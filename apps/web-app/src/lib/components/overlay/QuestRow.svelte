<script lang="ts">
	/**
	 * A single objective row.
	 *
	 * Shows the quest title, its completion state, the required-task counter, and
	 * one line per task. Numeric progress is shown **only** when the source
	 * provides `current`/`target`; there is no synthesized `0/1`
	 * (`docs/protocol.md` §8.4).
	 */
	import { formatPercentage, questStatusLabel, taskStatusLabel } from '#lib/presentation.ts';
	import type { Quest } from '@questbridge/protocol';
	import ProgressBar from '../common/ProgressBar.svelte';

	let {
		quest,
		showTasks,
		completed = false
	}: { quest: Quest; showTasks: boolean; completed?: boolean } = $props();

	const taskCount = $derived(`${quest.progress.completedTasks}/${quest.progress.totalRequiredTasks}`);
</script>

<article class="quest" data-status={quest.progress.status} data-completed={completed}>
	<header class="head">
		<h3 class="title">{quest.title}</h3>
		<span class="state">{questStatusLabel(quest.progress.status)}</span>
	</header>

	{#if showTasks}
		<div class="counter">
			<span class="count" aria-label="completed tasks">{taskCount}</span>
			<span class="bar">
				<ProgressBar
					value={quest.progress.percentage}
					label={`${quest.title} tasks`}
					emphasis={completed ? 'complete' : 'normal'}
				/>
			</span>
		</div>

		{#if quest.tasks.length > 0}
			<ul class="tasks">
				{#each quest.tasks as task (task.id)}
					<li class="task" data-status={task.progress.status} data-optional={task.optional}>
						<span class="marker" aria-hidden="true">
							{task.progress.status === 'completed' ? '✓' : task.progress.status === 'in_progress' ? '•' : '○'}
						</span>
						<span class="task-title">{task.title ?? taskStatusLabel(task.progress.status)}</span>
						{#if task.optional}
							<span class="optional" title="Optional task; never blocks completion">optional</span>
						{/if}
						<span class="task-value">
							{#if task.progress.current !== undefined && task.progress.target !== undefined}
								{task.progress.current}/{task.progress.target}
							{:else}
								{formatPercentage(task.progress.percentage)}
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</article>

<style>
	.quest {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 6px 7px;
		border-radius: 4px;
		background: var(--qb-row-fill, #1a1d23);
		/* Only paint properties transition here. The zoom and reflow are driven
		   by the parent's transition/animate directives so they cannot fight
		   with these. */
		transition:
			background var(--qb-zoom-ms, 260ms) ease-out,
			opacity var(--qb-zoom-ms, 260ms) ease-out;
	}

	.quest[data-completed='true'] {
		background: var(--qb-row-complete, #243029);
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.title {
		margin: 0;
		font-size: 12.5px;
		font-weight: 500;
		line-height: 1.3;
		color: var(--qb-text-primary, #e8e6e2);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
	}

	.state {
		flex: none;
		font-size: 10px;
		letter-spacing: 0.03em;
		color: var(--qb-text-muted, #92908d);
	}

	.quest[data-completed='true'] .state {
		color: var(--qb-accent-complete, #a9b4a5);
	}

	.counter {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	.count {
		flex: none;
		font-variant-numeric: tabular-nums;
		font-size: 10.5px;
		color: var(--qb-text-body, #b9b7b3);
	}

	.bar {
		flex: 1;
		min-width: 0;
	}

	.tasks {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 1px 0 0;
		padding: 0;
		list-style: none;
	}

	.task {
		display: flex;
		align-items: baseline;
		gap: 5px;
		font-size: 10.5px;
		line-height: 1.35;
		color: var(--qb-text-body, #b9b7b3);
	}

	.marker {
		flex: none;
		width: 9px;
		text-align: center;
		color: var(--qb-text-faint, #6e6c69);
	}

	.task[data-status='completed'] .marker {
		color: var(--qb-accent-complete, #a9b4a5);
	}

	.task[data-status='completed'] .task-title {
		color: var(--qb-text-faint, #6e6c69);
		text-decoration: line-through;
		text-decoration-color: var(--qb-text-faint, #6e6c69);
	}

	.task-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.optional {
		flex: none;
		font-size: 9px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--qb-text-faint, #6e6c69);
	}

	.task-value {
		flex: none;
		font-variant-numeric: tabular-nums;
		color: var(--qb-text-faint, #6e6c69);
	}
</style>
