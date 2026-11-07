/**
 * Read-only reader for the adapter's snapshot dump.
 *
 * The adapter has a development hook, `-Dquestbridge.dumpSnapshot=<path>`, that
 * appends each encoded `minecraft.snapshot` envelope as it is captured. That
 * file is the only direct evidence that `FtbSnapshotMapper` — not the 4A probe
 * log — produced the values a run publishes. Nothing else can distinguish the
 * two, which is why `docs/protocol.md` §4F left the mapper unproven.
 *
 * This script reads that dump and reports what it contains. It never writes to
 * the dump and never contacts the host.
 *
 * Usage:
 *   node scripts/phase5/read-capture.mjs <dump-path> [--json-out <path>]
 *
 * The dump is one JSON envelope per line. A truncated final line from a client
 * killed mid-write is reported and skipped, not treated as a failure.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const EXPECTED_CHAPTER_IDS = [
  "3B0302DB5E77C3A2",
  "28BCA5042050B140",
  "67E7552FDA3245F5",
  "634794CB36D61302",
  "571D32BADC77CDD0",
];

function parseArgs(argv) {
  const options = { dump: undefined, jsonOut: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json-out") {
      options.jsonOut = argv[++index];
    } else if (arg.startsWith("--json-out=")) {
      options.jsonOut = arg.slice("--json-out=".length);
    } else if (options.dump === undefined) {
      options.dump = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.dump === undefined) {
    throw new Error("usage: node scripts/phase5/read-capture.mjs <dump-path> [--json-out <path>]");
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.dump)) {
    process.stderr.write(
      `no dump at ${options.dump}\n` +
        "Start the client with -Dquestbridge.dumpSnapshot=<path> to record one.\n",
    );
    process.exitCode = 2;
    return;
  }

  const lines = readFileSync(options.dump, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
  const messages = [];
  const problems = [];

  for (const [index, line] of lines.entries()) {
    try {
      messages.push(JSON.parse(line));
    } catch {
      problems.push(`line ${index + 1} is not valid JSON (truncated write or corruption)`);
    }
  }

  const snapshots = messages.filter((message) => message.type === "minecraft.snapshot");
  if (snapshots.length === 0) {
    process.stderr.write(`no minecraft.snapshot messages in ${options.dump}\n`);
    process.exitCode = 1;
    return;
  }

  const latest = snapshots[snapshots.length - 1].payload;
  const allIds = new Set();
  let duplicateIds = 0;
  let sawNullProgress = false;
  let sawCompleted = false;
  let sawSubtitle = false;
  let sawNumericTask = false;
  let sawAutoPin = false;
  const taskTypes = new Set();

  for (const snapshot of snapshots) {
    const payload = snapshot.payload;
    for (const chapter of payload.chapters ?? []) {
      if (allIds.has(chapter.id)) {
        duplicateIds += 1;
      }
      allIds.add(chapter.id);
      if (chapter.progress === null) {
        sawNullProgress = true;
      }
      if (chapter.status === "completed") {
        sawCompleted = true;
      }
      if (chapter.subtitle !== undefined) {
        sawSubtitle = true;
      }
    }
    for (const quest of payload.quests ?? []) {
      for (const task of quest.tasks ?? []) {
        taskTypes.add(task.type);
        if (task.progress.current !== undefined || task.progress.target !== undefined) {
          sawNumericTask = true;
        }
      }
    }
    if ((payload.manualPinIds ?? []).includes("1")) {
      sawAutoPin = true;
    }
  }

  const resolved = EXPECTED_CHAPTER_IDS.filter((id) =>
    (latest.chapters ?? []).some((chapter) => chapter.id === id),
  );

  const report = {
    tool: "phase5-read-capture",
    dump: options.dump,
    snapshotMessages: snapshots.length,
    totalMessages: messages.length,
    problems,
    latest: {
      orderValuesContiguous: isContiguous((latest.chapters ?? []).map((c) => c.order)),
      chapterCount: (latest.chapters ?? []).length,
      manualPinIds: latest.manualPinIds ?? [],
      quests: (latest.quests ?? []).map((quest) => ({
        id: quest.id,
        title: quest.title,
        chapterId: quest.chapterId,
        status: quest.progress.status,
        tasks: (quest.tasks ?? []).length,
      })),
      unresolvedPinnedQuestIds: latest.unresolvedPinnedQuestIds ?? [],
      integratedServer: latest.integratedServer,
      worldName: latest.worldName,
      dimension: latest.dimension,
      teamId: latest.teamId,
    },
    findings: {
      expectedChaptersResolved: resolved.length,
      expectedChaptersExpected: EXPECTED_CHAPTER_IDS.length,
      duplicateChapterIds: duplicateIds,
      sawNullProgress,
      sawCompletedChapter: sawCompleted,
      sawSubtitle,
      sawNumericTask,
      sawAutoPinId: sawAutoPin,
      taskTypes: [...taskTypes].sort(),
    },
  };

  const line = "─".repeat(72);
  process.stdout.write(`${line}\ncapture: ${options.dump}\n${line}\n`);
  process.stdout.write(`snapshot messages: ${snapshots.length} (of ${messages.length} lines)\n`);
  process.stdout.write(`latest snapshot: ${report.latest.chapterCount} chapters, ` +
    `${report.latest.manualPinIds.length} manual pin(s), ${report.latest.quests.length} resolved\n`);
  process.stdout.write(`world: ${report.latest.worldName} (${report.latest.dimension}), ` +
    `integrated=${report.latest.integratedServer}\n`);
  process.stdout.write(`expected chapters resolved: ${resolved.length}/5\n`);
  process.stdout.write(`chapter ids duplicated: ${duplicateIds}\n`);
  process.stdout.write(`chapter order contiguous 0..n: ${report.latest.orderValuesContiguous}\n`);
  process.stdout.write(
    `features seen — null progress: ${sawNullProgress}, completed chapter: ${sawCompleted}, ` +
      `subtitle: ${sawSubtitle}, numeric task: ${sawNumericTask}\n`,
  );
  process.stdout.write(`task types: ${[...taskTypes].sort().join(", ") || "(none)"}\n`);
  process.stdout.write(`automatic pin id 1 seen: ${sawAutoPin}\n`);

  if (problems.length > 0) {
    process.stdout.write(`\nproblems:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  }

  const checks = [];
  const add = (name, passed, detail) => checks.push({ name, passed, detail });

  add("capture-written", true, `${snapshots.length} snapshot message(s)`);
  add(
    "expected-chapters",
    resolved.length === EXPECTED_CHAPTER_IDS.length,
    `${resolved.length}/5 ATM10 chapters present`,
  );
  add("unique-chapter-ids", duplicateIds === 0, `${duplicateIds} duplicate id(s)`);
  add(
    "contiguous-order",
    report.latest.orderValuesContiguous,
    "chapter.order must be unique and 0-based",
  );
  add("no-auto-pin", !sawAutoPin, "automatic pin id 1 must never be published");
  add(
    "real-progress",
    sawNullProgress || sawCompleted || sawNumericTask,
    "needs at least one of: null progress, a completed chapter, numeric task progress",
  );

  process.stdout.write(`\n`);
  for (const check of checks) {
    process.stdout.write(`  ${check.passed ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}\n`);
  }
  const failed = checks.filter((check) => !check.passed);
  process.stdout.write(`${line}\n${failed.length === 0 ? "CAPTURE LOOKS USABLE" : `${failed.length} CHECK(S) FAILED`}\n`);

  if (options.jsonOut !== undefined) {
    writeFileSync(options.jsonOut, `${JSON.stringify({ ...report, checks }, null, 2)}\n`, "utf8");
  }

  process.exitCode = failed.length === 0 ? 0 : 1;
}

function isContiguous(orders) {
  if (orders.length === 0) {
    return false;
  }
  const sorted = [...orders].sort((a, b) => a - b);
  return sorted.every((value, index) => value === index);
}

try {
  main();
} catch (error) {
  process.stderr.write(`read-capture failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
