<script lang="ts">
	/**
	 * `/overlay` — the OBS Browser Source.
	 *
	 * Non-interactive. It owns the transparent-background rule (not the shared
	 * layout, so `/control` is not forced transparent) and it contains no
	 * controls of any kind.
	 */
	import { onMount } from 'svelte';

	import OverlayView from '#lib/components/overlay/OverlayView.svelte';
	import OverlayStatus from '#lib/components/overlay/OverlayStatus.svelte';
	import { getAppContext } from '#lib/stores/app-context.svelte.ts';

	const app = getAppContext();

	onMount(() => {
		app.start({ role: 'overlay', clientName: 'QuestBridge overlay' });
		document.body.dataset.route = 'overlay';
		return () => {
			delete document.body.dataset.route;
		};
	});

	const pins = $derived(app.selectors.getPinnedChapters());
	const quests = $derived(app.selectors.getManuallyPinnedQuests());
</script>

<svelte:head>
	<title>QuestBridge overlay</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="stage" data-connected={app.state.transport === 'open'}>
	<OverlayStatus
		transport={app.state.transport}
		failure={app.state.failure}
		failureDetail={app.lastError?.message ?? null}
		hasSnapshot={app.state.receivedSnapshot}
	/>

	<OverlayView state={app.state} {pins} {quests} />
</div>

<style>
	:global(html),
	:global(body) {
		background: transparent;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.stage {
		position: fixed;
		inset: 0;
		background: transparent;
		/* The overlay is a broadcast graphic: no text selection, no focus ring,
		   no hover affordances. */
		user-select: none;
		pointer-events: none;
		overflow: hidden;
	}
</style>
