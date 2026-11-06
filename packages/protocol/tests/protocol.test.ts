import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  ProtocolError,
  RevisionTracker,
  SequenceCounter,
  SequenceTracker,
  chapterPinConfigSchema,
  createMessage,
  displayConfigSchema,
  parseFrame,
  parseMessage,
  serializeMessage,
  type MessageDirection,
  type ProtocolMessage,
} from "../src/index.js";

import {
  APP_STATE,
  CHAPTERS,
  DISPLAY,
  NOW,
  PINS,
  QUESTS,
  SESSION_ID,
  SNAPSHOT,
} from "./fixtures.js";

function expectProtocolError(fn: () => unknown, code: string): ProtocolError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolError);
    const protocolError = error as ProtocolError;
    expect(protocolError.code).toBe(code);
    return protocolError;
  }
  throw new Error(`Expected ProtocolError with code "${code}"`);
}

const HELLO = createMessage(
  "minecraft.hello",
  {
    modVersion: "0.1.0",
    minecraftVersion: "1.21.1",
    neoForgeVersion: "21.1.250",
    ftbQuestsVersion: "2101.1.30",
    ftbTeamsVersion: "2101.1.10",
  },
  { sequence: 1, sessionId: SESSION_ID, timestamp: NOW },
);

const STATUS = createMessage(
  "minecraft.status",
  { phase: "synchronizing", detail: "Waiting for quest data" },
  { sequence: 2, sessionId: SESSION_ID, timestamp: NOW },
);

const SNAPSHOT_MESSAGE = createMessage(
  "minecraft.snapshot",
  SNAPSHOT,
  { sequence: 3, sessionId: SESSION_ID, timestamp: NOW },
);

const PROGRESS = createMessage(
  "minecraft.progress",
  {
    capturedAt: NOW,
    chapters: [{ chapterId: "mock-chapter-01", progress: 61, status: "available" }],
    quests: [QUESTS[0]!],
  },
  { sequence: 4, sessionId: SESSION_ID, timestamp: NOW },
);

const PINS_MESSAGE = createMessage(
  "minecraft.pins",
  PINS,
  { sequence: 5, sessionId: SESSION_ID, timestamp: NOW },
);

const HEARTBEAT = createMessage(
  "minecraft.heartbeat",
  { ready: true },
  { sequence: 6, sessionId: SESSION_ID, timestamp: NOW },
);

const WELCOME = createMessage(
  "host.welcome",
  {
    hostVersion: "0.1.0",
    heartbeatIntervalMs: 5000,
    staleAfterMs: 10000,
    disconnectAfterMs: 15000,
    reconcileIntervalMs: 2000,
  },
  { timestamp: NOW },
);

const REQUEST_SNAPSHOT = createMessage(
  "host.request_snapshot",
  { reason: "sequence_gap" },
  { timestamp: NOW },
);

const HOST_ERROR = createMessage(
  "host.error",
  { code: "unsupported_protocol", message: "Unsupported protocol", fatal: true },
  { timestamp: NOW },
);

const BROWSER_HELLO = createMessage(
  "browser.hello",
  { role: "control", clientName: "Protocol test" },
  { timestamp: NOW },
);

const CHAPTER_PIN = createMessage(
  "chapter.pin",
  { chapterId: "mock-chapter-01" },
  { requestId: "pin-1", timestamp: NOW },
);

const CHAPTER_UNPIN = createMessage(
  "chapter.unpin",
  { chapterId: "mock-chapter-01" },
  { requestId: "unpin-1", timestamp: NOW },
);

const CHAPTER_REORDER = createMessage(
  "chapter.reorder",
  { chapterIds: ["mock-chapter-02", "mock-chapter-01"] },
  { requestId: "reorder-1", timestamp: NOW },
);

const CONFIG_UPDATE_BROWSER = createMessage(
  "config.update",
  { display: DISPLAY },
  { requestId: "config-1", timestamp: NOW },
);

const STATE_RESYNC = createMessage(
  "state.resync",
  { reason: "sequence_gap" },
  { requestId: "resync-1", timestamp: NOW },
);

const STATE_SNAPSHOT = createMessage(
  "state.snapshot",
  APP_STATE,
  { sequence: 1, timestamp: NOW },
);

