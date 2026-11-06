import { once } from "node:events";
import type { AddressInfo } from "node:net";

import {
  MESSAGE_TYPES_BY_DIRECTION,
  parseFrame,
  parseMessage,
  type MessagePayloadMap,
  type MessageType,
  type ProtocolMessage,
} from "@questbridge/protocol";
import { WebSocketServer } from "ws";
import { describe, expect, it } from "vitest";

import { openWebSocketTransport, playScenario } from "../src/client.js";
import {
  AUTOMATIC_PIN_ID_FIXTURE,
  BASE_PIN_IDS,
  CHAPTERS,
  EMPTY_PIN_CONFIG,
  FIVE_PIN_CONFIG,
  MOCK_SESSION_ID,
  ONE_PIN_CONFIG,
  QUESTS,
  UNRESOLVED_PIN_CONFIG,
  UNRESOLVED_PIN_ID,
} from "../src/fixtures.js";
import {
  SCENARIO_NAMES,
  buildAllScenarios,
  buildScenario,
  type Scenario,
  type ScenarioSendEvent,
} from "../src/scenarios.js";

function sendEvents(scenario: Scenario): ScenarioSendEvent[] {
  return scenario.events.filter((event): event is ScenarioSendEvent => event.kind === "send");
}

function payloadsOf<T extends MessageType>(
  scenario: Scenario,
  type: T,
): Array<MessagePayloadMap[T]> {
  return sendEvents(scenario)
    .filter((event) => event.message.type === type)
    .map((event) => event.message.payload as MessagePayloadMap[T]);
}

function profile(scenario: Scenario) {
  const byConnection = new Map<number, ScenarioSendEvent[]>();
  for (const event of sendEvents(scenario)) {
    const existing = byConnection.get(event.connection) ?? [];
    existing.push(event);
    byConnection.set(event.connection, existing);
  }
  return byConnection;
}

describe("synthetic fixtures", () => {
  it("defines at least six chapters with unique ids and orders", () => {
    expect(CHAPTERS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(CHAPTERS.map((chapter) => chapter.id)).size).toBe(CHAPTERS.length);
    expect(new Set(CHAPTERS.map((chapter) => chapter.order)).size).toBe(CHAPTERS.length);
    expect(new Set(CHAPTERS.map((chapter) => chapter.status))).toEqual(
      new Set(["available", "locked", "completed", "unknown"]),
    );
    expect(CHAPTERS.some((chapter) => chapter.progress === null)).toBe(true);
    expect(
      CHAPTERS.some((chapter) => chapter.progress === 100 && chapter.status !== "completed"),
    ).toBe(true);
  });

  it("defines at least ten quests across known chapters", () => {
    expect(QUESTS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(QUESTS.map((quest) => quest.id)).size).toBe(QUESTS.length);
    const chapterIds = new Set(CHAPTERS.map((chapter) => chapter.id));
    for (const quest of QUESTS) {
      expect(chapterIds.has(quest.chapterId)).toBe(true);
    }
  });

  it("covers optional quests, optional tasks, locked and completed quests", () => {
    expect(QUESTS.some((quest) => quest.optional)).toBe(true);
    expect(QUESTS.some((quest) => quest.tasks.some((task) => task.optional))).toBe(true);
    expect(QUESTS.some((quest) => quest.progress.status === "locked")).toBe(true);
    expect(QUESTS.some((quest) => quest.progress.status === "completed")).toBe(true);
  });

  it("covers multiple task types and numeric and non-numeric progress", () => {
    const taskTypes = new Set(QUESTS.flatMap((quest) => quest.tasks.map((task) => task.type)));
    expect(taskTypes.size).toBeGreaterThanOrEqual(3);

    const tasks = QUESTS.flatMap((quest) => quest.tasks);
    expect(
      tasks.some(
        (task) =>
          task.progress.current !== undefined &&
          task.progress.target !== undefined &&
          task.progress.percentage !== null,
      ),
    ).toBe(true);
    expect(
      tasks.some(
        (task) =>
          task.progress.current === undefined &&
          task.progress.target === undefined &&
          task.progress.percentage === null,
      ),
    ).toBe(true);
  });

  it("pins at least three quests, including a completed one", () => {
    expect(BASE_PIN_IDS.length).toBeGreaterThanOrEqual(3);
    const pinned = QUESTS.filter((quest) => BASE_PIN_IDS.includes(quest.id));
    expect(pinned.length).toBe(BASE_PIN_IDS.length);
    expect(pinned.some((quest) => quest.progress.status === "completed")).toBe(true);
  });

  it("provides empty, one, five, and unresolved chapter pin configurations", () => {
    expect(EMPTY_PIN_CONFIG.pinnedChapters).toHaveLength(0);
    expect(ONE_PIN_CONFIG.pinnedChapters).toHaveLength(1);
    expect(FIVE_PIN_CONFIG.pinnedChapters).toHaveLength(5);
    expect(UNRESOLVED_PIN_CONFIG.pinnedChapters[0]?.chapterId).toBe("mock-chapter-missing");
  });

  it("uses only synthetic identifiers", () => {
    const ids = [
      ...CHAPTERS.map((chapter) => chapter.id),
      ...QUESTS.map((quest) => quest.id),
      ...QUESTS.flatMap((quest) => quest.tasks.map((task) => task.id)),
    ];
    for (const id of ids) {
      expect(id.startsWith("mock-")).toBe(true);
    }
    expect(AUTOMATIC_PIN_ID_FIXTURE).toBe("1");
  });
});

