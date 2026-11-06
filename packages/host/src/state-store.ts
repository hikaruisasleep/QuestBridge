import {
  DEFAULT_TIMINGS,
  type Chapter,
  type ChapterPinConfig,
  type ConnectionState,
  type ConnectionStatus,
  type DisplayConfig,
  type MinecraftIdentity,
  type MinecraftPinsPayload,
  type MinecraftProgressPayload,
  type MinecraftSnapshotPayload,
  type MinecraftStatusPhase,
  type Quest,
  type StateUpdatePayload,
} from "@questbridge/protocol";

/**
 * Normalized host state.
 *
 * One `AppState` is the single source of truth for browsers
 * (`docs/phase-2-plan.md` §11). The store guarantees:
 *
 * - the revision starts at `0` and increments once per *committed state
 *   change*; a mutation that changes nothing must not move it, because a
 *   revision bump is what triggers a broadcast and the host must never
 *   broadcast unchanged state on a timer;
 * - the last Minecraft snapshot is retained across a disconnect but marked
 *   stale, so the overlay can show that progression is not live;
 * - progression is never fabricated: before the first snapshot the catalog and
 *   objectives are empty, and unavailable values stay `null`;
 * - a new publisher's data replaces the old catalog only when its first valid
 *   snapshot arrives, so a reconnect cannot mix two worlds.
 */

/** Top-level state sections that a change can affect. */
export type StateSection =
  | "connection"
  | "minecraft"
  | "chapters"
  | "quests"
  | "unresolvedPinnedQuestIds"
  | "chapterPins"
  | "display";

/** Sections changed by one committed mutation, with the resulting revision. */
export interface StateChange {
  revision: number;
  sections: StateSection[];
}

const NO_SECTIONS: readonly StateSection[] = [];

function shallowEqualIdentity(a: MinecraftIdentity, b: MinecraftIdentity): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.worldName === b.worldName &&
    a.dimension === b.dimension &&
    a.teamId === b.teamId &&
    a.teamName === b.teamName
  );
}

function equalConnection(a: ConnectionState, b: ConnectionState): boolean {
  return (
    a.status === b.status &&
    a.stale === b.stale &&
    a.lastSnapshotAt === b.lastSnapshotAt &&
    a.lastHeartbeatAt === b.lastHeartbeatAt &&
    a.error === b.error
  );
}

function equalChapters(a: readonly Chapter[], b: readonly Chapter[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((chapter, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      chapter.id === other.id &&
      chapter.title === other.title &&
      chapter.subtitle === other.subtitle &&
      chapter.order === other.order &&
      chapter.progress === other.progress &&
      chapter.status === other.status
    );
  });
}

