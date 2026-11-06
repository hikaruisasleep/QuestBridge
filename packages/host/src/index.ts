import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { CONFIG_DIR_ENV, resolveConfigPaths } from "./paths.js";
import { DEFAULT_PORT, HEALTH_PATH } from "./constants.js";
import { createLogger } from "./logging.js";
import { TokenStore, formatAccessUrls } from "./auth.js";
import { createHost, type Host } from "./host.js";

/**
 * Host CLI entry point.
 *
 * Milestone 2A added the process shell; 2D adds token generation and
 * `--print-urls`. WebSocket roles follow in 2E and 2F.
 */

const USAGE = `QuestBridge host

Usage:
  questbridge-host [options]

Options:
  --port <number>        Loopback port (default: ${DEFAULT_PORT}; 0 chooses a free port)
  --config-dir <path>    Configuration directory (overrides ${CONFIG_DIR_ENV})
  --print-urls           Print the overlay and dashboard access URLs, then exit
  --help                 Show this help

The host binds 127.0.0.1 only and never 0.0.0.0.
`;

export interface CliOptions {
  port: number;
  configDir: string | undefined;
}

export interface ParsedCliRun {
  kind: "run";
  options: CliOptions;
}

export interface ParsedCliHelp {
  kind: "help";
  text: string;
}

export interface ParsedCliPrintUrls {
  kind: "print-urls";
  configDir: string | undefined;
  port: number;
}

export type CliParseResult = ParsedCliRun | ParsedCliHelp | ParsedCliPrintUrls;

function parsePort(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_PORT;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error(`--port must be an integer between 0 and 65535, received ${raw}`);
  }
  return value;
}

/**
 * Parse CLI arguments.
 *
 * Returns a discriminated result instead of exiting, so tests can assert on
 * `--help` without terminating the test process.
 *
 * @throws when an argument is unknown or malformed.
 */
export function parseCliOptions(argv: string[]): CliParseResult {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      "config-dir": { type: "string" },
      "print-urls": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help === true) {
    return { kind: "help", text: USAGE };
  }

  const configDir = values["config-dir"];
  const port = parsePort(values.port);

  if (values["print-urls"] === true) {
    return { kind: "print-urls", configDir, port };
  }

  return { kind: "run", options: { port, configDir } };
}

/** Resolve the configuration directory, honouring the CLI override. */
function pathsFor(configDir: string | undefined): ReturnType<typeof resolveConfigPaths> {
  return resolveConfigPaths(
    configDir === undefined
      ? {}
      : { env: { ...process.env, [CONFIG_DIR_ENV]: configDir } },
  );
}

/**
 * Print the access URLs to stdout only.
 *
 * Never written to a log file: the tokenized URL is a credential
 * (`docs/local-authentication.md` §2.1).
 *
 * Logging is limited to warnings and errors so the output stays pipeable. A
 * recovery warning still surfaces, because a user whose tokens were just
 * regenerated must be told that previously issued URLs no longer work.
 */
export async function printUrls(configDir: string | undefined, port: number): Promise<void> {
  const paths = pathsFor(configDir);
  const logger = createLogger({ minLevel: "warn" });
  const tokens = await TokenStore.load({ filePath: paths.tokensFile, logger });
  const baseUrl = `http://127.0.0.1:${port}`;
  process.stdout.write(`${formatAccessUrls(baseUrl, tokens.tokens)}\n`);
}

/**
 * Start the host and resolve once it is listening.
 *
 * Shared by the CLI and integration tests so both exercise the same path.
 * This must go through `createHost`, which attaches the WebSocket transport
 * before the listener binds; starting the bare HTTP listener would leave every
 * `/ws` upgrade unanswered.
 */
export async function run(options: CliOptions): Promise<Host> {
  const logger = createLogger();
  const paths = pathsFor(options.configDir);

  logger.info(`config directory: ${paths.directory} (${paths.source})`);

  const host = await createHost({
    paths,
    port: options.port,
    logger,
  });

  logger.info(`QuestBridge host ${host.version} listening on ${host.url}`);
  logger.info(`health: ${host.url}${HEALTH_PATH}`);
  logger.info("run with --print-urls to display the overlay and dashboard URLs");

  return host;
}

/** Install SIGINT/SIGTERM handlers that close the host once. */
export function installSignalHandlers(host: Host): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    host.logger.info(`stopping host (${signal})`);
    host
      .close()
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`host shutdown failed: ${message}\n`);
        process.exitCode = 1;
      });
  };

  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

export async function main(argv: string[]): Promise<void> {
  const parsed = parseCliOptions(argv);

  if (parsed.kind === "help") {
    process.stdout.write(parsed.text);
    return;
  }

  if (parsed.kind === "print-urls") {
    await printUrls(parsed.configDir, parsed.port);
    return;
  }

  const host = await run(parsed.options);
  installSignalHandlers(host);
}

const invokedPath = process.argv[1];
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;

if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`host failed: ${message}\n`);
    process.exitCode = 1;
  });
}
