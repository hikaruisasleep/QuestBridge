<script lang="ts">
	/**
	 * Failure presentation for `/overlay`.
	 *
	 * The overriding rule (`docs/local-authentication.md` §6): an authorization
	 * or connection failure must be distinguishable from "no data yet", and the
	 * overlay must **never** render as a blank frame. A silently blank overlay
	 * during a stream is the worst failure mode this component has.
	 *
	 * What the page can and cannot know: a refused WebSocket upgrade does not
	 * expose its HTTP status to JavaScript, so `401`, `403`, and "host went
	 * away" are indistinguishable here. The message therefore names the remedy
	 * rather than asserting a cause it cannot verify.
	 *
	 * This element is deliberately **outside** the fading stack, so it stays
	 * readable while the progression content has faded out.
	 */
	import type { ClientFailure, TransportState } from '#lib/protocol/client.ts';

	let {
		transport,
		failure,
		failureDetail,
		hasSnapshot
	}: {
		transport: TransportState;
		failure: ClientFailure | null;
		failureDetail: string | null;
		hasSnapshot: boolean;
	} = $props();

	const state = $derived.by((): 'healthy' | 'reconnecting' | 'refused' | 'error' => {
		if (transport === 'open') {
			return 'healthy';
		}
		if (failure === 'unauthorized') {
			return 'refused';
		}
		if (transport === 'connecting') {
			return 'reconnecting';
		}
		return 'error';
	});
</script>

{#if state === 'refused'}
	<div class="notice" role="alert" data-tone="error">
		<p class="title">Not authorized</p>
		<p class="body">
			QuestBridge could not open its connection. Open the overlay from the URL printed by
			<code>questbridge-host --print-urls</code>; the token in that URL is what authorizes it.
		</p>
		{#if failureDetail !== null}
			<p class="detail">{failureDetail}</p>
		{/if}
	</div>
{:else if state === 'reconnecting'}
	<div class="notice" data-tone="muted">
		<p class="title">Connecting to QuestBridge host…</p>
		<p class="body">
			{hasSnapshot
				? 'Showing the last known progression until the connection returns.'
				: 'Waiting for the first snapshot.'}
		</p>
	</div>
{:else if state === 'error'}
	<div class="notice" data-tone="muted">
		<p class="title">Lost connection to QuestBridge host</p>
		<p class="body">
			Reconnecting automatically. Start the host with <code>questbridge-host</code> if it is not
			running.
		</p>
		{#if failureDetail !== null}
			<p class="detail">{failureDetail}</p>
		{/if}
	</div>
{/if}

<style>
	.notice {
		position: absolute;
		top: 12px;
		left: 14px;
		right: 14px;
		z-index: 2;
		box-sizing: border-box;
		padding: 9px 11px;
		border-radius: 5px;
		background: rgba(14, 16, 21, 0.82);
		backdrop-filter: blur(2px);
		font-size: 11.5px;
		line-height: 1.45;
	}

	.notice[data-tone='error'] {
		border-left: 2px solid rgba(232, 120, 120, 0.9);
	}

	.title {
		margin: 0 0 3px;
		font-size: 12px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.92);
	}

	.body {
		margin: 0;
		color: rgba(255, 255, 255, 0.62);
	}

	.detail {
		margin: 4px 0 0;
		font-size: 10.5px;
		color: rgba(255, 255, 255, 0.4);
	}

	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 10.5px;
		color: rgba(255, 255, 255, 0.78);
	}
</style>
