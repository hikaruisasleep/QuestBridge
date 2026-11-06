import type { ChromaKey } from '#lib/chroma.ts';
import { KEY_COLORS } from '#lib/chroma.ts';
import { readChromaKey, subscribeChromaKey, writeChromaKey } from './chroma-store.ts';

/** Follow changes from another tab. Module-level, so the cell can be reset. */
let unsubscribe: (() => void) | null = null;

/**
 * The chroma-key choice, as module-level reactive state.
 *
 * A `$state` cell outside a class rather than a class instance, because the
 * value is a single primitive shared by the whole page: the overlay route, the
 * dashboard preview, and the dashboard's own selector must never disagree. Runed
 * module exports are reactive across imports, which is exactly the semantics
 * needed here.
 */
export const chromaSetting: { key: ChromaKey } = $state({ key: readChromaKey() });

/** The opaque colour painted behind the overlay. */
export function chromaBackground(): string {
  return KEY_COLORS[chromaSetting.key];
}

export function setChromaKey(next: ChromaKey): void {
  if (next === chromaSetting.key) {
    return;
  }
  chromaSetting.key = next;
  writeChromaKey(next);
}

/** Begin following cross-tab changes. Idempotent. */
export function startChromaSync(): void {
  unsubscribe ??= subscribeChromaKey((next) => {
    chromaSetting.key = next;
  });
}

export function stopChromaSync(): void {
  unsubscribe?.();
  unsubscribe = null;
}

/** Re-read storage. Used on mount, in case another tab changed it first. */
export function refreshChromaKey(): void {
  chromaSetting.key = readChromaKey();
}
