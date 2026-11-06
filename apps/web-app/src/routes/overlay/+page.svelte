<script lang="ts">
	/**
	 * `/overlay` — the OBS Browser Source.
	 *
	 * Non-interactive, and **keyed**, not transparent. OBS removes a solid colour
	 * from the captured frame rather than trusting an alpha channel, so the page
	 * paints an opaque key field (`#00FF00` or `#0000FF`) and every UI colour is
	 * chosen to survive that keying.
	 *
	 * The background lives here rather than in the shared layout: `/control`
	 * renders the same component in a preview frame and must get the key colour
	 * injected from its own container, not from the document.
	 */
	import { onMount } from 'svelte';

	import OverlayView from '#lib/components/overlay/OverlayView.svelte';
	import OverlayStatus from '#lib/components/overlay/OverlayStatus.svelte';
	import { getAppContext } from '#lib/stores/app-context.svelte.ts';
	import {
		chromaBackground,
		refreshChromaKey,
		startChromaSync,
		stopChromaSync
	} from '#lib/stores/chroma.svelte.ts';

	const app = getAppContext();

	onMount(() => {
		refreshChromaKey();
		startChromaSync();
		app.start({ role: 'overlay', clientName: 'QuestBridge overlay' });
		document.body.dataset.route = 'overlay';
		return () => {
			stopChromaSync();
			delete document.body.dataset.route;
		};
	});

	const pins = $derived(app.selectors.getPinnedChapters());
	const quests = $derived(app.selectors.getManuallyPinnedQuests());
	const background = $derived(chromaBackground());
</script>

<svelte:head>
	<title>QuestBridge overlay</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="stage" data-connected={app.state.transport === 'open'} style:background>
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
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.stage {
		position: fixed;
		inset: 0;
		/* The key field itself. Set inline from the stored setting so it changes
		   without a rebuild, and so a switch from the dashboard applies live. */
		background-color: inherit;
		/* The overlay is a broadcast graphic: no text selection, no focus ring,
		   no hover affordances. */
		user-select: none;
		pointer-events: none;
		overflow: hidden;
	}
</style>
