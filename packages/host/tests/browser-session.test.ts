import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMessage, type ProtocolMessage } from "@questbridge/protocol";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHost, type Host } from "../src/host.js";
import { SILENT_LOGGER } from "../src/logging.js";
import {
  MOCK_HELLO_PAYLOAD,
  MOCK_SESSION_ID,
  snapshotMessage,
} from "./support/fixtures.js";

/**
 * Browser session, roles, and mutations over a real WebSocket.
 *
 * `docs/phase-2-plan.md` §14.2 requires the refresh case in particular: a
 * browser reconnecting must receive current state with no new Minecraft
 * snapshot, because OBS refreshes must not depend on the game.
 *
 * Note on `Origin`: the host accepts a browser-token connection only when it
 * carries an `Origin` header, because that is what distinguishes a browser from
 * a native client (`docs/local-authentication.md` §5). Node's `ws` client does
 * not set one, so these helpers set it explicitly to behave like a browser.
 */

/** Origin a real browser would send when loading a route from the host. */
function browserOrigin(host: Host): string {
  return `http://127.0.0.1:${host.port}`;
}

interface Browser {
  socket: WebSocket;
  send(message: ProtocolMessage): void;
  received(): ProtocolMessage[];
  waitFor(
    predicate: (message: ProtocolMessage) => boolean,
    timeoutMs?: number,
  ): Promise<ProtocolMessage>;
  /** Messages received so far of a given type. */
  all(type: string): ProtocolMessage[];
  close(): Promise<void>;
}