describe("scenario construction", () => {
  it("builds every declared scenario deterministically", () => {
    expect(buildAllScenarios().map((scenario) => scenario.name)).toEqual([...SCENARIO_NAMES]);
    for (const name of SCENARIO_NAMES) {
      const first = buildScenario(name);
      const second = buildScenario(name);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    }
  });

  it("emits only valid v1 messages in every scenario", () => {
    for (const scenario of buildAllScenarios()) {
      for (const event of sendEvents(scenario)) {
        const parsed = parseMessage(event.message, "minecraft_to_host");
        expect(parsed.type).toBe(event.message.type);
        expect(parsed.protocolVersion).toBe(1);
      }
    }
  });

  it("keeps event times ordered and within the scenario duration", () => {
    for (const scenario of buildAllScenarios()) {
      let previous = 0;
      for (const event of scenario.events) {
        expect(event.atMs).toBeGreaterThanOrEqual(previous);
        previous = event.atMs;
      }
      expect(scenario.durationMs).toBeGreaterThanOrEqual(previous);
    }
  });

  it("starts every connection at sequence 1 and increments by one", () => {
    for (const scenario of buildAllScenarios()) {
      for (const [connection, events] of profile(scenario)) {
        expect(events.length).toBeGreaterThan(0);
        events.forEach((event, index) => {
          expect(event.message.sequence).toBe(index + 1);
          expect(event.message.sessionId).toBe(MOCK_SESSION_ID);
          expect(event.connection).toBe(connection);
          expect(MESSAGE_TYPES_BY_DIRECTION.minecraft_to_host).toContain(event.message.type);
        });
      }
    }
  });

  it("starts with a minecraft.hello on the first connection", () => {
    for (const scenario of buildAllScenarios()) {
      const first = sendEvents(scenario)[0];
      expect(first?.message.type).toBe("minecraft.hello");
      expect(first?.message.sequence).toBe(1);
    }
  });
});

