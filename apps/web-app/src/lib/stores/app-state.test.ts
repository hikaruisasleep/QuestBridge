import {
  createMessage,
  type AppState,
  type Chapter,
  type ChapterPinConfig,
  type DisplayConfig,
  type Quest,
} from "@questbridge/protocol";
import { describe, expect, it } from "vitest";

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
 * Store reducers and selectors.
 *
 * These are the only place client state is derived, so the assertions focus on
 * the rules that are easy to get quietly wrong: unresolved pins keep their
 * position, completion never comes from progress, and an empty catalog is
 * distinguishable from a catalog that was never received.
 */

const DISPLAY: DisplayConfig = {
  showChapterProgress: true,
  showQuestTasks: true,
  showCompletedQuests: true,
  completionAnimation: true,
  theme: "minimal",
  compactMode: true,
};

function chapter(overrides: Partial<Chapter> & { id: string }): Chapter {
  return {
    title: overrides.id,
    order: 0,
    progress: null,
    status: "available",
    ...overrides,
  };
}

function pins(ids: readonly string[]): ChapterPinConfig {
  return {
    maxPins: 5,
    pinnedChapters: ids.map((chapterId, position) => ({ chapterId, position })),
  };
}

function quest(overrides: Partial<Quest> & { id: string }): Quest {
  return {
    chapterId: "chapter-a",
    title: overrides.id,
    optional: false,
    hidden: false,
    dependencies: [],
    tasks: [],
    progress: { status: "in_progress", completedTasks: 0, totalRequiredTasks: 0, percentage: null },
    ...overrides,
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    revision: 1,
    connection: {
      status: "ready",
      stale: false,
      lastSnapshotAt: "2026-01-01T00:00:00.000Z",
      lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
    },
    minecraft: { sessionId: "s1" },
    chapters: [],
    quests: [],
    unresolvedPinnedQuestIds: [],
    chapterPins: pins([]),
    display: DISPLAY,
    ...overrides,
  };
}

function selectorsFor(getState: () => ClientAppState): Selectors {
  return new Selectors({ getState });
}

describe("applySnapshot", () => {
  it("replaces every host-owned section and marks the snapshot received", () => {
    const next = applySnapshot(
      createInitialState(),
      state({
        revision: 7,
        chapters: [chapter({ id: "chapter-a" })],
        quests: [quest({ id: "quest-a" })],
        unresolvedPinnedQuestIds: ["missing-quest"],
        chapterPins: pins(["chapter-a", "gone"]),
      }),
    );

    expect(next.revision).toBe(7);
    expect(next.chapters).toHaveLength(1);
    expect(next.quests).toHaveLength(1);
    expect(next.unresolvedPinnedQuestIds).toEqual(["missing-quest"]);
    expect(next.chapterPins.pinnedChapters).toHaveLength(2);
    expect(next.receivedSnapshot).toBe(true);
  });

  it("applies a snapshot even when its revision is older", () => {
    // Snapshots are self-contained; refusing one would strand the page.
    const current = applySnapshot(createInitialState(), state({ revision: 10 }));
    const next = applySnapshot(current, state({ revision: 3 }));
    expect(next.revision).toBe(3);
  });

  it("marks the connection as established", () => {
    const next = applySnapshot(createInitialState(), state());
    expect(next.connectedOnce).toBe(true);
  });
});

describe("applyUpdate", () => {
  it("replaces present sections wholesale and leaves absent ones alone", () => {
    const base = applySnapshot(
      createInitialState(),
      state({ revision: 1, chapters: [chapter({ id: "a" })], quests: [quest({ id: "q" })] }),
    );

    const next = applyUpdate(
      base,
      createMessage("state.update", {
        revision: 2,
        chapters: [chapter({ id: "b" })],
      }),
    );

    expect(next.revision).toBe(2);
    expect(next.chapters.map((c) => c.id)).toEqual(["b"]);
    // Quests were not in the update, so they survive.
    expect(next.quests.map((q) => q.id)).toEqual(["q"]);
  });

  it("ignores an update whose revision is older than local state", () => {
    const base = applySnapshot(createInitialState(), state({ revision: 5 }));
    const next = applyUpdate(base, createMessage("state.update", { revision: 4, chapters: [] }));
    expect(next).toBe(base);
  });

  it("accepts a repeat of the current revision", () => {
    // The host sends state.update plus a section message for one change; both
    // carry the same revision. Neither may be discarded as stale.
    const base = applySnapshot(createInitialState(), state({ revision: 2 }));
    const next = applyUpdate(
      base,
      createMessage("state.update", { revision: 2, chapters: [] }),
    );
    expect(next.revision).toBe(2);
  });
});

describe("applySection", () => {
  it("applies authoritative chapter pins", () => {
    const base = applySnapshot(createInitialState(), state());
    const next = applySection(
      base,
      createMessage("chapter.pins.update", { chapterPins: pins(["a", "b"]) }),
    );
    expect(next.chapterPins.pinnedChapters.map((p) => p.chapterId)).toEqual(["a", "b"]);
  });

  it("applies authoritative display configuration", () => {
    const base = applySnapshot(createInitialState(), state());
    const next = applySection(
      base,
      createMessage("config.update", { display: { ...DISPLAY, compactMode: false } }),
    );
    expect(next.display.compactMode).toBe(false);
  });

  it("applies connection status without disturbing other sections", () => {
    const base = applySnapshot(createInitialState(), state({ chapters: [chapter({ id: "a" })] }));
    const next = applySection(
      base,
      createMessage("connection.status", {
        status: "synchronizing",
        stale: true,
        lastSnapshotAt: null,
        lastHeartbeatAt: null,
      }),
    );
    expect(next.connection.status).toBe("synchronizing");
    expect(next.chapters).toHaveLength(1);
  });
});

