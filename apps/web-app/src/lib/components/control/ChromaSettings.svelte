<script lang="ts">
	/**
	 * Green/blue screen selector.
	 *
	 * The choice is stored in this browser, not on the host: `DisplayConfig` has
	 * no field for it and protocol v1 was left unchanged. That makes it per-tab
	 * and per-browser profile, which matters for OBS — the source reads whatever
	 * was last set in the profile OBS uses.
	 *
	 * It is a radio group rather than two buttons because exactly one key colour
	 * is in effect at a time, and that is what a radio group communicates.
	 */
	import type { ChromaKey } from '#lib/chroma.ts';
	import { KEY_COLORS } from '#lib/chroma.ts';

	let {
		value,
		onChange
	}: {
		value: ChromaKey;
		onChange: (next: ChromaKey) => void;
	} = $props();

	const options: Array<{ key: ChromaKey; label: string; detail: string }> = [
		{ key: 'green', label: 'Green screen', detail: 'Key out #00FF00' },
		{ key: 'blue', label: 'Blue screen', detail: 'Key out #0000FF' }
	];
</script>

<section class="chroma" aria-labelledby="qb-chroma-heading">
	<h2 id="qb-chroma-heading">Background</h2>
	<p class="intro">
		The overlay paints a solid key colour for OBS to remove with a Chroma Key filter. This
		setting is stored in this browser only.
	</p>

	<div class="options" role="radiogroup" aria-labelledby="qb-chroma-heading">
		{#each options as option (option.key)}
			<label class="option" data-selected={value === option.key}>
				<input
					type="radio"
					name="qb-chroma-key"
					value={option.key}
					checked={value === option.key}
					onchange={() => onChange(option.key)}
				/>
				<span class="swatch" style:background={KEY_COLORS[option.key]} aria-hidden="true"></span>
				<span class="text">
					<span class="name">{option.label}</span>
					<span class="detail">{option.detail}</span>
				</span>
			</label>
		{/each}
	</div>

	<p class="note">
		UI colours avoid both key hues, so the same components work whichever colour you pick.
	</p>
</section>

<style>
	.chroma {
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
		color: var(--qb-text-muted, #92908d);
	}

	.intro,
	.note {
		margin: 0;
		font-size: 11px;
		line-height: 1.45;
		color: var(--qb-text-faint, #6e6c69);
	}

	.options {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.option {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 7px 9px;
		border-radius: 6px;
		background: #1a1d23;
		cursor: pointer;
	}

	.option[data-selected='true'] {
		background: #252932;
	}

	input {
		margin: 0;
		accent-color: var(--qb-text-strong, #d6d4d0);
	}

	.swatch {
		width: 14px;
		height: 14px;
		border-radius: 3px;
		flex: none;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.name {
		font-size: 12.5px;
		color: var(--qb-text-primary, #e8e6e2);
	}

	.detail {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 10.5px;
		color: var(--qb-text-faint, #6e6c69);
	}
</style>
