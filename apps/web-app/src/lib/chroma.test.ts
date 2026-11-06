import { describe, expect, it } from "vitest";

import {
  DOMINANCE_TOLERANCE,
  KEY_COLORS,
  evaluateColorForChroma,
  isSafeOverChroma,
  parseChromaKey,
  parseColor,
  type ChromaKey,
} from "./chroma.js";
import { OVERLAY_TOKENS } from "./theme.js";

/**
 * Chroma-key safety.
 *
 * The overlay is keyed in OBS, so no colour it paints may look like the key
 * colour. These tests walk the real token table rather than a copy of it, which
 * is what makes the guarantee hold when a token is later added.
 */

const KEYS: ChromaKey[] = ["green", "blue"];

describe("chroma colours", () => {
  it("uses the exact specified key colours", () => {
    expect(KEY_COLORS.green).toBe("#00ff00");
    expect(KEY_COLORS.blue).toBe("#0000ff");
  });

  it("parses the colour forms the stylesheet uses", () => {
    expect(parseColor("#00ff00")).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("rgba(255, 255, 255, 0.45)")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.45,
    });
    expect(parseColor("not-a-colour")).toBeNull();
  });

  it("recognizes the key colours themselves as unsafe", () => {
    // A sanity check on the rule itself: pure green must fail in green mode.
    for (const key of KEYS) {
      const verdict = isSafeOverChroma(
        key === "green" ? { r: 0, g: 255, b: 0 } : { r: 0, g: 0, b: 255 },
        key,
      );
      expect(verdict.safe, key).toBe(false);
    }
  });

  it("treats a near-key colour as unsafe, not just the exact key", () => {
    // A keyer's tolerance is not zero: a UI colour close to the key is removed
    // with it. This is the case an exact-match check would miss.
    expect(isSafeOverChroma({ r: 20, g: 230, b: 20 }, "green").safe).toBe(false);
    expect(isSafeOverChroma({ r: 20, g: 20, b: 230 }, "blue").safe).toBe(false);
  });

  it("accepts neutral and warm colours over both keys", () => {
    for (const key of KEYS) {
      for (const color of ["#e8e6e2", "#14161b", "#b8986a", "#ffffff"]) {
        expect(evaluateColorForChroma(color, key).safe, `${color} over ${key}`).toBe(true);
      }
    }
  });
});

describe("overlay tokens over every key", () => {
  it("keeps every token visible over green and over blue", () => {
    const failures: string[] = [];

    for (const key of KEYS) {
      for (const [name, value] of Object.entries(OVERLAY_TOKENS)) {
        // The key background is the exception by definition: it *is* the key.
        if (name === "keyBackground") {
          continue;
        }
        const verdict = evaluateColorForChroma(value, key);
        if (!verdict.safe) {
          failures.push(`${name} (${value}) over ${key}: ${verdict.reason}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps the notice plate opaque so the key cannot show through it", () => {
    // A translucent plate would composite into the key colour and be keyed out
    // with the background.
    const plate = parseColor(OVERLAY_TOKENS.plate);
    expect(plate?.a).toBe(1);
  });

  it("documents the tolerance it enforces", () => {
    // The rule is only meaningful if the number is visible and deliberate.
    expect(DOMINANCE_TOLERANCE).toBeGreaterThan(0);
    expect(DOMINANCE_TOLERANCE).toBeLessThan(0.5);
  });
});

describe("parseChromaKey", () => {
  it("accepts the two keys", () => {
    expect(parseChromaKey("green")).toBe("green");
    expect(parseChromaKey("blue")).toBe("blue");
  });

  it("defaults to green for a missing or unrecognized value", () => {
    expect(parseChromaKey(null)).toBe("green");
    expect(parseChromaKey("purple")).toBe("green");
  });
});