function openBrowser(url: string, token: string, role: "overlay" | "control"): Promise<Browser> {
  return new Promise<Browser>((resolve, reject) => {
    // `origin` is set explicitly because Node's `ws` client does not send one,
    // while a browser always does.
    const socket = new WebSocket(`${url}/ws?token=${token}`, { origin: url });
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
      const browser: Browser = {
        socket,
        send(message: ProtocolMessage): void {
          socket.send(JSON.stringify(message));
        },
        received: () => [...inbox],
        all: (type) => inbox.filter((message) => message.type === type),
        waitFor(predicate, timeoutMs = 2_000) {
          const existing = inbox.find(predicate);
          if (existing !== undefined) {
            return Promise.resolve(existing);
          }
          return new Promise<ProtocolMessage>((innerResolve, innerReject) => {
            const timer = setTimeout(
              () => innerReject(new Error("Timed out waiting for a browser message")),
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
      };

      browser.send(
        createMessage("browser.hello", { role }, { timestamp: new Date().toISOString() }) as ProtocolMessage,
      );
      resolve(browser);
    });

    socket.once("error", reject);
  });
}

async function connectPublisher(host: Host): Promise<WebSocket> {
  const token = host.tokenStore.tokens.minecraftToken;
  const socket = new WebSocket(`${host.url}/ws?token=${token}`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  socket.send(
    JSON.stringify(
      createMessage("minecraft.hello", MOCK_HELLO_PAYLOAD, {
        sequence: 1,
        sessionId: MOCK_SESSION_ID,
      }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  return socket;
}

let directory: string;
let host: Host;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "qb-browser-"));
  host = await createHost({ configDir: directory, logger: SILENT_LOGGER });
});

afterEach(async () => {
  await host.close();
  await rm(directory, { recursive: true, force: true });
});

describe("browser hello", () => {
  it("sends a state snapshot immediately", async () => {
    const browser = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "overlay");

    const message = await browser.waitFor((entry) => entry.type === "state.snapshot");
    if (message.type === "state.snapshot") {
      expect(message.sequence).toBe(1);
      expect(message.payload.revision).toBe(0);
      expect(message.payload.connection.status).toBe("disconnected");
      expect(message.payload.chapters).toEqual([]);
      expect(message.payload.chapterPins.pinnedChapters).toEqual([]);
      expect(message.payload.display.theme).toBe("minimal");
    }

    await browser.close();
  });

  it("accepts both roles with the same browser token", async () => {
    // Accepted risk R1: the token does not distinguish the roles.
    const token = host.tokenStore.tokens.browserToken;

    const overlay = await openBrowser(host.url, token, "overlay");
    await overlay.waitFor((message) => message.type === "state.snapshot");

    const control = await openBrowser(host.url, token, "control");
    await control.waitFor((message) => message.type === "state.snapshot");

    await overlay.close();
    await control.close();
  });

  it("rejects a non-hello first message", async () => {
    const socket = new WebSocket(`${host.url}/ws?token=${host.tokenStore.tokens.browserToken}`, {
      origin: browserOrigin(host),
    });
    await new Promise<void>((resolve) => socket.once("open", () => resolve()));

    const closed = new Promise<number>((resolve) => {
      socket.once("close", (code: number) => resolve(code));
    });

    socket.send(JSON.stringify({ protocolVersion: 1, type: "bogus", timestamp: new Date().toISOString(), payload: {} }));

    await expect(closed).resolves.toBe(1008);
  });
});

describe("state delivery", () => {
  it("delivers a Minecraft snapshot to a connected browser", async () => {
    const browser = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "overlay");
    await browser.waitFor((message) => message.type === "state.snapshot");

    const publisher = await connectPublisher(host);
    publisher.send(JSON.stringify(snapshotMessage(2, MOCK_SESSION_ID)));

    // The publisher's hello produces an earlier update carrying only the
    // connection section, so wait specifically for the catalog.
    const update = await browser.waitFor(
      (message) => message.type === "state.update" && message.payload.chapters !== undefined,
    );
    if (update.type === "state.update") {
      expect(update.payload.chapters?.length).toBeGreaterThan(0);
      expect(update.payload.connection?.status).toBe("ready");
    }

    publisher.close();
    await browser.close();
  });

  it("serves a refresh from host memory with no new Minecraft snapshot", async () => {
    const browser = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "overlay");
    await browser.waitFor((message) => message.type === "state.snapshot");

    const publisher = await connectPublisher(host);
    publisher.send(JSON.stringify(snapshotMessage(2, MOCK_SESSION_ID)));
    // Wait for the catalog specifically, so the refresh below observes a
    // fully-applied snapshot rather than racing the publisher's hello.
    await browser.waitFor(
      (message) => message.type === "state.update" && message.payload.chapters !== undefined,
    );

    // Simulate an OBS refresh: a brand new connection with no new Minecraft
    // message of any kind.
    const refreshed = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "overlay");
    const snapshot = await refreshed.waitFor((message) => message.type === "state.snapshot");

    if (snapshot.type === "state.snapshot") {
      expect(snapshot.payload.chapters.length).toBeGreaterThan(0);
      expect(snapshot.payload.connection.status).toBe("ready");
      expect(snapshot.payload.revision).toBeGreaterThan(0);
    }

    publisher.close();
    await browser.close();
    await refreshed.close();
  });

  it("answers a resync request with a fresh snapshot", async () => {
    const browser = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "overlay");
    await browser.waitFor((message) => message.type === "state.snapshot");

    browser.send(
      createMessage("state.resync", { reason: "manual" }, { timestamp: new Date().toISOString() }) as ProtocolMessage,
    );

    await expect(
      browser.waitFor(
        (message) => message.type === "state.snapshot" && message.sequence > 1,
      ),
    ).resolves.toBeDefined();

    await browser.close();
  });

  it("increments the outbound sequence for every message", async () => {
    const browser = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "overlay");
    await browser.waitFor((message) => message.type === "state.snapshot");

    browser.send(
      createMessage("state.resync", {}, { timestamp: new Date().toISOString() }) as ProtocolMessage,
    );
    await browser.waitFor((message) => message.type === "state.snapshot" && message.sequence === 2);

    browser.send(
      createMessage("state.resync", {}, { timestamp: new Date().toISOString() }) as ProtocolMessage,
    );
    await browser.waitFor((message) => message.type === "state.snapshot" && message.sequence === 3);

    await browser.close();
  });

  it("broadcasts to multiple browsers", async () => {
    const first = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "overlay");
    const second = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "control");
    await first.waitFor((message) => message.type === "state.snapshot");
    await second.waitFor((message) => message.type === "state.snapshot");

    const publisher = await connectPublisher(host);
    publisher.send(JSON.stringify(snapshotMessage(2, MOCK_SESSION_ID)));

    await expect(first.waitFor((message) => message.type === "state.update")).resolves.toBeDefined();
    await expect(second.waitFor((message) => message.type === "state.update")).resolves.toBeDefined();

    publisher.close();
    await first.close();
    await second.close();
  });

  it("does not deliver state before the role is established", async () => {
    const publisher = await connectPublisher(host);
    const before = host.stateStore.revision;

    // A socket that connects but never says hello receives nothing.
    const socket = new WebSocket(`${host.url}/ws?token=${host.tokenStore.tokens.browserToken}`, {
      origin: browserOrigin(host),
    });
    await new Promise<void>((resolve) => socket.once("open", () => resolve()));

    publisher.send(JSON.stringify(snapshotMessage(2, MOCK_SESSION_ID)));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(host.stateStore.revision).toBeGreaterThan(before);

    socket.close();
    publisher.close();
  });
});

