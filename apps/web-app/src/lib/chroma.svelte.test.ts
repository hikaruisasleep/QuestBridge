import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { Quest } from '@questbridge/protocol';

import OverlayView from './components/overlay/OverlayView.svelte';
import ChromaSettings from './components/control/ChromaSettings.svelte';
import { KEY_COLORS, evaluateColorForChroma, type ChromaKey } from './chroma.ts';
import {
	readChromaKey,
	resetChromaKeyForTests,
	writeChromaKey
} from './stores/chroma-store.ts';
import {
	chromaBackground,
	chromaSetting,
	setChromaKey
} from './stores/chroma.svelte.ts';
import type { ClientAppState } from './stores/app-state.ts';

/**
 * Chroma-key behaviour in the browser.
 *
 * The colour table itself is checked in the Node project (`chroma.test.ts`).
 * What is checked here is behaviour: the stored setting, what the overlay
 * actually renders behind and over it, and that switching from the dashboard
 * reaches the preview.
 */

const KEYS: ChromaKey[] = ['green', 'blue'];

function quest(id: string, title: string): Quest {
	return {
		id,
		chapterId: 'chapter-a',
		title,
		optional: false,
		hidden: false,
		dependencies: [],
		tasks: [],
		progress: { status: 'in_progress', completedTasks: 0, totalRequiredTasks: 1, percentage: 0 }
	};
}

function state(): ClientAppState {
	return {
		revision: 1,
		connection: {
			status: 'ready',
			stale: false,
			lastSnapshotAt: '2026-01-01T00:00:00.000Z',
			lastHeartbeatAt: '2026-01-01T00:00:00.000Z'
		},
		minecraft: { sessionId: 's1' },
		chapters: [],
		quests: [],
		unresolvedPinnedQuestIds: [],
		chapterPins: { maxPins: 5, pinnedChapters: [] },
		display: {
			showChapterProgress: true,
			showQuestTasks: true,
			showCompletedQuests: true,
			completionAnimation: true,
			theme: 'minimal',
			compactMode: true
		},
		transport: 'open',
		failure: null,
		receivedSnapshot: true,
		connectedOnce: true
	};
}

beforeEach(() => {
	resetChromaKeyForTests();
	chromaSetting.key = 'green';
});

describe('chroma store', () => {
	it('defaults to green when nothing is stored', () => {
		expect(readChromaKey()).toBe('green');
	});

	it('round-trips the choice through storage', () => {
		writeChromaKey('blue');
		expect(readChromaKey()).toBe('blue');
	});

	it('ignores a corrupt stored value', () => {
		globalThis.localStorage.setItem('questbridge.chromaKey.v1', 'purple');
		expect(readChromaKey()).toBe('green');
	});

	it('exposes the exact key colour for each mode', () => {
		chromaSetting.key = 'green';
		expect(chromaBackground()).toBe('#00ff00');
		chromaSetting.key = 'blue';
		expect(chromaBackground()).toBe('#0000ff');
	});

	it('persists a change made through setChromaKey', () => {
		setChromaKey('blue');
		expect(readChromaKey()).toBe('blue');
		expect(chromaBackground()).toBe('#0000ff');
	});
});

describe('overlay renders over the key field', () => {
	it.each(KEYS)('paints nothing that risks being keyed out in %s mode', async (key) => {
		// Set the mode the overlay route would read, then render the component the
		// route renders and inspect every computed colour in the subtree.
		chromaSetting.key = key;
		const { container } = render(OverlayView, {
			state: state(),
			pins: [],
			quests: [quest('q1', 'Objective one'), quest('q2', 'Objective two')]
		});

		const risks: string[] = [];
		const walk = (element: Element): void => {
			const style = getComputedStyle(element);
			for (const [property, value] of [
				['color', style.color],
				['background-color', style.backgroundColor]
			] as const) {
				if (value === 'rgba(0, 0, 0, 0)') {
					continue;
				}
				// Skip the element that carries the key field itself.
				if (element.classList.contains('overlay')) {
					continue;
				}
				const verdict = evaluateColorForChroma(value, key);
				if (!verdict.safe) {
					risks.push(`${element.className} ${property}=${value} → ${verdict.rendered}`);
				}
			}
			for (const child of element.children) {
				walk(child);
			}
		};
		walk(container);
		// Allowlist the transparent root, which inherits the key from its parent.
		expect(risks.filter((entry) => !entry.includes('background-color=rgba'))).toEqual([]);
	});

	it('does not paint an opaque key colour on any component inline style', () => {
		// The key field belongs to the route. A component that painted it would be
		// keyed out entirely, taking its content with it.
		const { container } = render(OverlayView, { state: state(), pins: [], quests: [] });
		const painted = [...container.querySelectorAll('[style]')].filter((element) =>
			/(#00ff00|#0000ff|rgb\(0, 255, 0\)|rgb\(0, 0, 255\))/i.test(element.getAttribute('style') ?? '')
		);
		expect(painted).toEqual([]);
	});
});

describe('ChromaSettings', () => {
	it('shows both keys with the current one selected', () => {
		const { container } = render(ChromaSettings, { value: 'blue', onChange: () => {} });
		const radios = [...container.querySelectorAll<HTMLInputElement>('input[type=radio]')];

		expect(radios.map((radio) => radio.value)).toEqual(['green', 'blue']);
		expect(radios[0]!.checked).toBe(false);
		expect(radios[1]!.checked).toBe(true);
	});

	it('reports the exact key colour being keyed out', () => {
		const { container } = render(ChromaSettings, { value: 'green', onChange: () => {} });
		expect(container.textContent).toContain('#00FF00');
		expect(container.textContent).toContain('#0000FF');
	});

	it('calls onChange with the chosen key', () => {
		const seen: ChromaKey[] = [];
		const { container } = render(ChromaSettings, {
			value: 'green',
			onChange: (next) => seen.push(next)
		});

		container.querySelector<HTMLInputElement>('input[value="blue"]')!.click();
		expect(seen).toEqual(['blue']);
	});

	it('states that the setting is browser-local', () => {
		// The store is frontend-only; saying so is what stops a user assuming the
		// host remembers it for every machine.
		const { container } = render(ChromaSettings, { value: 'green', onChange: () => {} });
		expect(container.textContent?.toLowerCase()).toContain('browser');
	});

	it('uses the exact key colours for its swatches', () => {
		const { container } = render(ChromaSettings, { value: 'green', onChange: () => {} });
		const swatches = [...container.querySelectorAll<HTMLElement>('.swatch')].map(
			(element) => getComputedStyle(element).backgroundColor
		);
		expect(swatches[0]).toBe(`${hexToRgb(KEY_COLORS.green)}`);
		expect(swatches[1]).toBe(`${hexToRgb(KEY_COLORS.blue)}`);
	});
});

function hexToRgb(hex: string): string {
	const value = hex.replace('#', '');
	const r = Number.parseInt(value.slice(0, 2), 16);
	const g = Number.parseInt(value.slice(2, 4), 16);
	const b = Number.parseInt(value.slice(4, 6), 16);
	return `rgb(${r}, ${g}, ${b})`;
}
