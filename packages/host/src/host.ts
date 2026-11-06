import type { Server } from "node:http";

import {
  createMessage,
  type ChapterPinConfig,
  type ConnectionState,
  type DisplayConfig,
  type ProtocolMessage,
  type SnapshotRequestReason,
} from "@questbridge/protocol";

import { TokenStore } from "./auth.js";
import { BrowserSession } from "./browser-session.js";
import { ConfigStore } from "./config-store.js";
import { resolveChapterPins } from "./chapter-resolver.js";
import { pinChapter, pinnedIds, reorderChapters, unpinChapter } from "./chapter-pins.js";
import { fail, ok, type Result } from "./errors.js";
import { SILENT_LOGGER, type Logger } from "./logging.js";
import { MinecraftSession } from "./minecraft-session.js";
import { resolveConfigPaths, type ConfigPaths } from "./paths.js";
import { startHost } from "./server.js";
import { StateStore, type StateChange } from "./state-store.js";
import {
  attachWebSocketServer,
  type BrowserSessionFactory,
  type PeerConnection,
  type WebSocketHandle,
} from "./websocket.js";

/**
 * Complete host assembly.
 *
 * One object that owns the config store, token store, state store, HTTP
 * listener, and WebSocket transport. Both the CLI and the integration tests
 * build a host through `createHost`, so the tested path is the shipped path.
 */

export interface CreateHostOptions {
  /** Directory holding `config.json` and `tokens.json`. */
  configDir?: string;
  /** Explicit paths, overriding `configDir`. Used by tests. */
  paths?: ConfigPaths;
  /** TCP port; `0` requests an ephemeral port. */
  port?: number;
  logger?: Logger;
  /** Browser session factory, supplied by the browser milestone. */
  createBrowserSession?: BrowserSessionFactory;
  /** First-message deadline. Defaults to the protocol's 5 s. */
  helloTimeoutMs?: number;
  /** Injectable clock for deterministic staleness tests. */
  now?: () => number;
}

export interface Host {
  readonly port: number;
  readonly url: string;
  readonly version: string;
  readonly server: Server;
  readonly logger: Logger;
  readonly paths: ConfigPaths;
  readonly configStore: ConfigStore;
  readonly tokenStore: TokenStore;
  readonly stateStore: StateStore;
  readonly websocket: WebSocketHandle;
  readonly pins: PinOperations;
  /** Broadcast a committed change to every connected browser. */
  broadcast(change: StateChange): void;
  /** Stop accepting connections and release the listener. Idempotent. */
  close(): Promise<void>;
}

/**
 * Chapter pin and display mutations.
 *
 * Every method validates, persists atomically, and only then updates state, so
 * a failed write cannot leave memory ahead of disk — the ordering
 * `docs/phase-2-plan.md` §9 requires.
 *
 * A successful mutation returns the `StateChange` it produced. The caller
 * broadcasts it, which keeps the "persist, then publish" ordering visible at
 * the call site instead of hidden inside this class.
 */
export class PinOperations {
  readonly #configStore: ConfigStore;
  readonly #stateStore: StateStore;
  readonly #logger: Logger;

  constructor(configStore: ConfigStore, stateStore: StateStore, logger: Logger) {
    this.#configStore = configStore;
    this.#stateStore = stateStore;
    this.#logger = logger;
  }

