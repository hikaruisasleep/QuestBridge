/**
 * Finds a quest that discriminates between two candidate pin-ordering rules.
 *
 * The adapter orders pinned quests by chapter catalog order, then by position
 * within the chapter. A live test can only separate that from a competing rule
 * (for example "sorted by quest id") if we pin a quest whose quest-id rank
 * differs from its catalog rank.
 *
 * This script reads the pack's chapter files, builds each chapter's catalog
 * rank from the chapter-group order and each chapter's order_index, then looks
 * for pairs whose relative order differs between the two rules.
 *
 * Usage: node scripts/find-ordering-probe.mjs "<path to instance minecraft dir>"
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const minecraftDir = process.argv[2];
if (!minecraftDir) {
  process.stderr.write("usage: node scripts/find-ordering-probe.mjs <minecraftDir>\n");
  process.exit(1);
}

const questsRoot = join(minecraftDir, "config", "ftbquests", "quests");
const chaptersDir = join(questsRoot, "chapters");

function readText(path) {
  return readFileSync(path, "utf8");
}

// Chapter group order, from chapter_groups.snbt. The list order is the catalog
// order of the groups.
const groupsText = readText(join(questsRoot, "chapter_groups.snbt"));
const groupOrder = [...groupsText.matchAll(/id:\s*"([0-9A-F]{16})"/g)].map((m) => m[1]);

const chapters = [];
for (const name of readdirSync(chaptersDir)) {
  if (!name.endsWith(".snbt")) {
    continue;
  }
  const text = readText(join(chaptersDir, name));

  // The chapter's own id is the top-level one; the file also contains quest ids.
  const ownId = /^[ \t]*id:\s*"([0-9A-F]{16})"/m.exec(text)?.[1];
  const group = /^[ \t]*group:\s*"([0-9A-F]{16})"/m.exec(text)?.[1];
  const orderIndex = Number(/^[ \t]*order_index:\s*(\d+)/m.exec(text)?.[1] ?? "0");
  if (ownId === undefined || group === undefined) {
    continue;
  }

  // Quest ids: every 16-hex quoted id that is not the chapter or the group.
  const ids = [...text.matchAll(/id:\s*"([0-9A-F]{16})"/g)]
    .map((m) => m[1])
    .filter((id) => id !== ownId && id !== group);

  chapters.push({
    file: name,
    id: ownId,
    group,
    orderIndex,
    groupRank: groupOrder.indexOf(group),
    questIds: [...new Set(ids)],
  });
}

// Catalog rank: FTB iterates chapter groups in order, and chapters within a
// group by order_index.
chapters.sort((a, b) => (a.groupRank - b.groupRank) || (a.orderIndex - b.orderIndex));
chapters.forEach((chapter, index) => {
  chapter.catalogRank = index;
});

process.stdout.write(`groups (catalog order): ${groupOrder.length}\n`);
process.stdout.write(`chapters parsed: ${chapters.length}\n\n`);

// Show the head of the catalog so rank 0 is identifiable.
process.stdout.write("catalog rank 0..7:\n");
for (const chapter of chapters.slice(0, 8)) {
  process.stdout.write(
    `  ${String(chapter.catalogRank).padStart(2)}  ${chapter.id}  group=${chapter.groupRank} order=${chapter.orderIndex}  quests=${chapter.questIds.length}  ${chapter.file}\n`,
  );
}

// Find a quest in an EARLY chapter whose id sorts AFTER a quest in a LATER
// chapter. Pinning the early chapter's high-id quest would then discriminate:
// catalog order puts it first, id order puts it last.
const probe = [];
for (const early of chapters.slice(0, 12)) {
  for (const late of chapters.slice(-25)) {
    if (early.catalogRank >= late.catalogRank) {
      continue;
    }
    const earlyMax = early.questIds
      .slice()
      .sort((a, b) => (BigInt("0x" + a) > BigInt("0x" + b) ? -1 : 1))[0];
    const lateMin = late.questIds
      .slice()
      .sort((a, b) => (BigInt("0x" + a) > BigInt("0x" + b) ? 1 : -1))[0];
    if (earlyMax === undefined || lateMin === undefined) {
      continue;
    }
    if (BigInt("0x" + earlyMax) > BigInt("0x" + lateMin)) {
      probe.push({
        earlyChapter: early,
        earlyQuestId: earlyMax,
        lateChapter: late,
        lateQuestId: lateMin,
        gap: BigInt("0x" + earlyMax) - BigInt("0x" + lateMin),
      });
    }
  }
}

probe.sort((a, b) => (a.gap > b.gap ? -1 : 1));

process.stdout.write(`\ndiscriminating pairs found: ${probe.length}\n`);
for (const pair of probe.slice(0, 5)) {
  process.stdout.write(
    `\n  pin a quest in chapter rank ${pair.earlyChapter.catalogRank} (${pair.earlyChapter.file})\n` +
      `    highest quest id there: ${pair.earlyQuestId}\n` +
      `  alongside chapter rank ${pair.lateChapter.catalogRank} (${pair.lateChapter.file})\n` +
      `    lowest quest id there:  ${pair.lateQuestId}\n` +
      `  catalog order predicts the rank-${pair.earlyChapter.catalogRank} quest FIRST;\n` +
      `  id order predicts it LAST. Pin the first quest listed and re-check.\n`,
  );
}
