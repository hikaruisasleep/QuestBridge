import { describe, expect, it } from "vitest";

import type {
  Chapter,
  ChapterPinConfig,
  MinecraftPinsPayload,
  MinecraftSnapshotPayload,
  Quest,
} from "@questbridge/protocol";

import { StateStore } from "../src/state-store.js";

/**
 * Normalized state and revision discipline.
 *
 * The critical property is that the revision moves only on a real change.
 * Because a revision bump is what triggers a broadcast, a spurious increment
 * would mean the host transmitting unchanged state — which the protocol
 * forbids (`docs/protocol.md` §9.2).
 */

const CHAPTERS: Chapter[] = [
  { id: "c1", title: "First", order: 0, progress: 10, status: "available" },
  { id: "c2", title: "Second", order: 1, progress: 100, status: "completed" },
];

function makeQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: "q1",
    chapterId: "c1",
    title: "A Quest",
    optional: false,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: "t1",
        type: "ftbquests:item",
        optional: false,
        progress: { status: "in_progress", current: 3, target: 10, percentage: 30 },
      },
    ],
    progress: {
      status: "in_progress",
      completedTasks: 0,
      totalRequiredTasks: 1,
      percentage: 30,
    },
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<MinecraftSnapshotPayload> = {}): MinecraftSnapshotPayload {
  const quests = overrides.quests ?? [makeQuest()];
  return {
    worldName: "Test World",
    dimension: "minecraft:overworld",
    integratedServer: true,
    teamId: "team-1",
    teamName: "Test Team",
    chapters: CHAPTERS,
    manualPinIds: quests.map((quest) => quest.id),
    quests,
    unresolvedPinnedQuestIds: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const EMPTY_PINS: ChapterPinConfig = { maxPins: 5, pinnedChapters: [] };

function makeStore(options: { now?: () => number; withPins?: ChapterPinConfig } = {}): StateStore {
  return new StateStore({
    chapterPins: options.withPins ?? EMPTY_PINS,
    display: {
      showChapterProgress: true,
      showQuestTasks: true,
      showCompletedQuests: true,
      completionAnimation: true,
      theme: "minimal",
      compactMode: true,
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

describe("initial state", () => {
  it("starts at revision 0, disconnected, with no fabricated data", () => {
    const store = makeStore();
    const snapshot = store.snapshot();

    expect(snapshot.revision).toBe(0);
    expect(snapshot.connection.status).toBe("disconnected");
    expect(snapshot.connection.stale).toBe(true);
    expect(snapshot.chapters).toEqual([]);
    expect(snapshot.quests).toEqual([]);
    expect(snapshot.minecraft.sessionId).toBeNull();
    expect(store.hasSnapshot).toBe(false);
  });

  it("returns defensive copies", () => {
    const store = makeStore();
    store.applySnapshot(makeSnapshot());

    const snapshot = store.snapshot();
    snapshot.chapters.push({ id: "injected", title: "X", order: 9, progress: 0, status: "unknown" });
    snapshot.quests[0]!.tasks[0]!.progress.current = 999;

    const fresh = store.snapshot();
    expect(fresh.chapters).toHaveLength(2);
    expect(fresh.quests[0]?.tasks[0]?.progress.current).toBe(3);
  });
});

describe("publisher lifecycle", () => {
  it("moves to connected and stale on hello", () => {
    const store = makeStore();
    const change = store.publisherConnected("session-1");

    expect(change.sections).toContain("connection");
    expect(change.sections).toContain("minecraft");
    expect(change.revision).toBe(1);
    expect(store.connection.status).toBe("connected");
    expect(store.connection.stale).toBe(true);
    expect(store.snapshot().minecraft.sessionId).toBe("session-1");
  });

  it("does not advance the revision for a repeated hello", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    const revision = store.revision;

    const change = store.publisherConnected("session-1");
    expect(change.sections).toEqual([]);
    expect(store.revision).toBe(revision);
  });

  it("maps status phases, treating ready as synchronizing before a snapshot", () => {
    const store = makeStore();
    store.publisherConnected("session-1");

    store.applyStatus("synchronizing");
    expect(store.connection.status).toBe("synchronizing");

    store.applyStatus("ready");
    expect(store.connection.status).toBe("synchronizing");

    store.applySnapshot(makeSnapshot());
    expect(store.connection.status).toBe("ready");
  });

  it("maps unavailable to connected", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applyStatus("unavailable", "No world loaded");
    expect(store.connection.status).toBe("connected");
  });

  it("records an error phase with its detail", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applyStatus("error", "FTB unavailable");
    expect(store.connection.status).toBe("error");
    expect(store.connection.error).toBe("FTB unavailable");
  });

  it("retains the snapshot across disconnect but marks it stale", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());

    const change = store.publisherDisconnected("socket closed");

    expect(change.sections).toEqual(["connection"]);
    expect(store.connection.status).toBe("disconnected");
    expect(store.connection.stale).toBe(true);
    // The data is retained so the overlay can show it as stale.
    expect(store.snapshot().chapters).toHaveLength(2);
    expect(store.snapshot().quests).toHaveLength(1);
    expect(store.hasSnapshot).toBe(false);
  });

  it("replaces data only after a new publisher's snapshot", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot({ chapters: CHAPTERS }));

    store.publisherDisconnected();
    // A new session connects; old data must remain until its snapshot lands.
    store.publisherConnected("session-2");
    expect(store.snapshot().chapters).toHaveLength(2);

    const replacement: Chapter[] = [
      { id: "c9", title: "Replacement", order: 0, progress: 0, status: "available" },
    ];
    store.applySnapshot(makeSnapshot({ chapters: replacement, quests: [], manualPinIds: [] }));

    expect(store.snapshot().chapters.map((chapter) => chapter.id)).toEqual(["c9"]);
    expect(store.snapshot().quests).toEqual([]);
  });
});

