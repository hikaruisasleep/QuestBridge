/**
 * Chroma-safe UI tokens.
 *
 * Every colour drawn over the overlay is defined here and verified by
 * `chroma.test.ts` against **both** key colours. Components reference these
 * tokens instead of writing literals, which is what makes the guarantee
 * checkable: the test walks this object rather than trusting a grep.
 *
 * The colours are deliberately desaturated. A keyer removes anything close to
 * the key hue, so a green accent or a blue focus ring would vanish along with
 * the background. Saturation is the cost of being keyable.
 */

export interface ChromaTokens {
  /** The opaque key field itself. */
  keyBackground: string;
  /** Dark plate behind one-line notices, opaque so nothing shows through. */
  plate: string;
  /** Secondary plates and hover states, composited over `plate`. */
  plateRaised: string;
  /** Row fills, composited over `plate`. */
  rowFill: string;
  rowFillStrong: string;
  /** Highlight fill for a row that just completed. */
  rowComplete: string;
  /** Drag target indicator. */
  rowDropTarget: string;
  /** Hairlines and progress tracks. */
  track: string;
  ruleStrong: string;
  ruleSoft: string;
  /** Text, strongest to weakest. */
  textPrimary: string;
  textStrong: string;
  textBody: string;
  textMuted: string;
  textFaint: string;
  /** Non-keyed accents. */
  accentComplete: string;
  accentWarn: string;
  accentError: string;
  /** Focus ring for the dashboard, which is not keyed but stays consistent. */
  focusRing: string;
}

/**
 * The overlay palette.
 *
 * Chosen so that each colour, composited over either key colour, stays within
 * `DOMINANCE_TOLERANCE` of that key's hue. Neutral greys and warm tones are the
 * backbone; the green and blue channels are kept in balance so neither key
 * claims the colour.
 */
export const OVERLAY_TOKENS: Readonly<ChromaTokens> = Object.freeze({
  keyBackground: "#00ff00",

  // Opaque plates: the notice must be readable over a saturated key field, and a
  // translucent plate over pure green would itself become green.
  plate: "#14161b",
  plateRaised: "#22252c",
  rowFill: "#1a1d23",
  rowFillStrong: "#252932",
  rowComplete: "#243029",
  rowDropTarget: "#2f3340",

  // Tracks and rules are greys; a coloured track would risk the key hue.
  track: "#4a4f5a",
  ruleStrong: "#6b7280",
  ruleSoft: "#3a3f49",

  // Text. Warm-neutral white rather than pure white, so it does not read as a
  // tint of either key after compositing.
  textPrimary: "#e8e6e2",
  textStrong: "#d6d4d0",
  textBody: "#b9b7b3",
  textMuted: "#92908d",
  textFaint: "#6e6c69",

  // Accents: warm amber and a desaturated teal-leaning grey, chosen to sit far
  // from both key hues.
  accentComplete: "#a9b4a5",
  accentWarn: "#b8986a",
  accentError: "#b07a72",

  focusRing: "#8a8f99",
});

/**
 * The dashboard palette.
 *
 * The dashboard is never keyed, so it keeps a dark neutral theme. It reuses the
 * overlay's text tokens so the two routes describe state consistently, which is
 * what lets the preview stay faithful.
 */
export const CONTROL_TOKENS: Readonly<Pick<ChromaTokens, "textPrimary" | "textBody" | "textMuted" | "textFaint" | "accentComplete" | "accentWarn" | "accentError" | "focusRing">> =
  Object.freeze({
    textPrimary: OVERLAY_TOKENS.textPrimary,
    textBody: OVERLAY_TOKENS.textBody,
    textMuted: OVERLAY_TOKENS.textMuted,
    textFaint: OVERLAY_TOKENS.textFaint,
    accentComplete: OVERLAY_TOKENS.accentComplete,
    accentWarn: OVERLAY_TOKENS.accentWarn,
    accentError: OVERLAY_TOKENS.accentError,
    focusRing: OVERLAY_TOKENS.focusRing,
  });

/** Emit tokens as CSS custom properties for a `<style>` block or inline `style`. */
export function tokensToCss(
  tokens: Readonly<Record<string, string>>,
  prefix = "--qb",
): string {
  return Object.entries(tokens)
    .map(([name, value]) => `${prefix}-${kebab(name)}:${value}`)
    .join(";");
}

/**
 * The overlay's colour tokens as CSS custom properties.
 *
 * `keyBackground` is omitted: it is not a component colour, and emitting it would
 * let a component paint the key field and be keyed out.
 */
export function componentsToCss(): string {
  const { keyBackground: _ignored, ...componentTokens } = OVERLAY_TOKENS;
  void _ignored;
  return tokensToCss(componentTokens);
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
