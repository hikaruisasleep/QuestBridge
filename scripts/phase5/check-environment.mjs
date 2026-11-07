/**
 * Read-only readiness check for a Phase 5 live run.
 *
 * Phase 5 verification is done collaboratively: the agent runs this and the
 * other `scripts/phase5/*` tools, and the user drives Minecraft. This script
 * answers one question before anything is launched — is this machine actually
 * ready — and it never changes anything it inspects.
 *
 * It checks, in dependency order:
 *
 *   1. Toolchain      Node matches `.nvmrc`
 *   2. Workspace      host, mock-publisher, protocol and frontend builds exist
 *   3. Host config    tokens.json is readable (the adapter needs minecraftToken)
 *   4. Prism instance the mod jar version and the client config file
 *   5. Saved world    the previous session's FTB team data, used as a baseline
 *
 * Usage:
 *   node scripts/phase5/check-environment.mjs [options]
 *
 * Options:
 *   --instance <path>       Prism instance directory
 *                           (default: $QUESTBRIDGE_AT10_INSTANCE)
 *   --config-dir <path>     Host config directory (overrides QUESTBRIDGE_CONFIG_DIR)
 *   --json                  Machine-readable output
 *   --json-out <path>       Machine-readable output written to a file
 *
 * Exit codes:
 *   0  ready
 *   1  ready, but with warnings a phase-5 run should note
 *   2  not ready: something must be fixed first
 *
 * Written for Phase 5 (`docs/phase-5-plan.md` §5). It reads files and runs no
 * Minecraft code, so a pass says nothing about FTB compatibility — only that the
 * pieces a live run needs are present and agree with each other.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The version the adapter currently builds as. Phase 5 does not bump it. */
const EXPECTED_MOD_VERSION = "0pre.2";

/** Pack facts verified in `docs/ftb-quests-integration.md` §2. */
const EXPECTED_CHAPTER_IDS = [
  "3B0302DB5E77C3A2",
  "28BCA5042050B140",
  "67E7552FDA3245F5",
  "634794CB36D61302",
  "571D32BADC77CDD0",
];

const results = [];

function record(level, area, message, hint) {
  results.push({ level, area, message, ...(hint === undefined ? {} : { hint }) });
}

const ok = (area, message) => record("ok", area, message);
const warn = (area, message, hint) => record("warn", area, message, hint);
const fail = (area, message, hint) => record("fail", area, message, hint);