describe("snapshot application", () => {
  it("replaces catalog, objectives, and identity atomically", () => {
    const store = makeStore();
    store.publisherConnected("session-1");

    const change = store.applySnapshot(makeSnapshot());

    expect(change.sections).toContain("chapters");
    expect(change.sections).toContain("quests");
    expect(change.sections).toContain("minecraft");
    expect(change.sections).toContain("connection");

    const snapshot = store.snapshot();
    expect(snapshot.chapters).toHaveLength(2);
    expect(snapshot.quests).toHaveLength(1);
    expect(snapshot.connection.status).toBe("ready");
    expect(snapshot.connection.stale).toBe(false);
    expect(snapshot.connection.lastSnapshotAt).toBe("2026-01-01T00:00:00.000Z");
    expect(snapshot.minecraft.worldName).toBe("Test World");
    expect(snapshot.minecraft.teamName).toBe("Test Team");
  });

  it("omits null identity fields rather than storing null", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot({ worldName: null, teamName: null, teamId: null }));

    const identity = store.snapshot().minecraft;
    expect(identity.sessionId).toBe("session-1");
    expect("worldName" in identity).toBe(false);
    expect("teamName" in identity).toBe(false);
  });

  it("does not advance the revision when an identical snapshot is replayed", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());
    const revision = store.revision;

    const change = store.applySnapshot(makeSnapshot());
    expect(change.sections).toEqual([]);
    expect(store.revision).toBe(revision);
  });

  it("accepts an empty snapshot without inventing data", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(
      makeSnapshot({ chapters: [], quests: [], manualPinIds: [], capturedAt: "2026-01-01T00:00:01.000Z" }),
    );

    const snapshot = store.snapshot();
    expect(snapshot.chapters).toEqual([]);
    expect(snapshot.quests).toEqual([]);
    expect(snapshot.connection.status).toBe("ready");
  });
});

