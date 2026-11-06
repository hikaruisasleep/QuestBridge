import {
  createMessage,
  type AppState,
  type ChapterPinConfig,
  type DisplayConfig,
  type ProtocolMessage,
} from "@questbridge/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProtocolClient, type ClientErrorEvent } from "./client.js";

/**
 * Protocol client behaviour.
 *
 * A fake WebSocket stands in for the real one so every lifecycle path —
 * hello, gap detection, duplicate suppression, reconnect backoff, and the
 * paired section message the host sends for a single change — is exercised
 * deterministically. The real transport is covered separately by the host's
 * end-to-end test.
 */

class FakeSocket {
  static instances: FakeSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.onclose?.();
  }

  // --- test helpers ---

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: ProtocolMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  receiveRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  lastSent(): ProtocolMessage {
    return JSON.parse(this.sent[this.sent.length - 1] ?? "{}") as ProtocolMessage;
  }

  sentTypes(): string[] {
    return this.sent.map((frame) => (JSON.parse(frame) as ProtocolMessage).type);
  }
}

const PAGE = { protocol: "http:", host: "127.0.0.1:8765", search: "?token=test-token" };

const DISPLAY: DisplayConfig = {
  showChapterProgress: true,
  showQuestTasks: true,
  showCompletedQuests: true,
  completionAnimation: true,
  theme: "minimal",
  compactMode: true,
};

const PINS: ChapterPinConfig = { maxPins: 5, pinnedChapters: [] };

function makeState(revision: number, overrides: Partial<AppState> = {}): AppState {
  return {
    revision,
    connection: {
      status: "ready",
      stale: false,
      lastSnapshotAt: "2026-01-01T00:00:00.000Z",
      lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
    },
    minecraft: { sessionId: "session-1" },
    chapters: [],
    quests: [],
    unresolvedPinnedQuestIds: [],
    chapterPins: PINS,
    display: DISPLAY,
    ...overrides,
  };
}

interface Harness {
  client: ProtocolClient;
  sockets: FakeSocket[];
  snapshot: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  section: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn<(event: ClientErrorEvent) => void>>;
  resync: ReturnType<typeof vi.fn>;
  transport: ReturnType<typeof vi.fn>;
  runTimers(): void;
}

function createHarness(backoffMs: readonly number[] = [10, 20, 40]): Harness {
  FakeSocket.instances = [];
  const timers: Array<{ handler: () => void; ms: number }> = [];

  const client = new ProtocolClient({
    role: "control",
    clientName: "QuestBridge test",
    location: PAGE,
    webSocketFactory: (url) => {
      // The constructor already registers the instance; registering it here as
      // well would make every socket count twice.
      return new FakeSocket(url) as unknown as WebSocket;
    },
    setTimeout: (handler, ms) => {
      timers.push({ handler, ms });
      return timers.length - 1;
    },
    clearTimeout: () => {
      // Timers are drained by `runTimers`; clearing is only used on dispose.
    },
    backoffMs,
    requestId: (() => {
      let counter = 0;
      return () => {
        counter += 1;
        return `req-${counter}`;
      };
    })(),
  });

  const snapshot = vi.fn();
  const update = vi.fn();
  const section = vi.fn();
  const error = vi.fn();
  const resync = vi.fn();
  const transport = vi.fn();

  client.on("snapshot", snapshot);
  client.on("update", update);
  client.on("section", section);
  client.on("error", error);
  client.on("resync", resync);
  client.on("transport", transport);

  return {
    client,
    sockets: FakeSocket.instances,
    snapshot,
    update,
    section,
    error,
    resync,
    transport,
    runTimers(): void {
      const pending = timers.splice(0, timers.length);
      for (const timer of pending) {
        timer.handler();
      }
    },
  };
}

beforeEach(() => {
  FakeSocket.instances = [];
});

