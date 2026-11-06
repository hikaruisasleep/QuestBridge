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
	 * readable while the progression content has faded out, and it sits on an
	 * opaque plate: a translucent plate over a saturated key colour would
	 * composite into that colour and be keyed out with the background.
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
		/* Opaque: translucency over a key colour becomes that colour. */
		background: var(--qb-plate, #14161b);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
		font-size: 11.5px;
		line-height: 1.45;
	}

	.notice[data-tone='error'] {
		border-left: 2px solid var(--qb-accent-error, #b07a72);
	}

	.title {
		margin: 0 0 3px;
		font-size: 12px;
		font-weight: 600;
		color: var(--qb-text-primary, #e8e6e2);
	}

	.body {
		margin: 0;
		color: var(--qb-text-body, #b9b7b3);
	}

	.detail {
		margin: 4px 0 0;
		font-size: 10.5px;
		color: var(--qb-text-faint, #6e6c69);
	}

	code {
		/* A code span inside the dark plate stays a lighter grey rather than
		   gaining a tinted chip, which would risk the key hue. */
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 10.5px;
		color: var(--qb-text-strong, #d6d4d0);
	}
</style>
