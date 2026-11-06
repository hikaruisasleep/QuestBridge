import { createServer, type Server } from "node:http";
import { once } from "node:events";

import { HOST_VERSION, LOOPBACK_ADDRESS } from "./constants.js";
import { createHttpHandler } from "./http.js";
import { SILENT_LOGGER, type Logger } from "./logging.js";
import type { TokenStore } from "./auth.js";

/**
 * Host process lifecycle.
 *
 * Owns the loopback HTTP listener and graceful shutdown. The WebSocket server
 * attaches to this same listener in milestone 2E, which is why the listener is
 * exposed rather than hidden.
 */

export interface StartHostOptions {
  /** TCP port. `0` requests an ephemeral port, which tests rely on. */
  port: number;
  logger?: Logger;
  /**
   * Token store used to authorise connections. Omitted only by tests that
   * exercise the listener before 2D wiring; the WebSocket layer requires it.
   */
  tokens?: TokenStore;
  /** Override for tests that need deterministic uptime output. */
  now?: () => number;
}

export interface HostHandle {
  /** The port actually bound. Resolves `0` to the assigned port. */
  readonly port: number;
  /** Base URL, e.g. `http://127.0.0.1:8765`. */
  readonly url: string;
  readonly version: string;
  /** The underlying HTTP server, for attaching the WebSocket server later. */
  readonly server: Server;
  readonly logger: Logger;
  /** Token store backing this host, when one was supplied. */
  readonly tokens: TokenStore | undefined;
  /** Idempotent. Resolves once the listener is released. */
  close(): Promise<void>;
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Port must be an integer between 0 and 65535, received ${String(port)}`);
  }
}

export async function startHost(options: StartHostOptions): Promise<HostHandle> {
  validatePort(options.port);

  const logger = options.logger ?? SILENT_LOGGER;
  const now = options.now ?? ((): number => Date.now());
  const startedAtMs = now();

  const server = createServer(
    createHttpHandler({ version: HOST_VERSION, startedAtMs, logger }),
  );

  // Do not let a slow or malicious local peer hold a connection open forever.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  server.on("clientError", (error, socket) => {
    logger.warn(`client error: ${error.message}`);
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
  });

  // Bind to the loopback address only. `AGENTS.md` §13 forbids `0.0.0.0`, and
  // `docs/local-authentication.md` §1 relies on no remote traffic arriving.
  server.listen({ host: LOOPBACK_ADDRESS, port: options.port });

  try {
    await once(server, "listening");
  } catch (error) {
    // A failed bind must not leave a half-open listener behind.
    server.close();
    throw error;
  }

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Host did not expose a TCP address");
  }

  const port = address.port;
  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    if (closing !== null) {
      return closing;
    }

    closing = new Promise<void>((resolve, reject) => {
      // `closeAllConnections` is required because keep-alive sockets would
      // otherwise hold shutdown open until their timeout expires.
      server.closeAllConnections();
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    return closing;
  };

  return {
    port,
    url: `http://${LOOPBACK_ADDRESS}:${port}`,
    version: HOST_VERSION,
    server,
    logger,
    tokens: options.tokens,
    close,
  };
}
