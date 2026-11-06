import { MAX_CHAPTER_PINS, type ChapterPin, type ChapterPinConfig } from "@questbridge/protocol";

import { fail, hostError, ok, type Result } from "./errors.js";

/**
 * Pure chapter-pin operations.
 *
 * Each function takes a validated `ChapterPinConfig` and returns either a new
 * config or a typed error. Nothing here mutates its input, touches the
 * filesystem, or knows about the network, which is what makes the pin rules
 * exhaustively testable and keeps persistence ordering in the caller's control.
 *
 * Rules: `docs/phase-2-plan.md` §9 and `docs/chapter-pinning.md` §4.
 */

/**
 * Sort by position and reassign contiguous positions from zero.
 *
 * Invariant 5 of `docs/chapter-pinning.md` §3 requires contiguous positions
 * after every successful operation. Sorting first means the stored `position`
 * is honoured as the source of truth even if a caller hands over an
 * out-of-order array.
 */
export function normalizePositions(pins: readonly ChapterPin[]): ChapterPin[] {
  return [...pins]
    .sort((a, b) => a.position - b.position)
    .map((pin, index) => ({ chapterId: pin.chapterId, position: index }));
}

/** True when the chapter is already pinned, regardless of catalog state. */
export function isPinned(config: ChapterPinConfig, chapterId: string): boolean {
  return config.pinnedChapters.some((pin) => pin.chapterId === chapterId);
}

/** Position of a pinned chapter, or `-1` when it is not pinned. */
export function positionOf(config: ChapterPinConfig, chapterId: string): number {
  const index = config.pinnedChapters.findIndex((pin) => pin.chapterId === chapterId);
  return index;
}

/** The pinned chapter IDs in presentation order. */
export function pinnedIds(config: ChapterPinConfig): string[] {
  return config.pinnedChapters.map((pin) => pin.chapterId);
}

/**
 * Pin a chapter, appending it at the end.
 *
 * @param config Current configuration.
 * @param chapterId Chapter to pin.
 * @param catalogIds IDs present in the live catalog. A chapter absent from the
 *   catalog is rejected with `unknown_chapter`; unresolved *existing* pins are
 *   unaffected by this check, because only new pins are validated against the
 *   catalog.
 */
export function pinChapter(
  config: ChapterPinConfig,
  chapterId: string,
  catalogIds: ReadonlySet<string>,
): Result<ChapterPinConfig> {
  if (isPinned(config, chapterId)) {
    return fail(
      hostError("duplicate_chapter", `Chapter "${chapterId}" is already pinned`, { chapterId }),
    );
  }

  if (config.pinnedChapters.length >= MAX_CHAPTER_PINS) {
    return fail(
      hostError("too_many_pins", `${MAX_CHAPTER_PINS} chapters are already pinned`, {
        maxPins: MAX_CHAPTER_PINS,
      }),
    );
  }

  if (!catalogIds.has(chapterId)) {
    return fail(
      hostError("unknown_chapter", `Chapter "${chapterId}" is not in the live catalog`, {
        chapterId,
      }),
    );
  }

  const next: ChapterPin[] = [
    ...config.pinnedChapters,
    { chapterId, position: config.pinnedChapters.length },
  ];

  return ok({ maxPins: MAX_CHAPTER_PINS, pinnedChapters: normalizePositions(next) });
}

/**
 * Unpin a chapter.
 *
 * Unpinning an unresolved ID is explicitly allowed: removing a stale
 * configuration entry is the only repair operation the protocol offers
 * (`docs/protocol.md` §11).
 */
export function unpinChapter(
  config: ChapterPinConfig,
  chapterId: string,
): Result<ChapterPinConfig> {
  if (!isPinned(config, chapterId)) {
    return fail(
      hostError("not_pinned", `Chapter "${chapterId}" is not pinned`, { chapterId }),
    );
  }

  const remaining = config.pinnedChapters.filter((pin) => pin.chapterId !== chapterId);
  return ok({ maxPins: MAX_CHAPTER_PINS, pinnedChapters: normalizePositions(remaining) });
}

/**
 * Replace pin order with `chapterIds`.
 *
 * The list must be exactly the current pinned set: no additions, removals, or
 * duplicates. Array order becomes presentation order.
 */
export function reorderChapters(
  config: ChapterPinConfig,
  chapterIds: readonly string[],
): Result<ChapterPinConfig> {
  if (chapterIds.length > MAX_CHAPTER_PINS) {
    return fail(
      hostError("invalid_reorder_set", `A reorder may not exceed ${MAX_CHAPTER_PINS} chapters`, {
        received: chapterIds.length,
        maxPins: MAX_CHAPTER_PINS,
      }),
    );
  }

  const seen = new Set<string>();
  for (const id of chapterIds) {
    if (seen.has(id)) {
      return fail(
        hostError("invalid_reorder_set", `Reorder list contains "${id}" more than once`, {
          chapterId: id,
        }),
      );
    }
    seen.add(id);
  }

  const current = new Set(pinnedIds(config));

  if (current.size !== seen.size) {
    return fail(
      hostError(
        "invalid_reorder_set",
        "Reorder list must contain exactly the currently pinned chapters",
        { expected: [...current], received: [...chapterIds] },
      ),
    );
  }

  for (const id of chapterIds) {
    if (!current.has(id)) {
      return fail(
        hostError("invalid_reorder_set", `"${id}" is not currently pinned`, { chapterId: id }),
      );
    }
  }

  const next: ChapterPin[] = chapterIds.map((chapterId, index) => ({ chapterId, position: index }));
  return ok({ maxPins: MAX_CHAPTER_PINS, pinnedChapters: next });
}