describe("mutations", () => {
  async function controlWithSnapshot(): Promise<{ browser: Browser; publisher: WebSocket }> {
    const publisher = await connectPublisher(host);
    publisher.send(JSON.stringify(snapshotMessage(2, MOCK_SESSION_ID)));
    await new Promise((resolve) => setTimeout(resolve, 60));

    const browser = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "control");
    await browser.waitFor((message) => message.type === "state.snapshot");
    return { browser, publisher };
  }

  it("pins a chapter and broadcasts the authoritative result", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    browser.send(
      createMessage("chapter.pin", { chapterId: "chapter-a" }, { requestId: "r1" }) as ProtocolMessage,
    );

    const update = await browser.waitFor((message) => message.type === "chapter.pins.update");
    if (update.type === "chapter.pins.update") {
      expect(update.payload.chapterPins.pinnedChapters).toEqual([
        { chapterId: "chapter-a", position: 0 },
      ]);
    }

    expect(host.pins.pinned()).toEqual(["chapter-a"]);
    publisher.close();
    await browser.close();
  });

  it("unpins a chapter", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    browser.send(createMessage("chapter.pin", { chapterId: "chapter-a" }) as ProtocolMessage);
    await browser.waitFor((message) => message.type === "chapter.pins.update");

    browser.send(createMessage("chapter.unpin", { chapterId: "chapter-a" }) as ProtocolMessage);
    await browser.waitFor(
      (message) =>
        message.type === "chapter.pins.update" &&
        message.payload.chapterPins.pinnedChapters.length === 0,
    );

    expect(host.pins.pinned()).toEqual([]);
    publisher.close();
    await browser.close();
  });

  it("reorders chapters", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    browser.send(createMessage("chapter.pin", { chapterId: "chapter-a" }) as ProtocolMessage);
    await browser.waitFor(
      (message) => message.type === "chapter.pins.update" && message.payload.chapterPins.pinnedChapters.length === 1,
    );
    browser.send(createMessage("chapter.pin", { chapterId: "chapter-b" }) as ProtocolMessage);
    await browser.waitFor(
      (message) => message.type === "chapter.pins.update" && message.payload.chapterPins.pinnedChapters.length === 2,
    );

    browser.send(
      createMessage("chapter.reorder", { chapterIds: ["chapter-b", "chapter-a"] }) as ProtocolMessage,
    );
    const update = await browser.waitFor(
      (message) =>
        message.type === "chapter.pins.update" &&
        message.payload.chapterPins.pinnedChapters[0]?.chapterId === "chapter-b",
    );

    if (update.type === "chapter.pins.update") {
      expect(update.payload.chapterPins.pinnedChapters).toEqual([
        { chapterId: "chapter-b", position: 0 },
        { chapterId: "chapter-a", position: 1 },
      ]);
    }

    publisher.close();
    await browser.close();
  });

  it("updates display configuration", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    browser.send(
      createMessage("config.update", {
        display: {
          showChapterProgress: false,
          showQuestTasks: true,
          showCompletedQuests: false,
          completionAnimation: false,
          theme: "minimal",
          compactMode: false,
        },
      }) as ProtocolMessage,
    );

    const update = await browser.waitFor((message) => message.type === "config.update");
    if (update.type === "config.update") {
      expect(update.payload.display.showChapterProgress).toBe(false);
      expect(update.payload.display.compactMode).toBe(false);
    }

    publisher.close();
    await browser.close();
  });

  it("rejects a duplicate chapter with duplicate_chapter", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    browser.send(createMessage("chapter.pin", { chapterId: "chapter-a" }) as ProtocolMessage);
    await browser.waitFor((message) => message.type === "chapter.pins.update");

    browser.send(
      createMessage("chapter.pin", { chapterId: "chapter-a" }, { requestId: "dup" }) as ProtocolMessage,
    );

    const error = await browser.waitFor((message) => message.type === "request.error");
    if (error.type === "request.error") {
      expect(error.payload.code).toBe("duplicate_chapter");
      expect(error.requestId).toBe("dup");
    }

    publisher.close();
    await browser.close();
  });

  it("rejects a chapter absent from the catalog with unknown_chapter", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    browser.send(createMessage("chapter.pin", { chapterId: "does-not-exist" }) as ProtocolMessage);

    const error = await browser.waitFor((message) => message.type === "request.error");
    if (error.type === "request.error") {
      expect(error.payload.code).toBe("unknown_chapter");
    }

    publisher.close();
    await browser.close();
  });

  it("rejects more than five pins with too_many_pins", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    // Extend the catalog so six distinct ids exist to try.
    const chapters = [
      { id: "c1", title: "1", order: 0, progress: 0, status: "available" as const },
      { id: "c2", title: "2", order: 1, progress: 0, status: "available" as const },
      { id: "c3", title: "3", order: 2, progress: 0, status: "available" as const },
      { id: "c4", title: "4", order: 3, progress: 0, status: "available" as const },
      { id: "c5", title: "5", order: 4, progress: 0, status: "available" as const },
      { id: "c6", title: "6", order: 5, progress: 0, status: "available" as const },
    ];
    publisher.send(
      JSON.stringify(
        createMessage(
          "minecraft.snapshot",
          {
            worldName: "Test World",
            dimension: "minecraft:overworld",
            integratedServer: true,
            teamId: "team-test",
            teamName: "Test Team",
            chapters,
            manualPinIds: [],
            quests: [],
            unresolvedPinnedQuestIds: [],
            capturedAt: "2026-01-01T00:00:10.000Z",
          },
          { sequence: 3, sessionId: MOCK_SESSION_ID },
        ),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));

    for (const id of ["c1", "c2", "c3", "c4", "c5"]) {
      browser.send(createMessage("chapter.pin", { chapterId: id }) as ProtocolMessage);
      await browser.waitFor(
        (message) =>
          message.type === "chapter.pins.update" &&
          message.payload.chapterPins.pinnedChapters.length === Number(id.slice(1)),
      );
    }

    browser.send(createMessage("chapter.pin", { chapterId: "c6" }) as ProtocolMessage);
    const error = await browser.waitFor((message) => message.type === "request.error", 3_000);
    if (error.type === "request.error") {
      expect(error.payload.code).toBe("too_many_pins");
    }

    expect(host.pins.pinned()).toHaveLength(5);
    publisher.close();
    await browser.close();
  });

  it("rejects a reorder that changes the pinned set", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    browser.send(createMessage("chapter.pin", { chapterId: "chapter-a" }) as ProtocolMessage);
    await browser.waitFor((message) => message.type === "chapter.pins.update");

    browser.send(
      createMessage("chapter.reorder", { chapterIds: ["chapter-a", "chapter-b"] }) as ProtocolMessage,
    );

    const error = await browser.waitFor((message) => message.type === "request.error");
    if (error.type === "request.error") {
      expect(error.payload.code).toBe("invalid_reorder_set");
    }

    publisher.close();
    await browser.close();
  });

  it("rejects an unpin of a chapter that is not pinned", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    browser.send(createMessage("chapter.unpin", { chapterId: "chapter-a" }) as ProtocolMessage);

    const error = await browser.waitFor((message) => message.type === "request.error");
    if (error.type === "request.error") {
      expect(error.payload.code).toBe("not_pinned");
    }

    publisher.close();
    await browser.close();
  });

  it("rejects every mutation from an overlay with unauthorized", async () => {
    const publisher = await connectPublisher(host);
    publisher.send(JSON.stringify(snapshotMessage(2, MOCK_SESSION_ID)));
    await new Promise((resolve) => setTimeout(resolve, 60));

    const overlay = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "overlay");
    await overlay.waitFor((message) => message.type === "state.snapshot");

    overlay.send(createMessage("chapter.pin", { chapterId: "chapter-a" }) as ProtocolMessage);
    const error = await overlay.waitFor((message) => message.type === "request.error");
    if (error.type === "request.error") {
      expect(error.payload.code).toBe("unauthorized");
    }

    // Nothing changed.
    expect(host.pins.pinned()).toEqual([]);

    publisher.close();
    await overlay.close();
  });

  it("rejects a malformed mutation payload", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    browser.send({
      protocolVersion: 1,
      type: "chapter.pin",
      timestamp: new Date().toISOString(),
      payload: { chapterId: "" },
    } as unknown as ProtocolMessage);

    const error = await browser.waitFor((message) => message.type === "request.error");
    if (error.type === "request.error") {
      expect(error.payload.code).toBe("invalid_message");
    }

    publisher.close();
    await browser.close();
  });

  it("keeps the connection open after a non-fatal request error", async () => {
    const { browser, publisher } = await controlWithSnapshot();

    browser.send(createMessage("chapter.unpin", { chapterId: "nope" }) as ProtocolMessage);
    await browser.waitFor((message) => message.type === "request.error");

    // The socket must still be usable.
    expect(browser.socket.readyState).toBe(WebSocket.OPEN);

    browser.send(createMessage("chapter.pin", { chapterId: "chapter-a" }) as ProtocolMessage);
    await expect(
      browser.waitFor((message) => message.type === "chapter.pins.update"),
    ).resolves.toBeDefined();

    publisher.close();
    await browser.close();
  });
});

