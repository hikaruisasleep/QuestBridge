<script lang="ts">
	/**
	 * Thin progress bar.
	 *
	 * `value === null` means the source did not expose progress. It renders as an
	 * unfilled track with no fill element and no `0%` text anywhere, so
	 * "unavailable" is never mistaken for "no progress" (`AGENTS.md` §7.5).
	 */
	import { progressWidth } from '#lib/presentation.ts';

	let {
		value,
		label,
		emphasis = 'normal'
	}: {
		value: number | null;
		/** Accessible name for the bar. */
		label: string;
		emphasis?: 'normal' | 'complete';
	} = $props();

	const width = $derived(progressWidth(value));
</script>

<div
	class="track"
	role="progressbar"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={100}
	aria-valuenow={value ?? undefined}
	aria-valuetext={value === null ? 'unavailable' : `${value}%`}
	data-complete={emphasis === 'complete'}
>
	{#if width !== null}
		<div class="fill" style:width></div>
	{/if}
</div>

<style>
	.track {
		position: relative;
		height: 3px;
		width: 100%;
		border-radius: 2px;
		background: var(--qb-track, #4a4f5a);
		overflow: hidden;
	}

	.fill {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: 2px;
		background: var(--qb-text-strong, #d6d4d0);
		/* Width changes are structural, not decorative; a short transition keeps
		   two progress updates from looking like a jump without animating for
		   longer than a viewer would tolerate. */
		transition: width var(--qb-progress-fill-ms, 420ms) var(--qb-easing, ease-out);
	}

	.track[data-complete='true'] .fill {
		background: var(--qb-accent-complete, #a9b4a5);
	}
</style>
