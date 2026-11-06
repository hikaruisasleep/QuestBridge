import { MAX_MESSAGE_BYTES, serializeMessage, type ProtocolMessage } from "@questbridge/protocol";
import { WebSocket } from "ws";

import type { Scenario, ScenarioEvent } from "./scenarios.js";

/**
 * Scenario playback.
 *
 * The player is transport-agnostic so tests can replay scenarios without a
 * socket. `playOverWebSocket` binds it to a real `ws` client.
 */

export interface ScenarioTransport {
  send(message: ProtocolMessage): void;
  close(): Promise<void>;
}

export interface PlaybackOptions {
  /** Open the transport for a connection index (0 is the first). */
  open: (connection: number) => Promise<ScenarioTransport>;
  /** Sleep for the requested number of real milliseconds. */
  sleep: (ms: number) => Promise<void>;
  onEvent?: (event: ScenarioEvent) => void;
  signal?: AbortSignal;
}

export function abortError(): Error {
  const error = new Error("Playback aborted");
  error.name = "AbortError";
  return error;
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function playScenario(
  scenario: Scenario,
  options: PlaybackOptions,
): Promise<void> {
  let transport: ScenarioTransport | null = await options.open(0);
  let connection = 0;
  let previousAtMs = 0;

  const checkAbort = (): void => {
    if (options.signal?.aborted === true) {
      throw abortError();
    }
  };

  try {
    for (const event of scenario.events) {
      checkAbort();

      const waitMs = event.atMs - previousAtMs;
      if (waitMs > 0) {
        await options.sleep(waitMs);
        checkAbort();
      }
      previousAtMs = event.atMs;

      options.onEvent?.(event);

      if (event.kind === "open") {
        if (transport !== null) {
          throw new Error(
            `Scenario "${scenario.name}" opened connection ${event.connection} without closing the previous one`,
          );
        }
        if (event.connection !== connection + 1) {
          throw new Error(
            `Scenario "${scenario.name}" opened connection ${event.connection} after ${connection}`,
          );
        }
        transport = await options.open(event.connection);
        connection = event.connection;
        continue;
      }

      if (event.connection !== connection) {
        throw new Error(
          `Scenario "${scenario.name}" event for connection ${event.connection} arrived while connection ${connection} is active`,
        );
      }

      if (event.kind === "send") {
        if (transport === null) {
          throw new Error(
            `Scenario "${scenario.name}" sent ${event.message.type} on a closed connection`,
          );
        }
        transport.send(event.message);
      } else if (event.kind === "close") {
        if (transport === null) {
          throw new Error(`Scenario "${scenario.name}" closed an already closed connection`);
        }
        await transport.close();
        transport = null;
      }
    }

    const remainingMs = scenario.durationMs - previousAtMs;
    if (remainingMs > 0) {
      await options.sleep(remainingMs);
    }

    checkAbort();
  } finally {
    // Release the socket on normal completion, abort, or a transport failure.
    if (transport !== null) {
      const openTransport = transport;
      transport = null;
      try {
        await openTransport.close();
      } catch {
        // Closing is best-effort; the original error, if any, is more useful.
      }
    }
  }
}

/**
 * Play a scenario over a real WebSocket. Connection events close and reopen the
 * socket, which exercises adapter reconnect behavior.
 */
export async function playOverWebSocket(
  scenario: Scenario,
  options: {
    url: string;
    speed?: number;
    onSend?: (message: ProtocolMessage) => void;
    onTransportError?: (error: Error) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const speed = options.speed ?? 1;
  if (!(speed > 0) || !Number.isFinite(speed)) {
    throw new Error(`Playback speed must be a finite positive number, received ${speed}`);
  }

  await playScenario(scenario, {
    open: () =>
      openWebSocketTransport(options.url, options.onSend, options.onTransportError),
    sleep: (ms) => delay(Math.max(0, Math.round(ms / speed)), options.signal),
    signal: options.signal,
  });
}

export function openWebSocketTransport(
  url: string,
  onSend?: (message: ProtocolMessage) => void,
  onTransportError?: (error: Error) => void,
): Promise<ScenarioTransport> {
  return new Promise<ScenarioTransport>((resolve, reject) => {
    const socket = new WebSocket(url, {
      perMessageDeflate: false,
      maxPayload: MAX_MESSAGE_BYTES,
    });

    const handleInitialError = (error: Error): void => {
      socket.off("open", handleOpen);
      reject(error);
    };

    const handleOpen = (): void => {
      socket.off("error", handleInitialError);
      socket.on("error", (error: Error) => {
        onTransportError?.(error);
      });

      resolve({
        send(message: ProtocolMessage): void {
          const wire = serializeMessage(message, "minecraft_to_host");
          socket.send(wire);
          onSend?.(message);
        },
        close(): Promise<void> {
          return new Promise<void>((done) => {
            if (socket.readyState === WebSocket.CLOSED) {
              done();
              return;
            }
            socket.once("close", () => done());
            socket.close();
          });
        },
      });
    };

    socket.once("open", handleOpen);
    socket.once("error", handleInitialError);
  });
}
