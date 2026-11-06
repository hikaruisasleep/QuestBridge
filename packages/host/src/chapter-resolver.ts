import type { Chapter, ChapterPinConfig, ChapterStatus } from "@questbridge/protocol";

/**
 * Chapter pin resolution.
 *
 * Joins the stored pin configuration against the latest chapter catalog. The
 * governing rules are `docs/phase-2-plan.md` §10 and `docs/chapter-pinning.md`
 * §6, and they are all prohibitions:
 *
 * - never delete an unresolved pin;
 * - never substitute a different chapter;
 * - never reorder by catalog order — configuration order wins;
 * - never fabricate a chapter.
 *
 * Before the first catalog arrives every pin is unresolved, and the UI shows a
 * synchronizing state rather than implying the chapters were removed.
 */

/** A pinned chapter that could not be matched against the live catalog. */
export interface UnresolvedChapterPin {
  chapterId: string;
  position: number;
  /** Always `"unresolved"`; present so the union is discriminable. */
  state: "unresolved";
}

/** A pinned chapter matched against the live catalog. */
export interface ResolvedChapterPin {
  chapterId: string;
  position: number;
  state: "resolved";
  chapter: Chapter;
}

export type ResolvedPin = ResolvedChapterPin | UnresolvedChapterPin;

/** The outcome of resolving a full pin configuration. */
export interface PinResolution {
  /**
   * Every pin, in configuration order. Resolved and unresolved entries are
   * interleaved here so presentation order is preserved exactly.
   */
  entries: ResolvedPin[];
  resolved: ResolvedChapterPin[];
  unresolved: UnresolvedChapterPin[];
}

/**
 * Resolve configured pins against a catalog.
 *
 * @param config Stored chapter pin configuration.
 * @param chapters Latest catalog, or an empty array before the first snapshot.
 */
export function resolveChapterPins(
  config: ChapterPinConfig,
  chapters: readonly Chapter[],
): PinResolution {
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));

  const entries: ResolvedPin[] = config.pinnedChapters.map((pin) => {
    const chapter = byId.get(pin.chapterId);
    if (chapter === undefined) {
      return { chapterId: pin.chapterId, position: pin.position, state: "unresolved" };
    }
    return {
      chapterId: pin.chapterId,
      position: pin.position,
      state: "resolved",
      chapter,
    };
  });

  // `pinnedChapters` is already normalized by the pin operations, but sort
  // defensively: a hand-edited config file could be out of order, and the
  // displayed order must never depend on catalog order.
  entries.sort((a, b) => a.position - b.position);

  const resolved = entries.filter((entry): entry is ResolvedChapterPin => entry.state === "resolved");
  const unresolved = entries.filter(
    (entry): entry is UnresolvedChapterPin => entry.state === "unresolved",
  );

  return { entries, resolved, unresolved };
}

/**
 * IDs that may be newly pinned.
 *
 * Only catalog IDs are pinnable. An already-pinned unresolved ID remains
 * pinned and appears in this set only if the catalog also contains it, so
 * `pinChapter` never needs to special-case unresolved entries.
 */
export function pinnableChapterIds(chapters: readonly Chapter[]): Set<string> {
  return new Set(chapters.map((chapter) => chapter.id));
}

/**
 * Chapter completion state, for UI convenience.
 *
 * Completion is FTB's explicit completion record, never `progress === 100`:
 * empty, `alwaysInvisible`, and all-optional chapters can report 100 without
 * being complete (`docs/protocol.md` §8.8).
 */
export function isChapterComplete(chapter: Chapter): boolean {
  return chapter.status === "completed";
}

/** Progress for display, or `null` when the source did not expose it. */
export function chapterProgressOrNull(chapter: Chapter): number | null {
  return chapter.progress;
}

/** True when a chapter's availability is not yet known. */
export function isChapterStatusUnknown(status: ChapterStatus): boolean {
  return status === "unknown";
}
