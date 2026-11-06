import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMessage, type ProtocolMessage } from "@questbridge/protocol";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHost, type Host } from "../src/host.js";
import { SILENT_LOGGER } from "../src/logging.js";
import {
  MOCK_CHAPTERS,
  MOCK_HELLO_PAYLOAD,
  MOCK_SESSION_ID,
  makePinsPayload,
  makeSnapshot,
  progressMessage,
  snapshotMessage,
} from "./support/fixtures.js";

/**
 * Minecraft publisher session, exercised over a real WebSocket.
 *
 * `docs/phase-2-plan.md` §14.2: an ephemeral loopback port and a temporary
 * config directory, with the real transport in the loop.
 */

interface Publisher {
  socket: WebSocket;
  /** Send a message as the adapter would. */
  send(message: ProtocolMessage): void;
  /** Collect messages the host sent back. */
  received(): ProtocolMessage[];
  waitFor(predicate: (message: ProtocolMessage) => boolean, timeoutMs?: number): Promise<ProtocolMessage>;
  close(): Promise<void>;
}

function openPublisher(url: string, token: string): Promise<Publisher> {
  return new Promise<Publisher>((resolve, reject) => {
    const socket = new WebSocket(`${url}/ws?token=${token}`);
    const inbox: ProtocolMessage[] = [];
    const waiters: {
      predicate: (message: ProtocolMessage) => boolean;
      resolve: (message: ProtocolMessage) => void;
      reject: (error: Error) => void;
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
        send(message: ProtocolMessage): void {
          socket.send(JSON.stringify(message));
        },
        received: () => [...inbox],
        waitFor(predicate, timeoutMs = 2_000) {
          const existing = inbox.find(predicate);
          if (existing !== undefined) {
            return Promise.resolve(existing);
          }
          return new Promise<ProtocolMessage>((innerResolve, innerReject) => {
            const timer = setTimeout(() => {
              innerReject(new Error("Timed out waiting for a host message"));
            }, timeoutMs);
            waiters.push({ predicate, resolve: innerResolve, reject: innerReject, timer });
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

/** Attempt a connection and resolve with the HTTP status the host refused with. */
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
      // `ws` reports a refused upgrade as an error after unexpected-response.
      if ((error as { message?: string }).message?.includes("Unexpected server response")) {
        return;
      }
      reject(error);
    });
  });
}

let directory: string;
let host: Host;
let token: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "qb-ws-"));
  host = await createHost({ configDir: directory, logger: SILENT_LOGGER });
  token = host.tokenStore.tokens.minecraftToken;
});

afterEach(async () => {
  await host.close();
  await rm(directory, { recursive: true, force: true });
});

describe("upgrade authentication", () => {
  it("rejects a missing token with 401", async () => {
    expect(await upgradeStatus(host.url, "")).toBe(401);
  });

  it("rejects an invalid token with 401", async () => {
    expect(await upgradeStatus(host.url, "?token=not-a-real-token")).toBe(401);
  });

  it("rejects a browser token on a Minecraft-role connection without Origin", async () => {
    // A browser token with no Origin is refused: only the Minecraft token may
    // make a native connection.
    const browserToken = host.tokenStore.tokens.browserToken;
    expect(await upgradeStatus(host.url, `?token=${browserToken}`)).toBe(403);
  });

  it("accepts the Minecraft token and completes the handshake", async () => {
    const publisher = await openPublisher(host.url, token);
    publisher.send(
      createMessage("minecraft.hello", MOCK_HELLO_PAYLOAD, {
        sequence: 1,
        sessionId: MOCK_SESSION_ID,
      }) as ProtocolMessage,
    );

    const welcome = await publisher.waitFor((message) => message.type === "host.welcome");
    expect(welcome.type).toBe("host.welcome");
    if (welcome.type === "host.welcome") {
      expect(welcome.payload.heartbeatIntervalMs).toBe(5_000);
      expect(welcome.payload.staleAfterMs).toBe(10_000);
      expect(welcome.payload.disconnectAfterMs).toBe(15_000);
      expect(welcome.payload.reconcileIntervalMs).toBe(2_000);
    }

    await publisher.close();
  });

  it("rejects a second publisher", async () => {
    const first = await openPublisher(host.url, token);
    first.send(
      createMessage("minecraft.hello", MOCK_HELLO_PAYLOAD, {
        sequence: 1,
        sessionId: MOCK_SESSION_ID,
      }) as ProtocolMessage,
    );
    await first.waitFor((message) => message.type === "host.welcome");

    expect(await upgradeStatus(host.url, `?token=${token}`)).toBe(409);

    await first.close();
  });

  it("accepts a second publisher after the first disconnects", async () => {
    const first = await openPublisher(host.url, token);
    first.send(
      createMessage("minecraft.hello", MOCK_HELLO_PAYLOAD, {
        sequence: 1,
        sessionId: MOCK_SESSION_ID,
      }) as ProtocolMessage,
    );
    await first.waitFor((message) => message.type === "host.welcome");
    await first.close();

    // Allow the close to be processed before reconnecting.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await openPublisher(host.url, token);
    second.send(
      createMessage("minecraft.hello", MOCK_HELLO_PAYLOAD, {
        sequence: 1,
        sessionId: MOCK_SESSION_ID,
      }) as ProtocolMessage,
    );
    await expect(
      second.waitFor((message) => message.type === "host.welcome"),
    ).resolves.toBeDefined();

    await second.close();
  });
});

