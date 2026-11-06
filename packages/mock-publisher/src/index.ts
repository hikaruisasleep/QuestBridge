import process from "node:process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import type { ProtocolMessage } from "@questbridge/protocol";

import { abortError, playOverWebSocket } from "./client.js";
import { SCENARIO_NAMES, buildScenario, isScenarioName } from "./scenarios.js";

const DEFAULT_URL = "ws://127.0.0.1:8765/ws";

const USAGE = `QuestBridge mock publisher

Usage:
  node dist/index.js --scenario <name> [options]

Options:
  --scenario <name>   Scenario to play (required)
  --url <ws-url>      Host WebSocket URL (default: ${DEFAULT_URL})
  --speed <factor>    Playback speed multiplier (default: 1)
  --token <value>     Minecraft bearer token for an authenticated host
  --list              List available scenarios
  --help              Show this help

The token may also be supplied through the QUESTBRIDGE_MINECRAFT_TOKEN
environment variable. Without a token the mock connects unauthenticated, which
is what the standalone collector expects.

Scenarios:
  ${SCENARIO_NAMES.join(", ")}
`;

function assertLoopbackUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid WebSocket URL: ${rawUrl}`);
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`WebSocket URL must use ws: or wss:, received ${url.protocol}`);
  }

  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (!loopbackHosts.has(url.hostname)) {
    throw new Error(
      `The mock publisher only connects to loopback hosts; received ${url.hostname}`,
    );
  }

  return url;
}

function parseSpeed(raw: string | undefined): number {
  if (raw === undefined) {
    return 1;
  }
  const speed = Number(raw);
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`--speed must be a finite positive number, received ${raw}`);
  }
  return speed;
}

function logMessage(message: ProtocolMessage): void {
  const sequence = message.sequence === undefined ? "-" : String(message.sequence);
  process.stdout.write(`-> ${message.type} #${sequence}\n`);
}

export async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      scenario: { type: "string" },
      url: { type: "string" },
      speed: { type: "string" },
      token: { type: "string" },
      list: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help === true) {
    process.stdout.write(USAGE);
    return;
  }

  if (values.list === true) {
    process.stdout.write(`${SCENARIO_NAMES.join("\n")}\n`);
    return;
  }

  const scenarioName = values.scenario;
  if (scenarioName === undefined) {
    throw new Error("--scenario is required. Use --list to see available scenarios.");
  }
  if (!isScenarioName(scenarioName)) {
    throw new Error(
      `Unknown scenario "${scenarioName}". Available scenarios: ${SCENARIO_NAMES.join(", ")}`,
    );
  }

  const url = assertLoopbackUrl(values.url ?? DEFAULT_URL);
  const speed = parseSpeed(values.speed);
  const scenario = buildScenario(scenarioName);
  const token = values.token ?? process.env["QUESTBRIDGE_MINECRAFT_TOKEN"];

  const controller = new AbortController();
  const onSigint = (): void => {
    process.stderr.write("\nStopping mock publisher...\n");
    controller.abort();
  };
  process.once("SIGINT", onSigint);

  process.stdout.write(
    `QuestBridge mock publisher: scenario=${scenarioName} url=${url.toString()} speed=${speed}` +
      `${token === undefined ? "" : " auth=bearer"}\n`,
  );

  try {
    await playOverWebSocket(scenario, {
      url: url.toString(),
      speed,
      signal: controller.signal,
      onSend: logMessage,
      ...(token === undefined ? {} : { token }),
      onTransportError: (error) => {
        process.stderr.write(`transport error: ${error.message}\n`);
      },
    });
    process.stdout.write(`Scenario "${scenarioName}" complete.\n`);
  } catch (error) {
    if (error instanceof Error && error.name === abortError().name) {
      process.stdout.write("Mock publisher stopped.\n");
      return;
    }
    throw error;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

const invokedPath = process.argv[1];
const isMain =
  invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;

if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`mock publisher failed: ${message}\n`);
    process.exitCode = 1;
  });
}
