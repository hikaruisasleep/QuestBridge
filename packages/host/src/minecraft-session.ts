import {
  DEFAULT_TIMINGS,
  HOST_TO_MINECRAFT_TYPES,
  ProtocolError,
  SequenceTracker,
  createMessage,
  parseFrame,
  type ErrorCode,
  type MinecraftHelloPayload,
  type ProtocolMessage,
  type SnapshotRequestReason,
} from "@questbridge/protocol";

import { HOST_VERSION } from "./constants.js";
import type { Logger } from "./logging.js";
import type { PeerConnection, PeerSession } from "./websocket.js";
import type { StateStore } from "./state-store.js";

/**
 * The Minecraft publisher session.
 *
 * Implements the host half of `docs/protocol.md` §5.1: the hello handshake,
 * session-id consistency, per-connection sequence tracking, snapshot and
 * incremental ingestion, and the stale/disconnect lifecycle.
 *
 * Only one publisher may be connected at a time; the transport enforces that
 * before a session is created, so this class assumes it is the sole publisher.
 */

export interface MinecraftSessionDeps {
  connection: PeerConnection;
  store: StateStore;
  logger: Logger;
  /** Notified after every committed state change. */
  onStateChange: (change: ReturnType<StateStore["markStale"]>) => void;
}

interface EstablishedHello {
  sessionId: string;
  payload: MinecraftHelloPayload;
}

export class MinecraftSession implements PeerSession {
  readonly #connection: PeerConnection;
  readonly #store: StateStore;
  readonly #logger: Logger;
  readonly #onStateChange: MinecraftSessionDeps["onStateChange"];
  readonly #sequence = new SequenceTracker();

  #hello: EstablishedHello | null = null;

  constructor(deps: MinecraftSessionDeps) {
    this.#connection = deps.connection;
    this.#store = deps.store;
    this.#logger = deps.logger;
    this.#onStateChange = deps.onStateChange;
  }

  /** True once a valid `minecraft.hello` has been accepted. */
  get established(): boolean {
    return this.#hello !== null;
  }

  get sessionId(): string | null {
    return this.#hello?.sessionId ?? null;
  }

  /** Ask the adapter for a fresh full snapshot. */
  requestSnapshot(reason: SnapshotRequestReason): void {
    this.#connection.send(
      createMessage("host.request_snapshot", { reason }) as ProtocolMessage,
    );
  }

  handleText(text: string): void {
    let message: ProtocolMessage;
    try {
      message = parseFrame(text, "minecraft_to_host");
    } catch (error) {
      this.#fail(error);
      return;
    }

    if (this.#hello === null) {
      this.#acceptHello(message);
      return;
    }

    if (message.type === "minecraft.hello") {
      this.#fail(
        new ProtocolError("invalid_message", "Duplicate minecraft.hello", { fatal: true }),
      );
      return;
    }

    if ((message.sessionId ?? null) !== this.#hello.sessionId) {
      this.#fail(
        new ProtocolError("session_mismatch", "sessionId changed mid-connection", {
          fatal: true,
        }),
      );
      return;
    }

    const sequence = message.sequence;
    if (sequence === undefined) {
      this.#fail(
        new ProtocolError("invalid_message", "minecraft messages require a sequence", {
          fatal: true,
        }),
      );
      return;
    }

    const observation = this.#sequence.observe(sequence, {
      snapshot: message.type === "minecraft.snapshot",
    });

    if (observation === "duplicate") {
      this.#logger.warn(
        `publisher sequence ${sequence} is a duplicate or replay; ignored without changing state`,
      );
      return;
    }

    if (observation === "gap") {
      this.#logger.warn(
        `publisher sequence gap at ${sequence}; marking stale and requesting a fresh snapshot`,
      );
      this.#emit(this.#store.markStale());
      this.requestSnapshot("sequence_gap");
    }

    this.#ingest(message);
  }

  handleClose(): void {
    // Retain the snapshot but mark it stale; the overlay must not present
    // disconnected progression as live.
    this.#emit(this.#store.publisherDisconnected());
  }

  #acceptHello(message: ProtocolMessage): void {
    if (message.type !== "minecraft.hello") {
      this.#fail(
        new ProtocolError("invalid_message", "First message must be minecraft.hello", {
          fatal: true,
        }),
      );
      return;
    }

    if (message.sequence !== 1) {
      this.#fail(
        new ProtocolError("invalid_message", "minecraft.hello must use sequence 1", {
          fatal: true,
        }),
      );
      return;
    }

    const sessionId = message.sessionId;
    if (sessionId === undefined || sessionId.length === 0) {
      this.#fail(
        new ProtocolError("invalid_message", "minecraft.hello requires a sessionId", {
          fatal: true,
        }),
      );
      return;
    }

    const payload = message.payload;
    this.#hello = { sessionId, payload };
    this.#sequence.reset();
    // The hello consumed sequence 1; expect 2 next.
    this.#sequence.observe(1);

    this.#connection.markEstablished();

    this.#logger.info(
      `publisher hello: MC ${payload.minecraftVersion}, NeoForge ${payload.neoForgeVersion}, ` +
        `FTB Quests ${payload.ftbQuestsVersion}, FTB Teams ${payload.ftbTeamsVersion}, ` +
        `mod ${payload.modVersion}`,
    );

    this.#connection.send(
      createMessage("host.welcome", {
        hostVersion: HOST_VERSION,
        ...DEFAULT_TIMINGS,
      }) as ProtocolMessage,
    );

    this.#emit(this.#store.publisherConnected(sessionId));
  }

  #ingest(message: ProtocolMessage): void {
    switch (message.type) {
      case "minecraft.status":
        this.#emit(this.#store.applyStatus(message.payload.phase, message.payload.detail));
        return;

      case "minecraft.snapshot":
        this.#emit(this.#store.applySnapshot(message.payload));
        return;

      case "minecraft.progress":
        this.#emit(
          this.#store.applyProgress(message.payload, (warning) => this.#logger.warn(warning)),
        );
        return;

      case "minecraft.pins":
        this.#emit(this.#store.applyPins(message.payload));
        return;

      case "minecraft.heartbeat":
        this.#emit(this.#store.heartbeat(message.timestamp, message.payload.ready));
        return;

      default:
        this.#logger.warn(`ignored unexpected Minecraft message type: ${message.type}`);
    }
  }

  /** Report a protocol failure and close when it is fatal. */
  #fail(error: unknown): void {
    const protocolError =
      error instanceof ProtocolError
        ? error
        : new ProtocolError(
            "invalid_message",
            error instanceof Error ? error.message : String(error),
          );

    // Before a hello, any failure is fatal: the role was never established.
    const fatal = this.#hello === null || protocolError.fatal;

    this.#logger.error(`publisher ${protocolError.code}: ${protocolError.message}`);

    this.#connection.send(
      createMessage("host.error", {
        code: protocolError.code as ErrorCode,
        message: protocolError.message,
        fatal,
      }) as ProtocolMessage,
    );

    if (fatal) {
      this.#connection.close(1008, protocolError.code);
    }
  }

  #emit(change: ReturnType<StateStore["markStale"]>): void {
    if (change.sections.length === 0) {
      return;
    }
    this.#onStateChange(change);
  }
}

/** True when a message type is a host-to-Minecraft control message. */
export function isHostToMinecraftType(type: string): boolean {
  return (HOST_TO_MINECRAFT_TYPES as readonly string[]).includes(type);
}
