/**
 * Agent-side observer for a Phase 5 live session.
 *
 * Phase 5 is verified collaboratively: the user launches the client and plays,
 * the agent watches. The host's log records what arrived; this script records
 * what the *browser* would see, which is the only view that answers "does the
 * overlay show the right thing".
 *
 * It connects once with the `control` role — the same normalised `AppState` the
 * overlay renders — applies revisions exactly as the frontend does, and prints
 * one line per observable change. When the run ends it evaluates the
 * assertions for the checks named on the command line and exits accordingly.
 *
 * It never mutates host state. It is an observer, not a dashboard.
 *
 * Usage:
 *   node scripts/phase5/watch.mjs [options]
 *
 * Options:
 *   --session <dir>        Read session.json from a phase-5 artifacts directory
 *   --url <ws url>         Override the publisher endpoint
 *   --token <browserToken> Browser token (the session file is preferred)
 *   --expect <names>       Comma-separated assertion names (see ASSERTIONS)
 *   --until <seconds>      Stop watching after N seconds (default: run until Ctrl+C)
 *   --json-out <path>      Write the final report here
 *   --quiet                Only print state transitions, not heartbeats
 *
 * Exit codes:
 *   0  every requested assertion passed
 *   1  an assertion failed
 *   2  the observer could not run
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { WebSocket } from "ws";

const PHASE5_CHECKS = {
  ready: "a publisher reached ready with a catalog",
  "no-auto-pin": "manual pin ID 1 never appears in objectives",
  "objectives-partition": "every manual pin is either resolved or listed unresolved",
  "chapter-mapping": "the five ATM10 chapters resolve by ID",
  "numeric-task": "at least one task exposes current/target",
  "null-or-complete": "progress is realistic (a completed chapter or a null-progress chapter)",
  "pin-change": "the manual pin set changed at least once",
  "progress-change": "chapter or quest progress changed at least once",
  "reconnect": "the publisher disconnected and came back",
  "world-change": "world identity changed at least once",
  "team-change": "team identity changed at least once",
  "after-pin-addition": "a pin added during the run appeared as a new objective",
  "after-completion": "a completing quest removed itself from the pin set",
  "single-player": "the publisher reported an integrated server",
  "multiplayer": "the publisher reported a remote server",
};

function parseArgs(argv) {
  const options = {
    session: undefined,
    url: undefined,
    token: undefined,
    expect: [],
    until: undefined,
    jsonOut: undefined,
    quiet: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) {
        throw new Error(`${arg} needs a value`);
      }
      return value;
    };
    if (arg === "--session") {
      options.session = next();
    } else if (arg.startsWith("--session=")) {
      options.session = arg.slice("--session=".length);
    } else if (arg === "--url") {
      options.url = next();
    } else if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
    } else if (arg === "--token") {
      options.token = next();
    } else if (arg.startsWith("--token=")) {
      options.token = arg.slice("--token=".length);
    } else if (arg === "--expect") {
      options.expect.push(...next().split(",").map((name) => name.trim()).filter(Boolean));
    } else if (arg.startsWith("--expect=")) {
      options.expect.push(...arg.slice("--expect=".length).split(",").map((n) => n.trim()).filter(Boolean));
    } else if (arg === "--until") {
      options.until = Number(next());
    } else if (arg.startsWith("--until=")) {
      options.until = Number(arg.slice("--until=".length));
    } else if (arg === "--json-out") {
      options.jsonOut = next();
    } else if (arg.startsWith("--json-out=")) {
      options.jsonOut = arg.slice("--json-out=".length);
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const EXPECTED_CHAPTER_IDS = [
  "3B0302DB5E77C3A2",
  "28BCA5042050B140",
  "67E7552FDA3245F5",
  "634794CB36D61302",
  "571D32BADC77CDD0",
];

// ---- observation model ---------------------------------------------------

function createLedger() {
  return {
    snapshotsReceived: 0,
    messagesReceived: 0,
    /** Resolved objective IDs ever seen during the run. */
    seenResolvedIds: new Set(),
    /** IDs that were once resolved and later disappeared (completed or unpinned). */
    disappearedIds: new Set(),
    reported: {
      ready: false,
      disconnectedAfterReady: false,
      reconnectAfterReady: false,
      pinSetChanged: false,
      progressChanged: false,
      worldChanged: false,
      teamChanged: false,
      sawNumericTask: false,
      sawAutoPin: false,
      sawPartitionViolation: false,
      sawZeroProgressChapter: false,
      sawNullProgressChapter: false,
      sawCompletedChapter: false,
      sawIntegratedServer: false,
      sawRemoteServer: false,
      addedPinAppeared: false,
    },
    firstReadyAt: null,
    lastStatus: null,
    lastChapterIds: null,
    lastPinIds: null,
    lastPinSetSize: 0,
    lastFingerprint: null,
    lastChapterProgress: null,
    lastWorldKey: null,
    lastTeamId: null,
    maxChapters: 0,
    expectedChaptersResolved: [],
    maxObjectives: 0,
    pinHistory: [],
    statusHistory: [],
    problems: [],
  };
}

