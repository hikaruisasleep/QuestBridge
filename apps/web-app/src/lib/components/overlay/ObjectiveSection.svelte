<script lang="ts">
	/**
	 * Current objectives: the player's manual FTB Quests pins.
	 *
	 * Animation contract (`docs/web-frontend.md` §3.5):
	 *
	 * - A quest that is pinned or unpinned **zooms** in or out (`scale`) rather
	 *   than appearing or vanishing.
	 * - Surviving quests **slide** to their new positions (`animate:flip`). A
	 *   plain re-render reorders DOM nodes and no animation plays, which is
	 *   exactly the snapping this exists to prevent.
	 *
	 * The keyed `each` block is load-bearing: it is what gives `flip` a stable
	 * identity per quest across updates.
	 *
	 * Auto-scroll: when the content is taller than the viewport the list drifts
	 * between the two ends with a pause at each, driven by a **measured**
	 * overflow rather than a fixed keyframe duration, so it stays correct as the
	 * content changes. Overflow is hidden on the scroll axis, because a
	 * scrollbar on stream is unacceptable.
	 */
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import type { Quest } from '@questbridge/protocol';

	import { motion } from '#lib/motion.ts';
	import QuestRow from './QuestRow.svelte';

	let {
		quests,
		showTasks,
		completedIds = []
	}: {
		quests: Quest[];
		showTasks: boolean;
		/** Quest IDs that transitioned into completion, for the row highlight. */
		completedIds?: string[];
	} = $props();

	let viewport = $state<HTMLElement | null>(null);
	let content = $state<HTMLElement | null>(null);
	let overflow = $state(0);
	let offset = $state(0);
	let atEnd = $state(false);

	/** Measure the overflow whenever the content or the viewport changes. */
	$effect(() => {
		const view = viewport;
		const inner = content;
		if (view === null || inner === null) {
			return;
		}

		const measure = (): void => {
			const excess = Math.max(0, inner.scrollHeight - view.clientHeight);
			overflow = excess;
			if (excess === 0) {
				offset = 0;
				atEnd = false;
			}
			// Keep the current offset inside the new range when content grows or
			// shrinks mid-animation, so a resize cannot leave a blank gap.
			offset = Math.min(offset, excess);
			if (offset >= excess && excess > 0) {
				atEnd = true;
			}
		};

		measure();

		const observer = new ResizeObserver(measure);
		observer.observe(view);
		observer.observe(inner);
		return () => observer.disconnect();
	});

	/** One leg of the auto-scroll: pause, travel, pause, travel back. */
	$effect(() => {
		if (overflow <= 0) {
			return;
		}

		const leg = Math.min(
			motion.autoScrollMaxTravelMs,
			Math.max(motion.autoScrollMinTravelMs, overflow * motion.autoScrollMsPerPx)
		);

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const step = (): void => {
			if (cancelled) {
				return;
			}
			if (atEnd) {
				offset = 0;
				atEnd = false;
			} else {
				offset = overflow;
				atEnd = true;
			}
			timer = setTimeout(step, leg + motion.autoScrollHoldMs);
		};

		// Start with a hold at the top so a fresh pin is readable before drifting.
		timer = setTimeout(step, motion.autoScrollHoldMs);
		return () => {
			cancelled = true;
			if (timer !== null) {
				clearTimeout(timer);
			}
		};
	});

	const travelMs = $derived(
		Math.min(
			motion.autoScrollMaxTravelMs,
			Math.max(motion.autoScrollMinTravelMs, overflow * motion.autoScrollMsPerPx)
		)
	);
</script>

<section class="section" aria-labelledby="qb-objectives-heading">
	<h2 id="qb-objectives-heading" class="heading">Objectives</h2>

	<div class="viewport" bind:this={viewport} data-scrollable={overflow > 0}>
		<div
			class="content"
			bind:this={content}
			style:transform="translateY(-{offset}px)"
			style:transition-duration="{overflow > 0 ? travelMs : 0}ms"
			style:transition-delay="{overflow > 0 ? motion.autoScrollHoldMs : 0}ms"
		>
			{#each quests as quest (quest.id)}
				<div
					class="slot"
					animate:flip={{ duration: motion.questReflowMs }}
					in:scale={{ duration: motion.questZoomMs, start: 0.86, opacity: 0 }}
					out:scale={{ duration: motion.questZoomMs, start: 0.86, opacity: 0 }}
				>
					<QuestRow
						{quest}
						{showTasks}
						completed={completedIds.includes(quest.id)}
					/>
				</div>
			{/each}
		</div>
	</div>
</section>

<style>
	.section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		/* The objectives section takes the remaining height and never forces the
		   overlay taller than the OBS frame. */
		min-height: 0;
		flex: 1;
	}

	.heading {
		margin: 0;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--qb-text-muted, #92908d);
	}

	.viewport {
		/* Hard requirement: no scrollbars on stream. Overflow is clipped and the
		   content is moved with a transform instead. */
		overflow: hidden;
		flex: 1;
		min-height: 0;
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 6px;
		/* `transform` transitions are compositor-only, so the auto-scroll never
		   triggers layout or re-rasterises text on each frame. */
		transition-property: transform;
		transition-timing-function: ease-in-out;
		will-change: transform;
	}
</style>