const STATE_UPDATE = createMessage(
  "state.update",
  { revision: 1, connection: APP_STATE.connection },
  { sequence: 2, timestamp: NOW },
);

const CHAPTER_PINS_UPDATE = createMessage(
  "chapter.pins.update",
  { chapterPins: APP_STATE.chapterPins },
  { sequence: 3, timestamp: NOW },
);

const CONFIG_UPDATE_HOST = createMessage(
  "config.update",
  { display: DISPLAY },
  { sequence: 4, timestamp: NOW },
);

const CONNECTION_STATUS = createMessage(
  "connection.status",
  APP_STATE.connection,
  { sequence: 5, timestamp: NOW },
);

const REQUEST_ERROR = createMessage(
  "request.error",
  { code: "too_many_pins", message: "Five chapters are already pinned" },
  { sequence: 6, requestId: "pin-1", timestamp: NOW },
);

const MESSAGES: Array<{ direction: MessageDirection; message: ProtocolMessage }> = [
  { direction: "minecraft_to_host", message: HELLO },
  { direction: "minecraft_to_host", message: STATUS },
  { direction: "minecraft_to_host", message: SNAPSHOT_MESSAGE },
  { direction: "minecraft_to_host", message: PROGRESS },
  { direction: "minecraft_to_host", message: PINS_MESSAGE },
  { direction: "minecraft_to_host", message: HEARTBEAT },
  { direction: "host_to_minecraft", message: WELCOME },
  { direction: "host_to_minecraft", message: REQUEST_SNAPSHOT },
  { direction: "host_to_minecraft", message: HOST_ERROR },
  { direction: "browser_to_host", message: BROWSER_HELLO },
  { direction: "browser_to_host", message: CHAPTER_PIN },
  { direction: "browser_to_host", message: CHAPTER_UNPIN },
  { direction: "browser_to_host", message: CHAPTER_REORDER },
  { direction: "browser_to_host", message: CONFIG_UPDATE_BROWSER },
  { direction: "browser_to_host", message: STATE_RESYNC },
  { direction: "host_to_browser", message: STATE_SNAPSHOT },
  { direction: "host_to_browser", message: STATE_UPDATE },
  { direction: "host_to_browser", message: CHAPTER_PINS_UPDATE },
  { direction: "host_to_browser", message: CONFIG_UPDATE_HOST },
  { direction: "host_to_browser", message: CONNECTION_STATUS },
  { direction: "host_to_browser", message: REQUEST_ERROR },
];

