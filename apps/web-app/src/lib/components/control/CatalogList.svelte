<script lang="ts">
	/**
	 * The discovered chapter catalog with search and pin actions.
	 *
	 * Two states that must not look alike (`docs/web-frontend.md` §3.3):
	 *
	 * - **no catalog received yet** — the host has told us nothing, so the area
	 *   says it is waiting for Minecraft;
	 * - **empty catalog** — Minecraft reports no chapters, which is a real and
	 *   different situation.
	 *
	 * Rendering an empty list for the first case would read as "no chapters
	 * exist", which is a statement we cannot make.
	 */
	import type { Chapter } from '@questbridge/protocol';

	import CatalogRow from './CatalogRow.svelte';

	let {
		chapters,
		isPinned,
		hasSnapshot,
		isFull,
		pinDisabledReason,
		busyChapterId = null,
		onPin
	}: {
		chapters: Chapter[];
		isPinned: (chapterId: string) => boolean;
		hasSnapshot: boolean;
		isFull: boolean;
		/** Reason pinning is unavailable in general, or `null`. */
		pinDisabledReason: string | null;
		busyChapterId?: string | null;
		onPin: (chapterId: string) => void;
	} = $props();

	let search = $state('');

	const filtered = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		if (needle.length === 0) {
			return chapters;
		}
		return chapters.filter(
			(chapter) =>
				chapter.title.toLowerCase().includes(needle) ||
				(chapter.subtitle?.toLowerCase().includes(needle) ?? false)
		);
	});

	const fullReason = $derived(isFull ? 'Five chapters are already pinned. Unpin one first.' : null);

	function reasonFor(_chapterId: string): string | null {
		return pinDisabledReason ?? fullReason;
	}
</script>

<section class="catalog" aria-labelledby="qb-catalog-heading">
	<div class="head">
		<h2 id="qb-catalog-heading">Chapter catalog</h2>
		{#if hasSnapshot}
			<span class="count">{chapters.length} discovered</span>
		{/if}
	</div>

	{#if !hasSnapshot}
		<p class="notice">Waiting for Minecraft. The catalog appears once FTB Quests has synchronized.</p>
	{:else if chapters.length === 0}
		<p class="notice">Minecraft reports no chapters.</p>
	{:else}
		<label class="search">
			<span class="visually-hidden">Search chapters</span>
			<input type="search" placeholder="Search chapters…" bind:value={search} />
		</label>

		{#if filtered.length === 0}
			<p class="notice">No chapter matches “{search.trim()}”.</p>
		{:else}
			<ul class="list">
				{#each filtered as chapter (chapter.id)}
					<CatalogRow
						{chapter}
						pinned={isPinned(chapter.id)}
						disabledReason={reasonFor(chapter.id)}
						busy={busyChapterId === chapter.id}
						{onPin}
					/>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	.catalog {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	h2 {
		margin: 0;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #8f96a3;
	}

	.count {
		font-size: 11px;
		color: #6f7683;
	}

	.search input {
		width: 100%;
		box-sizing: border-box;
		padding: 6px 9px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 5px;
		background: rgba(255, 255, 255, 0.04);
		color: #e6e9ef;
		font: inherit;
		font-size: 12.5px;
	}

	.search input:focus {
		outline: 2px solid rgba(120, 160, 230, 0.55);
		outline-offset: 1px;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
		max-height: 60vh;
		overflow-y: auto;
	}

	.notice {
		margin: 0;
		padding: 10px 11px;
		border-radius: 5px;
		background: rgba(255, 255, 255, 0.03);
		font-size: 12px;
		color: #8a919d;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