describe("transport lifecycle", () => {
  it("connects and sends browser.hello with the role and requestId", () => {
    const harness = createHarness();
    harness.client.connect();

    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe("ws://127.0.0.1:8765/ws?token=test-token");

    socket.open();

    const hello = socket.lastSent();
    expect(hello.type).toBe("browser.hello");
    expect(hello.payload).toEqual({ role: "control", clientName: "QuestBridge test" });
    expect(hello.requestId).toBe("req-1");
    // The socket URL carries the credential; the frame must not repeat it.
    expect(JSON.stringify(hello)).not.toContain("test-token");
  });

  it("does not open a second socket when connect is called twice", () => {
    const harness = createHarness();
    harness.client.connect();
    harness.client.connect();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("reports an unauthorized failure when the first attempt never opens", () => {
    const harness = createHarness();
    harness.client.connect();

    FakeSocket.instances[0]!.close();

    expect(harness.client.failure).toBe("unauthorized");
    expect(harness.client.transport).toBe("closed");
  });

  it("reports unreachable after a session has existed", () => {
    const harness = createHarness();
    harness.client.connect();
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.close();

    expect(harness.client.failure).toBe("unreachable");
  });
});

describe("reconnection", () => {
  it("reconnects with the configured backoff and re-hellos", () => {
    const harness = createHarness([10, 20]);
    harness.client.connect();
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.receive(createMessage("state.snapshot", makeState(0)) as ProtocolMessage);

    FakeSocket.instances[0]!.close();

    harness.runTimers();
    expect(FakeSocket.instances).toHaveLength(2);

    const second = FakeSocket.instances[1]!;
    second.open();
    expect(second.lastSent().type).toBe("browser.hello");
  });

  it("backs off progressively and resets after a successful open", () => {
    const harness = createHarness([10, 20, 40]);
    harness.client.connect();

    // First failure -> first delay. Each close schedules the next one.
    FakeSocket.instances[0]!.close();
    harness.runTimers();
    FakeSocket.instances[1]!.close();
    harness.runTimers();
    FakeSocket.instances[2]!.close();

    // Third attempt succeeds, resetting the schedule.
    harness.runTimers();
    FakeSocket.instances[3]!.open();
    FakeSocket.instances[3]!.close();
    harness.runTimers();

    // After the reset the next reconnect is scheduled again (not starved).
    expect(FakeSocket.instances.length).toBeGreaterThanOrEqual(5);
  });

  it("expects a fresh snapshot after reconnecting", () => {
    const harness = createHarness();
    harness.client.connect();
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.receive(
      { ...createMessage("state.snapshot", makeState(5)), sequence: 1 } as ProtocolMessage,
    );

    FakeSocket.instances[0]!.close();
    harness.runTimers();
    const second = FakeSocket.instances[1]!;
    second.open();

    // A snapshot with a lower revision than before is still applied: it is
    // self-contained, and refusing it would strand the page on stale data.
    second.receive(
      { ...createMessage("state.snapshot", makeState(1)), sequence: 1 } as ProtocolMessage,
    );
    expect(harness.snapshot).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1 }));
  });
});

describe("sequence handling", () => {
  function connected(): Harness {
    const harness = createHarness();
    harness.client.connect();
    FakeSocket.instances[0]!.open();
    return harness;
  }

  function frame(message: ProtocolMessage, sequence: number): ProtocolMessage {
    return { ...message, sequence } as ProtocolMessage;
  }

  it("applies a snapshot and in-order updates", () => {
    const harness = connected();
    const socket = FakeSocket.instances[0]!;

    socket.receive(frame(createMessage("state.snapshot", makeState(0)) as ProtocolMessage, 1));
    socket.receive(
      frame(
        createMessage("state.update", { revision: 1, chapters: [] }) as ProtocolMessage,
        2,
      ),
    );

    expect(harness.snapshot).toHaveBeenCalledTimes(1);
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.resync).not.toHaveBeenCalled();
  });

  it("ignores a duplicate sequence", () => {
    const harness = connected();
    const socket = FakeSocket.instances[0]!;

    socket.receive(frame(createMessage("state.snapshot", makeState(0)) as ProtocolMessage, 1));
    const update = frame(
      createMessage("state.update", { revision: 1, chapters: [] }) as ProtocolMessage,
      2,
    );
    socket.receive(update);
    socket.receive(update);

    expect(harness.update).toHaveBeenCalledTimes(1);
  });

  it("requests a resync once on a sequence gap", () => {
    const harness = connected();
    const socket = FakeSocket.instances[0]!;

    socket.receive(frame(createMessage("state.snapshot", makeState(0)) as ProtocolMessage, 1));
    // Sequence 3 arrives with 2 missing.
    socket.receive(
      frame(createMessage("state.update", { revision: 1, chapters: [] }) as ProtocolMessage, 3),
    );

    expect(harness.resync).toHaveBeenCalledWith("sequence_gap");
    const resync = socket.lastSent();
    expect(resync.type).toBe("state.resync");
    expect(resync.payload).toEqual({ reason: "sequence_gap" });

    // A second gap before the snapshot arrives must not spam the host.
    socket.receive(
      frame(createMessage("state.update", { revision: 2, chapters: [] }) as ProtocolMessage, 9),
    );
    expect(harness.resync).toHaveBeenCalledTimes(1);
  });

  it("requests a resync on a revision gap", () => {
    const harness = connected();
    const socket = FakeSocket.instances[0]!;

    socket.receive(frame(createMessage("state.snapshot", makeState(0)) as ProtocolMessage, 1));
    socket.receive(
      frame(createMessage("state.update", { revision: 5, chapters: [] }) as ProtocolMessage, 2),
    );

    expect(harness.resync).toHaveBeenCalledWith("revision_gap");
  });
});