function worldKeyOf(state) {
  const minecraft = state.minecraft ?? {};
  return `${minecraft.worldName ?? "null"}|${minecraft.dimension ?? "null"}`;
}

function objectivesOf(state) {
  return (state.quests ?? []).map((quest) => quest.id);
}

function chapterProgressMap(state) {
  const map = {};
  for (const chapter of state.chapters ?? []) {
    map[chapter.id] = `${chapter.progress}:${chapter.status}`;
  }
  return map;
}

/** Apply one host state and update the ledger. Returns human-readable events. */
function observe(ledger, state, context, resolvedEverSeen) {
  const events = [];
  // A repeated state (the host sends a paired section message for the same
  // change) must not re-emit anything.
  const fingerprint = JSON.stringify(state);
  if (fingerprint === ledger.lastFingerprint) {
    return events;
  }
  ledger.lastFingerprint = fingerprint;

  const connection = state.connection ?? {};
  const status = connection.status;
  if (status !== ledger.lastStatus) {
    ledger.statusHistory.push({ at: context.at, status, stale: connection.stale });
    if (status === "ready") {
      if (ledger.firstReadyAt === null) {
        ledger.firstReadyAt = context.at;
        ledger.reported.ready = true;
      } else if (ledger.reported.disconnectedAfterReady) {
        ledger.reported.reconnectAfterReady = true;
        events.push("RECONNECTED — publisher is back");
      }
      events.push(`connection -> ${status} (stale=${connection.stale})`);
    } else {
      if (status === "disconnected" && ledger.reported.ready) {
        ledger.reported.disconnectedAfterReady = true;
      }
      events.push(`connection -> ${status} (stale=${connection.stale})`);
    }
    ledger.lastStatus = status;
  }

  const chapters = state.chapters ?? [];
  const quests = state.quests ?? [];
  const unresolved = state.unresolvedPinnedQuestIds ?? [];

  if (chapters.length > 0) {
    ledger.snapshotsReceived += 1;
    ledger.maxChapters = Math.max(ledger.maxChapters, chapters.length);

    const ids = chapters.map((chapter) => chapter.id);
    if (ledger.lastChapterIds !== null && ids.join(",") !== ledger.lastChapterIds) {
      events.push(`catalog changed: ${chapters.length} chapters`);
    }
    ledger.lastChapterIds = ids.join(",");

    const resolved = EXPECTED_CHAPTER_IDS.filter((id) => ids.includes(id));
    if (resolved.length > ledger.expectedChaptersResolved.length) {
      ledger.expectedChaptersResolved = resolved;
      events.push(`expected chapters resolved: ${resolved.length}/${EXPECTED_CHAPTER_IDS.length}`);
    }

    for (const chapter of chapters) {
      if (chapter.progress === null) {
        ledger.reported.sawNullProgressChapter = true;
      }
      if (chapter.progress === 0) {
        ledger.reported.sawZeroProgressChapter = true;
      }
      if (chapter.status === "completed") {
        ledger.reported.sawCompletedChapter = true;
      }
    }

    const progress = chapterProgressMap(state);
    if (ledger.lastChapterProgress !== null) {
      const changed = Object.keys(progress).filter(
        (id) => ledger.lastChapterProgress[id] !== progress[id],
      );
      if (changed.length > 0) {
        ledger.reported.progressChanged = true;
        const sample = changed
          .slice(0, 3)
          .map((id) => `${id}: ${ledger.lastChapterProgress[id]} -> ${progress[id]}`);
        events.push(`chapter progress changed (${changed.length}): ${sample.join("; ")}`);
      }
    }
    ledger.lastChapterProgress = progress;
  }

  // Objectives. `state.snapshot` is a validated `AppState`; a partial
  // `state.update` may carry only some sections, so a check that needs two of
  // them must wait until both have arrived.
  const objectives = objectivesOf(state);
  if (
    Array.isArray(state.quests) &&
    Array.isArray(state.unresolvedPinnedQuestIds)
  ) {
    if (state.unresolvedPinnedQuestIds.includes("1")) {
      ledger.reported.sawAutoPin = true;
    }
    if (objectives.includes("1")) {
      ledger.reported.sawAutoPin = true;
    }
  }

  if (Array.isArray(state.quests) && Array.isArray(state.unresolvedPinnedQuestIds)) {
    const pinSet = new Set([...objectives, ...state.unresolvedPinnedQuestIds]);
    const resolved = new Set(objectives);
    const duplicated = objectives.filter((id, index) => objectives.indexOf(id) !== index);
    const overlap = state.unresolvedPinnedQuestIds.filter((id) => resolved.has(id));
    if (duplicated.length > 0 || overlap.length > 0) {
      ledger.reported.sawPartitionViolation = true;
      ledger.problems.push(
        `objective partition: duplicates=[${duplicated.join(", ")}] overlap=[${overlap.join(", ")}]`,
      );
    }
    ledger.lastPinSetSize = pinSet.size;
  }

  const pinKey = [...objectives, "|", ...unresolved].join(",");
  // Accumulate across the whole run rather than comparing adjacent ticks: the
  // host coalesces updates, so a pin that appears and disappears between two
  // observed states would otherwise be invisible. A live run is not a script;
  // this ledger must record everything that was ever seen.
  for (const id of objectives) {
    if (!ledger.seenResolvedIds.has(id)) {
      ledger.seenResolvedIds.add(id);
      if (ledger.reported.ready) {
        ledger.reported.addedPinAppeared = true;
      }
    }
  }
  for (const id of resolvedEverSeen) {
    if (!objectives.includes(id)) {
      ledger.disappearedIds.add(id);
    }
  }
  resolvedEverSeen.splice(0, resolvedEverSeen.length, ...objectives);
  if (ledger.lastPinIds !== null && pinKey !== ledger.lastPinIds) {
    const before = new Set(ledger.lastPinIds.split(","));
    const after = new Set(pinKey.split(","));
    const added = [...after].filter((id) => !before.has(id) && id !== "|");
    const removed = [...before].filter((id) => !after.has(id) && id !== "|");
    ledger.pinHistory.push({ at: context.at, added, removed });
    if (added.length > 0 || removed.length > 0) {
      ledger.reported.pinSetChanged = true;
      events.push(
        `pins changed: +[${added.join(", ")}] -[${removed.join(", ")}] (now ${objectives.length} objective(s))`,
      );
    }
  }
  ledger.lastPinIds = pinKey;
  ledger.maxObjectives = Math.max(ledger.maxObjectives, objectives.length);

  for (const quest of quests) {
    for (const task of quest.tasks ?? []) {
      if (task.progress.current !== undefined || task.progress.target !== undefined) {
        ledger.reported.sawNumericTask = true;
      }
    }
  }

  // A reconnect blanks identity while the new publisher's first snapshot is
  // pending. That is a lifecycle transition, not a world change, so only a
  // non-null value is compared against the last non-null one.
  const worldKey = worldKeyOf(state);
  const worldUnknown = worldKey === "null|null";
  if (!worldUnknown) {
    if (ledger.lastWorldKey !== null && worldKey !== ledger.lastWorldKey) {
      ledger.reported.worldChanged = true;
      events.push(`world changed: ${ledger.lastWorldKey} -> ${worldKey}`);
    }
    ledger.lastWorldKey = worldKey;
  }

  const teamId = state.minecraft?.teamId ?? null;
  if (teamId !== null) {
    if (ledger.lastTeamId !== null && teamId !== ledger.lastTeamId) {
      ledger.reported.teamChanged = true;
      events.push(`team changed: ${ledger.lastTeamId} -> ${teamId}`);
    }
    ledger.lastTeamId = teamId;
  }

  if (state.minecraft?.integratedServer === true) {
    ledger.reported.sawIntegratedServer = true;
  } else if (state.minecraft?.integratedServer === false) {
    ledger.reported.sawRemoteServer = true;
  }

  return events;
}

