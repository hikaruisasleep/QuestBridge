import type { Chapter, DisplayConfig, Quest } from '@questbridge/protocol';
import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import OverlayView from './OverlayView.svelte';
import type { ClientAppState, PinnedChapter } from '#lib/stores/app-state.ts';

/**
 * Overlay rendering.
 *
 * These run in a real Chromium instance, so they assert what a viewer would
 * actually see. The cases that matter most are the ones where a plausible
 * implementation silently fabricates data: filling empty chapter slots,
 * rendering `0%` for unavailable progress, or deriving completion from
 * progress.
 */

const DISPLAY: DisplayConfig = {
	showChapterProgress: true,
	showQuestTasks: true,
	showCompletedQuests: true,
	completionAnimation: true,
	theme: 'minimal',
	compactMode: true
};

function chapter(overrides: Partial<Chapter> & { id: string }): Chapter {
	return { title: overrides.id, order: 0, progress: null, status: 'available', ...overrides };
}

function quest(overrides: Partial<Quest> & { id: string }): Quest {
	return {
		chapterId: 'chapter-a',
		title: overrides.id,
		optional: false,
		hidden: false,
		dependencies: [],
		tasks: [],
		progress: {
			status: 'in_progress',
			completedTasks: 0,
			totalRequiredTasks: 0,
			percentage: null
		},
		...overrides
	};
}

function state(overrides: Partial<ClientAppState> = {}): ClientAppState {
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
		display: DISPLAY,
		transport: 'open',
		failure: null,
		receivedSnapshot: true,
		connectedOnce: true,
		...overrides
	};
}

function resolved(ch: Chapter, position: number): PinnedChapter {
	return { kind: 'resolved', position, chapter: ch };
}

function unresolved(chapterId: string, position: number): PinnedChapter {
	return { kind: 'unresolved', position, chapterId };
}

describe('OverlayView chapter section', () => {
	it('renders pinned chapters in configured order', async () => {
		render(OverlayView, {
			state: state(),
			pins: [
				resolved(chapter({ id: 'c', title: 'Third' }), 0),
				resolved(chapter({ id: 'a', title: 'First' }), 1),
				resolved(chapter({ id: 'b', title: 'Second' }), 2)
			],
			quests: []
		});

		const titles = await page.getByRole('listitem').all();
		expect(titles).toHaveLength(3);
		await expect.element(page.getByText('Third')).toBeInTheDocument();
		// Order is configuration order, not alphabetical or catalog order.
		const text = document.body.textContent ?? '';
		expect(text.indexOf('Third')).toBeLessThan(text.indexOf('First'));
		expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'));
	});

	it('renders no chapter rows for an empty pin configuration', async () => {
		// The catalog has chapters, but none are pinned. The overlay must show
		// nothing rather than the catalog (AGENTS.md §10.1).
		render(OverlayView, {
			state: state({ chapters: [chapter({ id: 'x', title: 'Never Shown' })] }),
			pins: [],
			quests: []
		});

		await expect.element(page.getByText('Progression')).not.toBeInTheDocument();
		await expect.element(page.getByText('Never Shown')).not.toBeInTheDocument();
	});

	it('renders an unresolved pin in its configured position', async () => {
		const { container } = render(OverlayView, {
			state: state(),
			pins: [
				resolved(chapter({ id: 'a', title: 'First' }), 0),
				unresolved('gone-id', 1),
				resolved(chapter({ id: 'c', title: 'Third' }), 2)
			],
			quests: []
		});

		const rows = [...container.querySelectorAll('.row')];
		expect(rows).toHaveLength(3);
		expect(rows[0]?.textContent).toContain('First');
		// The unresolved pin keeps position 1 rather than being dropped or moved.
		expect(rows[1]?.textContent).toContain('Unresolved chapter');
		expect(rows[1]?.textContent).toContain('gone-id');
		expect(rows[2]?.textContent).toContain('Third');
	});

	it('shows unavailable progress as an em dash, never as 0%', async () => {
		render(OverlayView, {
			state: state(),
			pins: [resolved(chapter({ id: 'a', title: 'No Data', progress: null }), 0)],
			quests: []
		});

		await expect.element(page.getByText('—')).toBeInTheDocument();
		await expect.element(page.getByText('0%')).not.toBeInTheDocument();
	});

	it('marks completion from status, not from progress', async () => {
		const { container } = render(OverlayView, {
			state: state(),
			pins: [
				resolved(
					chapter({ id: 'done', title: 'Really Done', progress: 100, status: 'completed' }),
					0
				),
				resolved(
					chapter({ id: 'full', title: 'Full But Open', progress: 100, status: 'available' }),
					1
				)
			],
			quests: []
		});

		const rows = [...container.querySelectorAll('.row')];
		expect(rows[0]?.getAttribute('data-status')).toBe('completed');
		expect(rows[1]?.getAttribute('data-status')).toBe('available');
	});

	it('hides progress when showChapterProgress is false', async () => {
		render(OverlayView, {
			state: state({ display: { ...DISPLAY, showChapterProgress: false } }),
			pins: [resolved(chapter({ id: 'a', title: 'Chapter A', progress: 62 }), 0)],
			quests: []
		});

		await expect.element(page.getByText('Chapter A')).toBeInTheDocument();
		await expect.element(page.getByText('62%')).not.toBeInTheDocument();
		expect(document.querySelectorAll('.track')).toHaveLength(0);
	});
});

