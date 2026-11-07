/**
 * One-off repair for a double-encoded UTF-8 file.
 *
 * `docs/phase-4-plan.md` was written as UTF-8, then reinterpreted as CP1252 and
 * re-encoded as UTF-8, so an em dash became the three-character sequence
 * "â€”". The file is the only one affected.
 *
 * This script reverses that mapping by code point so it does not depend on the
 * console's encoding. It is a maintenance tool, not part of the build.
 *
 * Usage: node scripts/fix-mojibake.mjs <file.md>
 */
import { readFileSync, writeFileSync } from "node:fs";

// CP1252 rendering of the UTF-8 bytes, keyed by the mojibake sequence.
const REPLACEMENTS = [
  ["\u00E2\u20AC\u201D", "\u2014"], // em dash
  ["\u00E2\u20AC\u201C", "\u2013"], // en dash
  ["\u00E2\u20AC\u009C", "\u201C"], // left double quote
  ["\u00E2\u20AC\u009D", "\u201D"], // right double quote
  ["\u00E2\u20AC\u2122", "\u2019"], // right single quote
  ["\u00E2\u20AC\u02DC", "\u2018"], // left single quote
  ["\u00E2\u20AC\u00A6", "\u2026"], // ellipsis
  ["\u00C2\u00A7", "\u00A7"], // section sign
  ["\u00C2\u00BB", "\u00BB"], // right guillemet
  ["\u00C2\u00AB", "\u00AB"], // left guillemet
  ["\u00C2\u00A0", " "], // non-breaking space
  ["\u00E2\u2020\u2019", "\u2192"], // rightwards arrow
  ["\u00E2\u2030\u00A4", "\u2264"], // less-than-or-equal
  ["\u00E2\u2030\u00A5", "\u2265"], // greater-than-or-equal
  ["\u00E2\u02DC\u2018", "\u2611"], // ballot box with check (best effort)
];

const target = process.argv[2];
if (!target) {
  process.stderr.write("usage: node scripts/fix-mojibake.mjs <file.md>\n");
  process.exit(1);
}

const before = readFileSync(target, "utf8");
let after = before;
for (const [from, to] of REPLACEMENTS) {
  // Split/join avoids regex escaping issues with multi-byte sequences.
  after = after.split(from).join(to);
}

// Any remaining sequence that looks like CP1252-mangled UTF-8 is reported
// rather than silently left, so the mapping can be extended.
const remaining = [...after.matchAll(/\u00C3.|\u00E2\u20AC./gu)].length;

if (before !== after) {
  writeFileSync(target, after, "utf8");
}

process.stdout.write(`file: ${target}\n`);
process.stdout.write(`changed: ${before !== after}\n`);
process.stdout.write(`remaining suspicious sequences: ${remaining}\n`);
if (remaining > 0) {
  const sample = [...after.matchAll(/.{0,12}(\u00C3.|\u00E2\u20AC.).{0,12}/gu)].slice(0, 5);
  for (const match of sample) {
    process.stdout.write(`  near: ${JSON.stringify(match[0])}\n`);
  }
}
