import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseCliOptions, run } from "../src/index.js";
import type { Host } from "../src/host.js";

/**
 * CLI wiring regression.
 *
 * A previous revision had `run` start the bare HTTP listener instead of
 * building the full host, so every `/ws` upgrade was answered with 404 while
 * the unit tests (which used `createHost` directly) still passed. These tests
 * exercise the CLI's own path so that gap cannot reopen.
 */

let directory: string;
let host: Host | null = null;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "qb-cli-run-"));
});

afterEach(async () => {
  if (host !== null) {
    await host.close();
    host = null;
  }
  await rm(directory, { recursive: true, force: true });
});

function upgradeStatus(url: string, query: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`${url}/ws${query}`, { headers });
    socket.once("open", () => {
      socket.close();
      resolve(101);
    });
    socket.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
    });
    socket.once("error", (error: Error) => {
      if ((error as { message?: string }).message?.includes("Unexpected server response")) {
        return;
      }
      reject(error);
    });
  });
}

describe("run() builds a complete host", () => {
  it("serves the WebSocket endpoint, including authenticated upgrades", async () => {
    host = await run({ port: 0, configDir: directory });

    // An unauthenticated upgrade is refused with 401, which proves the upgrade
    // handler is attached: a missing handler yields 404 instead.
    await expect(upgradeStatus(host.url, "")).resolves.toBe(401);

    const token = host.tokenStore.tokens.minecraftToken;
    await expect(upgradeStatus(host.url, `?token=${token}`)).resolves.toBe(101);
  });

  it("serves /health alongside the WebSocket endpoint", async () => {
    host = await run({ port: 0, configDir: directory });

    const response = await fetch(`${host.url}/health`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload["status"]).toBe("ok");
  });

  it("persists configuration in the requested directory", async () => {
    host = await run({ port: 0, configDir: directory });
    expect(host.paths.directory).toBe(directory);
    expect(host.configStore.filePath.startsWith(directory)).toBe(true);
    expect(host.tokenStore.filePath.startsWith(directory)).toBe(true);
  });
});

describe("CLI parsing remains consistent with run()", () => {
  it("produces options that run() accepts", () => {
    const parsed = parseCliOptions(["--port", "0", "--config-dir", "/tmp/qb"]);
    expect(parsed.kind).toBe("run");
    if (parsed.kind === "run") {
      expect(parsed.options.configDir).toBe("/tmp/qb");
    }
  });
});
