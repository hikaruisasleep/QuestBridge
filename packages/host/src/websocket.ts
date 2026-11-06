import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import { MAX_MESSAGE_BYTES, type ProtocolMessage, serializeMessage } from "@questbridge/protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { TokenStore, TokenRole } from "./auth.js";
import { WEBSOCKET_PATH } from "./constants.js";
import { isLoopbackHostHeader, pathnameOf } from "./http.js";
import type { Logger } from "./logging.js";
import { LIMITS, RateLimiter, isAllowedOrigin } from "./validation.js";

/**
 * WebSocket transport.
 *
 * This module owns everything that is true of *every* connection regardless of
 * role: the upgrade handshake, loopback `Host` validation, origin policy, token
 * authentication, frame limits, and connection rate limits. Role-specific
 * semantics live in the session classes.
 *
 * Two design points worth stating, because both look like oversights and are
 * not:
 *
 * - **There is one authentication checkpoint: the upgrade.** Page requests are
 *   not gated (`docs/local-authentication.md` §3).
 * - **Origins are matched by hostname only, ignoring the port** (accepted risk
 *   R2). Tightening this would break the Phase 3 development-server workflow.
 */

export type PeerRole = "minecraft" | "browser";

/**
 * Hard frame ceiling enforced by `ws` before a frame is buffered.
 *
 * Deliberately above the protocol limit so a frame between 256 KiB and this
 * ceiling reaches `handleText`, where it is rejected with the documented
 * `message_too_large` error rather than a bare socket termination. Frames above
 * this ceiling are an abuse case and are dropped by `ws`.
 */
const HARD_MAX_FRAME_BYTES = MAX_MESSAGE_BYTES * 4;

/** WebSocket close code for a policy violation. */
const CLOSE_POLICY = 1008;
/** WebSocket close code for an unexpected internal condition. */
const CLOSE_UNEXPECTED = 1011;

export interface PeerConnection {
  readonly id: number;
  readonly role: PeerRole;
  readonly remoteAddress: string;
  readonly origin: string | undefined;
  /** Serialize for this peer's direction and send. Invalid messages throw. */
  send(message: ProtocolMessage): void;
  close(code: number, reason: string): void;
  /**
   * Signal that the peer's first message was accepted, cancelling the
   * first-message timeout.
   */
  markEstablished(): void;
}

export interface PeerSession {
  /** Handle an inbound text frame that already passed size checks. */
  handleText(text: string): void;
  /** Handle socket close. */
  handleClose(): void;
  /**
   * Deliver a host-initiated message.
   *
   * Implemented by browser sessions, which the host pushes state to. A
   * Minecraft session does not implement it: the host only ever sends the
   * adapter control messages it has explicitly decided to send, never a
   * generic push.
   */
  push?(message: ProtocolMessage): void;
}

/**
 * Create a session for an authenticated connection.
 *
 * Returning `null` refuses the connection, which is how a role that is not yet
 * implemented is declined without inventing a fake session.
 */
export type SessionFactory = (connection: PeerConnection) => PeerSession | null;

/**
 * Alias for the factory used specifically for browser connections.
 *
 * Identical in shape to `SessionFactory`; the distinct name documents the
 * intent at the assembly site.
 */
export type BrowserSessionFactory = SessionFactory;

export interface WebSocketDeps {
  tokens: TokenStore;
  logger: Logger;
  createSession: SessionFactory;
  /** First-message deadline. Defaults to 5 s per the protocol. */
  helloTimeoutMs?: number;
  now?: () => number;
}

export interface WebSocketHandle {
  /** Live browser sessions, for broadcasting host-to-browser messages. */
  browserSessions(): PeerSession[];
  /** True when a Minecraft publisher is currently connected. */
  readonly hasPublisher: boolean;
  close(): Promise<void>;
}

function directionFor(role: PeerRole): "host_to_minecraft" | "host_to_browser" {
  return role === "minecraft" ? "host_to_minecraft" : "host_to_browser";
}

