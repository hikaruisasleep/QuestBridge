<script lang="ts">
	/**
	 * `/` — the landing page.
	 *
	 * Two routes, one token. It carries the token through from this page's own
	 * query string so someone who opens the bare host URL with a token can reach
	 * a working view in one click. Without a token it explains how to obtain the
	 * URLs rather than linking to pages that would render "not authorized".
	 *
	 * It deliberately says nothing about whether data is available: it has no
	 * socket and cannot know, and implying live progression here would be a
	 * fabricated state.
	 */
	import { readToken, tokenCarryingHref } from '#lib/protocol/endpoint.ts';

	let search = $state('');

	$effect(() => {
		search = globalThis.location?.search ?? '';
	});

	const hasToken = $derived(readToken(search) !== null);

	/**
	 * Links are built from `location.search` on the client.
	 *
	 * They are intentionally not rendered in the prerendered HTML. The build
	 * output is the same file for every visitor, and baking a token into a static
	 * artifact is exactly what `docs/local-authentication.md` §3.1 forbids.
	 */
	const overlayHref = $derived(
		tokenCarryingHref({ protocol: '', host: '', search }, '/overlay') ?? '/overlay'
	);
	const controlHref = $derived(
		tokenCarryingHref({ protocol: '', host: '', search }, '/control') ?? '/control'
	);
</script>

<svelte:head>
	<title>QuestBridge</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="landing">
	<header>
		<h1>QuestBridge</h1>
		<p class="lead">
			Shows FTB Quests progression on an OBS overlay: the chapters you choose, and the quests you
			pin in Minecraft.
		</p>
	</header>

	{#if hasToken}
		<ul class="cards">
			<li>
				<a class="card" href={overlayHref}>
					<span class="name">Overlay</span>
					<span class="desc">Transparent Browser Source for OBS. Add it once and leave it.</span>
				</a>
			</li>
			<li>
				<a class="card" href={controlHref}>
					<span class="name">Dashboard</span>
					<span class="desc">Choose up to five chapters and adjust how the overlay looks.</span>
				</a>
			</li>
		</ul>
	{:else}
		<div class="warning">
			<p class="name">This page has no access token.</p>
			<p class="desc">
				Run <code>questbridge-host --print-urls</code> and open one of the printed URLs. The token
				in that URL is what authorizes this page; links from here would otherwise open a page
				that cannot connect.
			</p>
		</div>
	{/if}

	<footer>
		<p>
			QuestBridge reads FTB Quests and never changes it. Quest pins are managed inside Minecraft;
			chapter pins are managed here.
		</p>
	</footer>
</main>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		gap: 22px;
		max-width: 40rem;
		margin: 0 auto;
		padding: 56px 24px;
	}

	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
		color: #eef1f6;
	}

	.lead {
		margin: 6px 0 0;
		font-size: 13.5px;
		line-height: 1.55;
		color: #8a919d;
	}

	.cards {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 14px 15px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 7px;
		background: rgba(255, 255, 255, 0.035);
		text-decoration: none;
		transition: background 140ms ease-out;
	}

	.card:hover {
		background: rgba(255, 255, 255, 0.07);
	}

	.card:focus-visible {
		outline: 2px solid rgba(120, 160, 230, 0.7);
		outline-offset: 2px;
	}

	.name {
		margin: 0;
		font-size: 14px;
		font-weight: 500;
		color: #e6e9ef;
	}

	.desc {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: #8a919d;
	}

	.warning {
		margin: 0;
		padding: 13px 15px;
		border-radius: 7px;
		border-left: 2px solid rgba(240, 190, 120, 0.7);
		background: rgba(240, 190, 120, 0.08);
	}

	.warning .name {
		color: #e0c48f;
	}

	footer {
		border-top: 1px solid rgba(255, 255, 255, 0.07);
		padding-top: 14px;
	}

	footer p {
		margin: 0;
		font-size: 11.5px;
		line-height: 1.55;
		color: #6f7683;
	}

	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 11.5px;
		padding: 1px 4px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.07);
		color: #cfd5df;
	}
</style>
