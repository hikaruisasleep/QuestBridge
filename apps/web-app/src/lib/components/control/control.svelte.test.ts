import type { Chapter } from '@questbridge/protocol';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import CatalogList from './CatalogList.svelte';
import PinList from './PinList.svelte';
import type { PinnedChapter } from '#lib/stores/app-state.ts';
import { startDragSession } from '#lib/utils/drag.ts';

/**
 * Control components.
 *
 * The rule under test throughout is `docs/web-frontend.md` §3.3: no
 * dysfunctional controls. A control that cannot work must be disabled *and*
 * explain why, and a host rejection must surface its code rather than collapsing
 * into a generic failure.
 */

function chapter(overrides: Partial<Chapter> & { id: string }): Chapter {
	return { title: overrides.id, order: 0, progress: null, status: 'available', ...overrides };
}

function resolved(ch: Chapter, position: number): PinnedChapter {
	return { kind: 'resolved', position, chapter: ch };
}

function unresolved(chapterId: string, position: number): PinnedChapter {
	return { kind: 'unresolved', position, chapterId };
}

const CATALOG = [
	chapter({ id: 'a', title: 'Getting Started', subtitle: 'The first steps', progress: 62 }),
	chapter({ id: 'b', title: 'Power Generation', progress: null, status: 'locked' }),
	chapter({ id: 'c', title: 'Advanced Storage', subtitle: 'Drawers and disks', progress: 45 }),
	chapter({ id: 'd', title: 'The ATM Star', progress: 100, status: 'completed' })
];

describe('CatalogList', () => {
	it('lists every discovered chapter with progress and state', async () => {
		const { container } = render(CatalogList, {
			chapters: CATALOG,
			isPinned: () => false,
			hasSnapshot: true,
			isFull: false,
			pinDisabledReason: null,
			onPin: () => {}
		});

		expect(container.querySelectorAll('.row')).toHaveLength(4);
		expect(container.textContent).toContain('Getting Started');
		expect(container.textContent).toContain('62%');
		// Unavailable progress is an em dash, not 0%.
		expect(container.textContent).toContain('—');
		expect(container.textContent).toContain('Locked');
		expect(container.textContent).toContain('Complete');
	});

	it('distinguishes a catalog that was never received from an empty one', async () => {
		const waiting = render(CatalogList, {
			chapters: [],
			isPinned: () => false,
			hasSnapshot: false,
			isFull: false,
			pinDisabledReason: 'Waiting for the first snapshot from Minecraft.',
			onPin: () => {}
		});
		expect(waiting.container.textContent).toContain('Waiting for Minecraft');
		waiting.unmount();

		const empty = render(CatalogList, {
			chapters: [],
			isPinned: () => false,
			hasSnapshot: true,
			isFull: false,
			pinDisabledReason: null,
			onPin: () => {}
		});
		expect(empty.container.textContent).toContain('Minecraft reports no chapters');
		expect(empty.container.textContent).not.toContain('Waiting for Minecraft');
	});

	it('filters on title and subtitle', async () => {
		const { container } = render(CatalogList, {
			chapters: CATALOG,
			isPinned: () => false,
			hasSnapshot: true,
			isFull: false,
			pinDisabledReason: null,
			onPin: () => {}
		});

		const input = container.querySelector('input')!;
		input.value = 'storage';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(container.querySelectorAll('.row')).toHaveLength(1);

		input.value = 'disks';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(container.querySelectorAll('.row')).toHaveLength(1);
		expect(container.textContent).toContain('Advanced Storage');

		input.value = 'nothing matches';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(container.querySelectorAll('.row')).toHaveLength(0);
		expect(container.textContent).toContain('No chapter matches');
	});

	it('disables pinning with a stated reason when the set is full', async () => {
		const onPin = vi.fn();
		const { container } = render(CatalogList, {
			chapters: CATALOG,
			isPinned: () => false,
			hasSnapshot: true,
			isFull: true,
			pinDisabledReason: null,
			onPin
		});

		const buttons = [...container.querySelectorAll<HTMLButtonElement>('.action')];
		expect(buttons).toHaveLength(4);
		for (const button of buttons) {
			expect(button.disabled).toBe(true);
			expect(button.title).toContain('Five chapters are already pinned');
		}

		buttons[0]!.click();
		expect(onPin).not.toHaveBeenCalled();
	});

	it('disables pinning with the connection reason before a snapshot', async () => {
		const { container } = render(CatalogList, {
			chapters: CATALOG,
			isPinned: () => false,
			hasSnapshot: true,
			isFull: false,
			pinDisabledReason: 'Waiting for the first snapshot from Minecraft.',
			onPin: () => {}
		});

		const button = container.querySelector<HTMLButtonElement>('.action')!;
		expect(button.disabled).toBe(true);
		expect(button.title).toBe('Waiting for the first snapshot from Minecraft.');
	});

	it('shows an already-pinned chapter as pinned rather than offering a pin', async () => {
		const { container } = render(CatalogList, {
			chapters: CATALOG,
			isPinned: (id) => id === 'b',
			hasSnapshot: true,
			isFull: false,
			pinDisabledReason: null,
			onPin: () => {}
		});

		const rows = [...container.querySelectorAll('.row')];
		expect(rows[1]?.getAttribute('data-pinned')).toBe('true');
		expect(rows[1]?.querySelector('.badge')?.textContent).toContain('Pinned');
		expect(rows[1]?.querySelector('.action')).toBeNull();
	});

	it('calls onPin with the chapter id', async () => {
		const onPin = vi.fn();
		const { container } = render(CatalogList, {
			chapters: CATALOG,
			isPinned: () => false,
			hasSnapshot: true,
			isFull: false,
			pinDisabledReason: null,
			onPin
		});

		container.querySelector<HTMLButtonElement>('.row:nth-child(3) .action')!.click();
		expect(onPin).toHaveBeenCalledWith('c');
	});
});

