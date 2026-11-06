import { describe, expect, it } from "vitest";

import type { Chapter, ChapterPinConfig } from "@questbridge/protocol";

import {
  isChapterComplete,
  pinnableChapterIds,
  resolveChapterPins,
} from "../src/chapter-resolver.js";

/**
 * Chapter pin resolution.
 *
 * `docs/chapter-pinning.md` §6: a configured pin resolves only on an exact id
 * match, and an unresolved pin is preserved rather than removed, substituted,
 * or reordered.
 */

const CHAPTERS: Chapter[] = [
  { id: "c1", title: "First", order: 0, progress: 40, status: "available" },
  { id: "c2", title: "Second", order: 1, progress: 100, status: "completed" },
  { id: "c3", title: "Third", order: 2, progress: null, status: "locked" },
];

function pins(...ids: string[]): ChapterPinConfig {
  return {
    maxPins: 5,
    pinnedChapters: ids.map((chapterId, position) => ({ chapterId, position })),
  };
}

describe("resolveChapterPins", () => {
  it("resolves a configured pin to its catalog chapter", () => {
    const result = resolveChapterPins(pins("c1"), CHAPTERS);

    expect(result.resolved).toHaveLength(1);
    expect(result.unresolved).toHaveLength(0);
    expect(result.resolved[0]?.chapter.title).toBe("First");
    expect(result.resolved[0]?.position).toBe(0);
  });

  it("preserves configuration order, never catalog order", () => {
    // Configuration order is c3, c1; catalog order is c1, c2, c3.
    const result = resolveChapterPins(pins("c3", "c1"), CHAPTERS);
    expect(result.entries.map((entry) => entry.chapterId)).toEqual(["c3", "c1"]);
  });

  it("marks an unknown id unresolved and keeps its position", () => {
    const result = resolveChapterPins(pins("c1", "ghost", "c2"), CHAPTERS);

    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toEqual({
      chapterId: "ghost",
      position: 1,
      state: "unresolved",
    });
    // The unresolved entry is interleaved in position order, not appended.
    expect(result.entries.map((entry) => entry.chapterId)).toEqual(["c1", "ghost", "c2"]);
  });

  it("treats every pin as unresolved before the first catalog arrives", () => {
    const result = resolveChapterPins(pins("c1", "c2"), []);

    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(2);
    expect(result.entries.every((entry) => entry.state === "unresolved")).toBe(true);
  });

  it("handles an empty pin configuration", () => {
    const result = resolveChapterPins(pins(), CHAPTERS);
    expect(result.entries).toEqual([]);
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("does not substitute a different chapter for a missing id", () => {
    const result = resolveChapterPins(pins("ghost"), CHAPTERS);
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved[0]?.chapterId).toBe("ghost");
  });

  it("keeps an unresolved pin when the catalog reloads without it", () => {
    const before = resolveChapterPins(pins("c1", "ghost"), CHAPTERS);
    expect(before.unresolved).toHaveLength(1);

    // A reload that drops c1 entirely leaves both pins unresolved.
    const after = resolveChapterPins(pins("c1", "ghost"), []);
    expect(after.unresolved.map((entry) => entry.chapterId)).toEqual(["c1", "ghost"]);
  });

  it("sorts defensively when stored positions are out of order", () => {
    const outOfOrder: ChapterPinConfig = {
      maxPins: 5,
      pinnedChapters: [
        { chapterId: "c2", position: 1 },
        { chapterId: "c1", position: 0 },
      ],
    };
    const result = resolveChapterPins(outOfOrder, CHAPTERS);
    expect(result.entries.map((entry) => entry.chapterId)).toEqual(["c1", "c2"]);
  });

  it("preserves chapter progress and status verbatim", () => {
    const result = resolveChapterPins(pins("c2", "c3"), CHAPTERS);

    const completed = result.resolved.find((entry) => entry.chapterId === "c2");
    expect(completed?.chapter.status).toBe("completed");
    expect(completed?.chapter.progress).toBe(100);

    const locked = result.resolved.find((entry) => entry.chapterId === "c3");
    expect(locked?.chapter.status).toBe("locked");
    // Unavailable progress stays null rather than becoming zero.
    expect(locked?.chapter.progress).toBeNull();
  });

  it("reports all five pins resolved and in order", () => {
    const catalog: Chapter[] = [...CHAPTERS];
    for (let index = 3; index < 6; index += 1) {
      catalog.push({
        id: `c${index + 1}`,
        title: `Chapter ${index + 1}`,
        order: index,
        progress: 0,
        status: "available",
      });
    }

    const result = resolveChapterPins(pins("c1", "c2", "c3", "c4", "c5"), catalog);
    expect(result.resolved).toHaveLength(5);
    expect(result.entries.map((entry) => entry.position)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("pinnableChapterIds", () => {
  it("contains exactly the catalog ids", () => {
    const ids = pinnableChapterIds(CHAPTERS);
    expect([...ids].sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("is empty for an empty catalog", () => {
    expect(pinnableChapterIds([]).size).toBe(0);
  });
});

describe("chapter completion helpers", () => {
  it("derives completion from status, never from progress", () => {
    const complete: Chapter = {
      id: "x",
      title: "X",
      order: 0,
      progress: 100,
      status: "completed",
    };
    const allOptionalFull: Chapter = {
      id: "y",
      title: "Y",
      order: 1,
      progress: 100,
      status: "available",
    };

    expect(isChapterComplete(complete)).toBe(true);
    // progress 100 without a completion record is not complete.
    expect(isChapterComplete(allOptionalFull)).toBe(false);
  });
});