describe("message catalog", () => {
  it.each(MESSAGES)("round-trips a valid $message.type", ({ direction, message }) => {
    const wire = serializeMessage(message, direction);
    const parsed = parseFrame(wire, direction);
    expect(parsed).toEqual(message);
    expect(parsed.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("serializes to strict JSON with no undefined values lost", () => {
    const wire = serializeMessage(PINS_MESSAGE, "minecraft_to_host");
    expect(wire).toContain('"type":"minecraft.pins"');
    expect(JSON.parse(wire)).toEqual(PINS_MESSAGE);
  });

  it("rejects invalid JSON", () => {
    expectProtocolError(() => parseFrame("{not json", "minecraft_to_host"), "invalid_message");
  });

  it("rejects a non-object message", () => {
    expectProtocolError(() => parseMessage([], "minecraft_to_host"), "invalid_message");
  });

  it("rejects an unsupported protocol version before payload validation", () => {
    const message = { ...HELLO, protocolVersion: 2, payload: { anything: true } };
    const error = expectProtocolError(
      () => parseMessage(message, "minecraft_to_host"),
      "unsupported_protocol",
    );
    expect(error.fatal).toBe(true);
  });

  it("rejects a non-integer protocol version as invalid", () => {
    expectProtocolError(
      () => parseMessage({ ...HELLO, protocolVersion: "1" }, "minecraft_to_host"),
      "invalid_message",
    );
  });

  it("rejects an unknown message type", () => {
    expectProtocolError(
      () => parseMessage({ ...HELLO, type: "minecraft.unknown" }, "minecraft_to_host"),
      "invalid_message",
    );
  });

  it("rejects a valid type on the wrong direction", () => {
    expectProtocolError(
      () => parseMessage(BROWSER_HELLO, "minecraft_to_host"),
      "invalid_message",
    );
    expectProtocolError(
      () => parseMessage(HEARTBEAT, "host_to_browser"),
      "invalid_message",
    );
  });

  it("rejects missing payloads", () => {
    const { payload: _payload, ...withoutPayload } = HELLO;
    expectProtocolError(
      () => parseMessage(withoutPayload, "minecraft_to_host"),
      "invalid_message",
    );
  });

  it("rejects unknown envelope fields", () => {
    expectProtocolError(
      () => parseMessage({ ...HELLO, extra: true }, "minecraft_to_host"),
      "invalid_message",
    );
  });

  it("rejects unknown payload fields", () => {
    expectProtocolError(
      () =>
        parseMessage(
          { ...HEARTBEAT, payload: { ready: true, extra: 1 } },
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("requires sequence and sessionId on minecraft messages", () => {
    const { sequence: _sequence, ...withoutSequence } = HEARTBEAT;
    expectProtocolError(
      () => parseMessage(withoutSequence, "minecraft_to_host"),
      "invalid_message",
    );

    const { sessionId: _sessionId, ...withoutSession } = HEARTBEAT;
    expectProtocolError(
      () => parseMessage(withoutSession, "minecraft_to_host"),
      "invalid_message",
    );
  });

  it("forbids sessionId on browser messages", () => {
    expectProtocolError(
      () => parseMessage({ ...BROWSER_HELLO, sessionId: SESSION_ID }, "browser_to_host"),
      "invalid_message",
    );
  });

  it("forbids sequence on host-to-Minecraft control messages", () => {
    expectProtocolError(
      () => parseMessage({ ...WELCOME, sequence: 1 }, "host_to_minecraft"),
      "invalid_message",
    );
  });

  it("requires sequence on host-to-browser messages", () => {
    const { sequence: _sequence, ...withoutSequence } = STATE_SNAPSHOT;
    expectProtocolError(
      () => parseMessage(withoutSequence, "host_to_browser"),
      "invalid_message",
    );
  });

  it("rejects oversized frames before parsing", () => {
    expectProtocolError(
      () => parseFrame("x".repeat(MAX_MESSAGE_BYTES + 1), "minecraft_to_host"),
      "message_too_large",
    );
  });

  it("rejects wrong field types", () => {
    expectProtocolError(
      () =>
        parseMessage(
          { ...SNAPSHOT_MESSAGE, payload: { ...SNAPSHOT, integratedServer: "no" } },
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });
});

describe("chapter and quest invariants", () => {
  it("rejects duplicate chapter ids", () => {
    const chapters = [CHAPTERS[0]!, { ...CHAPTERS[0]!, order: 99 }];
    expectProtocolError(
      () =>
        parseMessage(
          createMessage(
            "minecraft.snapshot",
            { ...SNAPSHOT, chapters, quests: [], manualPinIds: [], unresolvedPinnedQuestIds: [] },
            { sequence: 1, sessionId: SESSION_ID },
          ),
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("rejects duplicate chapter order values", () => {
    const chapters = [CHAPTERS[0]!, { ...CHAPTERS[1]!, order: 0 }];
    expectProtocolError(
      () =>
        parseMessage(
          createMessage(
            "minecraft.snapshot",
            { ...SNAPSHOT, chapters, quests: [], manualPinIds: [], unresolvedPinnedQuestIds: [] },
            { sequence: 1, sessionId: SESSION_ID },
          ),
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("rejects duplicate quest ids", () => {
    const quests = [QUESTS[0]!, { ...QUESTS[1]!, id: QUESTS[0]!.id }];
    expectProtocolError(
      () =>
        parseMessage(
          { ...SNAPSHOT_MESSAGE, payload: { ...SNAPSHOT, quests } },
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("rejects duplicate task ids within a quest", () => {
    const quest = {
      ...QUESTS[0]!,
      tasks: [QUESTS[0]!.tasks[0]!, { ...QUESTS[0]!.tasks[1]!, id: QUESTS[0]!.tasks[0]!.id }],
    };
    expectProtocolError(
      () =>
        parseMessage(
          {
            ...SNAPSHOT_MESSAGE,
            payload: {
              ...SNAPSHOT,
              quests: [quest, QUESTS[1]!],
            },
          },
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("rejects completedTasks greater than totalRequiredTasks", () => {
    const quest = {
      ...QUESTS[0]!,
      progress: { status: "in_progress", completedTasks: 2, totalRequiredTasks: 1, percentage: 50 },
    };
    expectProtocolError(
      () =>
        parseMessage(
          { ...SNAPSHOT_MESSAGE, payload: { ...SNAPSHOT, quests: [quest, QUESTS[1]!] } },
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("rejects out-of-range chapter progress", () => {
    const chapters = [{ ...CHAPTERS[0]!, progress: 101 }, ...CHAPTERS.slice(1)];
    expectProtocolError(
      () =>
        parseMessage(
          { ...SNAPSHOT_MESSAGE, payload: { ...SNAPSHOT, chapters } },
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("rejects out-of-range task percentage", () => {
    const quest = {
      ...QUESTS[0]!,
      tasks: [
        {
          ...QUESTS[0]!.tasks[0]!,
          progress: { status: "in_progress", percentage: 101 },
        },
      ],
    };
    expectProtocolError(
      () =>
        parseMessage(
          { ...SNAPSHOT_MESSAGE, payload: { ...SNAPSHOT, quests: [quest, QUESTS[1]!] } },
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("preserves null progress instead of coercing to zero", () => {
    const parsed = parseMessage(SNAPSHOT_MESSAGE, "minecraft_to_host");
    if (parsed.type !== "minecraft.snapshot") {
      throw new Error("unexpected type");
    }
    expect(parsed.payload.chapters[2]?.progress).toBeNull();
  });

  it("treats completion as independent from progress", () => {
    const chapters = [
      { ...CHAPTERS[0]!, progress: 100, status: "available" as const },
      { ...CHAPTERS[1]!, progress: 0, status: "completed" as const },
    ];
    const parsed = parseMessage(
      { ...SNAPSHOT_MESSAGE, payload: { ...SNAPSHOT, chapters, quests: [], manualPinIds: [], unresolvedPinnedQuestIds: [] } },
      "minecraft_to_host",
    );
    if (parsed.type !== "minecraft.snapshot") {
      throw new Error("unexpected type");
    }
    expect(parsed.payload.chapters[0]?.status).toBe("available");
    expect(parsed.payload.chapters[1]?.status).toBe("completed");
  });

  it("rejects a resolved quest whose chapter is missing", () => {
    expectProtocolError(
      () =>
        parseMessage(
          { ...SNAPSHOT_MESSAGE, payload: { ...SNAPSHOT, chapters: [] } },
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("accepts a completed quest disappearing from manual pins", () => {
    const pins = {
      capturedAt: NOW,
      manualPinIds: ["mock-quest-01"],
      quests: [QUESTS[0]!],
      unresolvedPinnedQuestIds: [],
    };
    const parsed = parseMessage(
      createMessage("minecraft.pins", pins, { sequence: 1, sessionId: SESSION_ID }),
      "minecraft_to_host",
    );
    if (parsed.type !== "minecraft.pins") {
      throw new Error("unexpected type");
    }
    expect(parsed.payload.manualPinIds).not.toContain("mock-quest-02");
  });
});

describe("manual pin objective-set invariants", () => {
  const buildPins = (manualPinIds: string[], quests: typeof SNAPSHOT.quests, unresolved: string[]) =>
    createMessage(
      "minecraft.pins",
      { capturedAt: NOW, manualPinIds, quests, unresolvedPinnedQuestIds: unresolved },
      { sequence: 1, sessionId: SESSION_ID },
    );

  it("rejects the automatic pin id", () => {
    const error = expectProtocolError(
      () => parseMessage(buildPins(["1"], [], []), "minecraft_to_host"),
      "invalid_message",
    );
    expect(JSON.stringify(error.details)).toContain("Automatic pin id");
  });

  it("rejects duplicate manual pin ids", () => {
    expectProtocolError(
      () =>
        parseMessage(
          buildPins(["mock-quest-01", "mock-quest-01"], [QUESTS[0]!], []),
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("rejects a pin that is neither resolved nor unresolved", () => {
    expectProtocolError(
      () => parseMessage(buildPins(["mock-quest-01", "ghost"], [QUESTS[0]!], []), "minecraft_to_host"),
      "invalid_message",
    );
  });

  it("rejects a resolved quest absent from manual pins", () => {
    expectProtocolError(
      () => parseMessage(buildPins([], [QUESTS[0]!], []), "minecraft_to_host"),
      "invalid_message",
    );
  });

  it("rejects unresolved ids that are not in manual pins", () => {
    expectProtocolError(
      () => parseMessage(buildPins(["mock-quest-01"], [QUESTS[0]!], ["ghost"]), "minecraft_to_host"),
      "invalid_message",
    );
  });

  it("rejects an id that is both resolved and unresolved", () => {
    expectProtocolError(
      () =>
        parseMessage(
          buildPins(["mock-quest-01"], [QUESTS[0]!], ["mock-quest-01"]),
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("rejects unresolved ids that are not sorted ascending", () => {
    const quests = [QUESTS[0]!, QUESTS[1]!];
    expectProtocolError(
      () =>
        parseMessage(
          buildPins(
            ["mock-quest-01", "mock-quest-02", "zzz", "aaa"],
            quests,
            ["zzz", "aaa"],
          ),
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("rejects resolved quests out of manual pin order", () => {
    expectProtocolError(
      () =>
        parseMessage(
          buildPins(["mock-quest-01", "mock-quest-02"], [QUESTS[1]!, QUESTS[0]!], []),
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("requires at least one changed section in progress updates", () => {
    expectProtocolError(
      () =>
        parseMessage(
          createMessage(
            "minecraft.progress",
            { capturedAt: NOW },
            { sequence: 1, sessionId: SESSION_ID },
          ),
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });

  it("rejects duplicate chapter progress ids", () => {
    const update = {
      capturedAt: NOW,
      chapters: [
        { chapterId: "mock-chapter-01", progress: 1, status: "available" as const },
        { chapterId: "mock-chapter-01", progress: 2, status: "available" as const },
      ],
    };
    expectProtocolError(
      () =>
        parseMessage(
          createMessage("minecraft.progress", update, {
            sequence: 1,
            sessionId: SESSION_ID,
          }),
          "minecraft_to_host",
        ),
      "invalid_message",
    );
  });
});

describe("chapter pin configuration", () => {
  const config = (pinnedChapters: Array<{ chapterId: string; position: number }>) => ({
    maxPins: 5 as const,
    pinnedChapters,
  });

  it("accepts an empty configuration", () => {
    expect(chapterPinConfigSchema.safeParse(config([])).success).toBe(true);
  });

  it.each([1, 2, 3, 4, 5])("accepts %i contiguous pins", (count) => {
    const pins = Array.from({ length: count }, (_, position) => ({
      chapterId: `chapter-${position}`,
      position,
    }));
    expect(chapterPinConfigSchema.safeParse(config(pins)).success).toBe(true);
  });

  it("rejects six pins", () => {
    const pins = Array.from({ length: 6 }, (_, position) => ({
      chapterId: `chapter-${position}`,
      position,
    }));
    expect(chapterPinConfigSchema.safeParse(config(pins)).success).toBe(false);
  });

  it("rejects duplicate chapter ids", () => {
    expect(
      chapterPinConfigSchema.safeParse(
        config([
          { chapterId: "chapter-a", position: 0 },
          { chapterId: "chapter-a", position: 1 },
        ]),
      ).success,
    ).toBe(false);
  });

  it("rejects non-contiguous or unordered positions", () => {
    expect(
      chapterPinConfigSchema.safeParse(
        config([
          { chapterId: "chapter-a", position: 0 },
          { chapterId: "chapter-b", position: 2 },
        ]),
      ).success,
    ).toBe(false);

    expect(
      chapterPinConfigSchema.safeParse(
        config([
          { chapterId: "chapter-a", position: 1 },
          { chapterId: "chapter-b", position: 0 },
        ]),
      ).success,
    ).toBe(false);
  });

  it("accepts unresolved chapter ids", () => {
    expect(
      chapterPinConfigSchema.safeParse(
        config([{ chapterId: "chapter-not-in-catalog", position: 0 }]),
      ).success,
    ).toBe(true);
  });
});

describe("display configuration", () => {
  it("accepts a complete configuration", () => {
    expect(displayConfigSchema.safeParse(DISPLAY).success).toBe(true);
  });

  it("rejects a partial configuration", () => {
    expect(displayConfigSchema.safeParse({ showChapterProgress: true }).success).toBe(false);
  });

  it("rejects an unknown theme", () => {
    expect(displayConfigSchema.safeParse({ ...DISPLAY, theme: "fancy" }).success).toBe(false);
  });
});

describe("state messages", () => {
  it("rejects an empty state.update", () => {
    expectProtocolError(
      () =>
        parseMessage(
          createMessage("state.update", { revision: 1 }, { sequence: 1 }),
          "host_to_browser",
        ),
      "invalid_message",
    );
  });

  it("rejects state with a quest from an unknown chapter", () => {
    expectProtocolError(
      () =>
        parseMessage(
          createMessage(
            "state.snapshot",
            { ...APP_STATE, chapters: [] },
            { sequence: 1 },
          ),
          "host_to_browser",
        ),
      "invalid_message",
    );
  });

  it("rejects a partial display payload in config.update", () => {
    expectProtocolError(
      () =>
        parseMessage(
          createMessage(
            "config.update",
            { display: { showChapterProgress: true } as never },
            { sequence: 1 },
          ),
          "host_to_browser",
        ),
      "invalid_message",
    );
  });
});

describe("sequence tracking", () => {
  it("accepts in-order sequences and ignores duplicates", () => {
    const tracker = new SequenceTracker();
    expect(tracker.observe(1)).toBe("accepted");
    expect(tracker.observe(2)).toBe("accepted");
    expect(tracker.observe(2)).toBe("duplicate");
    expect(tracker.observe(1)).toBe("duplicate");
  });

  it("reports gaps without advancing the accepted sequence", () => {
    const tracker = new SequenceTracker();
    expect(tracker.observe(1)).toBe("accepted");
    expect(tracker.observe(3)).toBe("gap");
    expect(tracker.lastAccepted).toBe(1);
    expect(tracker.observe(2)).toBe("accepted");
  });

  it("accepts a snapshot across a gap and resets expectation", () => {
    const tracker = new SequenceTracker();
    expect(tracker.observe(1)).toBe("accepted");
    expect(tracker.observe(9, { snapshot: true })).toBe("accepted");
    expect(tracker.lastAccepted).toBe(9);
    expect(tracker.observe(10)).toBe("accepted");
    expect(tracker.observe(9)).toBe("duplicate");
  });

  it("resets", () => {
    const tracker = new SequenceTracker();
    tracker.observe(4, { snapshot: true });
    tracker.reset();
    expect(tracker.lastAccepted).toBe(0);
    expect(tracker.observe(1)).toBe("accepted");
  });
});

describe("revision tracking", () => {
  it("accepts in-order revisions and ignores stale ones", () => {
    const tracker = new RevisionTracker();
    expect(tracker.observe(0)).toBe("accepted");
    expect(tracker.observe(1)).toBe("accepted");
    expect(tracker.observe(1)).toBe("stale");
    expect(tracker.observe(0)).toBe("stale");
  });

  it("reports revision gaps", () => {
    const tracker = new RevisionTracker();
    expect(tracker.observe(0)).toBe("accepted");
    expect(tracker.observe(3)).toBe("gap");
    expect(tracker.lastRevision).toBe(0);
  });

  it("accepts a snapshot across a gap", () => {
    const tracker = new RevisionTracker();
    expect(tracker.observe(7, { snapshot: true })).toBe("accepted");
    expect(tracker.observe(8)).toBe("accepted");
    expect(tracker.observe(7)).toBe("stale");
  });
});

describe("sequence counter", () => {
  it("starts at one and is monotonic", () => {
    const counter = new SequenceCounter();
    expect(counter.next()).toBe(1);
    expect(counter.next()).toBe(2);
    expect(counter.next()).toBe(3);
  });

  it("resets to one", () => {
    const counter = new SequenceCounter();
    counter.next();
    counter.next();
    counter.reset();
    expect(counter.next()).toBe(1);
  });
});
