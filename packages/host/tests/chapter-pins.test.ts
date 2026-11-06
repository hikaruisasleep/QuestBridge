import { describe, expect, it } from "vitest";

import type { ChapterPinConfig } from "@questbridge/protocol";

import {
  isPinned,
  normalizePositions,
  pinChapter,
  pinnedIds,
  reorderChapters,
  unpinChapter,
} from "../src/chapter-pins.js";

/**
 * Pure chapter-pin operations.
 *
 * Invariants under test are `docs/chapter-pinning.md` §3 and the operation
 * rules in §4.
 */

function configFor(...ids: string[]): ChapterPinConfig {
  return {
    maxPins: 5,
    pinnedChapters: ids.map((chapterId, position) => ({ chapterId, position })),
  };
}

const CATALOG = new Set(["a", "b", "c", "d", "e", "f", "g"]);

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw new Error(`Expected success, received ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function expectErr(
  result: { ok: true; value: unknown } | { ok: false; error: { code: string } },
): string {
  if (result.ok) {
    throw new Error("Expected failure, received success");
  }
  return result.error.code;
}

describe("normalizePositions", () => {
  it("sorts by position and reassigns contiguously from zero", () => {
    // Input positions 5, 2, 9 sort to a(2), c(5), b(9) -> 0, 1, 2.
    expect(
      normalizePositions([
        { chapterId: "c", position: 5 },
        { chapterId: "a", position: 2 },
        { chapterId: "b", position: 9 },
      ]),
    ).toEqual([
      { chapterId: "a", position: 0 },
      { chapterId: "c", position: 1 },
      { chapterId: "b", position: 2 },
    ]);
  });

  it("does not mutate its input", () => {
    const input = [
      { chapterId: "b", position: 1 },
      { chapterId: "a", position: 0 },
    ];
    normalizePositions(input);
    expect(input[0]).toEqual({ chapterId: "b", position: 1 });
  });

  it("handles an empty list", () => {
    expect(normalizePositions([])).toEqual([]);
  });
});

describe("pinChapter", () => {
  it("appends at the end", () => {
    const next = expectOk(pinChapter(configFor("a"), "b", CATALOG));
    expect(pinnedIds(next)).toEqual(["a", "b"]);
    expect(next.pinnedChapters[1]).toEqual({ chapterId: "b", position: 1 });
  });

  it("pins into an empty configuration", () => {
    const next = expectOk(pinChapter(configFor(), "a", CATALOG));
    expect(next.pinnedChapters).toEqual([{ chapterId: "a", position: 0 }]);
  });

  it("rejects a duplicate with duplicate_chapter", () => {
    expect(expectErr(pinChapter(configFor("a"), "a", CATALOG))).toBe("duplicate_chapter");
  });

  it("rejects a sixth pin with too_many_pins", () => {
    const full = configFor("a", "b", "c", "d", "e");
    expect(expectOk(pinChapter(configFor("a", "b", "c", "d"), "e", CATALOG))).toBeDefined();
    expect(expectErr(pinChapter(full, "f", CATALOG))).toBe("too_many_pins");
  });

  it("rejects a chapter absent from the catalog", () => {
    expect(expectErr(pinChapter(configFor(), "zzz", CATALOG))).toBe("unknown_chapter");
  });

  it("checks duplicates before the pin limit", () => {
    // A duplicate in a full configuration must report the more specific error.
    const full = configFor("a", "b", "c", "d", "e");
    expect(expectErr(pinChapter(full, "a", CATALOG))).toBe("duplicate_chapter");
  });

  it("allows exactly five pins", () => {
    const five = expectOk(pinChapter(configFor("a", "b", "c", "d"), "e", CATALOG));
    expect(five.pinnedChapters).toHaveLength(5);
    expect(five.pinnedChapters.map((pin) => pin.position)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("unpinChapter", () => {
  it("removes and normalizes positions", () => {
    const next = expectOk(unpinChapter(configFor("a", "b", "c"), "b"));
    expect(next.pinnedChapters).toEqual([
      { chapterId: "a", position: 0 },
      { chapterId: "c", position: 1 },
    ]);
  });

  it("rejects an unpinned chapter with not_pinned", () => {
    expect(expectErr(unpinChapter(configFor("a"), "b"))).toBe("not_pinned");
  });

  it("allows unpinning an unresolved id", () => {
    // "ghost" is not in CATALOG; it is still a valid configuration entry.
    const next = expectOk(unpinChapter(configFor("a", "ghost"), "ghost"));
    expect(pinnedIds(next)).toEqual(["a"]);
  });

  it("empties a single-pin configuration", () => {
    const next = expectOk(unpinChapter(configFor("a"), "a"));
    expect(next.pinnedChapters).toEqual([]);
  });
});

describe("reorderChapters", () => {
  it("assigns positions from array order", () => {
    const next = expectOk(reorderChapters(configFor("a", "b", "c"), ["c", "a", "b"]));
    expect(next.pinnedChapters).toEqual([
      { chapterId: "c", position: 0 },
      { chapterId: "a", position: 1 },
      { chapterId: "b", position: 2 },
    ]);
  });

  it("accepts the identity reorder", () => {
    const next = expectOk(reorderChapters(configFor("a", "b"), ["a", "b"]));
    expect(pinnedIds(next)).toEqual(["a", "b"]);
  });

  it("rejects an addition", () => {
    expect(expectErr(reorderChapters(configFor("a", "b"), ["a", "b", "c"]))).toBe(
      "invalid_reorder_set",
    );
  });

  it("rejects a removal", () => {
    expect(expectErr(reorderChapters(configFor("a", "b", "c"), ["a", "b"]))).toBe(
      "invalid_reorder_set",
    );
  });

  it("rejects a duplicate", () => {
    expect(expectErr(reorderChapters(configFor("a", "b"), ["a", "a"]))).toBe(
      "invalid_reorder_set",
    );
  });

  it("rejects an unknown id", () => {
    expect(expectErr(reorderChapters(configFor("a", "b"), ["a", "zzz"]))).toBe(
      "invalid_reorder_set",
    );
  });

  it("rejects more than five ids", () => {
    expect(
      expectErr(reorderChapters(configFor("a"), ["a", "b", "c", "d", "e", "f"])),
    ).toBe("invalid_reorder_set");
  });

  it("allows reordering unresolved ids", () => {
    const next = expectOk(reorderChapters(configFor("a", "ghost"), ["ghost", "a"]));
    expect(pinnedIds(next)).toEqual(["ghost", "a"]);
  });

  it("allows reordering an all-unresolved set", () => {
    const next = expectOk(reorderChapters(configFor("g1", "g2"), ["g2", "g1"]));
    expect(pinnedIds(next)).toEqual(["g2", "g1"]);
  });
});

describe("pin query helpers", () => {
  it("reports pin membership and position", () => {
    const config = configFor("a", "b");
    expect(isPinned(config, "a")).toBe(true);
    expect(isPinned(config, "z")).toBe(false);
    expect(pinnedIds(config)).toEqual(["a", "b"]);
  });
});

describe("unresolved chapter ids survive unrelated operations", () => {
  it("keeps an unresolved pin through pin, unpin, and reorder", () => {
    let config = configFor("ghost", "a");

    config = expectOk(pinChapter(config, "b", CATALOG));
    expect(pinnedIds(config)).toEqual(["ghost", "a", "b"]);

    config = expectOk(unpinChapter(config, "a"));
    expect(pinnedIds(config)).toEqual(["ghost", "b"]);

    config = expectOk(reorderChapters(config, ["b", "ghost"]));
    expect(pinnedIds(config)).toEqual(["b", "ghost"]);
    expect(config.pinnedChapters[1]).toEqual({ chapterId: "ghost", position: 1 });
  });
});
