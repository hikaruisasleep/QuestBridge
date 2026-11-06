import type { DisplayConfig, Quest } from '@questbridge/protocol';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { motion, motionCssVariables } from '#lib/motion.ts';
import type { ClientAppState } from '#lib/stores/app-state.ts';
import OverlayView from './OverlayView.svelte';

/**
 * Overlay state presentation: staleness, disconnection, and motion.
 *
 * These assert the product decisions that look like missing features and are
 * deliberate:
 *
 * - a **stale** overlay renders identically to a live one (`docs/web-frontend.md`
 *   §3.4). Asserted so nobody later "restores" a stale badge as a fix;
 * - the fade is keyed on `disconnected` only, never on `stale`, because the host
 *   sets `stale: true` during `synchronizing` and a fade there would pulse the
 *   overlay on every startup handshake;
 * - `prefers-reduced-motion` is not honoured.
 */

const DISPLAY: DisplayConfig = {
	showChapterProgress: true,
	showQuestTasks: true,
	showCompletedQuests: true,
	completionAnimation: true,
	theme: 'minimal',
	compactMode: true
};

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

function state(
	connection: ClientAppState['connection'],
	display: DisplayConfig = DISPLAY
): ClientAppState {
	return {
		revision: 1,
		connection,
		minecraft: { sessionId: 's1' },
		chapters: [],
		quests: [],
		unresolvedPinnedQuestIds: [],
		chapterPins: { maxPins: 5, pinnedChapters: [] },
		display,
		transport: 'open',
		failure: null,
		receivedSnapshot: true,
		connectedOnce: true
	};
}

const QUESTS = [quest('q1', 'Objective One'), quest('q2', 'Objective Two')];

/** Everything a viewer could perceive about the rendered overlay. */
function presentation(container: HTMLElement): string {
	const stack = container.querySelector('.stack');
	return JSON.stringify({
		html: container.innerHTML,
		faded: container.querySelector('.overlay')?.getAttribute('data-faded'),
		opacity: stack === null ? null : getComputedStyle(stack).opacity
	});
}

describe('stale is invisible', () => {
	it('renders a stale overlay identically to a live one', async () => {
		const live = render(OverlayView, {
			state: state({
				status: 'ready',
				stale: false,
				lastSnapshotAt: '2026-01-01T00:00:00.000Z',
				lastHeartbeatAt: '2026-01-01T00:00:00.000Z'
			}),
			pins: [],
			quests: QUESTS
		});
		const livePresentation = presentation(live.container);
		live.unmount();

		const stale = render(OverlayView, {
			state: state({
				status: 'ready',
				stale: true,
				lastSnapshotAt: '2026-01-01T00:00:00.000Z',
				lastHeartbeatAt: null
			}),
			pins: [],
			quests: QUESTS
		});
		const stalePresentation = presentation(stale.container);

		// Byte-identical: same markup, same fade attribute, same opacity. This is
		// the inverse of the original requirement and is intentional.
		expect(stalePresentation).toBe(livePresentation);
	});
});

describe('disconnection fades', () => {
	it('fades when the host reports disconnected', async () => {
		const { container } = render(OverlayView, {
			state: state({
				status: 'disconnected',
				stale: true,
				lastSnapshotAt: null,
				lastHeartbeatAt: null
			}),
			pins: [],
			quests: QUESTS
		});

		expect(container.querySelector('.overlay')?.getAttribute('data-faded')).toBe('true');
	});

	it('does not fade while synchronizing, even though stale is true', async () => {
		// The host sets stale for any non-ready status. Keying the fade on `stale`
		// would make the overlay pulse during every normal startup handshake.
		const { container } = render(OverlayView, {
			state: state({
				status: 'synchronizing',
				stale: true,
				lastSnapshotAt: null,
				lastHeartbeatAt: '2026-01-01T00:00:00.000Z'
			}),
			pins: [],
			quests: QUESTS
		});

		expect(container.querySelector('.overlay')?.getAttribute('data-faded')).toBe('false');
	});

	it('does not fade while ready', async () => {
		const { container } = render(OverlayView, {
			state: state({
				status: 'ready',
				stale: false,
				lastSnapshotAt: '2026-01-01T00:00:00.000Z',
				lastHeartbeatAt: '2026-01-01T00:00:00.000Z'
			}),
			pins: [],
			quests: QUESTS
		});

		expect(container.querySelector('.overlay')?.getAttribute('data-faded')).toBe('false');
	});

	it('never fades in the dashboard preview', async () => {
		// The preview is a design tool, not a live graphic; fading it would make
		// the dashboard look broken whenever Minecraft is closed.
		const { container } = render(OverlayView, {
			state: state({
				status: 'disconnected',
				stale: true,
				lastSnapshotAt: null,
				lastHeartbeatAt: null
			}),
			pins: [],
			quests: QUESTS,
			preview: true
		});

		expect(container.querySelector('.overlay')?.getAttribute('data-faded')).toBe('false');
	});
});

describe('preview hints', () => {
	it('shows setup hints only in the preview', async () => {
		const preview = render(OverlayView, {
			state: state({
				status: 'ready',
				stale: false,
				lastSnapshotAt: null,
				lastHeartbeatAt: null
			}),
			pins: [],
			quests: [],
			preview: true
		});

		expect(preview.container.textContent).toContain('No chapters pinned');
		expect(preview.container.textContent).toContain('No pinned objectives');
		preview.unmount();

		const live = render(OverlayView, {
			state: state({
				status: 'ready',
				stale: false,
				lastSnapshotAt: null,
				lastHeartbeatAt: null
			}),
			pins: [],
			quests: []
		});

		expect(live.container.textContent).not.toContain('No chapters pinned');
		expect(live.container.textContent).not.toContain('No pinned objectives');
	});
});

describe('motion tokens', () => {
	it('exposes CSS variables that match the TypeScript tokens', () => {
		const variables = motionCssVariables();
		expect(variables).toContain(`--qb-fade-ms:${motion.disconnectFadeMs}ms`);
		expect(variables).toContain(`--qb-zoom-ms:${motion.questZoomMs}ms`);
		expect(variables).toContain(`--qb-reflow-ms:${motion.questReflowMs}ms`);
		expect(variables).toContain(`--qb-pulse-ms:${motion.completionPulseMs}ms`);
	});

	it('completes reflow before the next reconciliation tick', () => {
		// The mock reconciles every 2 s; a reflow longer than that would look
		// unstable while pinning repeatedly.
		expect(motion.questReflowMs).toBeLessThan(2_000);
		expect(motion.maxReflowMs).toBeGreaterThanOrEqual(motion.questReflowMs);
	});

	it('does not declare a reduced-motion branch anywhere in the overlay', async () => {
		// Deliberate product decision (`docs/web-frontend.md` §3.5): the motion is
		// content on a broadcast, not chrome on a public site.
		const modules = import.meta.glob('./*.svelte', { query: '?raw', import: 'default', eager: true });
		const sources = Object.entries(modules).filter(([path]) => !path.includes('.test.'));
		expect(sources.length).toBeGreaterThan(0);
		for (const [, source] of sources) {
			expect(String(source)).not.toContain('prefers-reduced-motion');
		}
	});
});
