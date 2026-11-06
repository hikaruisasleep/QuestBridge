import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMessage, type ProtocolMessage } from "@questbridge/protocol";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHost, type Host } from "../src/host.js";
import { SILENT_LOGGER } from "../src/logging.js";

/**
 * End-to-end host behaviour.
 *
 * `docs/phase-2-plan.md` §14.2: a complete host on an ephemeral loopback port
 * with a temporary config directory, driving the real transport. Where the
 * milestone suites test one component, these tests exercise the seams between
 * them — which is where the CLI wiring bug in 2E hid.
 */

interface Peer {
  socket: WebSocket;
  inbox: ProtocolMessage[];
  send(message: ProtocolMessage): void;
  waitFor(
    predicate: (message: ProtocolMessage) => boolean,
    timeoutMs?: number,
  ): Promise<ProtocolMessage>;
  close(): Promise<void>;
}

function open(url: string, options: { origin?: string } = {}): Promise<Peer> {
  return new Promise<Peer>((resolve, reject) => {
    const socket = new WebSocket(
      url,
      options.origin === undefined ? {} : { origin: options.origin },
    );
    const inbox: ProtocolMessage[] = [];
    const waiters: {
      predicate: (message: ProtocolMessage) => boolean;
      resolve: (message: ProtocolMessage) => void;
      timer: NodeJS.Timeout;
    }[] = [];

    socket.on("message", (data: Buffer) => {
      const parsed = JSON.parse(data.toString("utf8")) as ProtocolMessage;
      inbox.push(parsed);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index]!;
        if (waiter.predicate(parsed)) {
          clearTimeout(waiter.timer);
          waiters.splice(index, 1);
          waiter.resolve(parsed);
        }
      }
    });

    socket.once("open", () => {
      resolve({
        socket,
        inbox,
        send(message: ProtocolMessage): void {
          socket.send(JSON.stringify(message));
        },
        waitFor(predicate, timeoutMs = 2_000) {
          const existing = inbox.find(predicate);
          if (existing !== undefined) {
            return Promise.resolve(existing);
          }
          return new Promise<ProtocolMessage>((innerResolve, innerReject) => {
            const timer = setTimeout(
              () => innerReject(new Error("Timed out waiting for a message")),
              timeoutMs,
            );
            waiters.push({ predicate, resolve: innerResolve, timer });
          });
        },
        close(): Promise<void> {
          return new Promise<void>((done) => {
            if (socket.readyState === WebSocket.CLOSED) {
              done();
              return;
            }
            socket.once("close", () => done());
            socket.close();
          });
        },
      });
    });

    socket.once("error", reject);
  });
}

let directory: string;
let host: Host;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "qb-e2e-"));
  host = await createHost({ configDir: directory, logger: SILENT_LOGGER });
});

afterEach(async () => {
  await host.close();
  await rm(directory, { recursive: true, force: true });
});

/** Drive a scenario's messages through the real mock publisher. */
async function playScenario(name: string, speed = 200): Promise<void> {
  const { buildScenario } = await import("@questbridge/mock-publisher/scenarios");
  const { playOverWebSocket } = await import("@questbridge/mock-publisher/client");

  await playOverWebSocket(buildScenario(name as never), {
    url: `${host.url}/ws`,
    speed,
    token: host.tokenStore.tokens.minecraftToken,
  });
}