describe("publisher protocol handling", () => {
  async function connected(): Promise<Publisher> {
    const publisher = await openPublisher(host.url, token);
    publisher.send(
      createMessage("minecraft.hello", MOCK_HELLO_PAYLOAD, {
        sequence: 1,
        sessionId: MOCK_SESSION_ID,
      }) as ProtocolMessage,
    );
    await publisher.waitFor((message) => message.type === "host.welcome");
    return publisher;
  }

  it("rejects a non-hello first message with a fatal error", async () => {
    const publisher = await openPublisher(host.url, token);
    publisher.send(
      createMessage("minecraft.heartbeat", { ready: false }, {
        sequence: 1,
        sessionId: MOCK_SESSION_ID,
      }) as ProtocolMessage,
    );

    const error = await publisher.waitFor((message) => message.type === "host.error");
    if (error.type === "host.error") {
      expect(error.payload.code).toBe("invalid_message");
      expect(error.payload.fatal).toBe(true);
    }

    await publisher.close();
  });

  it("rejects hello with a sequence other than 1", async () => {
    const publisher = await openPublisher(host.url, token);
    publisher.send(
      createMessage("minecraft.hello", MOCK_HELLO_PAYLOAD, {
        sequence: 2,
        sessionId: MOCK_SESSION_ID,
      }) as ProtocolMessage,
    );

    const error = await publisher.waitFor((message) => message.type === "host.error");
    if (error.type === "host.error") {
      expect(error.payload.message).toContain("sequence 1");
    }

    await publisher.close();
  });

  it("rejects a mismatched sessionId as fatal", async () => {
    const publisher = await connected();

    publisher.send(
      createMessage("minecraft.heartbeat", { ready: true }, {
        sequence: 2,
        sessionId: "different-session",
      }) as ProtocolMessage,
    );

    const error = await publisher.waitFor((message) => message.type === "host.error");
    if (error.type === "host.error") {
      expect(error.payload.code).toBe("session_mismatch");
      expect(error.payload.fatal).toBe(true);
    }

    await publisher.close();
  });

  it("rejects an unsupported protocol version", async () => {
    const publisher = await openPublisher(host.url, token);
    publisher.send({
      protocolVersion: 2,
      type: "minecraft.hello",
      timestamp: new Date().toISOString(),
      sequence: 1,
      sessionId: MOCK_SESSION_ID,
      payload: MOCK_HELLO_PAYLOAD,
    } as unknown as ProtocolMessage);

    const error = await publisher.waitFor((message) => message.type === "host.error");
    if (error.type === "host.error") {
      expect(error.payload.code).toBe("unsupported_protocol");
      expect(error.payload.fatal).toBe(true);
    }

    await publisher.close();
  });

  it("rejects a message directed the wrong way", async () => {
    const publisher = await connected();

    // A host-to-browser type is not valid in the Minecraft direction.
    publisher.send(
      createMessage("state.snapshot", host.stateStore.snapshot(), {
        sequence: 2,
        sessionId: MOCK_SESSION_ID,
      }) as unknown as ProtocolMessage,
    );

    const error = await publisher.waitFor((message) => message.type === "host.error");
    if (error.type === "host.error") {
      expect(error.payload.code).toBe("invalid_message");
    }

    await publisher.close();
  });

  it("ignores a duplicate sequence without changing state", async () => {
    const publisher = await connected();

    publisher.send(snapshotMessage(2, MOCK_SESSION_ID));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const revision = host.stateStore.revision;

    // Replay sequence 2.
    publisher.send(snapshotMessage(2, MOCK_SESSION_ID));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(host.stateStore.revision).toBe(revision);
    await publisher.close();
  });

  it("requests a snapshot and marks stale on a sequence gap", async () => {
    const publisher = await connected();

    publisher.send(snapshotMessage(2, MOCK_SESSION_ID));
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Skip sequence 3.
    publisher.send(progressMessage(4, MOCK_SESSION_ID));

    const request = await publisher.waitFor(
      (message) => message.type === "host.request_snapshot",
    );
    if (request.type === "host.request_snapshot") {
      expect(request.payload.reason).toBe("sequence_gap");
    }

    await publisher.close();
  });

  it("accepts a full snapshot even after a gap", async () => {
    const publisher = await connected();

    publisher.send(snapshotMessage(2, MOCK_SESSION_ID));
    await new Promise((resolve) => setTimeout(resolve, 30));

    // A snapshot is self-contained and resets the expected sequence.
    publisher.send(snapshotMessage(9, MOCK_SESSION_ID));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(host.stateStore.connection.status).toBe("ready");
    expect(host.stateStore.chapters).toHaveLength(MOCK_CHAPTERS.length);

    await publisher.close();
  });

  it("rejects a binary frame", async () => {
    const publisher = await connected();

    publisher.socket.send(Buffer.from([0x01, 0x02, 0x03]));

    const error = await publisher.waitFor((message) => message.type === "host.error", 3_000);
    if (error.type === "host.error") {
      expect(error.payload.message).toContain("Binary frames");
    }

    await publisher.close();
  });

  it("rejects an oversized frame", async () => {
    const publisher = await connected();

    const padding = "x".repeat(300_000);
    publisher.socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: "minecraft.status",
        timestamp: new Date().toISOString(),
        sequence: 2,
        sessionId: MOCK_SESSION_ID,
        payload: { phase: "ready", detail: padding },
      }),
    );

    const error = await publisher.waitFor((message) => message.type === "host.error", 3_000);
    if (error.type === "host.error") {
      expect(error.payload.code).toBe("message_too_large");
    }

    await publisher.close();
  });
});

