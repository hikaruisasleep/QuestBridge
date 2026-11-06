import process from "node:process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  DEFAULT_TIMINGS,
  MAX_MESSAGE_BYTES,
  ProtocolError,
  SequenceTracker,
  createMessage,
  parseFrame,
  serializeMessage,
  type ErrorCode,
  type ProtocolMessage,
  type SnapshotRequestReason,
} from "@questbridge/protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { CollectorModel, type CollectorNotice } from "./collector-model.js";

/**
 * Standalone QuestBridge collector.
 *
 * It implements the host side of the Minecraft publisher handshake just far
 * enough to receive, validate, and display the mock adapter's data flow. It is
 * a development and user-testing tool; it is not the QuestBridge host and does
 * not implement chapter pins, display configuration, or browser connections.
 */

const COLLECTOR_VERSION = "0.1.0-collector";
const DEFAULT_PORT = 8765;
const DEFAULT_PATH = "/ws";
const HELLO_TIMEOUT_MS = 5_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export interface StartCollectorOptions {
  port: number;
  path?: string;
  staleAfterMs?: number;
  log?: (line: string) => void;
}

export interface CollectorHandle {
  readonly port: number;
  readonly url: string;
  readonly model: CollectorModel;
  close(): Promise<void>;
}

function toText(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) {
    return true;
  }
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function clock(timestamp: string): string {
  return timestamp.slice(11, 23);
}

function line(level: "info" | "warn" | "error", text: string): string {
  return `[${clock(new Date().toISOString())}] ${level.toUpperCase().padEnd(5)} ${text}`;
}

