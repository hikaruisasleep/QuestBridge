import type {
  Chapter,
  ConnectionStatus,
  MinecraftHelloPayload,
  ProtocolMessage,
  Quest,
} from "@questbridge/protocol";

/**
 * Normalized state built by the standalone collector.
 *
 * This is intentionally a read-only observation model: it mirrors what a host
 * would receive from the Minecraft adapter, but it does not own chapter pins,
 * display configuration, or browser connections.
 */

export interface CollectorCounts {
  snapshots: number;
  progressUpdates: number;
  pinUpdates: number;
  heartbeats: number;
}

export interface CollectorState {
  status: ConnectionStatus;
  stale: boolean;
  hello: MinecraftHelloPayload | null;
  sessionId: string | null;
  worldName: string | null;
  dimension: string | null;
  integratedServer: boolean | null;
  teamId: string | null;
  teamName: string | null;
  chapters: Map<string, Chapter>;
  quests: Map<string, Quest>;
  manualPinIds: string[];
  unresolvedPinnedQuestIds: string[];
  lastSnapshotAt: string | null;
  lastHeartbeatAt: string | null;
  /** Wall-clock receipt time, used for staleness. Not the mock's timestamp. */
  lastSnapshotReceivedAtMs: number | null;
  /** Wall-clock receipt time, used for staleness. Not the mock's timestamp. */
  lastHeartbeatReceivedAtMs: number | null;
  counts: CollectorCounts;
}

export type CollectorNoticeLevel = "info" | "warn" | "error";

export interface CollectorNotice {
  timestamp: string;
  level: CollectorNoticeLevel;
  text: string;
}

export function createCollectorState(): CollectorState {
  return {
    status: "disconnected",
    stale: true,
    hello: null,
    sessionId: null,
    worldName: null,
    dimension: null,
    integratedServer: null,
    teamId: null,
    teamName: null,
    chapters: new Map(),
    quests: new Map(),
    manualPinIds: [],
    unresolvedPinnedQuestIds: [],
    lastSnapshotAt: null,
    lastHeartbeatAt: null,
    lastSnapshotReceivedAtMs: null,
    lastHeartbeatReceivedAtMs: null,
    counts: {
      snapshots: 0,
      progressUpdates: 0,
      pinUpdates: 0,
      heartbeats: 0,
    },
  };
}

