import {
  createMessage,
  parseMessage,
  type MessagePayloadMap,
  type MessageType,
  type MinecraftSnapshotPayload,
  type ProtocolMessage,
  type Quest,
} from "@questbridge/protocol";

import {
  BASE_PIN_IDS,
  CHAPTERS,
  MOCK_SESSION_ID,
  UNRESOLVED_PIN_ID,
  createSnapshot,
  pinsPayload,
  questWithProgress,
  questsForPinIds,
  timestampAt,
} from "./fixtures.js";

/**
 * Deterministic protocol-level scenarios.
 *
 * Each scenario is a script of messages and connection events. The runner in
 * `client.ts` plays the script; tests can inspect the events without any
 * network, or replay them into a collector.
 */

export const SCENARIO_NAMES = [
  "unavailable",
  "ready",
  "progress",
  "chapter-completion",
  "pins",
  "reload",
  "world-change",
  "team-change",
  "disconnect",
  "stale",
  "full",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export interface ScenarioSendEvent {
  kind: "send";
  atMs: number;
  connection: number;
  message: ProtocolMessage;
}

export interface ScenarioCloseEvent {
  kind: "close";
  atMs: number;
  connection: number;
}

export interface ScenarioOpenEvent {
  kind: "open";
  atMs: number;
  connection: number;
}

export type ScenarioEvent = ScenarioSendEvent | ScenarioCloseEvent | ScenarioOpenEvent;

export interface Scenario {
  name: ScenarioName;
  events: ScenarioEvent[];
  durationMs: number;
}

const HELLO_PAYLOAD: MessagePayloadMap["minecraft.hello"] = {
  modVersion: "0.1.0-mock",
  minecraftVersion: "1.21.1",
  neoForgeVersion: "21.1.250",
  ftbQuestsVersion: "2101.1.30-mock",
  ftbTeamsVersion: "2101.1.10-mock",
};

class ScenarioBuilder {
  readonly name: ScenarioName;
  #events: ScenarioEvent[] = [];
  #atMs = 0;
  #connection = 0;
  #sequence = 1;
  #open = true;

  constructor(name: ScenarioName) {
    this.name = name;
  }

  get now(): number {
    return this.#atMs;
  }

  get timestamp(): string {
    return timestampAt(this.#atMs);
  }

  wait(ms: number): this {
    if (!Number.isInteger(ms) || ms < 0) {
      throw new Error(`Scenario wait must be a non-negative integer, received ${ms}`);
    }
    this.#atMs += ms;
    return this;
  }

  send<T extends MessageType>(type: T, payload: MessagePayloadMap[T]): this {
    if (!this.#open) {
      throw new Error(`Scenario "${this.name}" attempted to send ${type} on a closed connection`);
    }

    const message = createMessage(type, payload, {
      sequence: this.#sequence,
      sessionId: MOCK_SESSION_ID,
      timestamp: this.timestamp,
    });
    this.#sequence += 1;

    // Fail at scenario construction time, not after connecting to a host.
    parseMessage(message as ProtocolMessage, "minecraft_to_host");

    this.#events.push({
      kind: "send",
      atMs: this.#atMs,
      connection: this.#connection,
      message: message as ProtocolMessage,
    });
    return this;
  }

  hello(): this {
    return this.send("minecraft.hello", HELLO_PAYLOAD);
  }

  status(phase: MessagePayloadMap["minecraft.status"]["phase"], detail?: string): this {
    return this.send(
      "minecraft.status",
      detail === undefined ? { phase } : { phase, detail },
    );
  }

  heartbeat(ready: boolean): this {
    return this.send("minecraft.heartbeat", { ready });
  }

  snapshot(payload: MinecraftSnapshotPayload): this {
    return this.send("minecraft.snapshot", payload);
  }

  progress(payload: MessagePayloadMap["minecraft.progress"]): this {
    return this.send("minecraft.progress", payload);
  }

  pins(payload: MessagePayloadMap["minecraft.pins"]): this {
    return this.send("minecraft.pins", payload);
  }

  close(): this {
    if (!this.#open) {
      throw new Error(`Scenario "${this.name}" closed an already closed connection`);
    }
    this.#events.push({
      kind: "close",
      atMs: this.#atMs,
      connection: this.#connection,
    });
    this.#open = false;
    return this;
  }

  reconnect(delayMs = 0): this {
    if (this.#open) {
      throw new Error(`Scenario "${this.name}" reconnected without closing first`);
    }
    this.wait(delayMs);
    this.#connection += 1;
    this.#sequence = 1;
    this.#open = true;
    this.#events.push({
      kind: "open",
      atMs: this.#atMs,
      connection: this.#connection,
    });
    return this;
  }

  finish(durationMs: number = this.#atMs): Scenario {
    if (durationMs < this.#atMs) {
      throw new Error(
        `Scenario "${this.name}" duration ${durationMs} is before its last event at ${this.#atMs}`,
      );
    }

    return {
      name: this.name,
      events: this.#events.map((event) => ({ ...event })),
      durationMs,
    };
  }
}

