/**
 * Validates captured QuestBridge messages against `@questbridge/protocol`.
 *
 * This exists because the host reports only the first schema failure, which is
 * slow to iterate against. The script prints every issue it finds, and it uses
 * the same `parseFrame` path the host uses, so a pass here means the host will
 * accept the message — including the 256 KiB frame limit.
 *
 * Usage:
 *   node scripts/validate-snapshot.mjs <file.json|dir> [...]
 *
 * Each input is understood in either of two shapes:
 *   - a full protocol envelope, validated by type and direction
 *     (`minecraft.hello`, `minecraft.status`, `minecraft.snapshot`, ...);
 *   - a bare `minecraft.snapshot` payload, which is what the live probe dumps.
 *
 * Exit code 0 means every message satisfied protocol v1; 1 otherwise.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  parseFrame,
  messageTypesForDirection,
  minecraftSnapshotPayloadSchema,
  ProtocolError,
} from "@questbridge/protocol";

const MINECRAFT_TO_HOST_TYPES = new Set(messageTypesForDirection("minecraft_to_host"));

function expand(args) {
  const files = [];
  for (const arg of args) {
    const info = statSync(arg);
    if (info.isDirectory()) {
      for (const name of readdirSync(arg)) {
        if (name.endsWith(".json")) files.push(join(arg, name));
      }
    } else {
      files.push(arg);
    }
  }
  return files.sort();
}

function describe(error) {
  if (!(error instanceof ProtocolError)) {
    return [{ path: [], message: error.message ?? String(error) }];
  }
  const issues = error.details?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues.map((issue) => ({ path: String(issue.path ?? ""), message: issue.message }));
  }
  return [{ path: "", message: `${error.code}: ${error.message}` }];
}

function summarise(message) {
  if (message.type !== "minecraft.snapshot") {
    return `  type=${message.type} sequence=${message.sequence}`;
  }
  const value = message.payload;
  const nullProgress = value.chapters.filter((chapter) => chapter.progress === null).length;
  const completed = value.chapters.filter((chapter) => chapter.status === "completed").length;
  const subtitled = value.chapters.filter((chapter) => chapter.subtitle !== undefined).length;
  const numericTasks = value.quests
    .flatMap((quest) => quest.tasks)
    .filter((task) => task.progress.current !== undefined || task.progress.target !== undefined)
    .length;
  return (
    `  chapters=${value.chapters.length} quests=${value.quests.length} ` +
    `manualPins=${value.manualPinIds.length} unresolved=${value.unresolvedPinnedQuestIds.length}\n` +
    `  chaptersWithNullProgress=${nullProgress} completedChapters=${completed} ` +
    `chaptersWithSubtitle=${subtitled} tasksWithNumericProgress=${numericTasks}`
  );
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error("usage: node scripts/validate-snapshot.mjs <file.json|dir> [...]");
  process.exit(1);
}

let failures = 0;
for (const path of expand(inputs)) {
  const text = readFileSync(path, "utf8");

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    console.error(`INVALID ${path}: not JSON (${error.message})`);
    failures++;
    continue;
  }

  // A bare snapshot payload (no envelope) is validated against its payload
  // schema directly, after the same size check the host applies to frames.
  const isBarePayload =
    raw && typeof raw === "object" && !("protocolVersion" in raw) && "chapters" in raw;

  if (isBarePayload) {
    const result = minecraftSnapshotPayloadSchema.safeParse(raw);
    if (result.success) {
      console.log(`OK ${path}`);
      console.log(summarise({ type: "minecraft.snapshot", payload: result.data }));
    } else {
      failures++;
      console.error(`INVALID ${path}: ${result.error.issues.length} issue(s)`);
      for (const issue of result.error.issues) {
        const location = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        console.error(`  [${location}] ${issue.message}`);
      }
    }
    continue;
  }

  if (raw && typeof raw === "object" && "type" in raw && !MINECRAFT_TO_HOST_TYPES.has(raw.type)) {
    failures++;
    console.error(
      `INVALID ${path}: message type "${raw.type}" is not a minecraft_to_host message`,
    );
    continue;
  }

  try {
    const message = parseFrame(text, "minecraft_to_host");
    console.log(`OK ${path}`);
    console.log(summarise(message));
  } catch (error) {
    failures++;
    const issues = describe(error);
    console.error(`INVALID ${path}: ${issues.length} issue(s)`);
    for (const issue of issues) {
      console.error(`  [${issue.path || "<root>"}] ${issue.message}`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} file(s) failed validation`);
  process.exit(1);
}
console.log("\nall messages valid");