function notice(
  timestamp: string,
  text: string,
  level: CollectorNoticeLevel = "info",
): CollectorNotice {
  return { timestamp, level, text };
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${value}%`;
}

export class CollectorModel {
  readonly state: CollectorState;

  constructor(state: CollectorState = createCollectorState()) {
    this.state = state;
  }

  connectionOpened(remote: string): CollectorNotice {
    this.state.status = "connecting";
    this.state.stale = true;
    return notice(new Date().toISOString(), `connection opened from ${remote}`);
  }

  connectionClosed(reason: string): CollectorNotice {
    this.state.status = "disconnected";
    this.state.stale = true;
    return notice(new Date().toISOString(), `connection closed (${reason})`, "warn");
  }

  markStale(reason: string, timestamp: string = new Date().toISOString()): CollectorNotice | null {
    if (this.state.stale) {
      return null;
    }
    this.state.stale = true;
    return notice(timestamp, reason, "warn");
  }

  /**
   * Mark the retained snapshot stale after the heartbeat threshold.
   * Returns a notice only when staleness changes.
   */
  markStaleIfNeeded(nowMs: number, staleAfterMs: number): CollectorNotice | null {
    if (this.state.status !== "ready" || this.state.stale) {
      return null;
    }

    const baseline =
      this.state.lastHeartbeatReceivedAtMs ?? this.state.lastSnapshotReceivedAtMs;
    if (baseline === null) {
      return null;
    }

    const ageMs = nowMs - baseline;
    if (!Number.isFinite(ageMs) || ageMs <= staleAfterMs) {
      return null;
    }

    return this.markStale(
      `no heartbeat for ${Math.round(ageMs / 1000)}s; the last snapshot is stale`,
      new Date(nowMs).toISOString(),
    );
  }

  ingest(message: ProtocolMessage): CollectorNotice[] {
    switch (message.type) {
      case "minecraft.hello":
        return this.ingestHello(message);
      case "minecraft.status":
        return this.ingestStatus(message);
      case "minecraft.snapshot":
        return this.ingestSnapshot(message);
      case "minecraft.progress":
        return this.ingestProgress(message);
      case "minecraft.pins":
        return this.ingestPins(message);
      case "minecraft.heartbeat":
        return this.ingestHeartbeat(message);
      default:
        return [notice(message.timestamp, `unexpected message type ${message.type}`, "warn")];
    }
  }

  summaryLines(): string[] {
    const state = this.state;
    const hello = state.hello;
    const world =
      state.worldName === null
        ? "(no snapshot)"
        : `${state.worldName} / ${state.dimension ?? "unknown"} (integrated=${String(state.integratedServer)})`;
    const team =
      state.teamName === null && state.teamId === null
        ? "(none)"
        : `${state.teamName ?? "(unnamed)"} (${state.teamId ?? "no id"})`;

    const lines = [
      `connection : ${state.status}${state.stale ? " (stale)" : ""}`,
      `session    : ${state.sessionId ?? "(none)"}`,
      `hello      : ${hello === null ? "(none)" : `MC ${hello.minecraftVersion}, NeoForge ${hello.neoForgeVersion}, FTB Quests ${hello.ftbQuestsVersion}`}`,
      `world      : ${world}`,
      `team       : ${team}`,
      `chapters   : ${state.chapters.size}`,
      `manual pins: ${state.manualPinIds.length}`,
      `unresolved : ${state.unresolvedPinnedQuestIds.length}`,
      `updates    : snapshots=${state.counts.snapshots} progress=${state.counts.progressUpdates} pins=${state.counts.pinUpdates} heartbeats=${state.counts.heartbeats}`,
      "objectives :",
    ];

    if (state.manualPinIds.length === 0) {
      lines.push("  (none)");
      return lines;
    }

    for (const id of state.manualPinIds) {
      const quest = state.quests.get(id);
      if (quest === undefined) {
        lines.push(`  ! ${id} (unresolved)`);
        continue;
      }
      lines.push(
        `  - ${quest.title} [${quest.progress.status}] ${quest.progress.completedTasks}/${quest.progress.totalRequiredTasks} tasks`,
      );
    }

    return lines;
  }

  private ingestHello(message: ProtocolMessage & { type: "minecraft.hello" }): CollectorNotice[] {
    this.state.hello = message.payload;
    this.state.sessionId = message.sessionId ?? null;
    this.state.status = "connected";
    this.state.stale = true;

    return [
      notice(
        message.timestamp,
        `hello MC ${message.payload.minecraftVersion} / NeoForge ${message.payload.neoForgeVersion} / FTB Quests ${message.payload.ftbQuestsVersion}`,
      ),
    ];
  }

  private ingestStatus(message: ProtocolMessage & { type: "minecraft.status" }): CollectorNotice[] {
    const phase = message.payload.phase;
    let status: ConnectionStatus;

    switch (phase) {
      case "unavailable":
        status = "connected";
        break;
      case "synchronizing":
        status = "synchronizing";
        break;
      case "ready":
        // The protocol treats "ready" as readiness only after a snapshot.
        status = this.state.lastSnapshotAt === null ? "synchronizing" : "ready";
        break;
      case "error":
        status = "error";
        break;
    }

    this.state.status = status;
    this.state.stale = status !== "ready";

    return [
      notice(
        message.timestamp,
        `status ${phase}${message.payload.detail === undefined ? "" : ` (${message.payload.detail})`}`,
      ),
    ];
  }

  private ingestSnapshot(
    message: ProtocolMessage & { type: "minecraft.snapshot" },
  ): CollectorNotice[] {
    const payload = message.payload;

    this.state.worldName = payload.worldName;
    this.state.dimension = payload.dimension;
    this.state.integratedServer = payload.integratedServer;
    this.state.teamId = payload.teamId;
    this.state.teamName = payload.teamName;
    this.state.chapters = new Map(payload.chapters.map((chapter) => [chapter.id, chapter]));
    this.state.quests = new Map(payload.quests.map((quest) => [quest.id, quest]));
    this.state.manualPinIds = [...payload.manualPinIds];
    this.state.unresolvedPinnedQuestIds = [...payload.unresolvedPinnedQuestIds];
    this.state.lastSnapshotAt = payload.capturedAt;
    this.state.lastSnapshotReceivedAtMs = Date.now();
    this.state.status = "ready";
    this.state.stale = false;
    this.state.counts.snapshots += 1;

    const notices = [
      notice(
        message.timestamp,
        `snapshot world="${payload.worldName ?? "unknown"}" dim=${payload.dimension ?? "unknown"} team="${payload.teamName ?? "unnamed"}" chapters=${payload.chapters.length} pins=${payload.manualPinIds.length} unresolved=${payload.unresolvedPinnedQuestIds.length}`,
      ),
    ];

    return [...notices, ...this.objectiveNotices(message.timestamp)];
  }

  private ingestProgress(
    message: ProtocolMessage & { type: "minecraft.progress" },
  ): CollectorNotice[] {
    const notices: CollectorNotice[] = [];

    for (const update of message.payload.chapters ?? []) {
      const chapter = this.state.chapters.get(update.chapterId);
      if (chapter === undefined) {
        notices.push(
          notice(
            message.timestamp,
            `ignored progress for unknown chapter "${update.chapterId}"`,
            "warn",
          ),
        );
        continue;
      }

      this.state.chapters.set(update.chapterId, {
        ...chapter,
        progress: update.progress,
        status: update.status,
      });
      notices.push(
        notice(
          message.timestamp,
          `chapter ${chapter.title} -> ${update.status} ${formatPercent(update.progress)}`,
        ),
      );
    }

    for (const quest of message.payload.quests ?? []) {
      if (!this.state.quests.has(quest.id)) {
        notices.push(
          notice(
            message.timestamp,
            `ignored progress for quest "${quest.id}" (not a resolved pin)`,
            "warn",
          ),
        );
        continue;
      }

      this.state.quests.set(quest.id, quest);
      notices.push(
        notice(
          message.timestamp,
          `quest ${quest.title} -> ${quest.progress.status} ${formatPercent(quest.progress.percentage)}`,
        ),
      );
    }

    this.state.counts.progressUpdates += 1;
    return notices;
  }

  private ingestPins(message: ProtocolMessage & { type: "minecraft.pins" }): CollectorNotice[] {
    const payload = message.payload;
    this.state.manualPinIds = [...payload.manualPinIds];
    this.state.unresolvedPinnedQuestIds = [...payload.unresolvedPinnedQuestIds];
    this.state.quests = new Map(payload.quests.map((quest) => [quest.id, quest]));
    this.state.counts.pinUpdates += 1;

    const notices = [
      notice(
        message.timestamp,
        `pins changed pins=${payload.manualPinIds.length} unresolved=${payload.unresolvedPinnedQuestIds.length}`,
      ),
    ];

    return [...notices, ...this.objectiveNotices(message.timestamp)];
  }

  private ingestHeartbeat(
    message: ProtocolMessage & { type: "minecraft.heartbeat" },
  ): CollectorNotice[] {
    const wasStale = this.state.stale;
    this.state.counts.heartbeats += 1;
    this.state.lastHeartbeatAt = message.timestamp;
    this.state.lastHeartbeatReceivedAtMs = Date.now();
    this.state.stale = !(message.payload.ready && this.state.lastSnapshotAt !== null);

    const restored = wasStale && !this.state.stale ? "heartbeat restored; state is live" : null;

    return [
      notice(
        message.timestamp,
        `${restored === null ? `heartbeat ready=${String(message.payload.ready)}` : restored}`,
      ),
    ];
  }

  private objectiveNotices(timestamp: string): CollectorNotice[] {
    if (this.state.manualPinIds.length === 0) {
      return [notice(timestamp, "  objectives: none")];
    }

    const notices: CollectorNotice[] = [notice(timestamp, "  objectives:")];
    for (const id of this.state.manualPinIds) {
      const quest = this.state.quests.get(id);
      if (quest === undefined) {
        notices.push(notice(timestamp, `    ! ${id} (unresolved)`));
        continue;
      }
      notices.push(
        notice(
          timestamp,
          `    - ${quest.title} [${quest.progress.status}] ${quest.progress.completedTasks}/${quest.progress.totalRequiredTasks} tasks`,
        ),
      );
    }
    return notices;
  }
}