// ---- assertions ----------------------------------------------------------

const ASSERTIONS = {
  ready: (ledger) => ledger.reported.ready,
  "no-auto-pin": (ledger) => !ledger.reported.sawAutoPin,
  "objectives-partition": (ledger) => !ledger.reported.sawPartitionViolation,
  "chapter-mapping": (ledger) => ledger.expectedChaptersResolved.length === EXPECTED_CHAPTER_IDS.length,
  "numeric-task": (ledger) => ledger.reported.sawNumericTask,
  "null-or-complete": (ledger) =>
    ledger.reported.sawCompletedChapter ||
    ledger.reported.sawNullProgressChapter ||
    ledger.reported.sawZeroProgressChapter,
  "pin-change": (ledger) => ledger.reported.pinSetChanged,
  "progress-change": (ledger) => ledger.reported.progressChanged,
  reconnect: (ledger) => ledger.reported.reconnectAfterReady,
  "world-change": (ledger) => ledger.reported.worldChanged,
  "team-change": (ledger) => ledger.reported.teamChanged,
  "after-pin-addition": (ledger) => ledger.reported.addedPinAppeared,
  "after-completion": (ledger) => ledger.disappearedIds.size > 0,
  "single-player": (ledger) => ledger.reported.sawIntegratedServer,
  multiplayer: (ledger) => ledger.reported.sawRemoteServer,
};