  async pin(chapterId: string): Promise<Result<StateChange>> {
    const catalogIds = new Set(this.#stateStore.chapters.map((chapter) => chapter.id));
    const result = pinChapter(this.#configStore.chapterPins, chapterId, catalogIds);
    if (!result.ok) {
      return fail(result.error);
    }
    return this.#persistPins(result.value);
  }

  async unpin(chapterId: string): Promise<Result<StateChange>> {
    const result = unpinChapter(this.#configStore.chapterPins, chapterId);
    if (!result.ok) {
      return fail(result.error);
    }
    return this.#persistPins(result.value);
  }

  async reorder(chapterIds: readonly string[]): Promise<Result<StateChange>> {
    const result = reorderChapters(this.#configStore.chapterPins, chapterIds);
    if (!result.ok) {
      return fail(result.error);
    }
    return this.#persistPins(result.value);
  }

  async updateDisplay(display: DisplayConfig): Promise<Result<StateChange>> {
    try {
      await this.#configStore.replaceDisplay(display);
    } catch (error) {
      this.#logger.error(`failed to persist display configuration: ${describe(error)}`);
      return fail({
        code: "invalid_request",
        message: "Could not persist the display configuration",
      });
    }

    return ok(this.#stateStore.setDisplay(this.#configStore.display));
  }

  /** Pinned chapter ids in configuration order. */
  pinned(): string[] {
    return pinnedIds(this.#configStore.chapterPins);
  }

  /** Resolve configured pins against the live catalog. */
  resolution(): ReturnType<typeof resolveChapterPins> {
    return resolveChapterPins(this.#configStore.chapterPins, this.#stateStore.chapters);
  }

  async #persistPins(pins: ChapterPinConfig): Promise<Result<StateChange>> {
    try {
      await this.#configStore.replaceChapterPins(pins);
    } catch (error) {
      this.#logger.error(`failed to persist chapter pin configuration: ${describe(error)}`);
      return fail({
        code: "invalid_request",
        message: "Could not persist the chapter pin configuration",
      });
    }

    return ok(this.#stateStore.setChapterPins(this.#configStore.chapterPins));
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createHost(options: CreateHostOptions = {}): Promise<Host> {
  const logger = options.logger ?? SILENT_LOGGER;
  const paths =
    options.paths ??
    resolveConfigPaths(
      options.configDir === undefined
        ? {}
        : { env: { ...process.env, QUESTBRIDGE_CONFIG_DIR: options.configDir } },
    );

  const configStore = await ConfigStore.load({ filePath: paths.configFile, logger });
  const tokenStore = await TokenStore.load({ filePath: paths.tokensFile, logger });

  const stateStore = new StateStore({
    chapterPins: configStore.chapterPins,
    display: configStore.display,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  // Assigned by the `configure` hook, which runs before the listener binds.
  let websocket: WebSocketHandle | null = null;

  // The browser session needs the assembled `Host`, which does not exist until
  // `startHost` returns. The reference is filled in immediately afterwards and
  // is only dereferenced once a browser sends `browser.hello`, which cannot
  // happen before the host is listening.
  let hostRef: Host | null = null;

  const defaultBrowserSession: BrowserSessionFactory = (connection) => {
    if (hostRef === null) {
      logger.error("refused a browser connection: the host is not fully initialised");
      return null;
    }
    return new BrowserSession({
      connection,
      host: hostRef,
      logger,
    });
  };

  const base = await startHost({
    port: options.port ?? 0,
    logger,
    tokens: tokenStore,
    ...(options.now === undefined ? {} : { now: options.now }),
    configure: (server: Server) => {
      websocket = attachWebSocketServer(server, {
        tokens: tokenStore,
        logger,
        ...(options.helloTimeoutMs === undefined
          ? {}
          : { helloTimeoutMs: options.helloTimeoutMs }),
        createSession: (connection: PeerConnection) => {
          if (connection.role === "minecraft") {
            return new MinecraftSession({
              connection,
              store: stateStore,
              logger,
              onStateChange: (change) => broadcast(change),
            });
          }

          // The browser factory is injectable so tests can substitute a
          // session, but the real one is always available.
          const factory = options.createBrowserSession ?? defaultBrowserSession;
          return factory(connection);
        },
      });
    },
    onClose: async () => {
      await websocket?.close();
    },
  });

  if (websocket === null) {
    await base.close();
    throw new Error("WebSocket transport was not attached during host startup");
  }

  const transport: WebSocketHandle = websocket;

  function sendToBrowsers(message: ProtocolMessage): void {
    for (const session of transport.browserSessions()) {
      session.push?.(message);
    }
  }

  function broadcast(change: StateChange): void {
    if (change.sections.length === 0) {
      return;
    }

    const update = stateStore.buildUpdate(change);
    if (update === null) {
      return;
    }

    sendToBrowsers(
      createMessage("state.update", update, {
        timestamp: new Date().toISOString(),
      }) as ProtocolMessage,
    );

    // Section-specific messages accompany the update for the two host-owned
    // configuration sections and for connection status, so a dashboard can act
    // without diffing. Browsers must treat all of them idempotently.
    if (change.sections.includes("chapterPins")) {
      sendToBrowsers(
        createMessage(
          "chapter.pins.update",
          { chapterPins: stateStore.chapterPins },
          { timestamp: new Date().toISOString() },
        ) as ProtocolMessage,
      );
    }

    if (change.sections.includes("display")) {
      sendToBrowsers(
        createMessage(
          "config.update",
          { display: stateStore.display },
          { timestamp: new Date().toISOString() },
        ) as ProtocolMessage,
      );
    }

    if (change.sections.includes("connection")) {
      const connection: ConnectionState = stateStore.connection;
      sendToBrowsers(
        createMessage("connection.status", connection, {
          timestamp: new Date().toISOString(),
        }) as ProtocolMessage,
      );
    }
  }

  const assembled: Host = {
    port: base.port,
    url: base.url,
    version: base.version,
    server: base.server,
    logger,
    paths,
    configStore,
    tokenStore,
    stateStore,
    websocket: transport,
    pins: new PinOperations(configStore, stateStore, logger),
    broadcast,
    close: () => base.close(),
  };

  // Publish the reference the browser session factory awaits. A browser cannot
  // have connected before this point because the host was not listening, and
  // the factory refuses rather than guessing if it somehow is.
  hostRef = assembled;

  return assembled;
}

/** Build a `state.snapshot` message from current state. */
export function buildStateSnapshot(stateStore: StateStore, timestamp?: string): ProtocolMessage {
  return createMessage("state.snapshot", stateStore.snapshot(), {
    timestamp: timestamp ?? new Date().toISOString(),
  }) as ProtocolMessage;
}

/** Build a `host.request_snapshot` message. */
export function buildSnapshotRequest(reason: SnapshotRequestReason): ProtocolMessage {
  return createMessage("host.request_snapshot", { reason }) as ProtocolMessage;
}