describe('OverlayView objective section', () => {
	it('renders quest titles and the required-task counter', async () => {
		render(OverlayView, {
			state: state(),
			pins: [],
			quests: [
				quest({
					id: 'q1',
					title: 'Craft a Machine Frame',
					progress: {
						status: 'in_progress',
						completedTasks: 1,
						totalRequiredTasks: 3,
						percentage: 33
					}
				})
			]
		});

		await expect.element(page.getByText('Craft a Machine Frame')).toBeInTheDocument();
		await expect.element(page.getByText('1/3')).toBeInTheDocument();
	});

	it('shows numeric task progress only when the source provides it', async () => {
		const { container } = render(OverlayView, {
			state: state(),
			pins: [],
			quests: [
				quest({
					id: 'q1',
					title: 'Numeric Quest',
					tasks: [
						{
							id: 't-numeric',
							type: 'ftbquests:item',
							title: 'Machine Frame',
							optional: false,
							progress: { status: 'in_progress', current: 3, target: 10, percentage: 30 }
						},
						{
							id: 't-check',
							type: 'ftbquests:checkmark',
							title: 'Checkmark',
							optional: false,
							progress: { status: 'incomplete', percentage: null }
						}
					]
				})
			]
		});

		const tasks = [...container.querySelectorAll('.task')];
		expect(tasks).toHaveLength(2);
		expect(tasks[0]?.textContent).toContain('3/10');
		// No synthesized 0/1 for a task without numeric progress.
		expect(tasks[1]?.textContent).not.toMatch(/\d+\/\d+/);
		expect(tasks[1]?.textContent).toContain('—');
	});

	it('marks optional tasks and keeps them from blocking counts', async () => {
		const { container } = render(OverlayView, {
			state: state(),
			pins: [],
			quests: [
				quest({
					id: 'q1',
					title: 'Optional Mix',
					progress: {
						status: 'in_progress',
						completedTasks: 1,
						totalRequiredTasks: 2,
						percentage: 50
					},
					tasks: [
						{
							id: 't-required',
							type: 'ftbquests:item',
							title: 'Required task',
							optional: false,
							progress: { status: 'completed', percentage: 100 }
						},
						{
							id: 't-optional',
							type: 'ftbquests:checkmark',
							title: 'Optional task',
							optional: true,
							progress: { status: 'incomplete', percentage: null }
						}
					]
				})
			]
		});

		expect(container.querySelectorAll('.task[data-optional="true"]')).toHaveLength(1);
		// The counter shows required tasks only.
		expect(container.querySelector('.count')?.textContent).toBe('1/2');
	});

	it('renders nothing for an empty objective set', async () => {
		render(OverlayView, { state: state(), pins: [], quests: [] });
		await expect.element(page.getByText('Objectives')).not.toBeInTheDocument();
	});

	it('hides completed quests only when showCompletedQuests is false', async () => {
		// A completed quest is normally absent because FTB removed its pin. If the
		// host still reports one, this setting is what suppresses it.
		const completed = quest({
			id: 'q-done',
			title: 'Already Finished',
			progress: { status: 'completed', completedTasks: 1, totalRequiredTasks: 1, percentage: 100 }
		});

		const visible = render(OverlayView, { state: state(), pins: [], quests: [completed] });
		await expect.element(page.getByText('Already Finished')).toBeInTheDocument();
		visible.unmount();

		render(OverlayView, {
			state: state({ display: { ...DISPLAY, showCompletedQuests: false } }),
			pins: [],
			quests: [completed]
		});
		await expect.element(page.getByText('Already Finished')).not.toBeInTheDocument();
	});

	it('hides task rows when showQuestTasks is false', async () => {
		const { container } = render(OverlayView, {
			state: state({ display: { ...DISPLAY, showQuestTasks: false } }),
			pins: [],
			quests: [
				quest({ id: 'q1', title: 'Visible Title', tasks: [] })
			]
		});

		expect(container.querySelectorAll('.task')).toHaveLength(0);
		await expect.element(page.getByText('Visible Title')).toBeInTheDocument();
	});
});

describe('OverlayView non-blank guarantees', () => {
	it('renders no fabricated content when everything is empty', async () => {
		const { container } = render(OverlayView, { state: state(), pins: [], quests: [] });
		// Nothing may be invented, but the element must still exist so the route
		// can render its status notice over it rather than showing a blank frame.
		expect(container.querySelector('.overlay')).not.toBeNull();
		expect(container.querySelectorAll('.row')).toHaveLength(0);
	});
});
