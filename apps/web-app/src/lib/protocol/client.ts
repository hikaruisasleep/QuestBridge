import {
  ProtocolError,
  RevisionTracker,
  SequenceCounter,
  SequenceTracker,
  createMessage,
  parseMessage,
  serializeMessage,
  type AppState,
  type BrowserRole,
  type ConnectionState,
  type DisplayConfig,
  type ProtocolMessage,
  type RequestErrorPayload,
  type ResyncReason,
} from "@questbridge/protocol";

import { resolveEndpoint, type EndpointOptions, type LocationLike } from "./endpoint.js";

/**
 * The single protocol client for a page.
 *
 * One socket exists per page for its whole lifetime; both routes use it and
 * neither opens its own (`docs/phase-3-plan.md` §5.1). The client owns the
 * transport lifecycle and nothing else: it does not hold application state, it
 * does not decide what an update means, and it does not re-implement sequence
 * or revision tracking — those come from `@questbridge/protocol`, so the host
 * and the browser cannot disagree about the ordering rules
 * (`docs/development.md` §7).
 *
 * Responsibilities:
 *
 * - connect, send `browser.hello`, and establish the role;
 * - reconnect with exponential backoff after any close;
 * - detect a sequence gap and request `state.resync` exactly once per gap;
 * - surface every inbound message and every lifecycle transition as an event.
 *
 * Deliberate non-responsibilities: no timers that poll, no retry of failed
 * mutations, and no interpretation of `request.error` codes. A rejected
 * mutation is the dashboard's to explain (`docs/web-frontend.md` §3.3), and
 * silently retrying one would be a second, unrequested attempt at a state
 * change.
 */

export type TransportState = "connecting" | "open" | "closed";

/**
 * Why the client is not connected, as far as the page can tell.
 *
 * A rejected WebSocket upgrade does not expose its HTTP status to JavaScript
 * (`docs/web-frontend.md` §3.2), so `unauthorized` is an inference from "we
 * were refused before ever reaching `open`", not a status code. It is named
 * honestly and never presented as a definitive diagnosis.
 */
export type ClientFailure = "unauthorized" | "unreachable";

export interface ClientSnapshot {
  state: AppState;
  /** True when this snapshot arrived from a live connection. */
  fromSocket: true;
}

export interface ClientErrorEvent {
  code: RequestErrorPayload["code"];
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

export interface ProtocolClientOptions {
  role: BrowserRole;
  /** Display text sent in `browser.hello`; never a credential. */
  clientName?: string;
  location: LocationLike;
  endpoint?: EndpointOptions;
  /** Injectable WebSocket constructor, for tests. */
  webSocketFactory?: (url: string) => WebSocket;
  /** Injectable timer functions, for deterministic backoff tests. */
  setTimeout?: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Injectable id generator for `requestId`. */
  requestId?: () => string;
  /**
   * Backoff schedule in milliseconds. After the last entry the final value is
   * reused, per `docs/protocol.md` §5.1 (1, 2, 4, 8 s capped at 30 s).
   */
  backoffMs?: readonly number[];
}

export interface ProtocolClientEvents {
  transport(state: TransportState, failure: ClientFailure | null): void;
  /** A full snapshot. Always replaces local state. */
  snapshot(state: AppState): void;
  /** An incremental update, already known to belong to a fresh revision. */
  update(message: ProtocolMessage): void;
  /** Authoritative section message (`chapter.pins.update`, `config.update`, `connection.status`). */
  section(message: ProtocolMessage): void;
  error(error: ClientErrorEvent): void;
  /** The client asked the host for a fresh snapshot. */
  resync(reason: ResyncReason): void;
}

const DEFAULT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 30_000] as const;

type Listener<K extends keyof ProtocolClientEvents> = ProtocolClientEvents[K];

export class ProtocolClient {
  readonly #options: ProtocolClientOptions;
  readonly #listeners = new Map<keyof ProtocolClientEvents, Set<(value: never) => void>>();

  readonly #sequence = new SequenceTracker();
  readonly #revision = new RevisionTracker();
  readonly #outbound = new SequenceCounter();

