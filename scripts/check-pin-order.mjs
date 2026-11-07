/**
 * Analyses the mapper's emitted pin order against the pack's catalog order.
 *
 * Used during Phase 5 to answer one question: does the adapter's fallback pin
 * ordering (chapter catalog order, then quest order in chapter) actually match
 * what the pack defines, or is the observed order equally explained by a
 * simpler rule such as "sorted by quest id"?
 *
 * It reads the pack's chapter files to derive an independent expectation. That
 * expectation is derived from SNBT metadata (chapter-group order plus each
 * chapter's order_index) and is therefore an approximation of FTB's runtime
 * `getAllChapters()` order, not the runtime list itself.
 *
 * Usage: node scripts/check-pin-order.mjs <minecraftDir> <questId:chapterId> [...]
 */
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [, , minecraftDir, ...pins] = process.argv;
if (!minecraftDir) {
  process.stderr.write(
    "usage: node scripts/check-pin-order.mjs <minecraftDir> <questId:chapterId> [...]\n",
  );
  process.exit(1);
}

const questsRoot = join(minecraftDir, "config", "ftbquests", "quests");
const chaptersDir = join(questsRoot, "chapters");
const langFile = join(questsRoot, "lang", "en_us.snbt");

const groupOrder = [...readFileSync(join(questsRoot, "chapter_groups.snbt"), "utf8")
  .matchAll(/id:\s*"([0-9A-F]{16})"/g)].map((m) => m[1]);

const files = readdirSync(chaptersDir).filter((n) => n.endsWith(".snbt"));
const chapters = [];
const failed = [];

for (const name of files) {
  const text = readFileSync(join(chaptersDir, name), "utf8");
  const ownId = /^[ \t]*id:\s*"([0-9A-F]{16})"/m.exec(text)?.[1];
  const group = /^[ \t]*group:\s*"([0-9A-F]{16})"/m.exec(text)?.[1];
  const orderIndex = Number(/^[ \t]*order_index:\s*(\d+)/m.exec(text)?.[1] ?? "0");
  if (ownId === undefined || group === undefined) {
    failed.push(name);
    continue;
  }
  chapters.push({ file: name, id: ownId, group, orderIndex, groupRank: groupOrder.indexOf(group), text });
}

chapters.sort((a, b) => (a.groupRank - b.groupRank) || (a.orderIndex - b.orderIndex));
chapters.forEach((c, i) => { c.rank = i; });

process.stdout.write(`chapter files:      ${files.length}\n`);
process.stdout.write(`parsed:             ${chapters.length}\n`);
if (failed.length > 0) {
  process.stdout.write(`unparsed files:     ${failed.join(", ")}\n`);
}
process.stdout.write(`groups:             ${groupOrder.length}\n\n`);

// ---- resolve the pinned chapters -----------------------------------------
const byId = new Map(chapters.map((c) => [c.id, c]));
const observed = pins.map((spec) => {
  const [questId, chapterId] = spec.split(":");
  const chapter = byId.get(chapterId);
  return {
    questId,
    chapterId,
    rank: chapter?.rank ?? null,
    file: chapter?.file ?? "(unknown chapter)",
  };
});

process.stdout.write("pinned quests, with pack-derived chapter rank:\n");
for (const p of observed) {
  process.stdout.write(`  rank ${String(p.rank).padStart(2)}  quest=${p.questId}  ${p.file}\n`);
}

const numeric = observed.every((p) => p.rank !== null);
if (!numeric) {
  process.stdout.write("\na pinned chapter id was not found in the pack; cannot compare.\n");
  process.exit(0);
}

// ---- which rules explain the observed order? -----------------------------
const order = observed.map((p) => p.questId);
const observedIdx = new Map(order.map((q, i) => [q, i]));

const rules = {
  "catalog rank (documented)": (a, b) => a.rank - b.rank,
  "quest id ascending": (a, b) => (BigInt("0x" + a.questId) < BigInt("0x" + b.questId) ? -1 : 1),
  "quest id descending": (a, b) => (BigInt("0x" + a.questId) > BigInt("0x" + b.questId) ? -1 : 1),
  "chapter id ascending": (a, b) => (BigInt("0x" + a.chapterId) < BigInt("0x" + b.chapterId) ? -1 : 1),
};

process.stdout.write("\nwhich rules predict the OBSERVED order?\n");
const survivors = [];
for (const [name, cmp] of Object.entries(rules)) {
  const predicted = [...observed].sort(cmp).map((p) => p.questId);
  const matches = predicted.every((q, i) => observedIdx.get(q) === i);
  if (matches) {
    survivors.push(name);
  }
  process.stdout.write(`  ${matches ? "MATCHES  " : "excluded "} ${name}\n`);
}

process.stdout.write(
  survivors.length > 1
    ? `\nCONFOUNDED: ${survivors.length} rules explain this pin set equally ` +
        `(${survivors.join(", ")}). Pin a quest whose id rank differs from its ` +
        `catalog rank to separate them.\n`
    : `\nDECISIVE: only "${survivors[0]}" explains the observed order.\n`,
);

// ---- offer a discriminating quest ----------------------------------------
// Look for a quest in a LATE chapter whose id sorts BELOW a quest in an EARLY
// chapter: catalog order and id order then make opposite predictions.
const lang = existsSync(langFile)
  ? new Map(
      [...readFileSync(langFile, "utf8").matchAll(/^\s*([\w.]+):\s*"((?:[^"\\]|\\.)*)"/gm)]
        .map((m) => [m[1], m[2]]),
    )
  : new Map();

function titleOf(chapter, questId) {
  const at = chapter.text.indexOf(`id: "${questId}"`);
  if (at === -1) {
    return "(not in this chapter file)";
  }
  const window = chapter.text.slice(at, at + 400);
  const raw = /title:\s*"((?:[^"\\]|\\.)*)"/.exec(window)?.[1];
  if (raw === undefined) {
    return "(no title field; likely auto-generated)";
  }
  return lang.get(raw) ?? raw;
}

const early = observed.reduce((best, p) => (best === null || p.rank < best.rank ? p : best), null);
if (early !== null) {
  const candidates = [];
  for (const chapter of chapters) {
    if (chapter.rank <= early.rank) {
      continue;
    }
    for (const m of chapter.text.matchAll(/id:\s*"([0-9A-F]{16})"/g)) {
      const qid = m[1];
      if (BigInt("0x" + qid) < BigInt("0x" + early.questId)) {
        candidates.push({ chapter, questId: qid });
      }
    }
  }
  candidates.sort((a, b) => (BigInt("0x" + a.questId) < BigInt("0x" + b.questId) ? -1 : 1));

  process.stdout.write(
    `\nTo separate the surviving rules, pin a quest in a LATER chapter whose id\n` +
      `sorts BELOW ${early.questId} (rank ${early.rank}). Candidates:\n`,
  );
  for (const c of candidates.slice(0, 6)) {
    process.stdout.write(
      `  ${c.questId}  rank ${String(c.chapter.rank).padStart(2)}  ` +
        `"${titleOf(c.chapter, c.questId)}"  (${c.chapter.file})\n`,
    );
  }
  if (candidates.length === 0) {
    process.stdout.write("  none found; every later chapter's ids sort higher.\n");
  }
}