function beginReady(
  builder: ScenarioBuilder,
  overrides: Partial<MinecraftSnapshotPayload> = {},
): void {
  builder.hello();
  builder.wait(100).status("synchronizing", "Waiting for quest data from server");
  builder.wait(400).snapshot(createSnapshot(builder.timestamp, overrides));
}

function lightInProgress(): Quest {
  const base = questWithProgress("mock-quest-light", {});
  return {
    ...base,
    tasks: base.tasks.map((task) => ({
      ...task,
      progress: { status: "incomplete", percentage: 0 },
    })),
    progress: {
      status: "in_progress",
      completedTasks: 0,
      totalRequiredTasks: 1,
      percentage: 0,
    },
  };
}

function pinnedQuestsWithLightInProgress(): Quest[] {
  return questsForPinIds(BASE_PIN_IDS).map((quest) =>
    quest.id === "mock-quest-light" ? lightInProgress() : quest,
  );
}

function machineFrameQuest(percentage: number, current: number): Quest {
  const base = questWithProgress("mock-quest-machine-frame", {});
  return {
    ...base,
    tasks: base.tasks.map((task) =>
      task.id === "mock-task-frame"
        ? { ...task, progress: { ...task.progress, current, percentage } }
        : task,
    ),
    progress: { ...base.progress, percentage },
  };
}

function unavailableScenario(): Scenario {
  const builder = new ScenarioBuilder("unavailable");
  builder.hello();
  builder.wait(100).status("unavailable", "No world loaded");
  builder.wait(900).heartbeat(false);
  builder.wait(5000).heartbeat(false);
  builder.wait(5000).heartbeat(false);
  return builder.finish(12_000);
}

function readyScenario(): Scenario {
  const builder = new ScenarioBuilder("ready");
  beginReady(builder);
  builder.wait(5000).heartbeat(true);
  return builder.finish(6_000);
}

function progressScenario(): Scenario {
  const builder = new ScenarioBuilder("progress");
  beginReady(builder, { quests: pinnedQuestsWithLightInProgress() });
  builder.wait(5000).heartbeat(true);

  builder.wait(1500).progress({
    capturedAt: builder.timestamp,
    chapters: [{ chapterId: "mock-chapter-start", progress: 63, status: "available" }],
    quests: [machineFrameQuest(40, 4)],
  });

  builder.wait(2000).progress({
    capturedAt: builder.timestamp,
    chapters: [{ chapterId: "mock-chapter-start", progress: 100, status: "completed" }],
    quests: [
      questWithProgress("mock-quest-light", {
        progress: {
          status: "completed",
          completedTasks: 1,
          totalRequiredTasks: 1,
          percentage: 100,
        },
      }),
    ],
  });

  builder.wait(2000).pins(
    pinsPayload(
      BASE_PIN_IDS.filter((id) => id !== "mock-quest-light"),
      [],
      builder.timestamp,
      new Map([["mock-quest-machine-frame", machineFrameQuest(40, 4)]]),
    ),
  );

  builder.wait(5000).heartbeat(true);
  return builder.finish(17_000);
}

function chapterCompletionScenario(): Scenario {
  const builder = new ScenarioBuilder("chapter-completion");
  beginReady(builder);
  builder.wait(5000).heartbeat(true);
  builder.wait(1500).progress({
    capturedAt: builder.timestamp,
    chapters: [{ chapterId: "mock-chapter-start", progress: 100, status: "completed" }],
  });
  return builder.finish(8_000);
}

