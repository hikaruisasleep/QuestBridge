<script lang="ts">
	/**
	 * The overlay, shared by `/overlay` and the dashboard preview.
	 *
	 * One component rather than an iframe, so the preview and the real overlay
	 * cannot drift and the dashboard never opens a second socket
	 * (`docs/phase-3-plan.md` §3.3).
	 *
	 * Visibility rules:
	 *
	 * - An empty pinned-chapter configuration renders **nothing** for that
	 *   section. The overlay never fabricates chapter entries.
	 * - When `preview` is true, a muted setup hint appears in place of an empty
	 *   section, because the streamer needs to know why it is blank. On stream
	 *   that hint would be noise, so it is not rendered.
	 * - The whole overlay **fades out** on `disconnected`, and only then. A stale
	 *   overlay renders identically to a live one (`docs/web-frontend.md` §3.4).
	 */
	import type { Quest } from '@questbridge/protocol';

	import type { ClientAppState, PinnedChapter } from '#lib/stores/app-state.ts';
	import { motion, motionCssVariables } from '#lib/motion.ts';
	import { componentsToCss } from '#lib/theme.ts';
	import EmptyHint from '../common/EmptyHint.svelte';
	import ChapterSection from './ChapterSection.svelte';
	import ObjectiveSection from './ObjectiveSection.svelte';

	let {
		state: appState,
		pins,
		quests,
		preview = false
	}: {
		state: ClientAppState;
		pins: PinnedChapter[];
		quests: Quest[];
		/** Dashboard preview: shows setup hints and is never faded. */
		preview?: boolean;
	} = $props();

	const display = $derived(appState.display);
	const disconnected = $derived(appState.connection.status === 'disconnected');

	/**
	 * Motion tokens plus the chroma-safe colour tokens.
	 *
	 * Injected here rather than per component so every descendant resolves the
	 * same palette, and so the dashboard preview gets it without depending on the
	 * document background.
	 */
	const overlayVariables = $derived(`${motionCssVariables()};${componentsToCss()}`);

	/**
	 * Genuine completion transitions.
	 *
	 * The highlight must fire when a row *reaches* completion, not on every
	 * state update, so the previous statuses are compared rather than the
	 * current ones (`docs/phase-3-plan.md` §6.1).
	 */
	let previousQuestStatus = new Map<string, string>();
	let previousChapterStatus = new Map<string, string>();

	let questCompletion = $state<{ questId: string; at: number } | null>(null);
	let chapterCompletion = $state<{ chapterId: string; at: number } | null>(null);
	$effect(() => {
		if (!display.completionAnimation) {
			questCompletion = null;
			chapterCompletion = null;
			return;
		}

		const now = Date.now();

		for (const quest of quests) {
			const before = previousQuestStatus.get(quest.id);
			if (before !== undefined && before !== 'completed' && quest.progress.status === 'completed') {
				questCompletion = { questId: quest.id, at: now };
			}
			previousQuestStatus.set(quest.id, quest.progress.status);
		}

		for (const pin of pins) {
			if (pin.kind !== 'resolved') {
				continue;
			}
			const before = previousChapterStatus.get(pin.chapter.id);
			if (before !== undefined && before !== 'completed' && pin.chapter.status === 'completed') {
				chapterCompletion = { chapterId: pin.chapter.id, at: now };
			}
			previousChapterStatus.set(pin.chapter.id, pin.chapter.status);
		}

		// Drop remembered IDs for rows that are gone, so a re-pin is a fresh row
		// rather than an instant "completion".
		const questIds = new Set(quests.map((quest) => quest.id));
		for (const id of previousQuestStatus.keys()) {
			if (!questIds.has(id)) {
				previousQuestStatus.delete(id);
			}
		}
	});

	const completedQuestIds = $derived(questCompletion === null ? [] : [questCompletion.questId]);

	const visibleQuests = $derived(
		display.showCompletedQuests
			? quests
			: quests.filter((quest) => quest.progress.status !== 'completed')
	);

	const hasChapters = $derived(pins.length > 0);
	const hasObjectives = $derived(visibleQuests.length > 0);
</script>

<div
	class="overlay"
	data-compact={display.compactMode}
	data-faded={disconnected && !preview}
	data-preview={preview}
	style={overlayVariables}
	role="status"
	aria-live="polite"
	aria-label="QuestBridge progression"
>
	<div class="stack" style:transition-duration="{motion.disconnectFadeMs}ms">
		{#if hasChapters}
			<ChapterSection
				{pins}
				showProgress={display.showChapterProgress}
				completedTransition={chapterCompletion}
			/>
		{:else if preview}
			<div class="section">
				<h2 class="heading">Progression</h2>
				<EmptyHint text="No chapters pinned. Choose up to five in the catalog below." />
			</div>
		{/if}

		{#if hasObjectives}
			<ObjectiveSection
				quests={visibleQuests}
				showTasks={display.showQuestTasks}
				completedIds={completedQuestIds}
			/>
		{:else if preview}
			<div class="section">
				<h2 class="heading">Objectives</h2>
				<EmptyHint text="No pinned objectives. Pin quests in the FTB Quests book in Minecraft." />
			</div>
		{/if}
	</div>
</div>

<style>
	.overlay {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		padding: 12px 14px;
		/* No panel, no border, no background image. The key field itself is painted
		   by the route (or by the dashboard preview frame), so this element stays
		   transparent and inherits whatever is behind it. */
		background: transparent;
		font-family:
			ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
		color: var(--qb-text-primary, #e8e6e2);
		-webkit-font-smoothing: antialiased;
		text-rendering: optimizeLegibility;
		/* Nothing in the overlay may produce a scrollbar. */
		overflow: hidden;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-height: 0;
		flex: 1;
		/* The fade is the overlay's only state signal. It is on the inner stack
		   so the outer element keeps a stable size for OBS. */
		transition-property: opacity;
		transition-timing-function: ease-in-out;
	}

	/* Disconnection fades out. A stale overlay has no rule here at all, which is
	   the point: stale must look identical to live. */
	.overlay[data-faded='true'] .stack {
		opacity: 0;
	}

	.overlay[data-faded='false'] .stack {
		opacity: 1;
	}

	.overlay[data-compact='false'] .stack {
		gap: 22px;
	}

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
</style>