describe("applyTransport", () => {
  it("records the failure reason and connectedOnce", () => {
    const next = applyTransport(createInitialState(), "closed", "unauthorized");
    expect(next.failure).toBe("unauthorized");
    expect(next.connectedOnce).toBe(false);

    const opened = applyTransport(next, "open", null);
    expect(opened.connectedOnce).toBe(true);
  });
});

describe("selectors", () => {
  it("returns configured pins in position order, not catalog order", () => {
    const current = applySnapshot(
      createInitialState(),
      state({
        chapters: [
          chapter({ id: "a", order: 0 }),
          chapter({ id: "b", order: 1 }),
          chapter({ id: "c", order: 2 }),
        ],
        chapterPins: pins(["c", "a"]),
      }),
    );

    const selector = selectorsFor(() => current);
    expect(selector.getPinnedChapters().map((p) => p.kind === "resolved" && p.chapter.id)).toEqual([
      "c",
      "a",
    ]);
  });

  it("keeps an unresolved pin in its configured position", () => {
    const current = applySnapshot(
      createInitialState(),
      state({
        chapters: [chapter({ id: "a" }), chapter({ id: "c" })],
        chapterPins: pins(["a", "missing-id", "c"]),
      }),
    );

    const selector = selectorsFor(() => current);
    const pinned = selector.getPinnedChapters();

    expect(pinned).toHaveLength(3);
    expect(pinned[1]).toEqual({ kind: "unresolved", position: 1, chapterId: "missing-id" });
    expect(selector.getUnresolvedChapterPins()).toEqual(["missing-id"]);
  });

  it("does not fabricate chapter entries when no chapters are pinned", () => {
    const current = applySnapshot(
      createInitialState(),
      state({ chapters: [chapter({ id: "a" }), chapter({ id: "b" })] }),
    );

    // The catalog has chapters; the pin configuration is empty. The overlay must
    // show nothing, not the catalog.
    expect(selectorsFor(() => current).getPinnedChapters()).toEqual([]);
  });

  it("reports progress as null rather than zero when unavailable", () => {
    const current = applySnapshot(
      createInitialState(),
      state({ chapters: [chapter({ id: "a", progress: null })] }),
    );
    const selector = selectorsFor(() => current);

    expect(selector.getChapterProgress("a")).toBeNull();
    expect(selector.getChapterProgress("unknown")).toBeNull();
  });

  it("never derives completion from progress", () => {
    // progress 100 with a non-completed status is authoritative: FTB reports
    // completion separately (`docs/protocol.md` §8.1).
    const current = applySnapshot(
      createInitialState(),
      state({
        chapters: [
          chapter({ id: "done", progress: 100, status: "completed" }),
          chapter({ id: "not-done", progress: 100, status: "available" }),
        ],
      }),
    );

    const selector = selectorsFor(() => current);
    const pinned = selector.getPinnedChapters();
    expect(pinned).toEqual([]);

    const statuses = selector
      .getChapterCatalog()
      .map((c) => [c.id, c.status] as const);
    expect(statuses).toEqual([
      ["done", "completed"],
      ["not-done", "available"],
    ]);
  });

  it("distinguishes an empty catalog from an absent one", () => {
    const initial = createInitialState();
    expect(selectorsFor(() => initial).hasReceivedSnapshot()).toBe(false);

    const empty = applySnapshot(initial, state({ chapters: [] }));
    expect(selectorsFor(() => empty).hasReceivedSnapshot()).toBe(true);
  });

  it("reports manual quests in host-provided order", () => {
    const current = applySnapshot(
      createInitialState(),
      state({
        chapters: [chapter({ id: "chapter-a" })],
        quests: [quest({ id: "q2" }), quest({ id: "q1" })],
      }),
    );

    expect(
      selectorsFor(() => current)
        .getManuallyPinnedQuests()
        .map((q) => q.id),
    ).toEqual(["q2", "q1"]);
  });

  it("reports the pin set as full only at the cap", () => {
    const four = applySnapshot(
      createInitialState(),
      state({ chapterPins: pins(["a", "b", "c", "d"]) }),
    );
    expect(selectorsFor(() => four).isPinSetFull()).toBe(false);

    const five = applySnapshot(
      createInitialState(),
      state({ chapterPins: pins(["a", "b", "c", "d", "e"]) }),
    );
    expect(selectorsFor(() => five).isPinSetFull()).toBe(true);
  });
});

describe("disconnection", () => {
  it("is keyed on the disconnected status, not on staleness", () => {
    // `stale` is true during `synchronizing`; fading on it would pulse the
    // overlay on every startup handshake (`docs/web-frontend.md` §3.4).
    const synchronizing = applySnapshot(
      createInitialState(),
      state({
        connection: {
          status: "synchronizing",
          stale: true,
          lastSnapshotAt: null,
          lastHeartbeatAt: null,
        },
      }),
    );
    expect(selectorsFor(() => synchronizing).isDisconnected()).toBe(false);

    const disconnected = applySnapshot(
      createInitialState(),
      state({
        connection: {
          status: "disconnected",
          stale: true,
          lastSnapshotAt: null,
          lastHeartbeatAt: null,
        },
      }),
    );
    expect(selectorsFor(() => disconnected).isDisconnected()).toBe(true);
  });
});