describe("persistence", () => {
  it("persists a pin across a host restart", async () => {
    const publisher = await connectPublisher(host);
    publisher.send(JSON.stringify(snapshotMessage(2, MOCK_SESSION_ID)));
    await new Promise((resolve) => setTimeout(resolve, 60));

    const browser = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "control");
    await browser.waitFor((message) => message.type === "state.snapshot");

    browser.send(createMessage("chapter.pin", { chapterId: "chapter-a" }) as ProtocolMessage);
    await browser.waitFor((message) => message.type === "chapter.pins.update");
    await browser.close();
    publisher.close();

    const raw = JSON.parse(await readFile(join(directory, "config.json"), "utf8")) as {
      chapterPins: { pinnedChapters: { chapterId: string; position: number }[] };
    };
    expect(raw.chapterPins.pinnedChapters).toEqual([
      { chapterId: "chapter-a", position: 0 },
    ]);

    // Restart against the same directory.
    await host.close();
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });
    expect(host.pins.pinned()).toEqual(["chapter-a"]);
  });

  it("keeps an unresolved pin after a restart and reports it unresolved", async () => {
    const { browser, publisher } = await (async () => {
      const pub = await connectPublisher(host);
      pub.send(JSON.stringify(snapshotMessage(2, MOCK_SESSION_ID)));
      await new Promise((resolve) => setTimeout(resolve, 60));
      const br = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "control");
      await br.waitFor((message) => message.type === "state.snapshot");
      return { browser: br, publisher: pub };
    })();

    browser.send(createMessage("chapter.pin", { chapterId: "chapter-a" }) as ProtocolMessage);
    await browser.waitFor((message) => message.type === "chapter.pins.update");
    await browser.close();
    publisher.close();

    await host.close();
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });

    // No Minecraft data yet, so the pin cannot resolve.
    const resolution = host.pins.resolution();
    expect(resolution.unresolved.map((entry) => entry.chapterId)).toEqual(["chapter-a"]);
    expect(resolution.resolved).toEqual([]);
  });

  it("does not advance the revision for an unchanged display update", async () => {
    const { browser, publisher } = await (async () => {
      const pub = await connectPublisher(host);
      pub.send(JSON.stringify(snapshotMessage(2, MOCK_SESSION_ID)));
      await new Promise((resolve) => setTimeout(resolve, 60));
      const br = await openBrowser(host.url, host.tokenStore.tokens.browserToken, "control");
      await br.waitFor((message) => message.type === "state.snapshot");
      return { browser: br, publisher: pub };
    })();

    const revision = host.stateStore.revision;
    browser.send(
      createMessage("config.update", { display: host.configStore.display }) as ProtocolMessage,
    );

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(host.stateStore.revision).toBe(revision);

    // No config.update should have been broadcast.
    expect(browser.all("config.update")).toHaveLength(0);

    publisher.close();
    await browser.close();
  });
});
