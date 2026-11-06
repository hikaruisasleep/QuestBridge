import type {
  AppState,
  Chapter,
  ChapterPin,
  ChapterPinConfig,
  ConnectionState,
  DisplayConfig,
  MinecraftIdentity,
  ProtocolMessage,
  Quest,
} from "@questbridge/protocol";

import { INITIAL_CONNECTION, type ClientFailure, type TransportState } from "../protocol/client.js";

/**
 * Client-side application state.
 *
 * Host-authoritative fields mirror `AppState` exactly. The four client-only
 * fields are facts the host does not and should not track
 * (`docs/phase-3-plan.md` §5.2):
 *
 * - `transport` and `failure` describe this page's socket;
 * - `receivedSnapshot` distinguishes "the host has told us about an empty
 *   catalog" from "the host has told us nothing yet" — a distinction
 *   `docs/web-frontend.md` §3.3 requires the dashboard to render differently;
 * - `connectedOnce` lets the UI say "reconnecting" rather than "not
 *   authorized" once a session has existed.
 *
 * The store is a plain state machine with no Svelte dependency, so it is
 * testable directly in the Node test project. Components read it through the
 * store wrapper in `app-state.svelte.ts`.
 */
export interface ClientAppState {
  // --- host-authoritative ---
  revision: number;
  connection: ConnectionState;
  minecraft: MinecraftIdentity;
  chapters: Chapter[];
  quests: Quest[];
  unresolvedPinnedQuestIds: string[];
  chapterPins: ChapterPinConfig;
  display: DisplayConfig;

  // --- client-only ---
  transport: TransportState;
  failure: ClientFailure | null;
  /** True once any `state.snapshot` has been applied. */
  receivedSnapshot: boolean;
  /** True once the socket has ever reached `open`. */
  connectedOnce: boolean;
}

/** Default host-owned values, used before the first snapshot. */
export const EMPTY_CHAPTER_PINS: ChapterPinConfig = Object.freeze({
  maxPins: 5,
  pinnedChapters: [],
});

const EMPTY_IDENTITY: MinecraftIdentity = Object.freeze({ sessionId: null });

/** Canonical display defaults, mirroring the protocol's `DEFAULT_DISPLAY_CONFIG`. */
export const DISPLAY_DEFAULTS: DisplayConfig = Object.freeze({
  showChapterProgress: true,
  showQuestTasks: true,
  showCompletedQuests: true,
  completionAnimation: true,
  theme: "minimal",
  compactMode: true,
});

export function createInitialState(): ClientAppState {
  return {
    revision: -1,
    connection: { ...INITIAL_CONNECTION },
    minecraft: { ...EMPTY_IDENTITY },
    chapters: [],
    quests: [],
    unresolvedPinnedQuestIds: [],
    chapterPins: { maxPins: 5, pinnedChapters: [] },
    display: { ...DISPLAY_DEFAULTS },
    transport: "closed",
    failure: null,
    receivedSnapshot: false,
    connectedOnce: false,
  };
}

/**
 * Apply a full snapshot.
 *
 * Snapshots are always applied, even when their revision is older than the
 * current one (`docs/protocol.md` §7.3). They are self-contained, and refusing
 * one would leave the page stuck on data the host has moved past.
 */
export function applySnapshot(state: ClientAppState, snapshot: AppState): ClientAppState {
  return {
    ...state,
    revision: snapshot.revision,
    connection: { ...snapshot.connection },
    minecraft: { ...snapshot.minecraft },
    chapters: snapshot.chapters.map((chapter) => ({ ...chapter })),
    quests: snapshot.quests.map(cloneQuest),
    unresolvedPinnedQuestIds: [...snapshot.unresolvedPinnedQuestIds],
    chapterPins: clonePins(snapshot.chapterPins),
    display: { ...snapshot.display },
    receivedSnapshot: true,
    connectedOnce: true,
  };
}

/**
 * Apply a `state.update`.
 *
 * Every present section replaces its counterpart wholesale; it is never a patch
 * (`docs/protocol.md` §9.12). A revision that is not newer is ignored, except
 * that a repeat of the current revision is harmless and changes nothing.
 */
export function applyUpdate(state: ClientAppState, message: ProtocolMessage): ClientAppState {
  if (message.type !== "state.update") {
    return state;
  }

  const update = message.payload;
  if (update.revision < state.revision) {
    return state;
  }

  const next: ClientAppState = { ...state, revision: update.revision };

  if (update.connection !== undefined) {
    next.connection = { ...update.connection };
  }
  if (update.minecraft !== undefined) {
    next.minecraft = { ...update.minecraft };
  }
  if (update.chapters !== undefined) {
    next.chapters = update.chapters.map((chapter) => ({ ...chapter }));
  }
  if (update.quests !== undefined) {
    next.quests = update.quests.map(cloneQuest);
  }
  if (update.unresolvedPinnedQuestIds !== undefined) {
    next.unresolvedPinnedQuestIds = [...update.unresolvedPinnedQuestIds];
  }
  if (update.chapterPins !== undefined) {
    next.chapterPins = clonePins(update.chapterPins);
  }
  if (update.display !== undefined) {
    next.display = { ...update.display };
  }

  return next;
}

/** Apply a section-specific host message (`chapter.pins.update`, `config.update`, `connection.status`). */
export function applySection(state: ClientAppState, message: ProtocolMessage): ClientAppState {
  switch (message.type) {
    case "chapter.pins.update":
      return { ...state, chapterPins: clonePins(message.payload.chapterPins) };
    case "config.update":
      return { ...state, display: { ...message.payload.display } };
    case "connection.status":
      return { ...state, connection: { ...message.payload } };
    default:
      return state;
  }
}

