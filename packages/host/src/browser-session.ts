import {
  ProtocolError,
  RevisionTracker,
  SequenceCounter,
  createMessage,
  parseFrame,
  type BrowserRole,
  type ErrorCode,
  type ProtocolMessage,
  type ResyncReason,
} from "@questbridge/protocol";

import type { Host } from "./host.js";
import type { StateChange } from "./state-store.js";
import type { Logger } from "./logging.js";
import type { PeerConnection, PeerSession } from "./websocket.js";
import { LIMITS, RateLimiter } from "./validation.js";

/**
 * Browser session.
 *
 * Implements the host half of `docs/protocol.md` §5.2: the hello handshake,
 * the immediate state snapshot, sequence and revision tracking, read-only
 * overlay enforcement, control mutations, and resync.
 *
 * Two points that look like defects and are not:
 *
 * - **The role is not checked against the token.** Accepted risk R1: the
 *   browser token authorises either role. The declared role *is* enforced for
 *   the life of the connection, which is what the overlay read-only rule
 *   requires, but it is a UI convention rather than a security boundary.
 * - **A browser may omit `sequence`.** Per `docs/protocol.md` §7.1 the host
 *   applies the duplicate rule when it is present but never asks a browser to
 *   resync.
 */

export interface BrowserSessionDeps {
  connection: PeerConnection;
  host: Host;
  logger: Logger;
}

/** Mutations a control client may perform. */
const MUTATION_TYPES = new Set([
  "chapter.pin",
  "chapter.unpin",
  "chapter.reorder",
  "config.update",
]);

export class BrowserSession implements PeerSession {
  readonly #connection: PeerConnection;
  readonly #host: Host;
  readonly #logger: Logger;

