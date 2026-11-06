<script lang="ts">
	/**
	 * `/control` — the chapter pin dashboard.
	 *
	 * The main purpose is chapter pin management (`AGENTS.md` §10.2). It selects
	 * **chapters**; it never selects quests, because FTB Quests remains the only
	 * quest-pinning interface (`docs/web-frontend.md` §1.1).
	 *
	 * Mutation controls are disabled with a stated reason until the socket is open
	 * and a snapshot has arrived. A button that appears to work and silently does
	 * nothing is worse than one that is visibly unavailable and explains why
	 * (`docs/web-frontend.md` §3.3).
	 */
	import { onMount } from 'svelte';

	import type { ClientAppState, PinnedChapter } from '#lib/stores/app-state.ts';
	import { getAppContext } from '#lib/stores/app-context.svelte.ts';
	import CatalogList from '#lib/components/control/CatalogList.svelte';
	import DisplaySettings from '#lib/components/control/DisplaySettings.svelte';
	import PinList from '#lib/components/control/PinList.svelte';
	import EmptyHint from '#lib/components/common/EmptyHint.svelte';
	import OverlayView from '#lib/components/overlay/OverlayView.svelte';

	const app = getAppContext();

	onMount(() => {
		app.start({ role: 'control', clientName: 'QuestBridge dashboard' });
		document.body.dataset.route = 'control';
		return () => {
			delete document.body.dataset.route;
		};
	});

	/** The last rejection, attached to the action that caused it. */
	let rejection = $state<{ code: string; message: string; target: string } | null>(null);
	let busyChapterId = $state<string | null>(null);

	const chapters = $derived(app.selectors.getChapterCatalog());
	const pins = $derived(app.selectors.getPinnedChapters());
	const quests = $derived(app.selectors.getManuallyPinnedQuests());
	const hasSnapshot = $derived(app.selectors.hasReceivedSnapshot());
	const isFull = $derived(app.selectors.isPinSetFull());

	/**
	 * Why pinning is unavailable, or `null`.
	 *
	 * Pre-snapshot the pin set is unknown, and the catalog is unknown too, so a
	 * pin could only be rejected. Saying so beats letting the user try.
	 */
	const mutationBlockedReason = $derived.by((): string | null => {
		if (!app.canMutate) {
			return app.state.transport === 'closed'
				? 'Not connected to the QuestBridge host.'
				: 'Connecting to the QuestBridge host…';
		}
		if (!hasSnapshot) {
			return 'Waiting for the first snapshot from Minecraft.';
		}
		return null;
	});

	const overlayPins = $derived<PinnedChapter[]>(pins);
	const overlayQuests = $derived(quests);

	function reportError(target: string, code: string, message: string): void {
		rejection = { code, message, target };
	}

	function pin(chapterId: string): void {
		const requestId = app.pinChapter(chapterId);
		if (requestId === null) {
			reportError(chapterId, 'not_connected', 'Not connected to the QuestBridge host.');
			return;
		}
		busyChapterId = chapterId;
		/** Backstop only: the broadcast or the error normally clears this first. */
		setTimeout(() => {
			if (busyChapterId === chapterId) {
				busyChapterId = null;
			}
		}, 3_000);
	}

	function unpin(chapterId: string): void {
		const requestId = app.unpinChapter(chapterId);
		if (requestId === null) {
			reportError(chapterId, 'not_connected', 'Not connected to the QuestBridge host.');
			return;
		}
		busyChapterId = chapterId;
		setTimeout(() => {
			if (busyChapterId === chapterId) {
				busyChapterId = null;
			}
		}, 3_000);
	}

	function reorder(chapterIds: string[]): void {
		const requestId = app.reorderChapters(chapterIds);
		if (requestId === null) {
			reportError(chapterIds.join(', '), 'not_connected', 'Not connected.');
		}
	}

	function updateDisplay(display: ClientAppState['display']): void {
		// The complete object is sent: the schema is a strictObject and partial
		// objects are rejected (`docs/phase-2-plan.md` §9).
		if (app.updateDisplay(display) === null) {
			reportError(
				'display',
				'not_connected',
				'Not connected to the QuestBridge host, so the settings were not saved.'
			);
		}
	}

	// The host answers every mutation either with an authoritative broadcast or
	// with a `request.error`, so both end a pending action.
	$effect(() => {
		void app.state.chapterPins;
		busyChapterId = null;
	});

	// Surface every host rejection, so nothing is collapsed into a generic
	// failure (`docs/web-frontend.md` §3.3).
	$effect(() => {
		const error = app.lastError;
		if (error === null) {
			return;
		}
		rejection = { code: error.code, message: error.message, target: '' };
		busyChapterId = null;
	});

	const REJECTION_TITLES: Record<string, string> = {
		too_many_pins: 'Five chapters are already pinned',
		duplicate_chapter: 'That chapter is already pinned',
		unknown_chapter: 'That chapter is not in the current catalog',
		not_pinned: 'That chapter is not currently pinned',
		invalid_reorder_set: 'The reorder did not match the pinned set',
		rate_limited: 'Too many changes at once',
		unauthorized: 'This connection may not change configuration',
		invalid_request: 'The request was rejected'
	};