function pinsScenario(): Scenario {
  const builder = new ScenarioBuilder("pins");
  beginReady(builder);
  builder.wait(5000).heartbeat(true);

  const withUnresolved = [...BASE_PIN_IDS, UNRESOLVED_PIN_ID];
  builder.wait(1500).pins(
    pinsPayload(withUnresolved, [UNRESOLVED_PIN_ID], builder.timestamp),
  );

  builder.wait(2000).pins(
    pinsPayload(
      withUnresolved.filter((id) => id !== "mock-quest-light"),
      [UNRESOLVED_PIN_ID],
      builder.timestamp,
    ),
  );

  builder.wait(2000).pins(
    pinsPayload(
      BASE_PIN_IDS.filter((id) => id !== "mock-quest-light"),
      [],
      builder.timestamp,
    ),
  );

  return builder.finish(12_000);
}

function reloadScenario(): Scenario {
  const builder = new ScenarioBuilder("reload");
  beginReady(builder);
  builder.wait(5000).heartbeat(true);

  builder.wait(1500);
  const chapters = [
    ...CHAPTERS,
    {
      id: "mock-chapter-reloaded",
      title: "Reloaded Chapter",
      order: 7,
      progress: 0,
      status: "available" as const,
    },
  ];
  builder.snapshot(createSnapshot(builder.timestamp, { chapters }));
  builder.wait(1000).heartbeat(true);
  return builder.finish(8_000);
}

function worldChangeScenario(): Scenario {
  const builder = new ScenarioBuilder("world-change");
  beginReady(builder);
  builder.wait(5000).heartbeat(true);

  builder.wait(1500);
  const chapters = CHAPTERS.map((chapter) => ({
    ...chapter,
    progress: 0,
    status: chapter.id === "mock-chapter-endgame" ? ("locked" as const) : ("available" as const),
  }));
  const snapshot = createSnapshot(builder.timestamp, {
    worldName: "Synthetic World II",
    dimension: "minecraft:the_nether",
    integratedServer: true,
    chapters,
    quests: [machineFrameQuest(0, 0), ...createSnapshot(builder.timestamp).quests.slice(1)],
  });
  builder.snapshot(snapshot);
  builder.wait(1000).heartbeat(true);
  return builder.finish(8_000);
}

function teamChangeScenario(): Scenario {
  const builder = new ScenarioBuilder("team-change");
  beginReady(builder);
  builder.wait(5000).heartbeat(true);

  builder.wait(1500);
  const chapters = CHAPTERS.map((chapter) => ({
    ...chapter,
    progress: chapter.id === "mock-chapter-start" ? 10 : chapter.progress,
  }));
  const snapshot = createSnapshot(builder.timestamp, {
    teamId: "33333333-3333-4333-8333-333333333333",
    teamName: "Second Team",
    chapters,
    quests: [machineFrameQuest(10, 1), ...createSnapshot(builder.timestamp).quests.slice(1)],
  });
  builder.snapshot(snapshot);
  builder.wait(1000).heartbeat(true);
  return builder.finish(8_000);
}

function disconnectScenario(): Scenario {
  const builder = new ScenarioBuilder("disconnect");
  beginReady(builder);
  builder.wait(5000).heartbeat(true);
  builder.wait(500).close();
  builder.reconnect(2000);
  builder.hello();
  builder.wait(100).status("synchronizing", "Reconnected");
  builder.wait(300).snapshot(createSnapshot(builder.timestamp));
  builder.wait(5000).heartbeat(true);
  return builder.finish(14_000);
}

function staleScenario(): Scenario {
  const builder = new ScenarioBuilder("stale");
  beginReady(builder);
  builder.wait(5000).heartbeat(true);
  // Intentionally no further heartbeats and no close: the socket stays open.
  return builder.finish(30_000);
}

