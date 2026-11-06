<script lang="ts">
	/**
	 * One row of the chapter catalog: a **chapter**, never a quest.
	 *
	 * The pin action is disabled rather than hidden when it cannot work, and the
	 * reason is available to assistive technology and on hover, per
	 * `docs/web-frontend.md` §3.3 ("no dysfunctional controls").
	 */
	import type { Chapter } from '@questbridge/protocol';

	import { chapterStatusLabel, formatPercentage } from '#lib/presentation.ts';
	import ProgressBar from '#lib/components/common/ProgressBar.svelte';

	let {
		chapter,
		pinned,
		disabledReason,
		busy = false,
		onPin
	}: {
		chapter: Chapter;
		pinned: boolean;
		/** `null` when the action is available. */
		disabledReason: string | null;
		busy?: boolean;
		onPin: (chapterId: string) => void;
	} = $props();
</script>

<li class="row" data-status={chapter.status} data-pinned={pinned}>
	<div class="main">
		<div class="line">
			<span class="title">{chapter.title}</span>
			<span class="status">{chapterStatusLabel(chapter.status)}</span>
		</div>
		{#if chapter.subtitle !== undefined}
			<span class="subtitle">{chapter.subtitle}</span>
		{/if}
		<div class="progress">
			<ProgressBar
				value={chapter.progress}
				label={chapter.title}
				emphasis={chapter.status === 'completed' ? 'complete' : 'normal'}
			/>
			<span class="value">{formatPercentage(chapter.progress)}</span>
		</div>
	</div>

	{#if pinned}
		<span class="badge">Pinned</span>
	{:else}
		<button
			type="button"
			class="action"
			disabled={disabledReason !== null || busy}
			title={disabledReason ?? `Pin ${chapter.title}`}
			onclick={() => onPin(chapter.id)}
		>
			Pin
		</button>
	{/if}
</li>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 9px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.035);
	}

	.row[data-pinned='true'] {
		background: rgba(126, 217, 160, 0.08);
	}

	.main {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1;
	}

	.line {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.title {
		font-size: 13px;
		font-weight: 500;
		color: #e6e9ef;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.subtitle {
		font-size: 11px;
		color: #8a919d;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status {
		flex: none;
		font-size: 10px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #6f7683;
	}

	.row[data-status='completed'] .status {
		color: #7ecfa3;
	}

	.row[data-status='locked'] .status {
		color: #a08b6a;
	}

	.progress {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.value {
		flex: none;
		font-variant-numeric: tabular-nums;
		font-size: 11px;
		color: #8a919d;
	}

	.action {
		flex: none;
		padding: 4px 11px;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
		color: #dfe4ec;
		font: inherit;
		font-size: 11.5px;
		cursor: pointer;
	}

	.action:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.12);
	}

	.action:disabled {
		cursor: not-allowed;
		opacity: 0.42;
	}

	.badge {
		flex: none;
		font-size: 10.5px;
		letter-spacing: 0.04em;
		color: #7ecfa3;
	}
</style>