  #socket: WebSocket | null = null;
  #transport: TransportState = "closed";
  #failure: ClientFailure | null = null;
  #everOpened = false;
  /** True while a resync request is outstanding, to coalesce repeated gaps. */
  #resyncPending = false;
  #attempt = 0;
  #reconnectTimer: unknown = null;
  #disposed = false;

  constructor(options: ProtocolClientOptions) {
    this.#options = options;
  }

  get transport(): TransportState {
    return this.#transport;
  }

  get failure(): ClientFailure | null {
    return this.#failure;
  }

  /** Current local revision, or `-1` before the first snapshot. */
  get revision(): number {
    return this.#revision.lastRevision;
  }

  on<K extends keyof ProtocolClientEvents>(event: K, listener: Listener<K>): () => void {
    let set = this.#listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as (value: never) => void);
    return () => {
      set.delete(listener as (value: never) => void);
    };
  }

  /** Open the socket. Safe to call once; later calls are ignored. */
  connect(): void {
    if (this.#disposed || this.#socket !== null) {
      return;
    }
    this.#open();
  }

  /** Close the socket and stop reconnecting. */
  dispose(): void {
    this.#disposed = true;
    this.#cancelReconnect();
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      try {
        socket.close(1000, "client_disposed");
      } catch {
        // A socket that is already closing cannot be closed again; the close
        // handler is detached below, so nothing further depends on this.
      }
    }
    for (const set of this.#listeners.values()) {
      set.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  pinChapter(chapterId: string): string | null {
    return this.#sendMutation("chapter.pin", { chapterId });
  }

  unpinChapter(chapterId: string): string | null {
    return this.#sendMutation("chapter.unpin", { chapterId });
  }

  reorderChapters(chapterIds: readonly string[]): string | null {
    return this.#sendMutation("chapter.reorder", { chapterIds: [...chapterIds] });
  }

  updateDisplay(display: DisplayConfig): string | null {
    return this.#sendMutation("config.update", { display });
  }

  resync(reason: ResyncReason = "manual"): void {
    if (this.#socket === null || this.#transport !== "open") {
      return;
    }
    this.#resyncPending = true;
    this.#emit("resync", reason);
    this.#sendMessage(
      createMessage(
        "state.resync",
        { reason },
        { requestId: this.#nextRequestId() },
      ) as ProtocolMessage,
    );
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  #open(): void {
    let url: string;
    try {
      url = resolveEndpoint(this.#options.location, this.#options.endpoint ?? {}).url;
    } catch (error) {
      // A configuration error is terminal: retrying cannot fix a malformed
      // override, and a reconnect loop would hide the real problem.
      this.#setTransport("closed", "unreachable");
      this.#emit("error", {
        code: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    this.#setTransport("connecting", null);

    const factory =
      this.#options.webSocketFactory ?? ((value: string): WebSocket => new WebSocket(value));

    let socket: WebSocket;
    try {
      socket = factory(url);
    } catch {
      this.#setTransport("closed", this.#classifyFailure());
      this.#scheduleReconnect();
      return;
    }

    this.#socket = socket;
    // An injected factory must never have called back before this assignment.
    // Assigning here keeps the guard below meaningful for test doubles.
    Object.assign(socket, {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    });

    socket.onopen = (): void => {
      if (this.#socket !== socket) {
        return;
      }
      this.#everOpened = true;
      this.#attempt = 0;
      this.#setTransport("open", null);
      // A fresh connection restarts sequence numbering on the host side.
      this.#sequence.reset();
      this.#resyncPending = false;
      this.#sendHello();
    };

    socket.onmessage = (event: MessageEvent): void => {
      if (this.#socket !== socket) {
        return;
      }
      this.#handleFrame(event.data);
    };

    socket.onerror = (): void => {
      // `error` is always followed by `close`; the close handler owns recovery
      // so the two cannot race into two reconnect timers.
    };

    socket.onclose = (): void => {
      if (this.#socket !== socket) {
        return;
      }
      this.#socket = null;
      this.#setTransport("closed", this.#classifyFailure());
      // A disposed client must not schedule another attempt. The timer callback
      // also checks `disposed`, so this is defence in depth rather than the only
      // guard.
      if (!this.#disposed) {
        this.#scheduleReconnect();
      }
    };
  }

  #classifyFailure(): ClientFailure {
    // The page cannot see whether the upgrade was refused for a bad token or
    // because the host is gone (`docs/web-frontend.md` §3.2). The honest
    // distinction available is "we never reached open", which reads as
    // "unauthorized", versus "we were connected and lost it", which reads as
    // "unreachable".
    return this.#everOpened ? "unreachable" : "unauthorized";
  }

  #scheduleReconnect(): void {
    if (this.#disposed || this.#reconnectTimer !== null) {
      return;
    }
    const schedule = this.#options.backoffMs ?? DEFAULT_BACKOFF_MS;
    const delay = schedule[Math.min(this.#attempt, schedule.length - 1)] ?? 30_000;
    this.#attempt += 1;

    const set = this.#options.setTimeout ?? ((h: () => void, ms: number) => setTimeout(h, ms));
    this.#reconnectTimer = set(() => {
      this.#reconnectTimer = null;
      if (this.#disposed) {
        return;
      }
      this.#open();
    }, delay);
  }

  #cancelReconnect(): void {
    if (this.#reconnectTimer === null) {
      return;
    }
    const clear = this.#options.clearTimeout ?? ((h: unknown) => clearTimeout(h as number));
    clear(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }

  #sendHello(): void {
    const options: { requestId: string; sequence: number } = {
      requestId: this.#nextRequestId(),
      sequence: this.#outbound.next(),
    };
    const payload: { role: BrowserRole; clientName?: string } = { role: this.#options.role };
    if (this.#options.clientName !== undefined) {
      payload.clientName = this.#options.clientName;
    }
    this.#sendMessage(createMessage("browser.hello", payload, options) as ProtocolMessage);
  }

  #sendMessage(message: ProtocolMessage): void {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== 1) {
      return;
    }
    // Serialized as browser-to-host. `config.update` exists in both directions
    // with the same payload but different envelope rules, so the direction is
    // not optional here (`docs/phase-3-recon.md` §4.2).
    socket.send(serializeMessage(message, "browser_to_host"));
  }

  #sendMutation(
    type: "chapter.pin" | "chapter.unpin" | "chapter.reorder" | "config.update",
    payload: { chapterId: string } | { chapterIds: string[] } | { display: DisplayConfig },
  ): string | null {
    if (this.#socket === null || this.#transport !== "open") {
      return null;
    }
    // Every mutation carries a requestId so a rejection can be attributed to
    // the row that caused it (`docs/phase-3-recon.md` §4.1).
    const requestId = this.#nextRequestId();
    const message = createMessage(type, payload as never, {
      requestId,
      sequence: this.#outbound.next(),
    }) as ProtocolMessage;
    this.#sendMessage(message);
    return requestId;
  }

  #nextRequestId(): string {
    if (this.#options.requestId !== undefined) {
      return this.#options.requestId();
    }
    return `r${this.#outbound.next().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  #handleFrame(data: unknown): void {
    if (typeof data !== "string") {
      this.#emit("error", {
        code: "invalid_message",
        message: "The host sent a binary frame; QuestBridge protocol v1 is text-only",
      });
      return;
    }

    let message: ProtocolMessage;
    try {
      message = parseMessage(JSON.parse(data), "host_to_browser");
    } catch (error) {
      const code = error instanceof ProtocolError ? error.code : "invalid_message";
      this.#emit("error", {
        code,
        message: error instanceof Error ? error.message : String(error),
      });
      // An unsupported protocol version is fatal by contract; reconnecting
      // would loop forever against a host the page cannot talk to.
      if (code === "unsupported_protocol") {
        this.#disposeTransport();
      }
      return;
    }

    const sequence = message.sequence;
    if (sequence === undefined) {
      this.#emit("error", {
        code: "invalid_message",
        message: `Host message ${message.type} has no sequence`,
      });
      return;
    }

    const observation = this.#sequence.observe(sequence, {
      snapshot: message.type === "state.snapshot",
    });

    if (observation === "duplicate") {
      return;
    }

    if (observation === "gap") {
      // The snapshot itself is self-contained and was accepted by the tracker,
      // so a gap only matters for non-snapshot messages.
      this.#requestResync("sequence_gap");
      return;
    }

    switch (message.type) {
      case "state.snapshot": {
        const snapshot = message.payload;
        // Snapshots are always applied, per `docs/protocol.md` §7.3.
        this.#revision.observe(snapshot.revision, { snapshot: true });
        this.#resyncPending = false;
        this.#emit("snapshot", toAppState(snapshot));
        return;
      }

      case "state.update": {
        if (!this.#acceptRevision(message.payload.revision)) {
          return;
        }
        this.#emit("update", message);
        return;
      }

      case "chapter.pins.update":
      case "config.update":
      case "connection.status": {
        if (!this.#acceptSection(message)) {
          return;
        }
        this.#emit("section", message);
        return;
      }

      case "request.error": {
        const payload = message.payload;
        this.#emit("error", {
          code: payload.code,
          message: payload.message,
          ...(message.requestId === undefined ? {} : { requestId: message.requestId }),
          ...(payload.details === undefined ? {} : { details: payload.details }),
        });
        return;
      }

      default: {
        // `parseMessage` is typed against the whole v1 catalog even though the
        // direction restricts it, so a direction-invalid type can only be
        // reached by a parser bug. Report it rather than crashing the page.
        this.#emit("error", {
          code: "invalid_message",
          message: `Unsupported host message type ${(message as ProtocolMessage).type}`,
        });
      }
    }
  }

  /**
   * Accept or reject a revisioned message.
   *
   * The host sends a section message alongside the `state.update` for the same
   * change, carrying the **same** revision (`docs/phase-3-recon.md` §4.3). The
   * first message for a revision is accepted; the second is a benign repeat and
   * must not be treated as a gap or a stale update.
   *
   * `RevisionTracker` reports a repeat as `stale`, which would otherwise look
   * identical to "an old update arrived late". The distinction is made here, at
   * the revision boundary, rather than by teaching the shared tracker a new
   * state.
   */
  #acceptRevision(revision: number): boolean {
    if (revision === this.#revision.lastRevision) {
      return true;
    }

    const observation = this.#revision.observe(revision);
    switch (observation) {
      case "accepted":
        return true;
      case "stale":
        return false;
      case "gap":
        this.#requestResync("revision_gap");
        return false;
    }
  }

  /**
   * Section messages declare no revision, so they are accepted whenever a
   * snapshot has established a baseline. The paired `state.update` decides
   * ordering; a repeated section is idempotent by contract
   * (`docs/protocol.md` §9.12).
   */
  #acceptSection(message: ProtocolMessage): boolean {
    if (this.#revision.lastRevision < 0) {
      // Before the first snapshot there is no baseline to apply a delta to.
      return false;
    }
    void message;
    return true;
  }

  #requestResync(reason: ResyncReason): void {
    if (this.#resyncPending) {
      return;
    }
    this.resync(reason);
  }

  /**
   * Stop for good after a failure the page cannot recover from by retrying.
   *
   * The retry loop was already prevented elsewhere: the timer callback checks
   * `disposed` before opening, so a host speaking an unsupported protocol is not
   * retried repeatedly. Marking the client disposed here both cancels any timer
   * already queued and makes the intent explicit at the point of failure.
   */
  #disposeTransport(): void {
    this.#disposed = true;
    this.#cancelReconnect();

    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      try {
        socket.close(1000, "unsupported_protocol");
      } catch {
        // Already closed.
      }
    }
    this.#setTransport("closed", "unreachable");
  }

  #setTransport(state: TransportState, failure: ClientFailure | null): void {
    if (this.#transport === state && this.#failure === failure) {
      return;
    }
    this.#transport = state;
    this.#failure = failure;
    this.#emit("transport", state, failure);
  }

  #emit<K extends keyof ProtocolClientEvents>(
    event: K,
    ...args: Parameters<ProtocolClientEvents[K]>
  ): void {
    const set = this.#listeners.get(event);
    if (set === undefined) {
      return;
    }
    for (const listener of set) {
      (listener as (...values: unknown[]) => void)(...args);
    }
  }
}

/** Project a `state.snapshot` payload onto `AppState`. */
export function toAppState(payload: AppState): AppState {
  return payload;
}

/** The default connection state before any snapshot has been received. */
export const INITIAL_CONNECTION: ConnectionState = Object.freeze({
  status: "disconnected",
  stale: true,
  lastSnapshotAt: null,
  lastHeartbeatAt: null,
});
