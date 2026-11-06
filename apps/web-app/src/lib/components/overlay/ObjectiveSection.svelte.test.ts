import type { Quest } from '@questbridge/protocol';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ObjectiveSection from './ObjectiveSection.svelte';

/**
 * Objective list reflow and overflow.
 *
 * `animate:flip` measures each surviving element before and after an update and
 * tweens it between the two. That is only observable through the Web Animations
 * API, which is why this test reads `getAnimations()` rather than comparing
 * markup: a plain re-render produces correct markup and no animation, and the
 * difference is exactly what `docs/web-frontend.md` §3.5 forbids.
 */

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

const LONG_TITLE =
	'An objective with a title long enough to wrap onto more than one line in a narrow overlay column';

describe('objective reflow', () => {
	it('animates surviving rows when the list reorders', async () => {
		const a = quest('a', LONG_TITLE);
		const b = quest('b', 'Short one');
		const c = quest('c', 'Another objective that also wraps in a narrow column');

		const view = render(ObjectiveSection, {
			quests: [a, b, c],
			showTasks: false
		});

		// Let the initial mount settle so only the reorder can produce animations.
		await new Promise((resolve) => setTimeout(resolve, 50));

		const content = view.container.querySelector('.content');
		expect(content).not.toBeNull();

		await view.rerender({ quests: [c, a, b], showTasks: false });

		// Flip runs asynchronously after the DOM update; poll briefly instead of
		// asserting on the first frame.
		let animated = 0;
		for (let attempt = 0; attempt < 20; attempt += 1) {
			animated = [...content!.children].reduce(
				(total, node) => total + node.getAnimations().length,
				0
			);
			if (animated > 0) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 16));
		}

		// Three surviving rows reorder, so flip must be running on them. A plain
		// re-render would leave this at zero.
		expect(animated).toBeGreaterThan(0);
	});

	it('zooms a newly pinned row rather than snapping it in', async () => {
		const a = quest('a', 'First objective');
		const view = render(ObjectiveSection, { quests: [a], showTasks: false });

		await new Promise((resolve) => setTimeout(resolve, 50));

		await view.rerender({ quests: [a, quest('b', 'Second objective')], showTasks: false });

		const content = view.container.querySelector('.content');
		let animated = 0;
		for (let attempt = 0; attempt < 20; attempt += 1) {
			animated = [...content!.children].reduce(
				(total, node) => total + node.getAnimations().length,
				0
			);
			if (animated > 0) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 16));
		}

		expect(animated).toBeGreaterThan(0);
	});

	it('renders the objective count it was given', async () => {
		const quests = [quest('a', 'One'), quest('b', 'Two'), quest('c', 'Three')];
		const view = render(ObjectiveSection, { quests, showTasks: false });
		expect(view.container.querySelectorAll('.slot')).toHaveLength(3);
	});
});

describe('objective overflow', () => {
	it('keeps the viewport scrollbar-free', async () => {
		const quests = Array.from({ length: 8 }, (_, index) => quest(`q${index}`, LONG_TITLE));
		const view = render(ObjectiveSection, { quests, showTasks: false });

		const viewport = view.container.querySelector('.viewport');
		expect(viewport).not.toBeNull();
		const style = getComputedStyle(viewport!);
		expect(style.overflowY).toBe('hidden');
		expect(style.overflowX).toBe('hidden');
	});

	it('does not animate while there is nothing to scroll', async () => {
		const view = render(ObjectiveSection, { quests: [quest('a', 'Only one')], showTasks: false });
		const content = view.container.querySelector('.content');
		expect(content?.getAttribute('data-scrollable')).toBeNull();
		const scrolled = getComputedStyle(content!).transform;
		expect(scrolled === 'none' || scrolled === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
	});
});

describe('completion highlight', () => {
	it('fires only on a transition into completion', async () => {
		const inProgress = quest('a', 'Becoming complete');
		const view = render(ObjectiveSection, {
			quests: [inProgress],
			showTasks: false,
			completedIds: []
		});

		expect(view.container.querySelector('.quest')?.getAttribute('data-completed')).toBe(
			'false'
		);

		await view.rerender({ quests: [inProgress], showTasks: false, completedIds: ['a'] });
		expect(view.container.querySelector('.quest')?.getAttribute('data-completed')).toBe('true');
	});
});