describe("scenario behavior", () => {
  it("unavailable never emits a snapshot", () => {
    const scenario = buildScenario("unavailable");
    expect(payloadsOf(scenario, "minecraft.snapshot")).toHaveLength(0);
    expect(payloadsOf(scenario, "minecraft.status")[0]?.phase).toBe("unavailable");
    expect(payloadsOf(scenario, "minecraft.heartbeat").every((beat) => !beat.ready)).toBe(true);
  });

  it("ready emits exactly one initial snapshot after synchronizing", () => {
    const scenario = buildScenario("ready");
    expect(payloadsOf(scenario, "minecraft.snapshot")).toHaveLength(1);
    const statuses = sendEvents(scenario)
      .filter((event) => event.message.type === "minecraft.status")
      .map((event) => (event.message as ProtocolMessage & { type: "minecraft.status" }).payload.phase);
    expect(statuses).toEqual(["synchronizing"]);
  });

  it("progress sends only changed sections before removing the completed pin", () => {
    const scenario = buildScenario("progress");
    const snapshots = payloadsOf(scenario, "minecraft.snapshot");
    expect(snapshots).toHaveLength(1);

    const initialLight = snapshots[0]?.quests.find(
      (quest) => quest.id === "mock-quest-light",
    );
    expect(initialLight?.progress.status).toBe("in_progress");

    const updates = payloadsOf(scenario, "minecraft.progress");
    expect(updates).toHaveLength(2);
    for (const update of updates) {
      expect(update.chapters !== undefined || update.quests !== undefined).toBe(true);
    }
    expect(updates[1]?.chapters?.[0]?.status).toBe("completed");
    expect(
      updates[1]?.quests?.find((quest) => quest.id === "mock-quest-light")?.progress.status,
    ).toBe("completed");

    const pins = payloadsOf(scenario, "minecraft.pins");
    expect(pins).toHaveLength(1);
    expect(pins[0]?.manualPinIds).not.toContain("mock-quest-light");
  });

  it("chapter-completion changes status without changing pins", () => {
    const scenario = buildScenario("chapter-completion");
    expect(payloadsOf(scenario, "minecraft.pins")).toHaveLength(0);
    const updates = payloadsOf(scenario, "minecraft.progress");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.chapters?.[0]?.chapterId).toBe("mock-chapter-start");
    expect(updates[0]?.chapters?.[0]?.status).toBe("completed");
  });

  it("pins replaces the objective set atomically, including unresolved and completed removal", () => {
    const scenario = buildScenario("pins");
    const pins = payloadsOf(scenario, "minecraft.pins");
    expect(pins).toHaveLength(3);

    expect(pins[0]?.manualPinIds).toContain(UNRESOLVED_PIN_ID);
    expect(pins[0]?.unresolvedPinnedQuestIds).toEqual([UNRESOLVED_PIN_ID]);
    expect(pins[0]?.quests.map((quest) => quest.id)).not.toContain(UNRESOLVED_PIN_ID);

    expect(pins[1]?.manualPinIds).not.toContain("mock-quest-light");
    expect(pins[1]?.unresolvedPinnedQuestIds).toEqual([UNRESOLVED_PIN_ID]);

    expect(pins[2]?.manualPinIds).not.toContain(UNRESOLVED_PIN_ID);
    expect(pins[2]?.unresolvedPinnedQuestIds).toEqual([]);
  });

  it("reload, world-change, and team-change emit fresh full snapshots", () => {
    const reload = buildScenario("reload");
    const reloadSnapshots = payloadsOf(reload, "minecraft.snapshot");
    expect(reloadSnapshots).toHaveLength(2);
    expect(reloadSnapshots[1]?.chapters).toHaveLength(reloadSnapshots[0]!.chapters.length + 1);

    const world = buildScenario("world-change");
    const worldSnapshots = payloadsOf(world, "minecraft.snapshot");
    expect(worldSnapshots).toHaveLength(2);
    expect(worldSnapshots[1]?.worldName).not.toBe(worldSnapshots[0]?.worldName);
    expect(worldSnapshots[1]?.dimension).toBe("minecraft:the_nether");
    expect(worldSnapshots[1]?.integratedServer).toBe(true);

    const team = buildScenario("team-change");
    const teamSnapshots = payloadsOf(team, "minecraft.snapshot");
    expect(teamSnapshots).toHaveLength(2);
    expect(teamSnapshots[1]?.teamId).not.toBe(teamSnapshots[0]?.teamId);
    expect(teamSnapshots[1]?.teamName).toBe("Second Team");
  });

  it("disconnect closes the socket, reconnects, and sends a fresh snapshot", () => {
    const scenario = buildScenario("disconnect");
    const closes = scenario.events.filter((event) => event.kind === "close");
    const opens = scenario.events.filter((event) => event.kind === "open");
    expect(closes).toHaveLength(1);
    expect(opens).toHaveLength(1);

    const connections = profile(scenario);
    expect([...connections.keys()]).toEqual([0, 1]);
    const second = connections.get(1)!;
    expect(second[0]?.message.type).toBe("minecraft.hello");
    expect(second[0]?.message.sequence).toBe(1);
    expect(second[0]?.message.sessionId).toBe(MOCK_SESSION_ID);
    expect(second.some((event) => event.message.type === "minecraft.snapshot")).toBe(true);
  });

  it("stale stops heartbeats while holding the socket open", () => {
    const scenario = buildScenario("stale");
    const heartbeats = sendEvents(scenario).filter(
      (event) => event.message.type === "minecraft.heartbeat",
    );
    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0]?.atMs).toBe(5_500);
    expect(scenario.events.some((event) => event.kind === "close")).toBe(false);
    expect(scenario.durationMs).toBeGreaterThanOrEqual(30_000);
  });

  it("full covers progress, pins, reload, world and team changes, and reconnect", () => {
    const scenario = buildScenario("full");
    expect(payloadsOf(scenario, "minecraft.progress").length).toBeGreaterThanOrEqual(2);
    expect(payloadsOf(scenario, "minecraft.pins").length).toBeGreaterThanOrEqual(2);
    const snapshots = payloadsOf(scenario, "minecraft.snapshot");
    expect(snapshots.length).toBeGreaterThanOrEqual(5);
    expect(scenario.events.some((event) => event.kind === "close")).toBe(true);
    expect(scenario.events.some((event) => event.kind === "open")).toBe(true);

    // The post-reconnect snapshot must preserve the last known world and team,
    // not revert to the fixture defaults.
    const finalSnapshot = snapshots.at(-1);
    expect(finalSnapshot?.worldName).toBe("Synthetic World II");
    expect(finalSnapshot?.dimension).toBe("minecraft:the_nether");
    expect(finalSnapshot?.integratedServer).toBe(true);
    expect(finalSnapshot?.teamName).toBe("Second Team");
    expect(finalSnapshot?.chapters).toHaveLength(CHAPTERS.length + 1);
    expect(finalSnapshot?.manualPinIds).not.toContain("mock-quest-light");
  });
});

