import { createMessage, type ProtocolMessage } from "@questbridge/protocol";
import { describe, expect, it } from "vitest";

import { openWebSocketTransport, playScenario } from "../src/client.js";
import { CollectorModel } from "../src/collector-model.js";
import { startCollector } from "../src/collector.js";
import {
  MOCK_NOW,
  MOCK_SESSION_ID,
  timestampAt,
} from "../src/fixtures.js";
import { buildScenario, type Scenario } from "../src/scenarios.js";

function feed(model: CollectorModel, scenario: Scenario, maxAtMs = Number.POSITIVE_INFINITY): void {
  for (const event of scenario.events) {
    if (event.kind === "send" && event.atMs <= maxAtMs) {
      model.ingest(event.message);
    }
  }
}

function heartbeat(sequence: number, offsetMs: number): ProtocolMessage {
  return createMessage(
    "minecraft.heartbeat",
    { ready: true },
    { sequence, sessionId: MOCK_SESSION_ID, timestamp: timestampAt(offsetMs) },
  );
}

describe("collector state model", () => {
  it("builds normalized state from the ready scenario", () => {
    const model = new CollectorModel();
    feed(model, buildScenario("ready"));

    expect(model.state.status).toBe("ready");
    expect(model.state.stale).toBe(false);
    expect(model.state.hello?.minecraftVersion).toBe("1.21.1");
    expect(model.state.worldName).toBe("Synthetic World");
    expect(model.state.teamName).toBe("Synthetic Team");
    expect(model.state.chapters.size).toBe(7);
    expect(model.state.manualPinIds).toHaveLength(4);
    expect(model.state.quests.size).toBe(4);
    expect(model.state.counts.snapshots).toBe(1);
    expect(model.state.counts.heartbeats).toBe(1);
  });

  it("applies progress and pin updates while preserving objective order", () => {
    const model = new CollectorModel();
    feed(model, buildScenario("progress"));

    expect(model.state.counts.progressUpdates).toBe(2);
    expect(model.state.counts.pinUpdates).toBe(1);
    expect(model.state.manualPinIds).not.toContain("mock-quest-light");
    expect(model.state.chapters.get("mock-chapter-start")?.status).toBe("completed");
    expect(model.state.chapters.get("mock-chapter-start")?.progress).toBe(100);
    expect(model.state.quests.get("mock-quest-machine-frame")?.progress.percentage).toBe(40);

    const summary = model.summaryLines().join("\n");
    expect(summary).toContain("Synthetic World");
    expect(summary).toContain("Craft a Machine Frame");
    expect(summary).toContain("Forty-Two Chests");
  });

  it("tracks an unresolved manual pin until it is removed", () => {
    const model = new CollectorModel();
    const scenario = buildScenario("pins");

    feed(model, scenario, 7_000);
    expect(model.state.manualPinIds).toHaveLength(5);
    expect(model.state.unresolvedPinnedQuestIds).toEqual(["mock-quest-missing"]);
    expect(model.state.quests.has("mock-quest-missing")).toBe(false);

    feed(model, scenario);
    expect(model.state.manualPinIds).toHaveLength(3);
    expect(model.state.unresolvedPinnedQuestIds).toEqual([]);
    expect(model.state.manualPinIds).not.toContain("mock-quest-light");
  });

  it("maps status phases and waits for a snapshot before reporting ready", () => {
    const model = new CollectorModel();
    feed(model, buildScenario("unavailable"));
    expect(model.state.status).toBe("connected");
    expect(model.state.stale).toBe(true);
    expect(model.state.counts.snapshots).toBe(0);

    model.ingest(
      createMessage(
        "minecraft.status",
        { phase: "ready" },
        { sequence: 2, sessionId: MOCK_SESSION_ID, timestamp: MOCK_NOW },
      ),
    );
    expect(model.state.status).toBe("synchronizing");
  });

  it("marks retained state stale after the heartbeat threshold and recovers", () => {
    const model = new CollectorModel();
    feed(model, buildScenario("ready"));
    const lastHeartbeat = model.state.lastHeartbeatReceivedAtMs!;

    expect(model.markStaleIfNeeded(lastHeartbeat + 5_000, 10_000)).toBeNull();
    const stale = model.markStaleIfNeeded(lastHeartbeat + 10_001, 10_000);
    expect(stale?.level).toBe("warn");
    expect(model.state.stale).toBe(true);

    model.ingest(heartbeat(7, 20_000));
    expect(model.state.stale).toBe(false);
    expect(model.state.lastHeartbeatAt).toBe(timestampAt(20_000));
  });

  it("retains the last snapshot after disconnect but marks it disconnected", () => {
    const model = new CollectorModel();
    feed(model, buildScenario("ready"));
    model.connectionClosed("test");

    expect(model.state.status).toBe("disconnected");
    expect(model.state.stale).toBe(true);
    expect(model.state.chapters.size).toBe(7);
    expect(model.state.manualPinIds).toHaveLength(4);
  });

  it("ignores progress for unknown chapters and quests", () => {
    const model = new CollectorModel();
    feed(model, buildScenario("ready"));

    const notices = model.ingest(
      createMessage(
        "minecraft.progress",
        {
          capturedAt: MOCK_NOW,
          chapters: [{ chapterId: "unknown-chapter", progress: 1, status: "available" }],
          quests: [],
        },
        { sequence: 7, sessionId: MOCK_SESSION_ID, timestamp: MOCK_NOW },
      ),
    );

    expect(model.state.chapters.size).toBe(7);
    expect(notices.some((entry) => entry.level === "warn")).toBe(true);
  });
});

describe("standalone collector server", () => {
  it("receives the full mock lifecycle and reports final state", async () => {
    const logs: string[] = [];
    const handle = await startCollector({
      port: 0,
      log: (text) => logs.push(text),
    });

    try {
      await playScenario(buildScenario("full"), {
        open: () => openWebSocketTransport(handle.url),
        sleep: async () => {},
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handle.model.state.counts.snapshots).toBe(5);
      expect(handle.model.state.counts.progressUpdates).toBe(2);
      expect(handle.model.state.counts.pinUpdates).toBe(2);
      expect(handle.model.state.chapters.size).toBe(8);
      expect(handle.model.state.worldName).toBe("Synthetic World II");
      expect(handle.model.state.teamName).toBe("Second Team");
      expect(handle.model.state.manualPinIds).not.toContain("mock-quest-light");
      expect(handle.model.state.status).toBe("disconnected");
      expect(logs.some((text) => text.includes("snapshot"))).toBe(true);
    } finally {
      await handle.close();
    }
  }, 15_000);
});