describe("progress application", () => {
  it("applies changed chapter progress and reports only that section", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());

    const change = store.applyProgress({
      capturedAt: "2026-01-01T00:00:05.000Z",
      chapters: [{ chapterId: "c1", progress: 40, status: "available" }],
    });

    expect(change.sections).toEqual(["chapters"]);
    const chapter = store.snapshot().chapters.find((entry) => entry.id === "c1");
    expect(chapter?.progress).toBe(40);
  });

  it("ignores progress for unchanged chapters without moving the revision", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());
    const revision = store.revision;

    const change = store.applyProgress({
      capturedAt: "2026-01-01T00:00:05.000Z",
      chapters: [{ chapterId: "c1", progress: 10, status: "available" }],
    });

    expect(change.sections).toEqual([]);
    expect(store.revision).toBe(revision);
  });

  it("warns and ignores unknown chapter and quest ids", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());

    const warnings: string[] = [];
    const change = store.applyProgress(
      {
        capturedAt: "2026-01-01T00:00:05.000Z",
        chapters: [{ chapterId: "unknown", progress: 5, status: "available" }],
        quests: [makeQuest({ id: "not-pinned" })],
      },
      (message) => warnings.push(message),
    );

    expect(change.sections).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("unknown chapter");
    expect(warnings[1]).toContain("not a resolved pin");
  });

  it("applies changed quest progress", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());

    const updated = makeQuest({
      progress: { status: "completed", completedTasks: 1, totalRequiredTasks: 1, percentage: 100 },
    });
    const change = store.applyProgress({
      capturedAt: "2026-01-01T00:00:05.000Z",
      quests: [updated],
    });

    expect(change.sections).toEqual(["quests"]);
    expect(store.snapshot().quests[0]?.progress.status).toBe("completed");
  });

  it("never removes a pinned quest through progress", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());

    // Omitting the quest from a progress message must not remove it.
    store.applyProgress({ capturedAt: "2026-01-01T00:00:05.000Z", chapters: [] });
    expect(store.snapshot().quests).toHaveLength(1);
  });
});

describe("pins application", () => {
  it("replaces the objective set atomically", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());

    const payload: MinecraftPinsPayload = {
      capturedAt: "2026-01-01T00:00:09.000Z",
      manualPinIds: ["q2"],
      quests: [makeQuest({ id: "q2", title: "Second Quest" })],
      unresolvedPinnedQuestIds: [],
    };

    const change = store.applyPins(payload);
    expect(change.sections).toContain("quests");

    const snapshot = store.snapshot();
    expect(snapshot.quests.map((quest) => quest.id)).toEqual(["q2"]);
  });

  it("records unresolved pinned ids", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());

    store.applyPins({
      capturedAt: "2026-01-01T00:00:09.000Z",
      manualPinIds: ["q1", "ghost"],
      quests: [makeQuest()],
      unresolvedPinnedQuestIds: ["ghost"],
    });

    expect(store.snapshot().unresolvedPinnedQuestIds).toEqual(["ghost"]);
  });

  it("drops a completed objective when FTB reports it unpinned", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());

    store.applyPins({
      capturedAt: "2026-01-01T00:00:09.000Z",
      manualPinIds: [],
      quests: [],
      unresolvedPinnedQuestIds: [],
    });

    expect(store.snapshot().quests).toEqual([]);
  });

  it("does not advance the revision for an identical pins message", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());
    const revision = store.revision;

    const change = store.applyPins({
      capturedAt: "2026-01-01T00:00:09.000Z",
      manualPinIds: ["q1"],
      quests: [makeQuest()],
      unresolvedPinnedQuestIds: [],
    });

    expect(change.sections).toEqual([]);
    expect(store.revision).toBe(revision);
  });
});

