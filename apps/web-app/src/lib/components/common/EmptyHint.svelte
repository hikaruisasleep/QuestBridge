<script lang="ts">
	/**
	 * Muted one-line explanation used by the preview and the dashboard.
	 *
	 * Never rendered by the real overlay: on stream, a setup hint is noise. The
	 * overlay hides empty sections outright and the dashboard shows this in
	 * their place (`docs/phase-3-plan.md` §3.6).
	 */
	let { text, tone = 'muted' }: { text: string; tone?: 'muted' | 'warning' } = $props();
</script>

<p class="hint" data-tone={tone}>{text}</p>

<style>
	.hint {
		margin: 0;
		font-size: 11px;
		line-height: 1.45;
		color: rgba(255, 255, 255, 0.45);
	}

	.hint[data-tone='warning'] {
		color: rgba(240, 190, 120, 0.8);
	}
</style>
