import { describe, expect, it } from 'vitest';

import { computeTargetIndex, moveItem, type DragGeometry } from './drag.js';

/**
 * Drag decision logic.
 *
 * The DOM wiring is exercised in the browser project; what is tested here is the
 * part that decides *where* a dragged row lands, because getting it wrong is
 * invisible in code review and obvious to a user.
 */

/** Five 40px rows starting at y=0, so centres are at 20, 60, 100, 140, 180. */
function rows(count = 5): DragGeometry[] {
	return Array.from({ length: count }, (_, index) => ({
		centre: index * 40 + 20,
		size: 40
	}));
}

describe('computeTargetIndex', () => {
	it("keeps an item in place when the pointer stays on it", () => {
		expect(computeTargetIndex(2, 100, rows())).toBe(2);
	});

	it("moves an item down past a neighbour", () => {
		// Dragging item 0 down past item 1's centre.
		expect(computeTargetIndex(0, 70, rows())).toBe(1);
	});

	it("moves an item up past a neighbour", () => {
		// Row 1's centre is 60. Above it (40) lands the item at index 1; above
		// row 0's centre (20) takes it to the top.
		expect(computeTargetIndex(3, 40, rows())).toBe(1);
		expect(computeTargetIndex(3, 10, rows())).toBe(0);
	});

	it("clamps above the first row", () => {
		expect(computeTargetIndex(2, -500, rows())).toBe(0);
	});

	it("clamps below the last row", () => {
		expect(computeTargetIndex(2, 5_000, rows())).toBe(4);
	});

	it("handles a single-item list", () => {
		expect(computeTargetIndex(0, 999, rows(1))).toBe(0);
	});

	it("ignores an out-of-range source", () => {
		expect(computeTargetIndex(9, 100, rows())).toBe(9);
	});

	it("is stable for rows of differing heights", () => {
		// A tall first row (0-120, centre 60) then three 40px rows.
		const mixed: DragGeometry[] = [
			{ centre: 60, size: 120 },
			{ centre: 140, size: 40 },
			{ centre: 180, size: 40 },
			{ centre: 220, size: 40 }
		];
		// Dropping the tall row below the 140-centre row.
		expect(computeTargetIndex(0, 150, mixed)).toBe(1);
		// And back to the top.
		expect(computeTargetIndex(3, 10, mixed)).toBe(0);
	});
});

describe('moveItem', () => {
	it("moves an item down", () => {
		expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
	});

	it("moves an item up", () => {
		expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
	});

	it("returns an unchanged copy for a no-op move", () => {
		const source = ['a', 'b', 'c'];
		const result = moveItem(source, 1, 1);
		expect(result).toEqual(source);
		// A fresh array, so callers can rely on reference inequality for updates.
		expect(result).not.toBe(source);
	});

	it("returns an unchanged copy for an out-of-range index", () => {
		expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
		expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
	});

	it("does not mutate the input", () => {
		const source = ['a', 'b', 'c'];
		moveItem(source, 0, 2);
		expect(source).toEqual(['a', 'b', 'c']);
	});
});