function evaluate(ledger, expected) {
  return expected.map((name) => {
    const check = ASSERTIONS[name];
    if (check === undefined) {
      return { name, passed: false, error: `unknown check (known: ${Object.keys(ASSERTIONS).join(", ")})` };
    }
    return { name, passed: Boolean(check(ledger)) };
  });
}

// ---- connection ----------------------------------------------------------

function describeFailure(ledger) {
  const out = [];
  out.push(`status history: ${ledger.statusHistory.map((e) => e.status).join(" -> ") || "(none)"}`);
  if (ledger.problems.length > 0) {
    out.push(...ledger.problems.map((problem) => `problem: ${problem}`));
  }
  return out;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  let session;
  if (options.session !== undefined) {
    try {
      session = JSON.parse(readFileSync(join(options.session, "session.json"), "utf8"));
    } catch (error) {
      throw new Error(`could not read session.json from ${options.session}: ${error.message}`);
    }
  }

  const url = options.url ?? session?.wsUrl;
  const token = options.token ?? session?.browserToken;
  if (url === undefined || token === undefined) {
    throw new Error("need --url and --token, or --session <dir containing session.json>");
  }

  const ledger = createLedger();
  const socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`, {
    headers: { origin: new URL(url).origin.replace(/^ws/, "http") },
  });

  const startedAt = new Date().toISOString();
  process.stdout.write(`[watch] observing ${url}\n`);
  process.stdout.write(`[watch] checks: ${options.expect.length > 0 ? options.expect.join(", ") : "(none — observe only)"}\n`);

  // A live session can run for a long time and may end by a hard kill that no
  // signal handler sees. Checkpoint the report on every change so the ledger
  // survives however the process ends, not only on a clean finish.
  const buildReport = (finishedAt) => {
    const checks = evaluate(ledger, options.expect);
    return {
      tool: "phase5-watch",
      startedAt,
      finishedAt,
      assertions: checks,
      observations: ledger.reported,
      maxChapters: ledger.maxChapters,
      maxObjectives: ledger.maxObjectives,
      expectedChaptersResolved: ledger.expectedChaptersResolved,
      objectivesThatDisappeared: [...ledger.disappearedIds],
      objectivesEverSeen: [...ledger.seenResolvedIds],
      statusHistory: ledger.statusHistory,
      pinHistory: ledger.pinHistory,
      problems: ledger.problems,
    };
  };

  const checkpoint = () => {
    if (options.jsonOut === undefined) {
      return;
    }
    try {
      writeFileSync(options.jsonOut, `${JSON.stringify(buildReport(null), null, 2)}\n`, "utf8");
    } catch {
      // A checkpoint failure must never stop observation.
    }
  };

  let finished = false;
  const finish = () => {
    if (finished) {
      return;
    }
    finished = true;
    const checks = evaluate(ledger, options.expect);
    const failed = checks.filter((check) => check.passed === false);
    const report = buildReport(new Date().toISOString());

    if (options.jsonOut !== undefined) {
      writeFileSync(options.jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    const line = "─".repeat(72);
    process.stdout.write(`\n${line}\n`);
    process.stdout.write(`chapters seen (max):   ${ledger.maxChapters}\n`);
    process.stdout.write(`objectives seen (max): ${ledger.maxObjectives}\n`);
    if (checks.length === 0) {
      process.stdout.write("no assertions requested\n");
    } else {
      for (const check of checks) {
        process.stdout.write(`  ${check.passed ? "PASS" : "FAIL"}  ${check.name}\n`);
      }
    }
    if (ledger.problems.length > 0) {
      process.stdout.write(`\nproblems:\n${ledger.problems.map((p) => `  - ${p}`).join("\n")}\n`);
    }
    process.stdout.write(`${line}\n`);
    process.stdout.write(`${failed.length === 0 ? "ALL REQUESTED CHECKS PASSED" : `${failed.length} CHECK(S) FAILED`}\n`);
    if (failed.length > 0) {
      process.stdout.write(`${describeFailure(ledger).join("\n")}\n`);
    }

    process.exitCode = failed.length === 0 ? 0 : 1;
    socket.close();
  };

  const state = { revision: -1, data: {} };
  /** Objectives resolved on the previous observation, for disappearance tracking. */
  const resolvedEverSeen = [];

  socket.on("open", () => {
    process.stdout.write("[watch] connected\n");
    socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: "browser.hello",
        timestamp: new Date().toISOString(),
        payload: { role: "control", clientName: "phase5-watch" },
      }),
    );
  });

  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    ledger.messagesReceived += 1;
    const at = new Date().toISOString();

    // The client applies revisions idempotently; the observer must too, or a
    // paired section message would look like a second change.
    if (message.type === "state.snapshot") {
      if (message.payload.revision < state.revision) {
        return;
      }
      state.revision = message.payload.revision;
      state.data = message.payload;
      for (const event of observe(ledger, state.data, { at }, resolvedEverSeen)) {
        process.stdout.write(`[${at}] ${event}\n`);
      }
      checkpoint();
      return;
    }

    if (message.type === "state.update" || message.type === "chapter.pins.update" ||
        message.type === "config.update" || message.type === "connection.status") {
      const revision = message.payload.revision;
      if (revision !== undefined && revision < state.revision) {
        return;
      }
      if (message.type === "state.update") {
        if (revision !== undefined) {
          state.revision = revision;
        }
        state.data = { ...state.data, ...message.payload };
      } else if (message.type === "chapter.pins.update") {
        state.data = { ...state.data, chapterPins: message.payload.chapterPins };
      } else if (message.type === "config.update") {
        state.data = { ...state.data, display: message.payload.display };
      } else {
        state.data = { ...state.data, connection: message.payload };
      }
      for (const event of observe(ledger, state.data, { at }, resolvedEverSeen)) {
        process.stdout.write(`[${at}] ${event}\n`);
      }
      checkpoint();
    }
  });

  socket.on("error", (error) => {
    process.stderr.write(`[watch] socket error: ${error.message}\n`);
    finish();
    process.exitCode = 2;
  });

  socket.on("close", () => {
    if (!finished) {
      process.stdout.write("[watch] host closed the connection\n");
      finish();
    }
  });

  if (options.until !== undefined && Number.isFinite(options.until) && options.until > 0) {
    setTimeout(finish, options.until * 1000);
  }

  process.once("SIGINT", () => {
    process.stdout.write("\n[watch] interrupted; reporting\n");
    finish();
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(`watch failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}

export { PHASE5_CHECKS };