function equalQuests(a: readonly Quest[], b: readonly Quest[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  // Quests are replaced wholesale from snapshots and pins messages, so a
  // reference check is sufficient and avoids deep comparison cost per tick.
  return a.every((quest, index) => deepEqualQuest(quest, b[index]));
}

function deepEqualQuest(a: Quest | undefined, b: Quest | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  if (
    a.id !== b.id ||
    a.chapterId !== b.chapterId ||
    a.title !== b.title ||
    a.description !== b.description ||
    a.optional !== b.optional ||
    a.hidden !== b.hidden ||
    a.dependencies.length !== b.dependencies.length ||
    a.tasks.length !== b.tasks.length
  ) {
    return false;
  }
  if (a.dependencies.some((id, index) => id !== b.dependencies[index])) {
    return false;
  }
  if (
    a.progress.status !== b.progress.status ||
    a.progress.completedTasks !== b.progress.completedTasks ||
    a.progress.totalRequiredTasks !== b.progress.totalRequiredTasks ||
    a.progress.percentage !== b.progress.percentage
  ) {
    return false;
  }
  return a.tasks.every((task, index) => {
    const other = b.tasks[index];
    return (
      other !== undefined &&
      task.id === other.id &&
      task.type === other.type &&
      task.title === other.title &&
      task.optional === other.optional &&
      task.progress.status === other.progress.status &&
      task.progress.current === other.progress.current &&
      task.progress.target === other.progress.target &&
      task.progress.percentage === other.progress.percentage &&
      task.progress.unit === other.progress.unit
    );
  });
}

function equalStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function equalPinConfig(a: ChapterPinConfig, b: ChapterPinConfig): boolean {
  if (a.maxPins !== b.maxPins || a.pinnedChapters.length !== b.pinnedChapters.length) {
    return false;
  }
  return a.pinnedChapters.every((pin, index) => {
    const other = b.pinnedChapters[index];
    return (
      other !== undefined && pin.chapterId === other.chapterId && pin.position === other.position
    );
  });
}

function equalDisplay(a: DisplayConfig, b: DisplayConfig): boolean {
  return (
    a.showChapterProgress === b.showChapterProgress &&
    a.showQuestTasks === b.showQuestTasks &&
    a.showCompletedQuests === b.showCompletedQuests &&
    a.completionAnimation === b.completionAnimation &&
    a.theme === b.theme &&
    a.compactMode === b.compactMode
  );
}

export interface StateStoreOptions {
  chapterPins: ChapterPinConfig;
  display: DisplayConfig;
  /** Injectable clock for deterministic staleness tests. */
  now?: () => number;
  staleAfterMs?: number;
  disconnectAfterMs?: number;
}

export interface AppStateSnapshot {
  revision: number;
  connection: ConnectionState;
  minecraft: MinecraftIdentity;
  chapters: Chapter[];
  quests: Quest[];
  unresolvedPinnedQuestIds: string[];
  chapterPins: ChapterPinConfig;
  display: DisplayConfig;
}

export class StateStore {
  #revision = 0;
  #connection: ConnectionState;
  #minecraft: MinecraftIdentity;
  #chapters: Chapter[] = [];
  #quests: Quest[] = [];
  #unresolvedPinnedQuestIds: string[] = [];
  #chapterPins: ChapterPinConfig;
  #display: DisplayConfig;

  readonly #now: () => number;
  readonly #staleAfterMs: number;
  readonly #disconnectAfterMs: number;

  /** Wall-clock receipt time of the last heartbeat, for staleness. */
  #lastHeartbeatAtMs: number | null = null;
  /** True once a snapshot has been accepted for the current publisher. */
  #hasSnapshot = false;

  constructor(options: StateStoreOptions) {
    this.#chapterPins = options.chapterPins;
    this.#display = options.display;
    this.#now = options.now ?? ((): number => Date.now());
    this.#staleAfterMs = options.staleAfterMs ?? DEFAULT_TIMINGS.staleAfterMs;
    this.#disconnectAfterMs = options.disconnectAfterMs ?? DEFAULT_TIMINGS.disconnectAfterMs;
    this.#connection = {
      status: "disconnected",
      stale: true,
      lastSnapshotAt: null,
      lastHeartbeatAt: null,
    };
    this.#minecraft = { sessionId: null };
  }

  get revision(): number {
    return this.#revision;
  }

  /** Wall-clock receipt time of the last heartbeat, or `null`. */
  get lastHeartbeatAtMs(): number | null {
    return this.#lastHeartbeatAtMs;
  }

  /** True once the current publisher has delivered a valid snapshot. */
  get hasSnapshot(): boolean {
    return this.#hasSnapshot;
  }

  /** A complete, self-contained state snapshot for `state.snapshot`. */
  snapshot(): AppStateSnapshot {
    return {
      revision: this.#revision,
      connection: { ...this.#connection },
      minecraft: { ...this.#minecraft },
      chapters: this.#chapters.map((chapter) => ({ ...chapter })),
      quests: this.#quests.map(cloneQuest),
      unresolvedPinnedQuestIds: [...this.#unresolvedPinnedQuestIds],
      chapterPins: {
        maxPins: this.#chapterPins.maxPins,
        pinnedChapters: this.#chapterPins.pinnedChapters.map((pin) => ({ ...pin })),
      },
      display: { ...this.#display },
    };
  }

  /** Current catalog, for pin validation. */
  get chapters(): Chapter[] {
    return this.#chapters.map((chapter) => ({ ...chapter }));
  }

  /** Current chapter pin configuration. */
  get chapterPins(): ChapterPinConfig {
    return {
      maxPins: this.#chapterPins.maxPins,
      pinnedChapters: this.#chapterPins.pinnedChapters.map((pin) => ({ ...pin })),
    };
  }

  /** Current display configuration. */
  get display(): DisplayConfig {
    return { ...this.#display };
  }

  /** Current connection state. */
  get connection(): ConnectionState {
    return { ...this.#connection };
  }

  // -----------------------------------------------------------------------
  // Mutation core
  // -----------------------------------------------------------------------

  /**
   * Apply a candidate state, commit only if something changed, and report the
   * affected sections with the resulting revision.
   */
  #commit(mutate: () => readonly StateSection[]): StateChange {
    const sections = mutate();
    if (sections.length === 0) {
      return { revision: this.#revision, sections: [] };
    }

    this.#revision += 1;
    return { revision: this.#revision, sections: [...sections] };
  }

  // -----------------------------------------------------------------------
  // Minecraft publisher lifecycle
  // -----------------------------------------------------------------------

  /**
   * Record that a publisher socket opened and sent a valid hello.
   *
   * A new session id clears the previous publisher's data only once its first
   * snapshot arrives; until then the retained data stays visible but stale.
   */
  publisherConnected(sessionId: string, worldName?: string): StateChange {
    return this.#commit(() => {
      const sections: StateSection[] = [];

      const nextConnection: ConnectionState = {
        status: "connected",
        stale: true,
        lastSnapshotAt: this.#connection.lastSnapshotAt,
        lastHeartbeatAt: this.#connection.lastHeartbeatAt,
        ...(this.#connection.error === undefined ? {} : { error: this.#connection.error }),
      };
      if (!equalConnection(this.#connection, nextConnection)) {
        this.#connection = nextConnection;
        sections.push("connection");
      }

      const nextIdentity: MinecraftIdentity = { sessionId };
      if (worldName !== undefined) {
        nextIdentity.worldName = worldName;
      }
      if (!shallowEqualIdentity(this.#minecraft, nextIdentity)) {
        this.#minecraft = nextIdentity;
        sections.push("minecraft");
      }

      return sections;
    });
  }

  /** Apply a `minecraft.status` phase. */
  applyStatus(phase: MinecraftStatusPhase, detail?: string): StateChange {
    return this.#commit(() => {
      const status = mapPhase(phase, this.#hasSnapshot);

      const next: ConnectionState = {
        status,
        stale: status !== "ready",
        lastSnapshotAt: this.#connection.lastSnapshotAt,
        lastHeartbeatAt: this.#connection.lastHeartbeatAt,
      };
      if (detail !== undefined && phase === "error") {
        next.error = detail;
      }

      if (equalConnection(this.#connection, next)) {
        return NO_SECTIONS;
      }
      this.#connection = next;
      return ["connection"];
    });
  }

  /**
   * Replace catalog, objectives, identity, and pin ids atomically from a
   * `minecraft.snapshot`.
   *
   * The payload has already been validated by the protocol package, including
   * the objective-set invariants, so this is a straight replacement.
   */
  applySnapshot(payload: MinecraftSnapshotPayload): StateChange {
    return this.#commit(() => {
      const sections: StateSection[] = [];

      const nextIdentity: MinecraftIdentity = { sessionId: this.#minecraft.sessionId };
      if (payload.worldName !== null) {
        nextIdentity.worldName = payload.worldName;
      }
      if (payload.dimension !== null) {
        nextIdentity.dimension = payload.dimension;
      }
      if (payload.teamId !== null) {
        nextIdentity.teamId = payload.teamId;
      }
      if (payload.teamName !== null) {
        nextIdentity.teamName = payload.teamName;
      }

      const nextConnection: ConnectionState = {
        status: "ready",
        stale: false,
        lastSnapshotAt: payload.capturedAt,
        lastHeartbeatAt: this.#connection.lastHeartbeatAt,
      };

      if (!equalChapters(this.#chapters, payload.chapters)) {
        this.#chapters = payload.chapters.map((chapter) => ({ ...chapter }));
        sections.push("chapters");
      }

      if (!equalQuests(this.#quests, payload.quests)) {
        this.#quests = payload.quests.map(cloneQuest);
        sections.push("quests");
      }

      if (!equalStringArray(this.#unresolvedPinnedQuestIds, payload.unresolvedPinnedQuestIds)) {
        this.#unresolvedPinnedQuestIds = [...payload.unresolvedPinnedQuestIds];
        sections.push("unresolvedPinnedQuestIds");
      }

      if (!shallowEqualIdentity(this.#minecraft, nextIdentity)) {
        this.#minecraft = nextIdentity;
        sections.push("minecraft");
      }

      if (!equalConnection(this.#connection, nextConnection)) {
        this.#connection = nextConnection;
        sections.push("connection");
      }

      this.#hasSnapshot = true;

      return sections;
    });
  }

  /**
   * Apply changed chapter and quest progress from `minecraft.progress`.
   *
   * Entries referencing unknown chapters or quests are ignored rather than
   * treated as fatal, per `docs/protocol.md` §9.5. A pinned quest is never
   * removed here; removal is signalled by `minecraft.pins`.
   */
  applyProgress(payload: MinecraftProgressPayload, warn?: (message: string) => void): StateChange {
    return this.#commit(() => {
      const sections: StateSection[] = [];
      let chaptersChanged = false;
      let questsChanged = false;

      for (const update of payload.chapters ?? []) {
        const index = this.#chapters.findIndex((chapter) => chapter.id === update.chapterId);
        if (index === -1) {
          warn?.(`ignored progress for unknown chapter "${update.chapterId}"`);
          continue;
        }
        const existing = this.#chapters[index];
        if (
          existing !== undefined &&
          (existing.progress !== update.progress || existing.status !== update.status)
        ) {
          this.#chapters[index] = {
            ...existing,
            progress: update.progress,
            status: update.status,
          };
          chaptersChanged = true;
        }
      }

      for (const quest of payload.quests ?? []) {
        const index = this.#quests.findIndex((existing) => existing.id === quest.id);
        if (index === -1) {
          warn?.(`ignored progress for quest "${quest.id}" which is not a resolved pin`);
          continue;
        }
        if (!deepEqualQuest(this.#quests[index], quest)) {
          this.#quests[index] = cloneQuest(quest);
          questsChanged = true;
        }
      }

      if (chaptersChanged) {
        sections.push("chapters");
      }
      if (questsChanged) {
        sections.push("quests");
      }

      return sections;
    });
  }

  /**
   * Replace the objective set atomically from `minecraft.pins`.
   *
   * A pins message is self-contained; it is never a delta. FTB itself removes
   * a quest from the pin set on completion, so a completed objective normally
   * disappears here — the host must not fabricate a retained completed pin.
   */
  applyPins(payload: MinecraftPinsPayload): StateChange {
    return this.#commit(() => {
      const sections: StateSection[] = [];

      if (!equalQuests(this.#quests, payload.quests)) {
        this.#quests = payload.quests.map(cloneQuest);
        sections.push("quests");
      }

      if (!equalStringArray(this.#unresolvedPinnedQuestIds, payload.unresolvedPinnedQuestIds)) {
        this.#unresolvedPinnedQuestIds = [...payload.unresolvedPinnedQuestIds];
        sections.push("unresolvedPinnedQuestIds");
      }

      return sections;
    });
  }

  /** Record a heartbeat, clearing staleness only when a snapshot exists. */
  heartbeat(timestamp: string, ready: boolean): StateChange {
    this.#lastHeartbeatAtMs = this.#now();

    return this.#commit(() => {
      const nextStale = !(ready && this.#hasSnapshot);

      const next: ConnectionState = {
        status: this.#connection.status,
        stale: nextStale,
        lastSnapshotAt: this.#connection.lastSnapshotAt,
        lastHeartbeatAt: timestamp,
      };
      if (this.#connection.error !== undefined) {
        next.error = this.#connection.error;
      }

      if (equalConnection(this.#connection, next)) {
        return NO_SECTIONS;
      }
      this.#connection = next;
      return ["connection"];
    });
  }

  /**
   * Record that the publisher socket closed.
   *
   * Data is retained and marked stale: the overlay must be able to show the
   * last known progression while making clear it is not live.
   */
  publisherDisconnected(reason?: string): StateChange {
    return this.#commit(() => {
      const next: ConnectionState = {
        status: "disconnected",
        stale: true,
        lastSnapshotAt: this.#connection.lastSnapshotAt,
        lastHeartbeatAt: this.#connection.lastHeartbeatAt,
      };
      if (reason !== undefined) {
        next.error = reason;
      }

      if (equalConnection(this.#connection, next)) {
        return NO_SECTIONS;
      }

      this.#connection = next;
      this.#lastHeartbeatAtMs = null;
      this.#hasSnapshot = false;
      return ["connection"];
    });
  }

  /** Mark the retained state stale without changing its content. */
  markStale(): StateChange {
    return this.#commit(() => {
      if (this.#connection.stale) {
        return NO_SECTIONS;
      }
      this.#connection = { ...this.#connection, stale: true };
      return ["connection"];
    });
  }

  /**
   * Advance staleness based on heartbeat age.
   *
   * Called periodically by the host. Returns a change only when the state
   * actually moves, so a steady connection produces no broadcasts.
   */
  evaluateStaleness(): StateChange {
    return this.#commit(() => {
      if (this.#connection.status === "disconnected" || this.#lastHeartbeatAtMs === null) {
        return NO_SECTIONS;
      }

      const ageMs = this.#now() - this.#lastHeartbeatAtMs;
      if (!Number.isFinite(ageMs)) {
        return NO_SECTIONS;
      }

      if (ageMs > this.#disconnectAfterMs) {
        // The early return above already excludes the disconnected status.
        this.#connection = {
          ...this.#connection,
          status: "disconnected",
          stale: true,
          error: `no heartbeat for ${Math.round(ageMs / 1000)}s`,
        };
        return ["connection"];
      }

      if (ageMs > this.#staleAfterMs && !this.#connection.stale) {
        this.#connection = { ...this.#connection, stale: true };
        return ["connection"];
      }

      return NO_SECTIONS;
    });
  }

  // -----------------------------------------------------------------------
  // Host-owned configuration
  // -----------------------------------------------------------------------

  /** Replace the chapter pin configuration. */
  setChapterPins(pins: ChapterPinConfig): StateChange {
    return this.#commit(() => {
      if (equalPinConfig(this.#chapterPins, pins)) {
        return NO_SECTIONS;
      }
      this.#chapterPins = {
        maxPins: pins.maxPins,
        pinnedChapters: pins.pinnedChapters.map((pin) => ({ ...pin })),
      };
      return ["chapterPins"];
    });
  }

  /** Replace the display configuration. */
  setDisplay(display: DisplayConfig): StateChange {
    return this.#commit(() => {
      if (equalDisplay(this.#display, display)) {
        return NO_SECTIONS;
      }
      this.#display = { ...display };
      return ["display"];
    });
  }

  /**
   * Build a `state.update` payload for the changed sections.
   *
   * Every present section replaces its counterpart wholesale, per
   * `docs/protocol.md` §9.12. Returns `null` when nothing changed, so a caller
   * cannot accidentally broadcast an empty update.
   */
  buildUpdate(change: StateChange): StateUpdatePayload | null {
    if (change.sections.length === 0) {
      return null;
    }

    const update: StateUpdatePayload = { revision: change.revision };

    for (const section of change.sections) {
      switch (section) {
        case "connection":
          update.connection = { ...this.#connection };
          break;
        case "minecraft":
          update.minecraft = { ...this.#minecraft };
          break;
        case "chapters":
          update.chapters = this.#chapters.map((chapter) => ({ ...chapter }));
          break;
        case "quests":
          update.quests = this.#quests.map(cloneQuest);
          break;
        case "unresolvedPinnedQuestIds":
          update.unresolvedPinnedQuestIds = [...this.#unresolvedPinnedQuestIds];
          break;
        case "chapterPins":
          update.chapterPins = this.chapterPins;
          break;
        case "display":
          update.display = { ...this.#display };
          break;
      }
    }

    return update;
  }
}

function mapPhase(phase: MinecraftStatusPhase, hasSnapshot: boolean): ConnectionStatus {
  switch (phase) {
    case "unavailable":
      return "connected";
    case "synchronizing":
      return "synchronizing";
    case "ready":
      // "ready" is only a readiness claim; the state becomes ready once a
      // snapshot has actually been accepted.
      return hasSnapshot ? "ready" : "synchronizing";
    case "error":
      return "error";
  }
}

function cloneQuest(quest: Quest): Quest {
  const clone: Quest = {
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
  };
  if (quest.description !== undefined) {
    clone.description = quest.description;
  }
  return clone;
}