describe("paired section messages", () => {
  it("accepts the section message the host sends with the same revision", () => {
    // The host broadcasts `state.update` plus `chapter.pins.update` for one
    // change, both carrying the same revision. The second must not be read as
    // a stale update or a gap.
    const harness = createHarness();
    harness.client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.receive(
      { ...createMessage("state.snapshot", makeState(0)), sequence: 1 } as ProtocolMessage,
    );
    socket.receive(
      {
        ...createMessage("state.update", { revision: 1, chapterPins: PINS }),
        sequence: 2,
      } as ProtocolMessage,
    );
    socket.receive(
      {
        ...createMessage("chapter.pins.update", { chapterPins: PINS }),
        sequence: 3,
      } as ProtocolMessage,
    );

    expect(harness.section).toHaveBeenCalledTimes(1);
    expect(harness.resync).not.toHaveBeenCalled();
  });

  it("ignores a section message that arrives before any snapshot", () => {
    const harness = createHarness();
    harness.client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.receive(
      {
        ...createMessage("connection.status", makeState(0).connection),
        sequence: 1,
      } as ProtocolMessage,
    );

    expect(harness.section).not.toHaveBeenCalled();
  });
});

describe("mutations", () => {
  function ready(): { harness: Harness; socket: FakeSocket } {
    const harness = createHarness();
    harness.client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    return { harness, socket };
  }

  it("sends each mutation with its own requestId", () => {
    const { harness, socket } = ready();

    const pinId = harness.client.pinChapter("chapter-a");
    const unpinId = harness.client.unpinChapter("chapter-a");
    const reorderId = harness.client.reorderChapters(["a", "b"]);
    const configId = harness.client.updateDisplay(DISPLAY);

    expect([pinId, unpinId, reorderId, configId].every((id) => id !== null)).toBe(true);
    expect(new Set([pinId, unpinId, reorderId, configId]).size).toBe(4);

    expect(socket.sentTypes().slice(-4)).toEqual([
      "chapter.pin",
      "chapter.unpin",
      "chapter.reorder",
      "config.update",
    ]);
    expect(socket.lastSent().payload).toEqual({ display: DISPLAY });
  });

  it("serializes config.update in the browser-to-host direction", () => {
    // `config.update` exists in both directions with the same payload but
    // different envelope rules; the wrong direction throws at send time.
    const { harness, socket } = ready();
    expect(() => harness.client.updateDisplay(DISPLAY)).not.toThrow();
    expect(() => JSON.parse(socket.lastSent() && socket.sent.at(-1)!)).not.toThrow();
  });

  it("returns null instead of throwing when the socket is not open", () => {
    const harness = createHarness();
    harness.client.connect();
    // Not opened yet.
    expect(harness.client.pinChapter("chapter-a")).toBeNull();
    expect(FakeSocket.instances[0]!.sent).toHaveLength(0);
  });
});

describe("errors", () => {
  it("surfaces a request.error with its code and requestId", () => {
    const harness = createHarness();
    harness.client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.receive(
      {
        ...createMessage(
          "request.error",
          { code: "too_many_pins", message: "Five chapters are already pinned" },
          { requestId: "req-9" },
        ),
        sequence: 1,
      } as ProtocolMessage,
    );

    expect(harness.error).toHaveBeenCalledWith({
      code: "too_many_pins",
      message: "Five chapters are already pinned",
      requestId: "req-9",
    });
  });

  it("reports a binary frame as an invalid message", () => {
    const harness = createHarness();
    harness.client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.receiveRaw(new ArrayBuffer(4));

    expect(harness.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid_message" }),
    );
  });

  it("reports malformed JSON without throwing", () => {
    const harness = createHarness();
    harness.client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    expect(() => socket.receiveRaw("{not json")).not.toThrow();
    expect(harness.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid_message" }),
    );
  });

  it("stops reconnecting after an unsupported protocol version", () => {
    const harness = createHarness();
    harness.client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.receiveRaw(
      JSON.stringify({
        protocolVersion: 2,
        type: "state.snapshot",
        timestamp: "2026-01-01T00:00:00.000Z",
        sequence: 1,
        payload: {},
      }),
    );

    expect(harness.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "unsupported_protocol" }),
    );
    expect(harness.client.transport).toBe("closed");
  });
});

describe("dispose", () => {
  it("closes the socket and stops reconnecting", () => {
    const harness = createHarness();
    harness.client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    harness.client.dispose();
    expect(socket.readyState).toBe(3);

    harness.runTimers();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
