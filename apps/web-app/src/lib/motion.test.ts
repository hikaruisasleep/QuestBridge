import { describe, expect, it } from 'vitest';

import { motion, motionCssVariables } from './motion.js';

/**
 * Motion tokens.
 *
 * `docs/phase-3-plan.md` §11.4 asks for the timings to be chosen once, in one
 * file. That is only true if components cannot quietly reintroduce a literal, so
 * the last test here scans the component sources.
 */

describe('motion tokens', () => {
  it('exposes every token as a CSS variable', () => {
    const css = motionCssVariables();
    expect(css).toContain(`--qb-fade-ms:${motion.disconnectFadeMs}ms`);
    expect(css).toContain(`--qb-zoom-ms:${motion.questZoomMs}ms`);
    expect(css).toContain(`--qb-reflow-ms:${motion.questReflowMs}ms`);
    expect(css).toContain(`--qb-pulse-ms:${motion.completionPulseMs}ms`);
    expect(css).toContain(`--qb-progress-fill-ms:${motion.progressFillMs}ms`);
    expect(css).toContain(`--qb-hover-ms:${motion.hoverMs}ms`);
    expect(css).toContain(`--qb-row-state-ms:${motion.rowStateMs}ms`);
    expect(css).toContain(`--qb-easing:${motion.easing}`);
  });

  it('keeps reflow inside one reconciliation interval', () => {
    // The mock reconciles every 2 s; a longer reflow would still be settling
    // when the next update arrives.
    expect(motion.questReflowMs).toBeLessThan(2_000);
    expect(motion.maxReflowMs).toBeGreaterThanOrEqual(motion.questReflowMs);
  });

  it('keeps the progress fill shorter than the completion pulse', () => {
    // Otherwise the bar is still travelling after the highlight has finished.
    expect(motion.progressFillMs).toBeLessThan(motion.completionPulseMs);
  });

  it('uses one easing token', () => {
    expect(typeof motion.easing).toBe('string');
    expect(motion.easing.length).toBeGreaterThan(0);
  });

  it('declares no reduced-motion branch', async () => {
    // Deliberate product decision (`docs/web-frontend.md` §3.5): the motion is
    // content on a broadcast, not chrome on a public site.
    const modules = import.meta.glob('./**/*.svelte', {
      query: '?raw',
      import: 'default',
      eager: true
    });
    for (const [path, source] of Object.entries(modules)) {
      expect(String(source), path).not.toContain('prefers-reduced-motion');
    }
  });

  it('keeps duration literals out of component stylesheets', async () => {
    // Every transition duration must come from the token file.
    //
    // A `var(--qb-…, 420ms)` fallback is not a hard-coded timing: it is the
    // value the token would supply, and it disappears the moment the token is
    // present. Fallbacks are therefore stripped before scanning, and what
    // remains must contain no duration of its own.
    const modules = import.meta.glob('./**/*.svelte', {
      query: '?raw',
      import: 'default',
      eager: true
    });

    const offenders: string[] = [];
    for (const [path, raw] of Object.entries(modules)) {
      const source = String(raw);
      const styleStart = source.indexOf('<style>');
      if (styleStart === -1) {
        continue;
      }
      const style = source
        .slice(styleStart)
        // Drop the fallback argument of every custom-property reference.
        .replace(/var\(\s*--[\w-]+\s*,[^()]*\)/g, 'var(--token)');

      for (const match of style.matchAll(/(?<![\w-])(\d+(?:\.\d+)?)(ms|s)(?![\w-])/g)) {
        offenders.push(`${path}: ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