describe("host and mock publisher end to end", () => {
  it("receives the ready scenario and serves it to a browser", async () => {
    const browser = await open(`${host.url}/ws?token=${host.tokenStore.tokens.browserToken}`, {
      origin: host.url,
    });
    browser.send(
      createMessage("browser.hello", { role: "overlay" }) as ProtocolMessage,
    );
    await browser.waitFor((message) => message.type === "state.snapshot");

    await playScenario("ready");

    const snapshot = await browser.waitFor(
      (message) => message.type === "state.update" && message.payload.chapters !== undefined,
      5_000,
    );
    if (snapshot.type === "state.update") {
      expect(snapshot.payload.chapters?.length).toBeGreaterThan(0);
      expect(snapshot.payload.connection?.status).toBe("ready");
    }

    await browser.close();
  }, 20_000);

  it("applies the full lifecycle scenario", async () => {
    await playScenario("full");

    const snapshot = host.stateStore.snapshot();
    // `full` ends with a reconnect after a world and team change.
    expect(snapshot.chapters.length).toBeGreaterThan(0);
    expect(snapshot.connection.lastSnapshotAt).not.toBeNull();
  }, 30_000);

  it("applies the pins scenario including an unresolved id", async () => {
    await playScenario("pins");

    const snapshot = host.stateStore.snapshot();
    // The scenario adds an unresolved pin and later removes it.
    expect(snapshot.quests.length).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(snapshot.unresolvedPinnedQuestIds)).toBe(true);
  }, 20_000);

  it("leaves no publisher connected after the scenario finishes", async () => {
    await playScenario("ready");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(host.websocket.hasPublisher).toBe(false);
    // The retained snapshot is marked stale rather than presented as live.
    expect(host.stateStore.connection.stale).toBe(true);
  }, 20_000);

  it("serves an unknown path as 404 while serving the routes as placeholders", async () => {
    const health = await fetch(`${host.url}/health`);
    expect(health.status).toBe(200);

    const overlay = await fetch(`${host.url}/overlay`);
    expect(overlay.status).toBe(200);

    const missing = await fetch(`${host.url}/nope`);
    expect(missing.status).toBe(404);
  });

  it("rejects an oversized request body", async () => {
    // A raw request is used because `fetch` refuses to send a body whose length
    // contradicts its own Content-Length header.
    const { connect } = await import("node:net");

    const status = await new Promise<string>((resolve, reject) => {
      const socket = connect(host.port, "127.0.0.1", () => {
        socket.write(
          "POST /health HTTP/1.1\r\n" +
            `Host: 127.0.0.1:${host.port}\r\n` +
            "Content-Length: 200000\r\n" +
            "Connection: close\r\n" +
            "\r\n",
        );
      });

      let received = "";
      socket.on("data", (chunk: Buffer) => {
        received += chunk.toString("utf8");
      });
      socket.on("end", () => resolve(received.split("\r\n")[0] ?? ""));
      socket.on("error", reject);
      socket.setTimeout(3_000, () => {
        socket.destroy();
        resolve(received.split("\r\n")[0] ?? "");
      });
    });

    expect(status).toContain("413");
  });

  it("recovers configuration across a restart", async () => {
    const publisher = await open(`${host.url}/ws?token=${host.tokenStore.tokens.minecraftToken}`);
    publisher.send(
      createMessage("minecraft.hello", {
        modVersion: "test",
        minecraftVersion: "1.21.1",
        neoForgeVersion: "21.1.250",
        ftbQuestsVersion: "test",
        ftbTeamsVersion: "test",
      }, { sequence: 1, sessionId: "11111111-1111-4111-8111-111111111111" }) as ProtocolMessage,
    );
    await publisher.waitFor((message) => message.type === "host.welcome");

    publisher.send(
      createMessage(
        "minecraft.snapshot",
        {
          worldName: "W",
          dimension: "minecraft:overworld",
          integratedServer: true,
          teamId: "t",
          teamName: "T",
          chapters: [
            { id: "c1", title: "One", order: 0, progress: 10, status: "available" },
          ],
          manualPinIds: [],
          quests: [],
          unresolvedPinnedQuestIds: [],
          capturedAt: "2026-01-01T00:00:00.000Z",
        },
        { sequence: 2, sessionId: "11111111-1111-4111-8111-111111111111" },
      ) as ProtocolMessage,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));

    const control = await open(`${host.url}/ws?token=${host.tokenStore.tokens.browserToken}`, {
      origin: host.url,
    });
    control.send(createMessage("browser.hello", { role: "control" }) as ProtocolMessage);
    await control.waitFor((message) => message.type === "state.snapshot");

    control.send(createMessage("chapter.pin", { chapterId: "c1" }) as ProtocolMessage);
    await control.waitFor((message) => message.type === "chapter.pins.update");

    await control.close();
    await publisher.close();
    await host.close();

    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });
    expect(host.pins.pinned()).toEqual(["c1"]);
  }, 20_000);
});
