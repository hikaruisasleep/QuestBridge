<script lang="ts">
	/**
	 * The configured chapter pins: reorder, unpin, and see unresolved entries.
	 *
	 * Reordering is drag-and-drop on a dedicated grab handle. The handle is a
	 * `button` rather than the whole row so that unpinning and dragging do not
	 * compete for the same gesture, and so a keyboard user can focus it even
	 * though keyboard reordering itself is out of scope (`docs/phase-3-plan.md`
	 * §11.2).
	 *
	 * Pointer Events cover mouse, pen, and touch. Touch needs two extra things
	 * that a mouse-only implementation silently lacks: a movement threshold before
	 * the drag begins (so the list can still scroll on a phone) and suppression of
	 * the browser's touch scrolling once a drag is underway. Both live in
	 * `startDragSession`.
	 */
	import type { PinnedChapter } from '#lib/stores/app-state.ts';
	import { chapterStatusLabel, formatPercentage, UNRESOLVED_CHAPTER_LABEL } from '#lib/presentation.ts';
	import { startDragSession } from '#lib/utils/drag.ts';

	let {
		pins,
		disabledReason,
		onUnpin,
		onReorder
	}: {
		pins: PinnedChapter[];
		/** Reason mutations are unavailable, or `null`. */
		disabledReason: string | null;
		onUnpin: (chapterId: string) => void;
		onReorder: (chapterIds: string[]) => void;
	} = $props();

	let dragging = $state(false);
	let dragTarget = $state<number | null>(null);
	let dragSource = $state<number | null>(null);
	/**
	 * Frozen copy of the row order for the duration of a drag.
	 *
	 * The drag module enumerates `.pin` elements and writes `dragover` onto them
	 * imperatively. Re-rendering the list mid-drag would replace those elements
	 * and orphan the module's references, so the rendered order is held constant
	 * and only the *displayed* position numbers are projected.
	 */
	let positions = $state<number[] | null>(null);

	const ids = $derived(
		pins.map((pin) => (pin.kind === 'resolved' ? pin.chapter.id : pin.chapterId))
	);

	/** Index the item would occupy if the drag were released now. */
	const projectedOrder = $derived.by(() => {
		if (dragSource === null || dragTarget === null) {
			return null;
		}
		const next = [...ids];
		const [moved] = next.splice(dragSource, 1);
		if (moved !== undefined) {
			next.splice(dragTarget, 0, moved);
		}
		return next;
	});

	function beginDrag(event: PointerEvent, index: number): void {
		if (disabledReason !== null) {
			return;
		}
		const handle = event.currentTarget as HTMLElement;
		const row = handle.closest('li');
		const owner = handle.closest('ul');
		if (!(row instanceof HTMLElement) || !(owner instanceof HTMLElement)) {
			return;
		}
		const rows = [...owner.querySelectorAll<HTMLElement>('.pin')];
		const sourceIndex = rows.indexOf(row);
		if (sourceIndex === -1) {
			return;
		}

		// The module registers itself on this handle's `pointerdown`, so this runs
		// on every press: the first one starts a session, and the rest of the
		// gesture is delivered to it through the window listeners it installs.
		startDragSession(handle, sourceIndex, {
			list: owner,
			source: row,
			handle,
			items: () => [...owner.querySelectorAll<HTMLElement>('.pin')],
			onTargetChange: (from, to) => {
				dragSource = from;
				dragTarget = to;
			},
			onActiveChange: (active) => {
				dragging = active;
				// Hold the rendered order steady for the duration of the drag. The
				// module enumerates the rows and writes attributes onto them, so a
				// re-render mid-drag would replace those elements. Only the
				// displayed position numbers are projected.
				positions = active ? pins.map((_, index) => index) : null;
			},
			onDrop: (from, to) => {
				const current = [...ids];
				const [moved] = current.splice(from, 1);
				if (moved !== undefined) {
					current.splice(to, 0, moved);
				}
				resetDrag();
				// The host is authoritative; sending the full new order lets it
				// answer `invalid_reorder_set` rather than us guessing what it wanted.
				if (current.join('\u0000') !== ids.join('\u0000')) {
					onReorder(current);
				}
			}
		}, event);
	}

		/** Index the item occupies in the rendered list while a drag is in progress. */
	function positionOf(chapterId: string, renderIndex: number): number {
		if (positions === null) {
			return renderIndex;
		}
		const projected = projectedOrder ?? ids;
		const index = projected.indexOf(chapterId);
		return index === -1 ? renderIndex : index;
	}

	function resetDrag(): void {
		dragging = false;
		dragSource = null;
		dragTarget = null;
		positions = null;
	}

	function onHandleKeydown(event: KeyboardEvent, index: number): void {
		// Keyboard reordering is out of scope, but cancellation must still work so
		// a focused handle cannot leave the list in a half-started state.
		if (event.key === 'Escape') {
			resetDrag();
			return;
		}
		void index;
	}