describe("heartbeat and staleness", () => {
  it("clears staleness only when ready and a snapshot exists", () => {
    let nowMs = 1_000;
    const store = makeStore({ now: () => nowMs });

    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());

    store.heartbeat("2026-01-01T00:00:05.000Z", true);
    expect(store.connection.stale).toBe(false);

    store.heartbeat("2026-01-01T00:00:10.000Z", false);
    expect(store.connection.stale).toBe(true);

    nowMs += 1;
    store.heartbeat("2026-01-01T00:00:15.000Z", true);
    expect(store.connection.stale).toBe(false);
  });

  it("does not clear staleness for a heartbeat before any snapshot", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.heartbeat("2026-01-01T00:00:05.000Z", true);
    expect(store.connection.stale).toBe(true);
  });

  it("marks stale then disconnected as heartbeats age", () => {
    let nowMs = 0;
    const store = makeStore({ now: () => nowMs });

    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());
    store.heartbeat("2026-01-01T00:00:00.000Z", true);
    expect(store.connection.stale).toBe(false);

    // 9 s: still live.
    nowMs = 9_000;
    expect(store.evaluateStaleness().sections).toEqual([]);

    // 11 s: past the 10 s stale threshold.
    nowMs = 11_000;
    expect(store.evaluateStaleness().sections).toEqual(["connection"]);
    expect(store.connection.stale).toBe(true);
    expect(store.connection.status).toBe("ready");

    // 16 s: past the 15 s disconnect threshold.
    nowMs = 16_000;
    const change = store.evaluateStaleness();
    expect(change.sections).toEqual(["connection"]);
    expect(store.connection.status).toBe("disconnected");
  });

  it("returns no change while the connection is steady", () => {
    let nowMs = 0;
    const store = makeStore({ now: () => nowMs });

    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());
    store.heartbeat("2026-01-01T00:00:00.000Z", true);

    nowMs = 1_000;
    expect(store.evaluateStaleness().sections).toEqual([]);
    nowMs = 2_000;
    expect(store.evaluateStaleness().sections).toEqual([]);
  });

  it("does not evaluate staleness without a heartbeat", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    expect(store.evaluateStaleness().sections).toEqual([]);
  });

  it("markStale is idempotent", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    store.applySnapshot(makeSnapshot());
    store.heartbeat("2026-01-01T00:00:00.000Z", true);

    expect(store.markStale().sections).toEqual(["connection"]);
    expect(store.markStale().sections).toEqual([]);
  });
});

describe("host-owned configuration in state", () => {
  it("reports chapterPins changes and ignores identical ones", () => {
    const store = makeStore();

    const change = store.setChapterPins({
      maxPins: 5,
      pinnedChapters: [{ chapterId: "c1", position: 0 }],
    });
    expect(change.sections).toEqual(["chapterPins"]);

    const repeat = store.setChapterPins({
      maxPins: 5,
      pinnedChapters: [{ chapterId: "c1", position: 0 }],
    });
    expect(repeat.sections).toEqual([]);
  });

  it("reports display changes and ignores identical ones", () => {
    const store = makeStore();
    const display = store.display;

    expect(store.setDisplay(display).sections).toEqual([]);

    const change = store.setDisplay({ ...display, compactMode: false });
    expect(change.sections).toEqual(["display"]);
    expect(store.display.compactMode).toBe(false);
  });
});

describe("buildUpdate", () => {
  it("returns null when nothing changed", () => {
    const store = makeStore();
    expect(store.buildUpdate({ revision: 0, sections: [] })).toBeNull();
  });

  it("includes only the changed sections", () => {
    const store = makeStore();
    const change = store.setDisplay({ ...store.display, compactMode: false });

    const update = store.buildUpdate(change);
    expect(update).not.toBeNull();
    expect(update?.revision).toBe(change.revision);
    expect(update?.display).toBeDefined();
    expect(update?.chapters).toBeUndefined();
    expect(update?.connection).toBeUndefined();
    expect(update?.quests).toBeUndefined();
  });

  it("includes the current section value, not a patch", () => {
    const store = makeStore();
    store.publisherConnected("session-1");
    const change = store.applySnapshot(makeSnapshot());

    const update = store.buildUpdate(change);
    expect(update?.chapters).toHaveLength(2);
    expect(update?.quests).toHaveLength(1);
    expect(update?.connection?.status).toBe("ready");
    expect(update?.minecraft?.sessionId).toBe("session-1");
  });
});