describe('PinList', () => {
	const PINS = [
		resolved(chapter({ id: 'a', title: 'Getting Started', progress: 62 }), 0),
		unresolved('gone-id', 1),
		resolved(chapter({ id: 'c', title: 'Advanced Storage', progress: 45 }), 2)
	];

	it('renders pins in order with positions and the cap count', async () => {
		const { container } = render(PinList, {
			pins: PINS,
			disabledReason: null,
			onUnpin: () => {},
			onReorder: () => {}
		});

		const positions = [...container.querySelectorAll('.position')].map((p) => p.textContent);
		expect(positions).toEqual(['1', '2', '3']);
		expect(container.textContent).toContain('3 / 5');
	});

	it('shows an unresolved pin in place with its raw id', async () => {
		const { container } = render(PinList, {
			pins: PINS,
			disabledReason: null,
			onUnpin: () => {},
			onReorder: () => {}
		});

		const rows = [...container.querySelectorAll('.pin')];
		expect(rows[1]?.getAttribute('data-kind')).toBe('unresolved');
		expect(rows[1]?.textContent).toContain('Unresolved chapter');
		expect(rows[1]?.textContent).toContain('gone-id');
	});

	it('unpins by chapter id, including an unresolved id', async () => {
		const onUnpin = vi.fn();
		const { container } = render(PinList, {
			pins: PINS,
			disabledReason: null,
			onUnpin,
			onReorder: () => {}
		});

		container.querySelector<HTMLButtonElement>('.pin:nth-child(2) .action')!.click();
		expect(onUnpin).toHaveBeenCalledWith('gone-id');
	});

	it('disables every control with the stated reason', async () => {
		const { container } = render(PinList, {
			pins: PINS,
			disabledReason: 'Not connected to the QuestBridge host.',
			onUnpin: () => {},
			onReorder: () => {}
		});

		const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
		expect(buttons.length).toBeGreaterThan(0);
		for (const button of buttons) {
			expect(button.disabled).toBe(true);
			expect(button.title).toBe('Not connected to the QuestBridge host.');
		}
	});

	it('renders an empty state rather than an empty list', async () => {
		const { container } = render(PinList, {
			pins: [],
			disabledReason: null,
			onUnpin: () => {},
			onReorder: () => {}
		});

		expect(container.querySelectorAll('.pin')).toHaveLength(0);
		expect(container.textContent).toContain('No chapters pinned yet');
	});

	it('explains how to reorder, including touch', async () => {
		const { container } = render(PinList, {
			pins: PINS,
			disabledReason: null,
			onUnpin: () => {},
			onReorder: () => {}
		});
		expect(container.textContent?.toLowerCase()).toContain('touch');
	});
});