function parseArgs(argv) {
  const options = { instance: process.env["QUESTBRIDGE_AT10_INSTANCE"], configDir: undefined, json: false, jsonOut: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--instance") {
      options.instance = argv[++index];
    } else if (arg.startsWith("--instance=")) {
      options.instance = arg.slice("--instance=".length);
    } else if (arg === "--config-dir") {
      options.configDir = argv[++index];
    } else if (arg.startsWith("--config-dir=")) {
      options.configDir = arg.slice("--config-dir=".length);
    } else if (arg === "--json-out") {
      options.jsonOut = argv[++index];
    } else if (arg.startsWith("--json-out=")) {
      options.jsonOut = arg.slice("--json-out=".length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

// ---- 1. Toolchain --------------------------------------------------------

function checkToolchain() {
  const area = "toolchain";
  let required;
  try {
    required = readFileSync(join(REPO_ROOT, ".nvmrc"), "utf8").trim();
  } catch {
    warn(area, ".nvmrc is missing; cannot confirm the pinned Node version");
    required = undefined;
  }

  const running = process.versions.node;
  if (required === undefined) {
    // Already reported.
  } else if (running === required) {
    ok(area, `Node ${running} matches .nvmrc`);
  } else {
    fail(
      area,
      `Node ${running} does not match the pinned ${required}`,
      "Prepend the fnm install of the pinned version to Path (AGENTS.md §3). Do not install another Node.",
    );
  }

  if (process.platform === "win32") {
    const fnmRoot = join(process.env["APPDATA"] ?? "", "fnm", "node-versions");
    if (required !== undefined && existsSync(fnmRoot)) {
      const installed = readdirSync(fnmRoot).map((name) => name.replace(/^v/, ""));
      if (installed.includes(required)) {
        ok(area, `fnm has v${required} installed`);
      } else {
        fail(area, `fnm does not have v${required} installed (has: ${installed.join(", ") || "none"})`, "The pinned version is a hard requirement (AGENTS.md §3).");
      }
    }
  }
}

// ---- 2. Workspace builds --------------------------------------------------

function checkBuilds() {
  const area = "builds";
  const artifacts = [
    ["host", join(REPO_ROOT, "packages", "host", "dist", "index.js"), "npm run build -w @questbridge/host"],
    ["mock-publisher", join(REPO_ROOT, "packages", "mock-publisher", "dist", "index.js"), "npm run build -w @questbridge/mock-publisher"],
    ["protocol", join(REPO_ROOT, "packages", "protocol", "dist", "index.js"), "npm run build -w @questbridge/protocol"],
    ["web-app", join(REPO_ROOT, "apps", "web-app", "build", "index.html"), "npm run build -w web-app"],
  ];

  for (const [name, path, command] of artifacts) {
    if (existsSync(path)) {
      ok(area, `${name} build present`);
    } else {
      fail(area, `${name} build missing`, `Run: ${command}`);
    }
  }

  const jar = join(REPO_ROOT, "minecraft-mod", "build", "libs", `questbridge-${EXPECTED_MOD_VERSION}.jar`);
  if (existsSync(jar)) {
    ok(area, `mod jar questbridge-${EXPECTED_MOD_VERSION}.jar is built`);
  } else {
    warn(area, `mod jar questbridge-${EXPECTED_MOD_VERSION}.jar is not built`, "Run: cd minecraft-mod; ./gradlew build");
  }
}

// ---- 3. Host configuration ------------------------------------------------

function resolveHostConfigDir(explicit) {
  if (explicit !== undefined && explicit.trim() !== "") {
    return { directory: resolve(explicit.trim()), source: "--config-dir" };
  }
  const fromEnv = process.env["QUESTBRIDGE_CONFIG_DIR"];
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return { directory: resolve(fromEnv.trim()), source: "QUESTBRIDGE_CONFIG_DIR" };
  }
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"];
    if (appData !== undefined && appData.trim() !== "") {
      return { directory: join(appData.trim(), "QuestBridge"), source: "APPDATA" };
    }
    return { directory: join(homedir(), "AppData", "Roaming", "QuestBridge"), source: "home" };
  }
  if (process.platform === "darwin") {
    return { directory: join(homedir(), "Library", "Application Support", "QuestBridge"), source: "macOS" };
  }
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg !== undefined && xdg.trim() !== "") {
    return { directory: join(xdg.trim(), "questbridge"), source: "XDG" };
  }
  return { directory: join(homedir(), ".config", "questbridge"), source: "home" };
}

function checkHostConfig(configDirOption) {
  const area = "host-config";
  const { directory, source } = resolveHostConfigDir(configDirOption);
  const tokensPath = join(directory, "tokens.json");
  const configPath = join(directory, "config.json");

  if (!existsSync(tokensPath)) {
    warn(area, `no tokens.json at ${tokensPath}`, "Start the host once; it generates tokens on first run.");
    return { directory, minecraftToken: undefined, browserToken: undefined };
  }

  const tokens = safeReadJson(tokensPath);
  if (
    tokens === undefined ||
    typeof tokens.browserToken !== "string" ||
    typeof tokens.minecraftToken !== "string"
  ) {
    fail(area, `tokens.json at ${tokensPath} is unreadable or malformed`, "The host regenerates a corrupt token file on start; start it once.");
    return { directory, minecraftToken: undefined, browserToken: undefined };
  }

  ok(area, `tokens.json readable (${source}: ${directory})`);
  ok(area, `minecraftToken present (${tokens.minecraftToken.length} chars, value not printed)`);

  const config = safeReadJson(configPath);
  if (config === undefined) {
    warn(area, `no readable config.json at ${configPath}`, "Chapter pins are unset until the dashboard saves some.");
  } else {
    const pins = Array.isArray(config.chapterPins?.pinnedChapters) ? config.chapterPins.pinnedChapters : [];
    if (pins.length === 0) {
      warn(area, "no chapter pins configured", "Phase 5's overlay checks need up to five pins set in /control.");
    } else {
      ok(area, `${pins.length} chapter pin(s) configured`);
    }
  }

  return { directory, minecraftToken: tokens.minecraftToken, browserToken: tokens.browserToken };
}