</script>

<section class="pins" aria-labelledby="qb-pins-heading">
	<div class="head">
		<h2 id="qb-pins-heading">Pinned chapters</h2>
		<span class="count">{pins.length} / 5</span>
	</div>

	{#if pins.length === 0}
		<p class="notice">No chapters pinned yet. Pin up to five from the catalog.</p>
	{:else}
		<ul class="list" data-dragging={dragging}>
			{#each pins as pin, index (pin.kind === 'resolved' ? pin.chapter.id : `unresolved:${pin.chapterId}`)}
				{@const chapterId = pin.kind === 'resolved' ? pin.chapter.id : pin.chapterId}
				{@const position = positionOf(chapterId, index)}
				<li class="pin" data-kind={pin.kind} data-position={position}>
					<span class="position" aria-hidden="true">{position + 1}</span>

					<button
						type="button"
						class="handle"
						disabled={disabledReason !== null || pins.length < 2}
						title={pins.length < 2 ? 'Nothing to reorder' : `Drag to reorder ${position + 1}`}
						aria-label="Reorder chapter at position {position + 1}"
						aria-describedby="qb-drag-help"
						onpointerdown={(event) => beginDrag(event, index)}
						onkeydown={(event) => onHandleKeydown(event, index)}
					>
						⠿
					</button>

					<div class="body">
						{#if pin.kind === 'resolved'}
							<span class="title">{pin.chapter.title}</span>
							{#if pin.chapter.subtitle !== undefined}
								<span class="subtitle">{pin.chapter.subtitle}</span>
							{/if}
							<span class="meta">
								{chapterStatusLabel(pin.chapter.status)} · {formatPercentage(pin.chapter.progress)}
							</span>
						{:else}
							<span class="title unresolved">{UNRESOLVED_CHAPTER_LABEL}</span>
							<span class="meta code">{pin.chapterId}</span>
						{/if}
					</div>

					<button
						type="button"
						class="action"
						disabled={disabledReason !== null}
						title={disabledReason ?? `Unpin ${chapterId}`}
						onclick={() => onUnpin(chapterId)}
					>
						Unpin
					</button>
				</li>
			{/each}
		</ul>
		<p id="qb-drag-help" class="help">
			Drag the handle to reorder. Touch screens: press and hold, then drag.
		</p>
	{/if}
</section>

<style>
	.pins {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	h2 {
		margin: 0;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #8f96a3;
	}

	.count {
		font-size: 11px;
		color: #6f7683;
		font-variant-numeric: tabular-nums;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
		/* The list owns its own scrolling so a long catalog below stays reachable
		   while a touch drag is in progress. */
		touch-action: pan-y;
	}

	.pin {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 9px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.045);
		transition: background 120ms ease-out;
	}

	/* The drag module writes these attributes directly on the elements it is
	   given, so the compiler cannot see them from the markup. They are matched by
	   attribute selector, which is what the module relies on. */
	.pin:global([data-dragover='true']) {
		background: rgba(120, 160, 230, 0.16);
	}

	.pin:global([data-dragging='true']) {
		opacity: 0.55;
	}

	.position {
		flex: none;
		width: 15px;
		font-variant-numeric: tabular-nums;
		font-size: 11px;
		color: #6f7683;
		text-align: right;
	}

	.handle {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.03);
		color: #8a919d;
		font-size: 13px;
		line-height: 1;
		cursor: grab;
		/* `none` lets a finger drag the handle without the page panning; the list
		   still pans because rows outside the handle keep `pan-y`. */
		touch-action: none;
	}

	.handle:active {
		cursor: grabbing;
	}

	.handle:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}

	.title {
		font-size: 13px;
		font-weight: 500;
		color: #e6e9ef;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title.unresolved {
		color: #a08b6a;
		font-style: italic;
	}

	.subtitle {
		font-size: 11px;
		color: #8a919d;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		font-size: 11px;
		color: #6f7683;
	}

	.meta.code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 10.5px;
	}

	.action {
		flex: none;
		padding: 4px 10px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 4px;
		background: transparent;
		color: #cfd5df;
		font: inherit;
		font-size: 11.5px;
		cursor: pointer;
	}

	.action:disabled {
		cursor: not-allowed;
		opacity: 0.42;
	}

	.notice {
		margin: 0;
		padding: 10px 11px;
		border-radius: 5px;
		background: rgba(255, 255, 255, 0.03);
		font-size: 12px;
		color: #8a919d;
	}

	.help {
		margin: 0;
		font-size: 10.5px;
		color: #5f6672;
	}
</style>