describe('drag session input families', () => {
	function list(): { root: HTMLElement; items: HTMLElement[]; handle: HTMLElement } {
		const root = document.createElement('ul');
		root.style.cssText = 'position:relative;width:200px;';
		const items: HTMLElement[] = [];
		for (let index = 0; index < 3; index += 1) {
			const li = document.createElement('li');
			li.style.cssText = `height:40px;display:block;margin:0;padding:0;`;
			const handle = document.createElement('button');
			handle.style.cssText = 'height:40px;width:40px;display:block;';
			li.appendChild(handle);
			root.appendChild(li);
			items.push(li);
		}
		document.body.appendChild(root);
		return { root, items, handle: items[0]!.querySelector('button')! };
	}

	it('starts a pull on the opening pointerdown and reports the target on drop', () => {
		const { root, items, handle } = list();
		const drops: Array<[number, number]> = [];

		const opening = new PointerEvent('pointerdown', {
			pointerId: 1,
			pointerType: 'mouse',
			button: 0,
			clientY: 20,
			bubbles: true
		});
		startDragSession(
			handle,
			0,
			{
				list: root,
				source: items[0]!,
				handle,
				items: () => items,
				onDrop: (from, to) => drops.push([from, to])
			},
			opening
		);

		window.dispatchEvent(
			new PointerEvent('pointermove', { pointerId: 1, clientY: 100, bubbles: true })
		);
		window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientY: 100, bubbles: true }));

		expect(drops).toEqual([[0, 1]]);
		root.remove();
	});

	it('does not commit a gesture that never crossed the threshold', () => {
		const { root, items, handle } = list();
		const drops: Array<[number, number]> = [];

		startDragSession(
			handle,
			0,
			{
				list: root,
				source: items[0]!,
				handle,
				items: () => items,
				onDrop: (from, to) => drops.push([from, to])
			},
			new PointerEvent('pointerdown', {
				pointerId: 2,
				pointerType: 'mouse',
				button: 0,
				clientY: 20,
				bubbles: true
			})
		);

		// A click: a move of one pixel and a release in the same row.
		window.dispatchEvent(
			new PointerEvent('pointermove', { pointerId: 2, clientY: 21, bubbles: true })
		);
		window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientY: 21, bubbles: true }));

		expect(drops).toEqual([]);
		root.remove();
	});

	it('cancels without committing when the gesture is cancelled', () => {
		const { root, items, handle } = list();
		const drops: Array<[number, number]> = [];
		const active: boolean[] = [];

		startDragSession(
			handle,
			0,
			{
				list: root,
				source: items[0]!,
				handle,
				items: () => items,
				onDrop: (from, to) => drops.push([from, to]),
				onActiveChange: (value) => active.push(value)
			},
			new PointerEvent('pointerdown', {
				pointerId: 3,
				pointerType: 'touch',
				button: 0,
				clientY: 20,
				bubbles: true
			})
		);

		window.dispatchEvent(
			new PointerEvent('pointermove', { pointerId: 3, clientY: 110, bubbles: true })
		);
		window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 3, bubbles: true }));

		expect(drops).toEqual([]);
		expect(active).toContain(false);
		root.remove();
	});

	it('requires more travel before a touch counts as a drag than a mouse', () => {
		const thresholdProbe = (pointerType: 'mouse' | 'touch', delta: number): boolean => {
			const { root, items, handle } = list();
			let started = false;
			startDragSession(
				handle,
				0,
				{
					list: root,
					source: items[0]!,
					handle,
					items: () => items,
					onDrop: () => {},
					onActiveChange: (value) => {
						if (value) {
							started = true;
						}
					}
				},
				new PointerEvent('pointerdown', {
					pointerId: 9,
					pointerType,
					button: 0,
					clientY: 20,
					bubbles: true
				})
			);
			window.dispatchEvent(
				new PointerEvent('pointermove', {
					pointerId: 9,
					pointerType,
					clientY: 20 + delta,
					bubbles: true
				})
			);
			window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 9, bubbles: true }));
			root.remove();
			return started;
		};

		// 6px moves a mouse past its 4px tolerance but not a finger past its 8px one.
		expect(thresholdProbe('mouse', 6)).toBe(true);
		expect(thresholdProbe('touch', 6)).toBe(false);
	});
});
