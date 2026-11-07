/**
 * Starts a QuestBridge host for a Phase 5 live session and prints what the user
 * needs to open.
 *
 * The host itself is the product — this script is a thin, opinionated wrapper so
 * a collaborative run has one predictable starting point. It:
 *
 *   - builds nothing and changes no source file;
 *   - starts the real host with the built frontend (`--build-dir`), so the
 *     overlay and dashboard are the production routes;
 *   - reads the tokens with the host's own loader, so a corrupt `tokens.json` is
 *     recovered exactly as a normal host start would recover it;
 *   - prints the overlay and dashboard URLs, because OBS and the browser need the
 *     tokenized URL and the host only prints it on `--print-urls`;
 *   - writes a small session file the other phase-5 scripts read, so the agent
 *     never has to ask the user to copy a token.
 *
 * The token is written to the session file with owner-only permissions and is
 * never logged. Printing it to stdout is the same disclosure `--print-urls`
 * already makes, and is required for the user to open the routes.
 *
 * Usage:
 *   node scripts/phase5/start-session.mjs [options]
 *
 * Options:
 *   --port <n>            Loopback port (default 8765)
 *   --config-dir <path>   Host config directory
 *   --artifacts <dir>     Where logs and the session file go
 *                         (default: .questbridge/phase5/<timestamp>)
 *   --no-frontend         Start without --build-dir (placeholder routes)
 *
 * Press Ctrl+C to stop the host cleanly.
 */
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_DIR_ENV, resolveConfigPaths } from "../../packages/host/dist/paths.js";
import { TokenStore, formatAccessUrls } from "../../packages/host/dist/auth.js";
import { createHost } from "../../packages/host/dist/host.js";
import { createLogger } from "../../packages/host/dist/logging.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_PORT = 8765;

function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, configDir: undefined, artifacts: undefined, frontend: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) {
        throw new Error(`${arg} needs a value`);
      }
      return value;
    };
    if (arg === "--port") {
      options.port = Number(next());
    } else if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
    } else if (arg === "--config-dir") {
      options.configDir = next();
    } else if (arg.startsWith("--config-dir=")) {
      options.configDir = arg.slice("--config-dir=".length);
    } else if (arg === "--artifacts") {
      options.artifacts = next();
    } else if (arg.startsWith("--artifacts=")) {
      options.artifacts = arg.slice("--artifacts=".length);
    } else if (arg === "--no-frontend") {
      options.frontend = false;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  return options;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const buildDir = join(REPO_ROOT, "apps", "web-app", "build");
  if (options.frontend && !existsSync(join(buildDir, "index.html"))) {
    process.stderr.write(
      `no frontend build at ${buildDir}\nRun: npm run build -w web-app\n` +
        "Or pass --no-frontend to start with the placeholder routes.\n",
    );
    process.exitCode = 2;
    return;
  }

  const artifactsDir = resolve(
    options.artifacts ?? join(REPO_ROOT, ".questbridge", "phase5", timestamp()),
  );
  mkdirSync(artifactsDir, { recursive: true });

  const paths = resolveConfigPaths(
    options.configDir === undefined
      ? {}
      : { env: { ...process.env, [CONFIG_DIR_ENV]: options.configDir } },
  );

  const logFile = join(artifactsDir, "host.log");
  const logStream = createWriteStream(logFile, { flags: "a" });

  // The host's own logger already redacts credentials from every line. Point its
  // single formatted output at both sinks so the user watching the terminal and
  // the agent reading the file see byte-identical, redacted lines. Wrapping the
  // logger instead would bypass `redactSecrets`; do not do that.
  const logger = createLogger({
    write: (line) => {
      process.stdout.write(`${line}\n`);
      logStream.write(`${line}\n`);
    },
  });

  const tokens = await TokenStore.load({ filePath: paths.tokensFile, logger });
  const baseUrl = `http://127.0.0.1:${options.port}`;

  let host;
  try {
    host = await createHost({
      paths,
      port: options.port,
      logger,
      ...(options.frontend ? { buildDir } : {}),
    });
  } catch (error) {
    process.stderr.write(
      `host failed to start: ${error instanceof Error ? error.message : String(error)}\n` +
        "If this is EADDRINUSE, something else owns the port; stop it or pass --port.\n",
    );
    process.exitCode = 2;
    return;
  }

  const session = {
    tool: "phase5-start-session",
    startedAt: new Date().toISOString(),
    baseUrl,
    wsUrl: `ws://127.0.0.1:${host.port}/ws`,
    port: host.port,
    configDir: paths.directory,
    artifactsDir,
    hostLog: logFile,
    frontend: options.frontend,
    browserToken: tokens.tokens.browserToken,
    minecraftToken: tokens.tokens.minecraftToken,
  };
  const sessionFile = join(artifactsDir, "session.json");
  writeFileSync(sessionFile, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });

  // ---- the operator's briefing -------------------------------------------
  const line = "─".repeat(72);
  process.stdout.write(`\n${line}\nQuestBridge host is running\n${line}\n\n`);
  process.stdout.write(`${formatAccessUrls(baseUrl, tokens.tokens)}\n\n`);
  process.stdout.write(`Minecraft publisher endpoint: ${session.wsUrl}\n`);
  process.stdout.write(`Config directory:            ${paths.directory}\n`);
  process.stdout.write(`Session file:                ${sessionFile}\n`);
  process.stdout.write(`Host log:                    ${logFile}\n\n`);
  process.stdout.write(
    "Next: open the Dashboard URL, pin up to five chapters, then launch the client.\n" +
      "The agent can watch this run; nothing else needs to be started.\n\n",
  );
  process.stdout.write(`Press Ctrl+C to stop.\n${line}\n\n`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write(`\nstopping host (${signal})\n`);
    try {
      await host.close();
      logStream.end();
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(`shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  process.stderr.write(`start-session failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