</script>

<svelte:head>
	<title>QuestBridge dashboard</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="dashboard">
	<header class="topbar">
		<div>
			<h1>QuestBridge</h1>
			<p class="sub">
				Choose up to five chapters for the overlay. Quest objectives come from the pins you set
				inside Minecraft.
			</p>
		</div>
		<span class="status" data-status={app.state.connection.status}>
			{app.state.connection.status}
		</span>
	</header>

	{#if mutationBlockedReason !== null}
		<p class="blocked" role="status">{mutationBlockedReason} Controls are disabled until then.</p>
	{/if}

	{#if rejection !== null}
		<div class="rejection" role="alert">
			<p class="code">
				<strong>{REJECTION_TITLES[rejection.code] ?? 'The host rejected the change'}</strong>
				<span class="raw">{rejection.code}</span>
			</p>
			<p class="detail">{rejection.message}</p>
			<button type="button" class="dismiss" onclick={() => (rejection = null)}>Dismiss</button>
		</div>
	{/if}

	<div class="columns">
		<div class="column">
			<PinList
				{pins}
				disabledReason={mutationBlockedReason}
				onUnpin={unpin}
				onReorder={reorder}
			/>
			<CatalogList
				{chapters}
				{hasSnapshot}
				{isFull}
				pinDisabledReason={mutationBlockedReason}
				{busyChapterId}
				isPinned={(chapterId) =>
					pins.some((pin) => (pin.kind === 'resolved' ? pin.chapter.id : pin.chapterId) === chapterId)}
				onPin={pin}
			/>
			<DisplaySettings
				display={app.state.display}
				disabledReason={mutationBlockedReason}
				onChange={updateDisplay}
			/>
		</div>

		<aside class="column preview-column">
			<div class="preview-head">
				<h2>Live preview</h2>
				<span class="frame-size">380 × 650</span>
			</div>
			<div class="preview-frame">
				<OverlayView state={app.state} pins={overlayPins} quests={overlayQuests} preview />
			</div>
			<EmptyHint text="This is the same component the OBS source renders." />
		</aside>
	</div>
</main>

<style>
	.dashboard {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 1080px;
		margin: 0 auto;
		padding: 20px 20px 40px;
		font-size: 13px;
	}

	.topbar {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	h1 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
		color: #eef1f6;
	}

	.sub {
		margin: 3px 0 0;
		max-width: 46rem;
		font-size: 12px;
		line-height: 1.5;
		color: #8a919d;
	}

	.status {
		flex: none;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		font-size: 10.5px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #8a919d;
	}

	.status[data-status='ready'] {
		border-color: rgba(126, 207, 163, 0.4);
		color: #7ecfa3;
	}

	.status[data-status='error'] {
		border-color: rgba(232, 120, 120, 0.4);
		color: #e87878;
	}

	.blocked {
		margin: 0;
		padding: 8px 11px;
		border-radius: 5px;
		background: rgba(240, 190, 120, 0.1);
		border-left: 2px solid rgba(240, 190, 120, 0.7);
		font-size: 12px;
		color: #e0c48f;
	}

	.rejection {
		position: relative;
		margin: 0;
		padding: 9px 12px;
		border-radius: 5px;
		background: rgba(232, 120, 120, 0.1);
		border-left: 2px solid rgba(232, 120, 120, 0.8);
	}

	.rejection .code {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 12.5px;
		color: #f0c8c8;
	}

	.rejection .raw {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 10.5px;
		color: #e8a0a0;
	}

	.rejection .detail {
		margin: 3px 0 0;
		font-size: 11.5px;
		color: #c8a8a8;
	}

	.dismiss {
		position: absolute;
		top: 7px;
		right: 9px;
		border: 0;
		background: transparent;
		color: #c8a8a8;
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}

	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 20px;
		align-items: start;
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}

	.preview-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.preview-head h2 {
		margin: 0;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #8f96a3;
	}

	.frame-size {
		font-size: 10.5px;
		color: #6f7683;
		font-variant-numeric: tabular-nums;
	}

	/* A scoped preview at the documented OBS starting size. The backdrop stands
	   in for gameplay so white text is judged as it will appear on stream. */
	.preview-frame {
		width: 380px;
		height: 650px;
		overflow: hidden;
		border-radius: 8px;
		background:
			linear-gradient(160deg, #2f5d3a 0%, #4a7c4e 45%, #6b8f3f 100%),
			repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.08) 0 6px, transparent 6px 12px);
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
	}

	@media (max-width: 900px) {
		.columns {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