// ---- 4. Prism instance ----------------------------------------------------

function checkInstance(instanceOption, hostConfig) {
  const area = "prism-instance";
  if (instanceOption === undefined || instanceOption.trim() === "") {
    warn(
      area,
      "no Prism instance given",
      "Pass --instance \"<path to instance>\" or set QUESTBRIDGE_AT10_INSTANCE.",
    );
    return { modsDir: undefined, minecraftDir: undefined };
  }

  const instanceDir = resolve(instanceOption.trim());
  const minecraftDir = join(instanceDir, "minecraft");
  const modsDir = join(minecraftDir, "mods");

  if (!existsSync(modsDir)) {
    fail(area, `no mods directory at ${modsDir}`, "Check the instance path; it must be the Prism instance directory, not its minecraft/ subdirectory.");
    return { modsDir: undefined, minecraftDir };
  }
  ok(area, `instance found: ${instanceDir}`);

  const jars = readdirSync(modsDir).filter((name) => /^questbridge-.*\.jar(\.disabled)?$/.test(name));
  if (jars.length === 0) {
    fail(area, "no questbridge jar in the instance mods directory", `Copy minecraft-mod/build/libs/questbridge-${EXPECTED_MOD_VERSION}.jar into ${modsDir}`);
  } else {
    const active = jars.filter((name) => name.endsWith(".jar"));
    if (active.length === 0) {
      fail(area, `every QuestBridge jar is disabled (${jars.join(", ")})`, "Rename the jar to end in .jar.");
    } else if (active.length > 1) {
      fail(area, `more than one QuestBridge jar is loadable: ${active.join(", ")}`, "Two copies of the same mod stop the client from loading. Keep one.");
    } else {
      const jar = active[0];
      const version = /^questbridge-(.+)\.jar$/.exec(jar)?.[1];
      if (version === EXPECTED_MOD_VERSION) {
        ok(area, `installed jar is ${jar}`);
      } else {
        warn(
          area,
          `installed jar is ${jar}, expected questbridge-${EXPECTED_MOD_VERSION}.jar`,
          "A stale jar publishes nothing useful. Phase 5 tests the currently built adapter.",
        );
      }
      if (jars.some((name) => name.endsWith(".jar.disabled") || name.endsWith(".bak"))) {
        warn(area, `disabled/backup jars also present: ${jars.filter((name) => !name.endsWith(".jar")).join(", ")}`, "Harmless, but confirm the active jar is the one being tested.");
      }
    }
  }

  const clientConfig = join(minecraftDir, "config", "questbridge-client.toml");
  if (!existsSync(clientConfig)) {
    fail(
      area,
      `no client config at ${clientConfig}`,
      "Create it and set minecraftToken (docs/phase-5-verification-guide.md §3). Without it the adapter logs once and stays idle.",
    );
  } else {
    const text = readFileSync(clientConfig, "utf8");
    const match = /^\s*minecraftToken\s*=\s*"([^"]*)"/m.exec(text);
    if (match === null || match[1].trim() === "") {
      fail(area, "client config has an empty minecraftToken", "Paste the host's minecraftToken into the client config.");
    } else if (hostConfig.minecraftToken !== undefined && match[1] !== hostConfig.minecraftToken) {
      fail(area, "client minecraftToken does not match the host's tokens.json", "The host will refuse the publisher with HTTP 401.");
    } else {
      ok(area, "client minecraftToken matches the host");
    }

    const url = /^\s*hostUrl\s*=\s*"([^"]*)"/m.exec(text)?.[1];
    if (url !== undefined && url !== "ws://127.0.0.1:8765/ws") {
      warn(area, `client hostUrl is ${url}, not the default`, "Start the host on the same port, or pass --port to the session script.");
    }

    const enabled = /^\s*enabled\s*=\s*(\w+)/m.exec(text)?.[1];
    if (enabled === "false") {
      fail(area, "client config has enabled = false", "Publishing is off; the in-game probe still runs but nothing reaches the host.");
    }
  }

  return { modsDir, minecraftDir };
}

// ---- 5. Saved world baseline ---------------------------------------------