describe("collector replay", () => {
  it("replays the full lifecycle into a test WebSocket collector", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");

    const received: Array<{ connection: number; message: ProtocolMessage }> = [];
    let connectionCount = 0;

    server.on("connection", (socket) => {
      const connection = connectionCount;
      connectionCount += 1;
      socket.on("message", (data) => {
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : Buffer.from(data as ArrayBuffer).toString("utf8");
        received.push({ connection, message: parseFrame(text, "minecraft_to_host") });
      });
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Collector did not expose a TCP address");
    }
    const url = `ws://127.0.0.1:${(address as AddressInfo).port}/ws`;

    try {
      await playScenario(buildScenario("full"), {
        open: () => openWebSocketTransport(url),
        sleep: async () => {},
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(connectionCount).toBe(2);
      expect(received.length).toBeGreaterThan(10);
      expect(new Set(received.map((entry) => entry.connection))).toEqual(new Set([0, 1]));

      const first = received[0]!;
      expect(first.message.type).toBe("minecraft.hello");
      expect(first.message.sequence).toBe(1);

      const snapshot = received.find(
        (entry) => entry.message.type === "minecraft.snapshot",
      );
      expect(snapshot).toBeDefined();

      const connectionOne = received.filter((entry) => entry.connection === 1);
      expect(connectionOne[0]?.message.type).toBe("minecraft.hello");
      expect(connectionOne[0]?.message.sequence).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }, 15_000);
});
