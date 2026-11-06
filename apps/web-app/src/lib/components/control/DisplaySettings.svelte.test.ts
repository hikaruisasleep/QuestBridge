import { createMessage, parseMessage, serializeMessage, type DisplayConfig } from '@questbridge/protocol';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import DisplaySettings from './DisplaySettings.svelte';

/**
 * Display settings and the `config.update` round trip.
 *
 * `config.update` is registered in **both** directions with the same payload but
 * different envelope rules: a browser message must carry no `sessionId` and may
 * omit `sequence`, while a host message must carry a `sequence`. Serializing in
 * the wrong direction throws at send time, which is invisible until a user
 * flips a switch, so it is asserted here.
 */

const DISPLAY: DisplayConfig = {
	showChapterProgress: true,
	showQuestTasks: true,
	showCompletedQuests: true,
	completionAnimation: true,
	theme: 'minimal',
	compactMode: true
};

describe('config.update round trip', () => {
	it('serializes a browser config.update as browser_to_host', () => {
		const message = createMessage('config.update', { display: DISPLAY }, { requestId: 'r1' });
		expect(() => serializeMessage(message, 'browser_to_host')).not.toThrow();
	});

	it('rejects a browser config.update serialized as host_to_browser', () => {
		// The host direction requires a `sequence`, so this is where the mistake
		// surfaces rather than at a user's first settings change.
		const message = createMessage('config.update', { display: DISPLAY });
		expect(() => serializeMessage(message, 'host_to_browser')).toThrow();
	});

	it('round-trips a complete display object unchanged', () => {
		const wire = serializeMessage(
			createMessage('config.update', { display: DISPLAY }, { requestId: 'r2' }),
			'browser_to_host'
		);
		// Parsed as a browser message: that is the direction it was sent in. The
		// host's reply is a different envelope (it carries a sequence), so
		// parsing the browser frame in the host direction would be a type error,
		// not a round trip.
		const parsed = parseMessage(JSON.parse(wire), 'browser_to_host');

		expect(parsed.type).toBe('config.update');
		if (parsed.type === 'config.update') {
			expect(parsed.payload.display).toEqual(DISPLAY);
			expect(parsed.requestId).toBe('r2');
		}
	});

	it('accepts the host echo, which does carry a sequence', () => {
		// The host broadcasts its authoritative copy back as host_to_browser.
		const echo = createMessage(
			'config.update',
			{ display: { ...DISPLAY, compactMode: false } },
			{ sequence: 7 }
		);
		const parsed = parseMessage(JSON.parse(serializeMessage(echo, 'host_to_browser')), 'host_to_browser');
		if (parsed.type === 'config.update') {
			expect(parsed.payload.display.compactMode).toBe(false);
			expect(parsed.sequence).toBe(7);
		}
	});

	it('rejects a partial display object', () => {
		const partial = { showChapterProgress: true } as unknown as DisplayConfig;
		expect(() =>
			serializeMessage(createMessage('config.update', { display: partial }), 'browser_to_host')
		).toThrow();
	});

	it('rejects an unknown theme value', () => {
		const bad = { ...DISPLAY, theme: 'dark' } as unknown as DisplayConfig;
		expect(() =>
			serializeMessage(createMessage('config.update', { display: bad }), 'browser_to_host')
		).toThrow();
	});
});

describe('DisplaySettings', () => {
	it('renders one control per field with theme shown as read-only', async () => {
		const { container } = render(DisplaySettings, {
			display: DISPLAY,
			disabledReason: null,
			onChange: () => {}
		});

		const checkboxes = [...container.querySelectorAll('input[type=checkbox]')];
		// showChapterProgress, showQuestTasks, showCompletedQuests,
		// completionAnimation, compactMode. `theme` has no control in v1.
		expect(checkboxes).toHaveLength(5);
		expect(container.textContent).toContain('minimal');
		for (const box of checkboxes) {
			expect((box as HTMLInputElement).checked).toBe(true);
		}
	});

	it('sends the complete object with a single field flipped', async () => {
		const onChange = vi.fn();
		const { container } = render(DisplaySettings, {
			display: DISPLAY,
			disabledReason: null,
			onChange
		});

		const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
		boxes[0]!.click();

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith({ ...DISPLAY, showChapterProgress: false });
		// Every other field is still present, so the object is complete.
		const sent = onChange.mock.calls[0]![0] as DisplayConfig;
		expect(Object.keys(sent).sort()).toEqual(Object.keys(DISPLAY).sort());
	});

	it('flips each field independently', async () => {
		const onChange = vi.fn();
		const { container } = render(DisplaySettings, {
			display: DISPLAY,
			disabledReason: null,
			onChange
		});

		const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
		boxes[4]!.click();

		expect(onChange).toHaveBeenCalledWith({ ...DISPLAY, compactMode: false });
	});

	it('disables every control with a stated reason', async () => {
		const onChange = vi.fn();
		const { container } = render(DisplaySettings, {
			display: DISPLAY,
			disabledReason: 'Waiting for the first snapshot from Minecraft.',
			onChange
		});

		const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
		for (const box of boxes) {
			expect(box.disabled).toBe(true);
			expect(box.title).toBe('Waiting for the first snapshot from Minecraft.');
		}
	});

	it('does not emit a change while disabled', async () => {
		const onChange = vi.fn();
		const { container } = render(DisplaySettings, {
			display: DISPLAY,
			disabledReason: 'Not connected to the QuestBridge host.',
			onChange
		});

		// `click()` on a disabled input does nothing, which is the behaviour the
		// "no dysfunctional controls" rule depends on.
		container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
		expect(onChange).not.toHaveBeenCalled();
	});
});
