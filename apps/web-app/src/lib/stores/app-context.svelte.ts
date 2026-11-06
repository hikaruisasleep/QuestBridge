import type { BrowserRole, ProtocolMessage, ResyncReason } from "@questbridge/protocol";

import { ProtocolClient, type ClientFailure, type ProtocolClientOptions } from "../protocol/client.js";
import type { LocationLike } from "../protocol/endpoint.js";
import {
  Selectors,
  applySection,
  applySnapshot,
  applyTransport,
  applyUpdate,
  createInitialState,
  type ClientAppState,
} from "./app-state.js";

/**
 * The page's single application context.
 *
 * One instance owns one `ProtocolClient` and one `ClientAppState`. Both routes
 * and the dashboard preview read from it, so the preview cannot drift from the
 * overlay it previews and no second socket is opened
 * (`docs/phase-3-plan.md` §3.3).
 *
 * Svelte 5 runes: `state` is a `$state` object, and mutating its properties in
 * place is what makes subscribers re-render. The pure reducer functions in
 * `app-state.ts` return new objects; this wrapper assigns the changed fields
 * across so reactivity stays granular.
 */
export class AppContext {
  state: ClientAppState = $state(createInitialState());

  /** The most recent error the host or transport reported, if any. */
  lastError = $state<{ code: string; message: string } | null>(null);

  /** Bumped whenever a resync is requested, so tests and logs can observe it. */
  resyncCount = $state(0);

  readonly selectors: Selectors;

  #client: ProtocolClient | null = null;
  #unsubscribes: Array<() => void> = [];

  constructor() {
    const context = this;
    this.selectors = new Selectors({
      getState: (): ClientAppState => context.state,
    });
  }

  get client(): ProtocolClient | null {
    return this.#client;
  }

  get transport(): ClientAppState["transport"] {
    return this.state.transport;
  }

  get failure(): ClientFailure | null {
    return this.state.failure;
  }

  /**
   * Start the connection.
   *
   * Idempotent: a second call from a component that mounts twice does not open
   * a second socket.
   */
  start(options: Omit<ProtocolClientOptions, "location"> & { location?: LocationLike }): void {
    if (this.#client !== null) {
      return;
    }

    const location: LocationLike =
      options.location ?? {
        protocol: globalThis.location.protocol,
        host: globalThis.location.host,
        search: globalThis.location.search,
      };

    const client = new ProtocolClient({ ...options, location });
    this.#client = client;

    this.#unsubscribes = [
      client.on("transport", (transport, failure) => {
        this.#apply(applyTransport(this.state, transport, failure));
      }),
      client.on("snapshot", (snapshot) => {
        this.#apply(applySnapshot(this.state, snapshot));
      }),
      client.on("update", (message: ProtocolMessage) => {
        this.#apply(applyUpdate(this.state, message));
      }),
      client.on("section", (message: ProtocolMessage) => {
        this.#apply(applySection(this.state, message));
      }),
      client.on("error", (error) => {
        this.lastError = { code: error.code, message: error.message };
      }),
      client.on("resync", () => {
        this.resyncCount += 1;
      }),
    ];

    client.connect();
  }

  /** Close the socket and detach. Used by tests. */
  dispose(): void {
    for (const unsubscribe of this.#unsubscribes) {
      unsubscribe();
    }
    this.#unsubscribes = [];
    this.#client?.dispose();
    this.#client = null;
  }

  pinChapter(chapterId: string): string | null {
    return this.#client?.pinChapter(chapterId) ?? null;
  }

  unpinChapter(chapterId: string): string | null {
    return this.#client?.unpinChapter(chapterId) ?? null;
  }

  reorderChapters(chapterIds: readonly string[]): string | null {
    return this.#client?.reorderChapters(chapterIds) ?? null;
  }

  updateDisplay(display: ClientAppState["display"]): string | null {
    return this.#client?.updateDisplay(display) ?? null;
  }

  resync(reason: ResyncReason = "manual"): void {
    this.#client?.resync(reason);
  }

  /** True when the socket is open and mutations can be sent. */
  get canMutate(): boolean {
    return this.#client !== null && this.state.transport === "open";
  }

  #apply(next: ClientAppState): void {
    if (next === this.state) {
      return;
    }
    // Assign changed fields individually so `$state` keeps per-field
    // granularity and unrelated sections do not invalidate subscribers.
    for (const key of Object.keys(next) as Array<keyof ClientAppState>) {
      if (this.state[key] !== next[key]) {
        (this.state as unknown as Record<string, unknown>)[key as string] = next[key];
      }
    }
  }
}

let sharedContext: AppContext | null = null;

/**
 * The shared context for this page.
 *
 * A module-level singleton rather than a Svelte context: both routes and the
 * preview must share one socket, and the lifetime is exactly the page's.
 */
export function getAppContext(): AppContext {
  sharedContext ??= new AppContext();
  return sharedContext;
}

/** Replace the shared context. Test-only. */
export function setAppContextForTests(context: AppContext | null): void {
  sharedContext = context;
}

export type { BrowserRole };