/** Record a transport transition from the protocol client. */
export function applyTransport(
  state: ClientAppState,
  transport: TransportState,
  failure: ClientFailure | null,
): ClientAppState {
  return {
    ...state,
    transport,
    failure,
    connectedOnce: state.connectedOnce || transport === "open",
  };
}

function clonePins(pins: ChapterPinConfig): ChapterPinConfig {
  return {
    maxPins: pins.maxPins,
    pinnedChapters: pins.pinnedChapters.map((pin) => ({ ...pin })),
  };
}

function cloneQuest(quest: Quest): Quest {
  return {
    id: quest.id,
    chapterId: quest.chapterId,
    title: quest.title,
    optional: quest.optional,
    hidden: quest.hidden,
    dependencies: [...quest.dependencies],
    tasks: quest.tasks.map((task) => ({
      id: task.id,
      type: task.type,
      optional: task.optional,
      progress: { ...task.progress },
      ...(task.title === undefined ? {} : { title: task.title }),
    })),
    progress: { ...quest.progress },
    ...(quest.description === undefined ? {} : { description: quest.description }),
  };
}

/**
 * A pinned chapter as the UI consumes it: either resolved against the catalog
 * or explicitly unresolved, always in configured position order.
 */
export type PinnedChapter =
  | { kind: "resolved"; position: number; chapter: Chapter }
  | { kind: "unresolved"; position: number; chapterId: string };

export interface SelectorContext {
  getState(): ClientAppState;
}

/**
 * Read-only projections over `ClientAppState`.
 *
 * Every derivation the UI needs lives here and nowhere else, so a component
 * cannot quietly invent a second interpretation of the same data
 * (`AGENTS.md` §10.3). In particular these never infer completion from
 * `progress === 100`; completion is `status === "completed"` and nothing else
 * (`docs/protocol.md` §8.1).
 */
export class Selectors {
  readonly #ctx: SelectorContext;

  constructor(ctx: SelectorContext) {
    this.#ctx = ctx;
  }

  /** The complete discovered catalog, in host-provided order. */
  getChapterCatalog(): Chapter[] {
    return this.#ctx.getState().chapters;
  }

  /**
   * The configured chapter pins, joined against the catalog, in configured
   * order.
   *
   * This is the single place the join happens. Unresolved pins are preserved in
   * position rather than dropped or substituted, because they are user
   * configuration the host deliberately retains (`AGENTS.md` §8).
   */
  getPinnedChapters(): PinnedChapter[] {
    const state = this.#ctx.getState();
    const byId = new Map(state.chapters.map((chapter) => [chapter.id, chapter]));

    return [...state.chapterPins.pinnedChapters]
      .sort((a, b) => a.position - b.position)
      .map((pin: ChapterPin): PinnedChapter => {
        const chapter = byId.get(pin.chapterId);
        return chapter === undefined
          ? { kind: "unresolved", position: pin.position, chapterId: pin.chapterId }
          : { kind: "resolved", position: pin.position, chapter };
      });
  }

  /** Progress for one chapter, or `null` when unavailable. Never coerced to 0. */
  getChapterProgress(chapterId: string): number | null {
    const chapter = this.#ctx.getState().chapters.find((entry) => entry.id === chapterId);
    return chapter === undefined ? null : chapter.progress;
  }

  /** The manually pinned quests, in host-provided order. */
  getManuallyPinnedQuests(): Quest[] {
    return this.#ctx.getState().quests;
  }

  /** Host-reported connection status. */
  getConnectionStatus(): ConnectionState["status"] {
    return this.#ctx.getState().connection.status;
  }

  /** Configured pins whose chapter is absent from the current catalog. */
  getUnresolvedChapterPins(): string[] {
    const state = this.#ctx.getState();
    const catalogIds = new Set(state.chapters.map((chapter) => chapter.id));
    return state.chapterPins.pinnedChapters
      .filter((pin) => !catalogIds.has(pin.chapterId))
      .map((pin) => pin.chapterId);
  }

  /** Pinned quest IDs the host could not resolve against the quest file. */
  getUnresolvedPinnedQuestIds(): string[] {
    return this.#ctx.getState().unresolvedPinnedQuestIds;
  }

  /** True when the current pin set has no free slot. */
  isPinSetFull(): boolean {
    const state = this.#ctx.getState();
    return state.chapterPins.pinnedChapters.length >= state.chapterPins.maxPins;
  }

  /** True when a chapter ID is already pinned, resolved or not. */
  isPinned(chapterId: string): boolean {
    return this.#ctx
      .getState()
      .chapterPins.pinnedChapters.some((pin) => pin.chapterId === chapterId);
  }

  /**
   * Whether a snapshot has ever been applied.
   *
   * Distinguishes an empty catalog ("Minecraft reports no chapters") from an
   * absent one ("we have not heard from the host yet"), which
   * `docs/web-frontend.md` §3.3 requires the dashboard to render differently.
   */
  hasReceivedSnapshot(): boolean {
    return this.#ctx.getState().receivedSnapshot;
  }

  /** The overlay-wide fade state: disconnection only, never staleness. */
  isDisconnected(): boolean {
    return this.#ctx.getState().connection.status === "disconnected";
  }
}