function checkWorlds(minecraftDir) {
  const area = "saved-world";
  if (minecraftDir === undefined) {
    return;
  }
  const savesDir = join(minecraftDir, "saves");
  if (!existsSync(savesDir)) {
    warn(area, "no saves directory", "Create or select a world in the client.");
    return;
  }

  const worlds = readdirSync(savesDir).filter((name) => existsSync(join(savesDir, name, "level.dat")));
  if (worlds.length === 0) {
    warn(area, "no saved worlds", "Create or select a world in the client.");
    return;
  }
  ok(area, `worlds available: ${worlds.join(", ")}`);

  // The freshest team data is the best predictor of what a run should see, and
  // serves as the baseline the run's snapshot is compared against.
  let newest;
  for (const world of worlds) {
    const questDir = join(savesDir, world, "ftbquests");
    if (!existsSync(questDir)) {
      continue;
    }
    for (const file of readdirSync(questDir)) {
      if (!file.endsWith(".snbt")) {
        continue;
      }
      const path = join(questDir, file);
      const mtime = statSync(path).mtimeMs;
      if (newest === undefined || mtime > newest.mtime) {
        newest = { world, teamFile: file, path, mtime };
      }
    }
  }

  if (newest === undefined) {
    warn(area, "no FTB team data saved in any world", "Progression will start from zero in a new world.");
    return;
  }

  const text = readFileSync(newest.path, "utf8");
  const pinned = /pinned_quests:\s*\[([^\]]*)\]/.exec(text)?.[1]
    ?.split(",")
    .map((id) => id.trim().replace(/"/g, ""))
    .filter((id) => id !== "") ?? [];
  const completed = countMapEntries(text, "completed");

  ok(area, `baseline from "${newest.world}": ${completed} completed object(s), ${pinned.length} manual pin(s)`);
  if (pinned.includes("1")) {
    warn(area, "the saved pin set contains the automatic pin ID 1", "The adapter must filter it; this is a useful baseline case, not an error.");
  }
  return { world: newest.world, completedObjects: completed, pinnedQuestIds: pinned };
}

function countMapEntries(text, key) {
  const start = text.indexOf(`\n\t${key}: {`);
  if (start === -1) {
    return 0;
  }
  const end = text.indexOf("\n\t}", start);
  if (end === -1) {
    return 0;
  }
  return text.slice(start, end).split("\n").filter((line) => /^\t\t\S+:\s*\d+L/.test(line)).length;
}

// ---- main ----------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv.slice(2));

  checkToolchain();
  checkBuilds();
  const hostConfig = checkHostConfig(options.configDir);
  const instance = checkInstance(options.instance, hostConfig);
  const world = checkWorlds(instance.minecraftDir);

  const failures = results.filter((entry) => entry.level === "fail").length;
  const warnings = results.filter((entry) => entry.level === "warn").length;
  const conclusions = { ready: failures === 0, failures, warnings };
  const report = {
    tool: "phase5-check-environment",
    generatedAt: new Date().toISOString(),
    expectedModVersion: EXPECTED_MOD_VERSION,
    expectedChapterIds: EXPECTED_CHAPTER_IDS,
    hostConfigDir: hostConfig.directory,
    ...(instance.minecraftDir === undefined ? {} : { minecraftDir: instance.minecraftDir }),
    ...(world === undefined ? {} : { baselineWorld: world }),
    conditions: results,
    conclusions,
  };

  if (options.jsonOut !== undefined) {
    writeFileSync(options.jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const marker = { ok: "ok  ", warn: "WARN", fail: "FAIL" };
    let currentArea = "";
    for (const entry of results) {
      if (entry.area !== currentArea) {
        currentArea = entry.area;
        process.stdout.write(`\n[${currentArea}]\n`);
      }
      process.stdout.write(`  ${marker[entry.level]}  ${entry.message}\n`);
      if (entry.hint !== undefined) {
        process.stdout.write(`        -> ${entry.hint}\n`);
      }
    }
    process.stdout.write(
      `\n${conclusions.ready ? "READY" : "NOT READY"} — ${failures} failure(s), ${warnings} warning(s)\n`,
    );
  }

  process.exitCode = failures > 0 ? 2 : warnings > 0 ? 1 : 0;
}

try {
  main();
} catch (error) {
  process.stderr.write(`check-environment failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
