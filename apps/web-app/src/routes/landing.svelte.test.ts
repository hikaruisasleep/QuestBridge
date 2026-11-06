import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import Landing from './+page.svelte';

/**
 * The landing page.
 *
 * Its two jobs are to link to both routes with the token carried through, and to
 * refuse to link anywhere when there is no token. It also must not claim
 * anything about live data: it has no socket, so any statement about
 * progression here would be invented.
 *
 * The page reads `location.search`, so these tests navigate the real page first.
 */

const original = globalThis.location.href;

afterEach(() => {
	window.history.replaceState(null, '', new URL(original).pathname);
});

async function visit(query: string): Promise<void> {
	window.history.replaceState(null, '', `${new URL(original).pathname}${query}`);
	// Allow the component's `$effect` to read the new search string.
}

describe('landing page', () => {
	it('links to both routes with the token preserved', async () => {
		await visit('?token=abc123');
		const { container } = render(Landing);
		await new Promise((resolve) => setTimeout(resolve, 20));

		const links = [...container.querySelectorAll<HTMLAnchorElement>('a.card')];
		expect(links).toHaveLength(2);
		expect(links.map((link) => link.getAttribute('href'))).toEqual([
			'/overlay?token=abc123',
			'/control?token=abc123'
		]);
	});

	it('explains how to obtain a token instead of offering dead links', async () => {
		await visit('');
		const { container } = render(Landing);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(container.querySelectorAll('a.card')).toHaveLength(0);
		expect(container.textContent).toContain('no access token');
		expect(container.textContent).toContain('questbridge-host --print-urls');
	});

	it('says nothing about live progression', async () => {
		// It has no socket, so it cannot know whether data exists.
		await visit('?token=abc123');
		const { container } = render(Landing);
		await new Promise((resolve) => setTimeout(resolve, 20));

		const text = (container.textContent ?? '').toLowerCase();
		for (const forbidden of ['connected', 'live progression', 'in progress', 'sync']) {
			expect(text, forbidden).not.toContain(forbidden);
		}
	});

	it('does not put the token in the rendered text', async () => {
		await visit('?token=super-secret-token');
		const { container } = render(Landing);
		await new Promise((resolve) => setTimeout(resolve, 20));

		// The token may appear in an href, which is how it is carried. It must not
		// appear as visible text, and it must not be written anywhere else.
		const visibleText = (container.textContent ?? '');
		expect(visibleText).not.toContain('super-secret-token');
	});
});