function fullScenario(): Scenario {
  const builder = new ScenarioBuilder("full");
  beginReady(builder, { quests: pinnedQuestsWithLightInProgress() });
  builder.wait(5000).heartbeat(true);

  builder.wait(1500).progress({
    capturedAt: builder.timestamp,
    chapters: [{ chapterId: "mock-chapter-start", progress: 63, status: "available" }],
    quests: [machineFrameQuest(40, 4)],
  });

  builder.wait(2000).progress({
    capturedAt: builder.timestamp,
    chapters: [{ chapterId: "mock-chapter-start", progress: 100, status: "completed" }],
    quests: [
      questWithProgress("mock-quest-light", {
        progress: {
          status: "completed",
          completedTasks: 1,
          totalRequiredTasks: 1,
          percentage: 100,
        },
      }),
    ],
  });

  builder.wait(1000).heartbeat(true);

  const activePinIds = BASE_PIN_IDS.filter((id) => id !== "mock-quest-light");
  const machineOverride = new Map([
    ["mock-quest-machine-frame", machineFrameQuest(40, 4)],
  ]);
  const activeQuests = (capturedAt: string): Quest[] =>
    pinsPayload(activePinIds, [], capturedAt, machineOverride).quests;
  const withUnresolved = [...activePinIds, UNRESOLVED_PIN_ID];
  builder.wait(500).pins(
    pinsPayload(withUnresolved, [UNRESOLVED_PIN_ID], builder.timestamp, machineOverride),
  );

  builder.wait(2000).pins(
    pinsPayload(activePinIds, [], builder.timestamp, machineOverride),
  );

  builder.wait(2000).heartbeat(true);

  builder.wait(1000);
  const chaptersAfterReload = [
    ...CHAPTERS,
    {
      id: "mock-chapter-reloaded",
      title: "Reloaded Chapter",
      order: 7,
      progress: 0,
      status: "available" as const,
    },
  ];
  const worldAfterChange = {
    worldName: "Synthetic World II",
    dimension: "minecraft:the_nether",
    integratedServer: true,
  } as const;
  const teamAfterChange = {
    teamId: "33333333-3333-4333-8333-333333333333",
    teamName: "Second Team",
  } as const;

  builder.snapshot(
    createSnapshot(builder.timestamp, {
      manualPinIds: activePinIds,
      chapters: chaptersAfterReload,
      quests: activeQuests(builder.timestamp),
    }),
  );

  builder.wait(2000);
  builder.snapshot(
    createSnapshot(builder.timestamp, {
      manualPinIds: activePinIds,
      chapters: chaptersAfterReload,
      quests: activeQuests(builder.timestamp),
      ...worldAfterChange,
    }),
  );

  builder.wait(2000);
  builder.snapshot(
    createSnapshot(builder.timestamp, {
      manualPinIds: activePinIds,
      chapters: chaptersAfterReload,
      quests: activeQuests(builder.timestamp),
      ...worldAfterChange,
      ...teamAfterChange,
    }),
  );

  builder.wait(1000).close();
  builder.reconnect(2000);
  builder.hello();
  builder.wait(100).status("synchronizing", "Reconnected");
  builder.wait(300).snapshot(
    createSnapshot(builder.timestamp, {
      manualPinIds: activePinIds,
      chapters: chaptersAfterReload,
      quests: activeQuests(builder.timestamp),
      ...worldAfterChange,
      ...teamAfterChange,
    }),
  );
  builder.wait(5000).heartbeat(true);
  return builder.finish(30_000);
}

const SCENARIO_BUILDERS: Record<ScenarioName, () => Scenario> = {
  unavailable: unavailableScenario,
  ready: readyScenario,
  progress: progressScenario,
  "chapter-completion": chapterCompletionScenario,
  pins: pinsScenario,
  reload: reloadScenario,
  "world-change": worldChangeScenario,
  "team-change": teamChangeScenario,
  disconnect: disconnectScenario,
  stale: staleScenario,
  full: fullScenario,
};

export function isScenarioName(value: string): value is ScenarioName {
  return (SCENARIO_NAMES as readonly string[]).includes(value);
}

export function buildScenario(name: ScenarioName): Scenario {
  const scenario = SCENARIO_BUILDERS[name]();
  if (scenario.name !== name) {
    throw new Error(`Scenario builder for "${name}" returned "${scenario.name}"`);
  }
  return scenario;
}

export function buildAllScenarios(): Scenario[] {
  return SCENARIO_NAMES.map((name) => buildScenario(name));
}