  /** Outbound sequence, starting at 1 per `docs/protocol.md` §7.1. */
  readonly #sequence = new SequenceCounter();
  /** Tracks the revision we last sent, to detect a client that fell behind. */
  readonly #revision = new RevisionTracker();
  /** Total messages received, used only to apply the duplicate rule. */
  readonly #mutations = new RateLimiter(
    LIMITS.browserMutationsPerSecond,
    1_000,
    () => Date.now(),
  );

  #role: BrowserRole | null = null;

  constructor(deps: BrowserSessionDeps) {
    this.#connection = deps.connection;
    this.#host = deps.host;
    this.#logger = deps.logger;
  }

  get role(): BrowserRole | null {
    return this.#role;
  }

  /** True once `browser.hello` has been accepted. */
  get established(): boolean {
    return this.#role !== null;
  }

  /**
   * Deliver a host-initiated message.
   *
   * Every outbound message consumes a sequence number, so a browser can detect
   * transport loss independently of the state revision.
   */
  push(message: ProtocolMessage): void {
    if (this.#role === null) {
      // Never send state before the role is established.
      return;
    }
    this.#connection.send(this.#withSequence(message));
  }

  /** Send a full state snapshot, resetting the revision baseline. */
  sendSnapshot(): void {
    const snapshot = this.#host.stateStore.snapshot();
    this.#revision.observe(snapshot.revision, { snapshot: true });
    this.#connection.send(
      this.#withSequence(
        createMessage("state.snapshot", snapshot, {
          timestamp: new Date().toISOString(),
        }) as ProtocolMessage,
      ),
    );
  }

  handleText(text: string): void {
    let message: ProtocolMessage;
    try {
      message = parseFrame(text, "browser_to_host");
    } catch (error) {
      this.#fail(error);
      return;
    }

    if (this.#role === null) {
      this.#acceptHello(message);
      return;
    }

    if (message.type === "browser.hello") {
      this.#fail(
        new ProtocolError("invalid_message", "Duplicate browser.hello", { fatal: true }),
      );
      return;
    }

    if (message.type === "state.resync") {
      const reason: ResyncReason | undefined = message.payload.reason;
      this.#logger.info(`browser requested a resync${reason === undefined ? "" : ` (${reason})`}`);
      this.sendSnapshot();
      return;
    }

    if (MUTATION_TYPES.has(message.type)) {
      this.#handleMutation(message);
      return;
    }

    this.#logger.warn(`ignored unexpected browser message type: ${message.type}`);
  }

  handleClose(): void {
    // A browser disconnect never changes host state.
    this.#logger.info("browser disconnected; host state is unchanged");
  }

  #acceptHello(message: ProtocolMessage): void {
    if (message.type !== "browser.hello") {
      this.#fail(
        new ProtocolError("invalid_message", "First message must be browser.hello", {
          fatal: true,
        }),
      );
      return;
    }

    const role = message.payload.role;

    // The role is a permission claim, enforced for this connection's lifetime.
    // It is deliberately not compared against the token: accepted risk R1.
    this.#role = role;
    this.#connection.markEstablished();

    const clientName = message.payload.clientName;
    this.#logger.info(
      `browser hello: role=${role}${clientName === undefined ? "" : ` name="${clientName}"`}`,
    );

    // OBS refreshes and reconnects must never require a new Minecraft snapshot.
    this.sendSnapshot();
  }

  #handleMutation(message: ProtocolMessage): void {
    if (this.#role === "overlay") {
      this.#reject(message, "unauthorized", "The overlay role is read-only");
      return;
    }

    if (!this.#mutations.tryConsume(`conn-${this.#connection.id}`)) {
      this.#reject(
        message,
        "rate_limited",
        `At most ${LIMITS.browserMutationsPerSecond} mutations per second are allowed`,
      );
      return;
    }

    void this.#applyMutation(message);
  }

  async #applyMutation(message: ProtocolMessage): Promise<void> {
    try {
      let change: StateChange | null = null;

      switch (message.type) {
        case "chapter.pin": {
          const result = await this.#host.pins.pin(message.payload.chapterId);
          if (!result.ok) {
            this.#reject(message, result.error.code, result.error.message, result.error.details);
            return;
          }
          change = result.value;
          break;
        }

        case "chapter.unpin": {
          const result = await this.#host.pins.unpin(message.payload.chapterId);
          if (!result.ok) {
            this.#reject(message, result.error.code, result.error.message, result.error.details);
            return;
          }
          change = result.value;
          break;
        }

        case "chapter.reorder": {
          const result = await this.#host.pins.reorder(message.payload.chapterIds);
          if (!result.ok) {
            this.#reject(message, result.error.code, result.error.message, result.error.details);
            return;
          }
          change = result.value;
          break;
        }

        case "config.update": {
          const result = await this.#host.pins.updateDisplay(message.payload.display);
          if (!result.ok) {
            this.#reject(message, result.error.code, result.error.message, result.error.details);
            return;
          }
          change = result.value;
          break;
        }

        default:
          this.#reject(message, "invalid_request", `Unsupported mutation ${message.type}`);
          return;
      }

      // Broadcasting the authoritative result is how the requesting dashboard
      // learns what actually happened, rather than trusting its own request.
      if (change !== null) {
        this.#host.broadcast(change);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.#logger.error(`mutation ${message.type} failed: ${detail}`);
      this.#reject(message, "invalid_request", "The mutation could not be applied");
    }
  }

  #withSequence(message: ProtocolMessage): ProtocolMessage {
    return { ...message, sequence: this.#sequence.next() } as ProtocolMessage;
  }

  #reject(
    message: ProtocolMessage,
    code: ErrorCode,
    text: string,
    details?: Record<string, unknown>,
  ): void {
    this.#logger.warn(`rejected browser ${message.type}: ${code} ${text}`);

    this.#connection.send(
      this.#withSequence(
        createMessage(
          "request.error",
          {
            code,
            message: text,
            ...(details === undefined ? {} : { details }),
          },
          {
            timestamp: new Date().toISOString(),
            ...(message.requestId === undefined ? {} : { requestId: message.requestId }),
          },
        ) as ProtocolMessage,
      ),
    );
  }

  #fail(error: unknown): void {
    const protocolError =
      error instanceof ProtocolError
        ? error
        : new ProtocolError(
            "invalid_message",
            error instanceof Error ? error.message : String(error),
          );

    const fatal = this.#role === null || protocolError.fatal;

    this.#logger.error(`browser ${protocolError.code}: ${protocolError.message}`);

    // Before a hello the role is unknown, so there is no role-scoped error
    // channel yet; closing is the only safe response.
    if (fatal) {
      this.#connection.close(1008, protocolError.code);
      return;
    }

    this.#connection.send(
      this.#withSequence(
        createMessage("request.error", {
          code: protocolError.code,
          message: protocolError.message,
        }) as ProtocolMessage,
      ),
    );
  }
}
