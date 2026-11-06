import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { CONFIG_DIR_ENV, resolveConfigPaths } from "./paths.js";
import { DEFAULT_PORT, HEALTH_PATH } from "./constants.js";
import { createLogger } from "./logging.js";
import { startHost, type HostHandle } from "./server.js";

/**
 * Host CLI entry point.
 *
 * Phase 2A: start the loopback listener, report `/health`, and shut down
 * cleanly on a signal. Configuration, WebSocket roles, and authentication are
 * added in later milestones.
 */

const USAGE = `QuestBridge host

Usage:
  questbridge-host [options]

Options:
  --port <number>        Loopback port (default: ${DEFAULT_PORT}; 0 chooses a free port)
  --config-dir <path>    Configuration directory (overrides ${CONFIG_DIR_ENV})
  --help                 Show this help

The host binds 127.0.0.1 only and never 0.0.0.0.
`;

export interface CliOptions {
  port: number;
  configDir: string | undefined;
}

export interface ParsedCli {
  kind: "run";
  options: CliOptions;
}

export interface ParsedCliHelp {
  kind: "help";
  text: string;
}

export type CliParseResult = ParsedCli | ParsedCliHelp;

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
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help === true) {
    return { kind: "help", text: USAGE };
  }

  return {
    kind: "run",
    options: {
      port: parsePort(values.port),
      configDir: values["config-dir"],
    },
  };
}

/**
 * Start the host and resolve once it is listening.
 *
 * Shared by the CLI and integration tests so both exercise the same path.
 */
export async function run(options: CliOptions): Promise<HostHandle> {
  const logger = createLogger();

  const paths = resolveConfigPaths(
    options.configDir === undefined
      ? {}
      : { env: { ...process.env, [CONFIG_DIR_ENV]: options.configDir } },
  );

  logger.info(`config directory: ${paths.directory} (${paths.source})`);

  const host = await startHost({ port: options.port, logger });

  logger.info(`QuestBridge host ${host.version} listening on ${host.url}`);
  logger.info(`health: ${host.url}${HEALTH_PATH}`);

  return host;
}

/** Install SIGINT/SIGTERM handlers that close the host once. */
export function installSignalHandlers(host: HostHandle): void {
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
