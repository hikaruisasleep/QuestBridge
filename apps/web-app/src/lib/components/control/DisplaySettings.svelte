<script lang="ts">
	/**
	 * Display settings.
	 *
	 * `config.update` carries a **complete** `DisplayConfig`: the schema is a
	 * `strictObject` and partial objects are rejected (`docs/phase-2-plan.md` §9).
	 * Every control therefore sends the whole object with one field changed, and
	 * the host's broadcast is what confirms it — the UI never assumes its own
	 * change took effect.
	 *
	 * `theme` is the literal `"minimal"` in protocol v1 and has no control; it is
	 * shown as text so the omission reads as a deliberate v1 constraint rather
	 * than a missing feature.
	 */
	import type { DisplayConfig } from '@questbridge/protocol';

	let {
		display,
		disabledReason,
		pending = false,
		onChange
	}: {
		display: DisplayConfig;
		disabledReason: string | null;
		pending?: boolean;
		onChange: (display: DisplayConfig) => void;
	} = $props();

	interface Toggle {
		key: 'showChapterProgress' | 'showQuestTasks' | 'showCompletedQuests' | 'completionAnimation' | 'compactMode';
		label: string;
		detail: string;
	}

	const toggles: Toggle[] = [
		{
			key: 'showChapterProgress',
			label: 'Chapter progress',
			detail: 'Show the progress bar and percentage for pinned chapters.'
		},
		{
			key: 'showQuestTasks',
			label: 'Task counters',
			detail: 'Show each objective’s task list and completed task count.'
		},
		{
			key: 'showCompletedQuests',
			label: 'Completed objectives',
			detail: 'Keep an objective visible if it is still pinned after completion.'
		},
		{
			key: 'completionAnimation',
			label: 'Completion highlight',
			detail: 'Briefly highlight an objective or chapter when it completes.'
		},
		{
			key: 'compactMode',
			label: 'Compact mode',
			detail: 'Tighter spacing between sections.'
		}
	];

	function toggle(key: Toggle['key']): void {
		if (disabledReason !== null) {
			return;
		}
		onChange({ ...display, [key]: !display[key] });
	}
</script>

<section class="settings" aria-labelledby="qb-settings-heading">
	<h2 id="qb-settings-heading">Display</h2>

	<ul class="list">
		{#each toggles as item (item.key)}
			<li class="row">
				<label class="label">
					<input
						type="checkbox"
						checked={display[item.key]}
						disabled={disabledReason !== null || pending}
						title={disabledReason ?? undefined}
						onchange={() => toggle(item.key)}
					/>
					<span class="text">
						<span class="name">{item.label}</span>
						<span class="detail">{item.detail}</span>
					</span>
				</label>
			</li>
		{/each}
	</ul>

	<p class="theme">
		Theme <span class="value">{display.theme}</span>
		<span class="note">The only value protocol v1 defines.</span>
	</p>
</section>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	h2 {
		margin: 0;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #8f96a3;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.label {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 6px 8px;
		border-radius: 5px;
		cursor: pointer;
	}

	.label:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	input {
		margin: 2px 0 0;
		accent-color: #7ecfa3;
	}

	input:disabled {
		cursor: not-allowed;
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.name {
		font-size: 12.5px;
		color: #dfe4ec;
	}

	.detail {
		font-size: 11px;
		line-height: 1.4;
		color: #7c838f;
	}

	.theme {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin: 0;
		padding: 0 8px;
		font-size: 11.5px;
		color: #7c838f;
	}

	.value {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 11px;
		color: #aab2bf;
	}

	.note {
		font-size: 10.5px;
		color: #5f6672;
	}
</style>
