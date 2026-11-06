/**
 * Shared timing and status vocabulary for the overlay and the dashboard.
 *
 * Kept separate from the components so the dashboard preview and the real
 * overlay cannot describe the same state differently.
 */

import type { ChapterStatus, ConnectionStatus, QuestStatus, TaskStatus } from "@questbridge/protocol";

/** Human wording for a chapter's progression state, used by both routes. */
export function chapterStatusLabel(status: ChapterStatus): string {
  switch (status) {
    case "available":
      return "In progress";
    case "locked":
      return "Locked";
    case "completed":
      return "Complete";
    case "unknown":
      return "Unknown";
  }
}

/** Human wording for a quest's state, used by the objectives list. */
export function questStatusLabel(status: QuestStatus): string {
  switch (status) {
    case "locked":
      return "Locked";
    case "available":
      return "Not started";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Complete";
    case "unknown":
      return "Unknown";
  }
}

export function taskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case "incomplete":
      return "Not started";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Done";
    case "unknown":
      return "Unknown";
  }
}

/**
 * Wording for the host's connection status.
 *
 * `ready` and `connecting` have no overlay presentation of their own; they are
 * listed so the mapping is total and a new status cannot fall through silently.
 */
export function connectionStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case "disconnected":
      return "Minecraft not connected";
    case "connecting":
      return "Connecting to Minecraft";
    case "connected":
      return "Waiting for quest data";
    case "synchronizing":
      return "Synchronizing quests";
    case "ready":
      return "Live";
    case "error":
      return "Minecraft reported an error";
  }
}

/**
 * Render a percentage as text.
 *
 * `null` means "the source did not expose it" and must never become `0%`
 * (`AGENTS.md` §7.5). An em dash is used so the row still occupies its place.
 */
export function formatPercentage(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/** Fallback title for a chapter whose ID is no longer in the catalog. */
export const UNRESOLVED_CHAPTER_LABEL = "Unresolved chapter";

/** Fallback title for a pinned quest ID the host could not resolve. */
export const UNRESOLVED_QUEST_LABEL = "Unresolved objective";

/** Clamp a `0..100` progress value for rendering, leaving `null` alone. */
export function progressWidth(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped}%`;
}