function extractToken(request: IncomingMessage, url: URL): string | null {
  const header = request.headers.authorization;
  if (typeof header === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match !== null && match[1] !== undefined && match[1].length > 0) {
      return match[1];
    }
  }

  const queryToken = url.searchParams.get("token");
  if (queryToken !== null && queryToken.length > 0) {
    return queryToken;
  }

  return null;
}

function respondRaw(socket: Duplex, status: number, reason: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "connection: close\r\n" +
      "content-length: 0\r\n" +
      "referrer-policy: no-referrer\r\n" +
      "\r\n",
  );
  socket.destroy();
}

function toText(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return Buffer.from(data as Buffer).toString("utf8");
}

export function attachWebSocketServer(server: Server, deps: WebSocketDeps): WebSocketHandle {
  const { tokens, logger } = deps;
  const now = deps.now ?? ((): number => Date.now());
  const helloTimeoutMs = deps.helloTimeoutMs ?? 5_000;

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: HARD_MAX_FRAME_BYTES,
    clientTracking: false,
  });

  const newMinecraftLimiter = new RateLimiter(LIMITS.newMinecraftConnectionsPerMinute, 60_000, now);
  const newBrowserLimiter = new RateLimiter(LIMITS.newBrowserConnectionsPerMinute, 60_000, now);

  let nextConnectionId = 1;
  let activePublisher: PeerConnection | null = null;
  const sessions = new Map<PeerConnection, { session: PeerSession; socket: WebSocket; role: PeerRole }>();

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const rawUrl = request.url ?? "/";
    const path = pathnameOf(rawUrl);

    if (path !== WEBSOCKET_PATH) {
      logger.warn(`rejected upgrade for unknown path: ${path}`);
      respondRaw(socket, 404, "Not Found");
      return;
    }

    // `Host` validation first: it is what defeats DNS rebinding.
    if (!isLoopbackHostHeader(request.headers.host)) {
      logger.warn(
        `rejected upgrade with disallowed Host: ${request.headers.host ?? "(none)"}`,
      );
      respondRaw(socket, 403, "Forbidden");
      return;
    }

    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin)) {
      logger.warn(`rejected upgrade from disallowed origin: ${String(origin)}`);
      respondRaw(socket, 403, "Forbidden");
      return;
    }

    let url: URL;
    try {
      url = new URL(rawUrl, "http://127.0.0.1");
    } catch {
      respondRaw(socket, 400, "Bad Request");
      return;
    }

    const presented = extractToken(request, url);
    const tokenRole: TokenRole | null = tokens.roleFor(presented);

    if (tokenRole === null) {
      logger.warn("rejected upgrade with a missing or invalid token");
      respondRaw(socket, 401, "Unauthorized");
      return;
    }

    const role: PeerRole = tokenRole === "minecraft" ? "minecraft" : "browser";

    // A native client sends no Origin. Only the Minecraft token authorises that,
    // because a browser always sends one.
    if (origin === undefined && tokenRole !== "minecraft") {
      logger.warn("rejected a browser connection with no Origin header");
      respondRaw(socket, 403, "Forbidden");
      return;
    }

    const remoteAddress = request.socket.remoteAddress ?? "unknown";

    if (role === "minecraft") {
      if (activePublisher !== null) {
        logger.warn(`rejected a second Minecraft publisher from ${remoteAddress}`);
        respondRaw(socket, 409, "Conflict");
        return;
      }
      if (!newMinecraftLimiter.tryConsume(remoteAddress)) {
        logger.warn("rejected a Minecraft connection: rate limit exceeded");
        respondRaw(socket, 429, "Too Many Requests");
        return;
      }
    } else if (!newBrowserLimiter.tryConsume(remoteAddress)) {
      logger.warn("rejected a browser connection: rate limit exceeded");
      respondRaw(socket, 429, "Too Many Requests");
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      setupConnection(ws, request, role, remoteAddress, origin);
    });
  });

  wss.on("error", (error) => {
    logger.error(`websocket server error: ${error.message}`);
  });

  function setupConnection(
    socket: WebSocket,
    _request: IncomingMessage,
    role: PeerRole,
    remoteAddress: string,
    origin: string | undefined,
  ): void {
    const id = nextConnectionId;
    nextConnectionId += 1;

    let established = false;
    let helloTimer: NodeJS.Timeout | null = null;

    const connection: PeerConnection = {
      id,
      role,
      remoteAddress,
      origin,
      send(message: ProtocolMessage): void {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }
        try {
          socket.send(serializeMessage(message, directionFor(role)));
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          logger.error(`refused to send an invalid ${message.type}: ${detail}`);
        }
      },
      close(code: number, reason: string): void {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(code, reason);
        }
      },
      markEstablished(): void {
        established = true;
        if (helloTimer !== null) {
          clearTimeout(helloTimer);
          helloTimer = null;
        }
      },
    };

    const session = deps.createSession(connection);

    if (session === null) {
      logger.warn(`refused a ${role} connection: no session is available for this role`);
      socket.close(CLOSE_UNEXPECTED, "role_not_supported");
      return;
    }

    if (role === "minecraft") {
      activePublisher = connection;
    }

    sessions.set(connection, { session, socket, role });

    logger.info(`connection ${id} opened (${role}) from ${remoteAddress}`);

    helloTimer = setTimeout(() => {
      if (established) {
        return;
      }
      logger.warn(`connection ${id} did not send a valid first message within ${helloTimeoutMs}ms`);
      if (role === "minecraft") {
        connection.send({
          protocolVersion: 1,
          type: "host.error",
          timestamp: new Date().toISOString(),
          payload: {
            code: "invalid_message",
            message: "First message must be minecraft.hello within 5 seconds",
            fatal: true,
          },
        });
      }
      socket.close(CLOSE_POLICY, "hello_timeout");
    }, helloTimeoutMs);
    helloTimer.unref();

    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        logger.warn(`connection ${id} sent a binary frame; closing`);
        if (role === "minecraft") {
          connection.send({
            protocolVersion: 1,
            type: "host.error",
            timestamp: new Date().toISOString(),
            payload: {
              code: "invalid_message",
              message: "Binary frames are not supported",
              fatal: true,
            },
          });
        }
        socket.close(CLOSE_POLICY, "binary_not_supported");
        return;
      }

      const text = toText(data);

      // Enforced here as well as by `ws` so the protocol error can be reported.
      if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
        logger.warn(`connection ${id} sent an oversized frame; closing`);
        if (role === "minecraft") {
          connection.send({
            protocolVersion: 1,
            type: "host.error",
            timestamp: new Date().toISOString(),
            payload: {
              code: "message_too_large",
              message: `Frames must not exceed ${MAX_MESSAGE_BYTES} bytes`,
              fatal: true,
            },
          });
        }
        socket.close(CLOSE_POLICY, "message_too_large");
        return;
      }

      try {
        session.handleText(text);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.error(`connection ${id} handler failure: ${detail}`);
      }
    });

    socket.on("error", (error: Error) => {
      logger.warn(`connection ${id} socket error: ${error.message}`);
    });

    socket.on("close", (code: number, reason: Buffer) => {
      if (helloTimer !== null) {
        clearTimeout(helloTimer);
        helloTimer = null;
      }
      sessions.delete(connection);
      if (activePublisher === connection) {
        activePublisher = null;
      }
      const reasonText = reason.length === 0 ? "" : `: ${reason.toString("utf8")}`;
      logger.info(`connection ${id} closed (${role}, code ${code}${reasonText})`);

      try {
        session.handleClose();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.error(`connection ${id} close handler failure: ${detail}`);
      }
    });
  }

  return {
    browserSessions(): PeerSession[] {
      const result: PeerSession[] = [];
      for (const entry of sessions.values()) {
        if (entry.role === "browser") {
          result.push(entry.session);
        }
      }
      return result;
    },
    get hasPublisher(): boolean {
      return activePublisher !== null;
    },
    close(): Promise<void> {
      for (const entry of sessions.values()) {
        entry.socket.terminate();
      }
      sessions.clear();
      activePublisher = null;

      return new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
