/**
 * Chroma-key backgrounds.
 *
 * OBS removes a solid colour from the overlay rather than a transparent alpha
 * channel, so the overlay paints an opaque key-coloured field and every UI
 * colour has to survive being shown over it.
 *
 * ## Why the forbidden channels are far stricter than `#00FF00` / `#0000FF`
 *
 * An OBS chroma key does not match one exact value. It removes pixels "close
 * enough" to the key colour, with similarity and smoothness tolerances the user
 * tunes. A component drawn in `#00E000` or `#0030FF` is therefore at risk of
 * being keyed out alongside the background even though its hex is not the key.
 *
 * The rule applied here is channel-by-channel: in green mode **no channel may be
 * dominated by green**, and in blue mode no channel may be dominated by blue,
 * after compositing over the background. Text that merely has a green tint is
 * fine; text a keyer would reasonably call "green" is not.
 */

/** Which key colour the overlay paints. */
export type ChromaKey = "green" | "blue";

/**
 * The exact key colours.
 *
 * Saturated primaries, as specified. These are the only colours the overlay may
 * paint in their own channel at full strength.
 */
export const KEY_COLORS: Readonly<Record<ChromaKey, string>> = Object.freeze({
  green: "#00ff00",
  blue: "#0000ff",
});

/**
 * Tolerance, as a fraction of the channel range, before a colour is considered
 * "this channel" rather than "a tint of it".
 *
 * A keyer at similarity 0.4 (a common OBS default) matches colours within
 * roughly 40% of the colour space of the key. Components are kept well inside
 * that: a colour may carry at most this share of the keyed channel above the
 * other two.
 */
export const DOMINANCE_TOLERANCE = 0.35;

/** Parse `#rrggbb` or `rgb()`/`rgba()` into 8-bit channels. Returns `null` when unparseable. */
export function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const text = value.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex !== null) {
    const digits = hex[1]!;
    if (digits.length === 3) {
      const [r, g, b] = [...digits].map((digit) => Number.parseInt(digit + digit, 16));
      return { r: r!, g: g!, b: b!, a: 1 };
    }
    const r = Number.parseInt(digits.slice(0, 2), 16);
    const g = Number.parseInt(digits.slice(2, 4), 16);
    const b = Number.parseInt(digits.slice(4, 6), 16);
    const a = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
  if (rgb !== null) {
    const parts = rgb[1]!
      .split(/[\s,/]+/)
      .filter((part) => part.length > 0)
      .map((part) => Number.parseFloat(part));
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
      return null;
    }
    return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
  }

  return null;
}

/** Composite a possibly translucent colour over an opaque backdrop. */
export function compositeOver(
  color: { r: number; g: number; b: number; a: number },
  backdrop: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  const mix = (front: number, back: number): number => front * color.a + back * (1 - color.a);
  return {
    r: mix(color.r, backdrop.r),
    g: mix(color.g, backdrop.g),
    b: mix(color.b, backdrop.b),
  };
}

/**
 * Whether a rendered colour is at risk of being keyed out.
 *
 * Evaluated against a key colour, not against a fixed rule, so green mode and
 * blue mode share one implementation and one test.
 */
export function isSafeOverChroma(
  rendered: { r: number; g: number; b: number },
  key: ChromaKey,
): { safe: boolean; reason: string | null } {
  const channels = { r: rendered.r, g: rendered.g, b: rendered.b };
  const others: Record<ChromaKey, [number, number]> = {
    green: [channels.r, channels.b],
    blue: [channels.r, channels.g],
  };
  const keyed = key === "green" ? channels.g : channels.b;
  const [first, second] = others[key];

  const limit = Math.max(first, second) + DOMINANCE_TOLERANCE * 255;
  if (keyed > limit) {
    return {
      safe: false,
      reason: `the ${key === "green" ? "green" : "blue"} channel (${Math.round(keyed)}) dominates the others (${Math.round(first)}, ${Math.round(second)})`,
    };
  }
  return { safe: true, reason: null };
}

/**
 * Test by hand whether a colour is safely visible over a key background.
 *
 * Exposed so the check used by the test suite is the same one a future
 * contributor can run against a proposed colour.
 */
export function evaluateColorForChroma(
  value: string,
  key: ChromaKey,
): { safe: boolean; rendered: string; reason: string | null } {
  const parsed = parseColor(value);
  if (parsed === null) {
    return { safe: false, rendered: value, reason: "unparseable colour" };
  }
  const backdrop = parseColor(KEY_COLORS[key])!;
  const rendered = compositeOver(parsed, { r: backdrop.r, g: backdrop.g, b: backdrop.b });
  const verdict = isSafeOverChroma(rendered, key);
  const asHex = `#${[rendered.r, rendered.g, rendered.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
  return { safe: verdict.safe, rendered: asHex, reason: verdict.reason };
}

/** Read a stored chroma key, ignoring anything unrecognized. */
export function parseChromaKey(value: string | null): ChromaKey {
  return value === "green" || value === "blue" ? value : "green";
}
