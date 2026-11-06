/**
 * Motion tokens.
 *
 * One file, per `docs/phase-3-plan.md` §11.4: the fade, the zoom, and the
 * reflow are chosen once here rather than ad hoc per component.
 *
 * `prefers-reduced-motion` is deliberately **not** honoured
 * (`docs/web-frontend.md` §3.5, `docs/phase-3-plan.md` §11.3). The motion on
 * this overlay is content, not chrome: it is a stream graphic rendered over a
 * video game on a broadcast, not a public site. Do not add a reduced-motion
 * branch to any of these values.
 *
 * Values are plain numbers and strings so they can be consumed both by Svelte
 * transitions (which take milliseconds) and by CSS custom properties.
 */

export const motion = Object.freeze({
  /**
   * Overlay-wide fade on disconnection.
   *
   * Long enough to read as deliberate, short enough not to linger on a frozen
   * overlay. A hard cut would read as a glitch on stream.
   */
  disconnectFadeMs: 700,

  /** Quest box zoom on pin/unpin. Animate transform and opacity, never layout. */
  questZoomMs: 260,

  /** Surviving objective rows slide to their new positions. */
  questReflowMs: 320,

  /** Brief highlight when a row reaches completion. */
  completionPulseMs: 900,

  /** Pause at each end of the objectives auto-scroll. */
  autoScrollHoldMs: 1_600,

  /** Minimum time to travel the objectives between the two ends. */
  autoScrollMinTravelMs: 1_400,

  /** Travel time per pixel of overflow; capped by `autoScrollMaxTravelMs`. */
  autoScrollMsPerPx: 9,

  /** Upper bound on one auto-scroll leg, so long lists still cycle visibly. */
  autoScrollMaxTravelMs: 9_000,

  /**
   * Reflow must complete before a subsequent update arrives, or drag-heavy
   * pinning around the 2 s reconciliation interval looks unstable.
   */
  maxReflowMs: 400,
} as const);

/** Promptness for the dashboard, where motion is feedback rather than content. */
export const controlMotion = Object.freeze({
  feedbackMs: 180,
  dragLiftMs: 120,
} as const);

/**
 * CSS custom properties mirroring the tokens above.
 *
 * Exposed on the overlay root so component stylesheets can reference the same
 * numbers without importing TypeScript. Kept in sync by the test in
 * `motion.test.ts`, which is cheaper than noticing drift on stream.
 */
export function motionCssVariables(): string {
  return [
    `--qb-fade-ms:${motion.disconnectFadeMs}ms`,
    `--qb-zoom-ms:${motion.questZoomMs}ms`,
    `--qb-reflow-ms:${motion.questReflowMs}ms`,
    `--qb-pulse-ms:${motion.completionPulseMs}ms`,
  ].join(";");
}
