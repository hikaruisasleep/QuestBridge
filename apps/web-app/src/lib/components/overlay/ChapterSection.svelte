<script lang="ts">
	/**
	 * Major progression: exactly the configured chapter pins, in configured
	 * order.
	 *
	 * This section renders the pin list and nothing else. It does not consult the
	 * catalog for extra chapters, does not fill empty slots, and does not
	 * reorder by catalog order (`docs/chapter-pinning.md` §9). An unresolved pin
	 * keeps its position and is marked; it is never substituted.
	 */
	import { chapterStatusLabel, formatPercentage, UNRESOLVED_CHAPTER_LABEL } from '#lib/presentation.ts';
	import type { PinnedChapter } from '#lib/stores/app-state.ts';
	import { motion } from '#lib/motion.ts';
	import ProgressBar from '../common/ProgressBar.svelte';

	let {
		pins,
		showProgress,
		completedTransition = null
	}: {
		pins: PinnedChapter[];
		showProgress: boolean;
		/**
		 * Triggers the completion highlight only on a genuine transition into
		 * completion. The parent owns transition detection so the animation does
		 * not re-fire on every state update (`docs/phase-3-plan.md` §6.1).
		 */
		completedTransition?: { chapterId: string; at: number } | null;
	} = $props();

	let pulse: { chapterId: string; at: number } | null = $state(null);

	$effect(() => {
		const transition = completedTransition;
		if (transition === null) {
			return;
		}
		pulse = transition;
		const timer = setTimeout(() => {
			if (pulse === transition) {
				pulse = null;
			}
		}, motion.completionPulseMs);
		return () => clearTimeout(timer);
	});
</script>

<section class="section" aria-labelledby="qb-chapters-heading">
	<h2 id="qb-chapters-heading" class="heading">Progression</h2>
	<ul class="list">
		{#each pins as pin (pin.kind === 'resolved' ? pin.chapter.id : `unresolved:${pin.chapterId}`)}
			{@const resolved = pin.kind === 'resolved' ? pin.chapter : null}
			{@const id = pin.kind === 'resolved' ? pin.chapter.id : pin.chapterId}
			{@const completed = resolved?.status === 'completed'}
			<li
				class="row"
				data-status={resolved?.status ?? 'unresolved'}
				data-pulsing={pulse?.chapterId === id}
			>
				<div class="line">
					<span class="title" class:unresolved={resolved === null}>
						{resolved === null ? UNRESOLVED_CHAPTER_LABEL : resolved.title}
					</span>
					{#if showProgress && resolved !== null}
						<span class="value">{formatPercentage(resolved.progress)}</span>
					{/if}
				</div>
				{#if showProgress && resolved !== null}
					<ProgressBar value={resolved.progress} label={resolved.title} emphasis={completed ? 'complete' : 'normal'} />
				{/if}
				{#if resolved === null}
					<span class="note">{id}</span>
				{:else if resolved.status !== 'available' && !showProgress}
					<span class="note">{chapterStatusLabel(resolved.status)}</span>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	.section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.heading {
		margin: 0;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--qb-text-muted, #92908d);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 7px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 2px 0;
	}

	.line {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.title {
		font-size: 13px;
		font-weight: 500;
		line-height: 1.25;
		color: var(--qb-text-primary, #e8e6e2);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
	}

	.title.unresolved {
		color: var(--qb-text-muted, #92908d);
		font-style: italic;
	}

	.value {
		font-variant-numeric: tabular-nums;
		font-size: 11px;
		color: var(--qb-text-body, #b9b7b3);
	}

	.note {
		font-size: 10px;
		letter-spacing: 0.04em;
		color: var(--qb-text-faint, #6e6c69);
	}

	.row[data-status='completed'] .title {
		color: var(--qb-accent-complete, #a9b4a5);
	}

	/* Completion highlight: opacity and a thin left rule only, so the row never
	   changes height or pushes its neighbours. */
	.row[data-pulsing='true']::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 -8px;
		width: 2px;
		border-radius: 1px;
		background: var(--qb-accent-complete, #a9b4a5);
		animation: qb-chapter-pulse var(--qb-pulse-ms, 900ms) ease-out;
	}

	@keyframes qb-chapter-pulse {
		0% {
			opacity: 0;
		}
		18% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
</style>
