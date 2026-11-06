import { parseChromaKey, type ChromaKey } from '#lib/chroma.ts';

/**
 * The chroma-key choice.
 *
 * **Frontend-only, by decision.** It is stored in `localStorage` rather than in
 * `DisplayConfig` because that object is a `strictObject` with no free field and
 * Phase 3 was scoped to leave protocol v1 unchanged. The consequence is
 * deliberate and worth stating: the host does not store this setting, so it is
 * per-browser. An OBS source and a dashboard tab that were set separately can
 * disagree, and the overlay is the one that matters — a source reads whatever
 * was last set in *its* browser profile.
 *
 * The storage key is namespaced and versioned so a future protocol field can
 * migrate from it rather than guess.
 */

const STORAGE_KEY = 'questbridge.chromaKey.v1';

/** In-memory fallback so the app works when storage is unavailable. */
let memoryValue: ChromaKey | null = null;

function storage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		// Some browsers throw on access in private mode; a memory fallback keeps
		// the setting working for the session rather than failing the page.
		return null;
	}
}

export function readChromaKey(): ChromaKey {
	const store = storage();
	const raw = store === null ? memoryValue : store.getItem(STORAGE_KEY);
	return parseChromaKey(raw ?? memoryValue);
}

export function writeChromaKey(key: ChromaKey): void {
	memoryValue = key;
	const store = storage();
	if (store === null) {
		return;
	}
	try {
		store.setItem(STORAGE_KEY, key);
	} catch {
		// Quota or a blocked origin: the in-memory value still applies for this
		// page, which is what the overlay needs.
	}
}

/** Listen for changes made in another tab, so an open overlay follows the dashboard. */
export function subscribeChromaKey(listener: (key: ChromaKey) => void): () => void {
	const store = storage();
	if (store === null || typeof globalThis.addEventListener !== 'function') {
		return () => {};
	}

	const handler = (event: StorageEvent): void => {
		if (event.key !== STORAGE_KEY) {
			return;
		}
		listener(parseChromaKey(event.newValue));
	};

	globalThis.addEventListener('storage', handler);
	return () => globalThis.removeEventListener('storage', handler);
}

/** Clear the stored value. Test-only. */
export function resetChromaKeyForTests(): void {
	memoryValue = null;
	storage()?.removeItem(STORAGE_KEY);
}