export async function startCollector(
  options: StartCollectorOptions,
): Promise<CollectorHandle> {
  const log = options.log ?? ((text: string): void => {
    process.stdout.write(`${text}\n`);
  });
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_TIMINGS.staleAfterMs;
  const path = options.path ?? DEFAULT_PATH;
  const model = new CollectorModel();

  let active: WebSocket | null = null;
  let helloReceived = false;
  let sessionId: string | null = null;
  let helloTimer: NodeJS.Timeout | null = null;
  const sequence = new SequenceTracker();

  const printNotice = (entry: CollectorNotice): void => {
    const receivedAt = clock(new Date().toISOString());
    log(`[${receivedAt}] ${entry.level.toUpperCase().padEnd(5)} ${entry.text}`);
  };

  const sendControl = (socket: WebSocket, message: ProtocolMessage): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(serializeMessage(message, "host_to_minecraft"));
    }
  };

  const sendWelcome = (socket: WebSocket): void => {
    sendControl(
      socket,
      createMessage(
        "host.welcome",
        {
          hostVersion: COLLECTOR_VERSION,
          ...DEFAULT_TIMINGS,
        },
        { timestamp: new Date().toISOString() },
      ) as ProtocolMessage,
    );
  };

  const sendRequestSnapshot = (socket: WebSocket, reason: SnapshotRequestReason): void => {
    sendControl(
      socket,
      createMessage(
        "host.request_snapshot",
        { reason },
        { timestamp: new Date().toISOString() },
      ) as ProtocolMessage,
    );
  };

  const sendError = (
    socket: WebSocket,
    code: ErrorCode,
    messageText: string,
    fatal: boolean,
  ): void => {
    sendControl(
      socket,
      createMessage(
        "host.error",
        { code, message: messageText, fatal },
        { timestamp: new Date().toISOString() },
      ) as ProtocolMessage,
    );
  };

  const clearHelloTimer = (): void => {
    if (helloTimer !== null) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }
  };

  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: options.port,
    path,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
    clientTracking: true,
  });

  try {
    await once(wss, "listening");
  } catch (error) {
    try {
      wss.close();
    } catch {
      // The server was never listening; there is nothing else to release.
    }
    throw error;
  }

  wss.on("error", (error) => {
    log(line("error", `server error: ${error.message}`));
  });

  const handleProtocolFailure = (socket: WebSocket, error: unknown): void => {
    const protocolError =
      error instanceof ProtocolError
        ? error
        : new ProtocolError(
            "invalid_message",
            error instanceof Error ? error.message : String(error),
          );
    const fatal = !helloReceived || protocolError.fatal;

    log(line("error", `${protocolError.code}: ${protocolError.message}`));
    sendError(socket, protocolError.code, protocolError.message, fatal);
    if (fatal) {
      socket.close(1002, protocolError.code);
    }
  };

  const handleMessage = (socket: WebSocket, data: RawData): void => {
    if (socket !== active) {
      return;
    }

    let message: ProtocolMessage;
    try {
      message = parseFrame(toText(data), "minecraft_to_host");
    } catch (error) {
      handleProtocolFailure(socket, error);
      return;
    }

    if (!helloReceived) {
      if (message.type !== "minecraft.hello") {
        handleProtocolFailure(
          socket,
          new ProtocolError("invalid_message", "First message must be minecraft.hello", {
            fatal: true,
          }),
        );
        return;
      }
      if (message.sequence !== 1) {
        handleProtocolFailure(
          socket,
          new ProtocolError("invalid_message", "minecraft.hello must use sequence 1", {
            fatal: true,
          }),
        );
        return;
      }

      helloReceived = true;
      sessionId = message.sessionId ?? null;
      clearHelloTimer();
      sendWelcome(socket);
    } else {
      if (message.type === "minecraft.hello") {
        handleProtocolFailure(
          socket,
          new ProtocolError("invalid_message", "Duplicate minecraft.hello", { fatal: true }),
        );
        return;
      }
      if ((message.sessionId ?? null) !== sessionId) {
        handleProtocolFailure(
          socket,
          new ProtocolError("session_mismatch", "sessionId changed mid-connection", {
            fatal: true,
          }),
        );
        return;
      }
    }

    const sequenceNumber = message.sequence;
    if (sequenceNumber === undefined) {
      handleProtocolFailure(
        socket,
        new ProtocolError("invalid_message", "minecraft messages require a sequence", {
          fatal: true,
        }),
      );
      return;
    }

    const observation = sequence.observe(sequenceNumber, {
      snapshot: message.type === "minecraft.snapshot",
    });

    if (observation === "duplicate") {
      log(line("warn", `duplicate sequence ${sequenceNumber} ignored`));
      return;
    }

    if (observation === "gap") {
      log(line("warn", `sequence gap at ${sequenceNumber}; requesting a fresh snapshot`));
      const stale = model.markStale(
        "sequence gap detected; requesting a fresh snapshot",
        message.timestamp,
      );
      if (stale !== null) {
        printNotice(stale);
      }
      sendRequestSnapshot(socket, "sequence_gap");
    }

    for (const entry of model.ingest(message)) {
      printNotice(entry);
    }
  };

  wss.on("connection", (socket, request) => {
    const remote = request.socket.remoteAddress ?? "unknown";
    const origin = request.headers.origin;

    if (!isAllowedOrigin(origin)) {
      log(line("warn", `rejected WebSocket origin ${String(origin)}`));
      sendError(socket, "unauthorized", "Origin is not allowed", true);
      socket.close(1008, "origin_not_allowed");
      return;
    }

    if (active !== null && active.readyState !== WebSocket.CLOSED) {
      log(line("warn", `rejected extra publisher from ${remote}`));
      sendError(
        socket,
        "invalid_request",
        "A Minecraft publisher is already connected",
        true,
      );
      socket.close(1008, "publisher_already_connected");
      return;
    }

    active = socket;
    helloReceived = false;
    sessionId = null;
    sequence.reset();
    clearHelloTimer();
    printNotice(model.connectionOpened(remote));

    helloTimer = setTimeout(() => {
      if (!helloReceived && socket.readyState === WebSocket.OPEN) {
        log(line("warn", "first message timeout; closing connection"));
        sendError(
          socket,
          "invalid_message",
          "First message must be minecraft.hello within 5 seconds",
          true,
        );
        socket.close(1008, "hello_timeout");
      }
    }, HELLO_TIMEOUT_MS);

    socket.on("message", (data) => {
      handleMessage(socket, data);
    });

    socket.on("error", (error) => {
      log(line("warn", `socket error: ${error.message}`));
    });

    socket.on("close", (code, reason) => {
      clearHelloTimer();
      if (socket !== active) {
        return;
      }
      active = null;
      helloReceived = false;
      sessionId = null;
      sequence.reset();
      const reasonText = reason.length === 0 ? "" : `: ${reason.toString()}`;
      printNotice(model.connectionClosed(`code ${code}${reasonText}`));
    });
  });

  const staleTimer = setInterval(() => {
    const stale = model.markStaleIfNeeded(Date.now(), staleAfterMs);
    if (stale !== null) {
      printNotice(stale);
    }
  }, 1_000);
  staleTimer.unref();

  const address = wss.address();
  if (address === null || typeof address === "string") {
    throw new Error("Collector did not expose a TCP address");
  }

  const close = async (): Promise<void> => {
    clearInterval(staleTimer);
    clearHelloTimer();
    for (const client of wss.clients) {
      client.terminate();
    }
    active = null;
    await new Promise<void>((resolve, reject) => {
      wss.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  };

  return {
    port: address.port,
    url: `ws://127.0.0.1:${address.port}${path}`,
    model,
    close,
  };
}

const USAGE = `QuestBridge standalone collector

Receives the Minecraft-side protocol from the mock publisher, validates every
message, and prints the normalized state. It is not the QuestBridge host.

Usage:
  node dist/collector.js [options]

Options:
  --port <number>         Loopback port (default: ${DEFAULT_PORT})
  --stale-after <ms>      Heartbeat staleness threshold (default: ${DEFAULT_TIMINGS.staleAfterMs})
  --help                  Show this help
`;

function parsePositiveInteger(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, received ${raw}`);
  }
  return value;
}

export async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      "stale-after": { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help === true) {
    process.stdout.write(USAGE);
    return;
  }

  const port = parsePositiveInteger(values.port, DEFAULT_PORT, "--port");
  if (port > 65_535) {
    throw new Error(`--port must be at most 65535, received ${port}`);
  }
  const staleAfterMs = parsePositiveInteger(
    values["stale-after"],
    DEFAULT_TIMINGS.staleAfterMs,
    "--stale-after",
  );

  const handle = await startCollector({ port, staleAfterMs });

  process.stdout.write(`QuestBridge collector listening on ${handle.url}\n`);
  process.stdout.write("Minecraft-side messages are validated and printed below.\n\n");
  process.stdout.write("Run the mock publisher in another terminal:\n");
  const mockCommand =
    handle.port === DEFAULT_PORT
      ? "  npm run mock -- --scenario=full --speed=5"
      : `  npm run mock -- --scenario=full --speed=5 --url=${handle.url}`;
  process.stdout.write(`${mockCommand}\n\n`);
  process.stdout.write("Press Ctrl+C to print the final state and stop.\n\n");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    process.stdout.write(`\nStopping collector (${signal}).\n\n`);

    try {
      await handle.close();
      process.exitCode = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`collector close failed: ${message}\n`);
      process.exitCode = 1;
    }

    process.stdout.write("=== Final collector state ===\n");
    for (const summaryLine of handle.model.summaryLines()) {
      process.stdout.write(`${summaryLine}\n`);
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

const invokedPath = process.argv[1];
const isMain =
  invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;

if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`collector failed: ${message}\n`);
    process.exitCode = 1;
  });
}