describe("state ingestion", () => {
  async function connected(): Promise<Publisher> {
    const publisher = await openPublisher(host.url, token);
    publisher.send(
      createMessage("minecraft.hello", MOCK_HELLO_PAYLOAD, {
        sequence: 1,
        sessionId: MOCK_SESSION_ID,
      }) as ProtocolMessage,
    );
    await publisher.waitFor((message) => message.type === "host.welcome");
    return publisher;
  }

  it("applies a snapshot to host state", async () => {
    const publisher = await connected();
    publisher.send(snapshotMessage(2, MOCK_SESSION_ID));

    await new Promise((resolve) => setTimeout(resolve, 80));

    const snapshot = host.stateStore.snapshot();
    expect(snapshot.connection.status).toBe("ready");
    expect(snapshot.chapters).toHaveLength(MOCK_CHAPTERS.length);
    expect(snapshot.quests.length).toBeGreaterThan(0);
    expect(snapshot.minecraft.teamName).toBe("Test Team");

    await publisher.close();
  });

  it("applies a pins message that replaces the objective set", async () => {
    const publisher = await connected();
    publisher.send(snapshotMessage(2, MOCK_SESSION_ID));
    await new Promise((resolve) => setTimeout(resolve, 50));

    publisher.send(
      createMessage("minecraft.pins", makePinsPayload(), {
        sequence: 3,
        sessionId: MOCK_SESSION_ID,
      }) as ProtocolMessage,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const snapshot = host.stateStore.snapshot();
    expect(snapshot.unresolvedPinnedQuestIds).toEqual(["quest-missing"]);
    expect(snapshot.quests.map((quest) => quest.id)).toEqual(["quest-a"]);

    await publisher.close();
  });

  it("records heartbeats and clears staleness", async () => {
    const publisher = await connected();
    publisher.send(snapshotMessage(2, MOCK_SESSION_ID));
    await new Promise((resolve) => setTimeout(resolve, 50));

    publisher.send(
      createMessage("minecraft.heartbeat", { ready: true }, {
        sequence: 3,
        sessionId: MOCK_SESSION_ID,
      }) as ProtocolMessage,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(host.stateStore.connection.stale).toBe(false);
    await publisher.close();
  });

  it("retains a snapshot across disconnect and marks it stale", async () => {
    const publisher = await connected();
    publisher.send(snapshotMessage(2, MOCK_SESSION_ID));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const chaptersBefore = host.stateStore.chapters.length;

    await publisher.close();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const snapshot = host.stateStore.snapshot();
    expect(snapshot.connection.status).toBe("disconnected");
    expect(snapshot.connection.stale).toBe(true);
    // The data is retained so the overlay can present it as stale.
    expect(snapshot.chapters).toHaveLength(chaptersBefore);
  });

  it("applies a progress update without dropping the objective set", async () => {
    const publisher = await connected();
    publisher.send(snapshotMessage(2, MOCK_SESSION_ID));
    await new Promise((resolve) => setTimeout(resolve, 50));

    publisher.send(progressMessage(3, MOCK_SESSION_ID));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const chapter = host.stateStore.chapters.find((entry) => entry.id === "chapter-a");
    expect(chapter?.progress).toBe(55);
    expect(host.stateStore.snapshot().quests.length).toBeGreaterThan(0);

    await publisher.close();
  });
});

describe("first-message timeout", () => {
  it("closes a connection that never sends hello", async () => {
    // A dedicated directory: two hosts sharing one tokens.json would race.
    const isolated = await mkdtemp(join(tmpdir(), "qb-ws-timeout-"));
    const strictHost = await createHost({
      configDir: isolated,
      logger: SILENT_LOGGER,
      // Shortened so the test is fast; the shipped default is 5 s.
      helloTimeoutMs: 300,
    });

    try {
      const publisher = await openPublisher(
        strictHost.url,
        strictHost.tokenStore.tokens.minecraftToken,
      );

      const error = await publisher.waitFor((message) => message.type === "host.error", 3_000);
      if (error.type === "host.error") {
        expect(error.payload.message).toContain("minecraft.hello");
        expect(error.payload.fatal).toBe(true);
      }

      await publisher.close();
    } finally {
      await strictHost.close();
      await rm(isolated, { recursive: true, force: true });
    }
  }, 10_000);
});
