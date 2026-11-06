import {
  createMessage,
  type Chapter,
  type MessagePayloadMap,
  type MinecraftPinsPayload,
  type MinecraftSnapshotPayload,
  type ProtocolMessage,
  type Quest,
} from "@questbridge/protocol";

/**
 * Host test fixtures.
 *
 * Synthetic identifiers only. No real ATM10 TTS identifiers appear here, so a
 * passing host test can never be mistaken for pack compatibility
 * (`docs/protocol.md` §13.2).
 */

export const MOCK_SESSION_ID = "11111111-1111-4111-8111-111111111111";

export const MOCK_HELLO_PAYLOAD: MessagePayloadMap["minecraft.hello"] = {
  modVersion: "0.1.0-test",
  minecraftVersion: "1.21.1",
  neoForgeVersion: "21.1.250",
  ftbQuestsVersion: "2101.1.30-test",
  ftbTeamsVersion: "2101.1.10-test",
};

export const MOCK_CHAPTERS: Chapter[] = [
  { id: "chapter-a", title: "First Chapter", order: 0, progress: 40, status: "available" },
  { id: "chapter-b", title: "Second Chapter", order: 1, progress: 100, status: "completed" },
  { id: "chapter-c", title: "Third Chapter", order: 2, progress: null, status: "locked" },
];

function makeQuest(id: string, chapterId: string, title: string): Quest {
  return {
    id,
    chapterId,
    title,
    optional: false,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: `${id}-task`,
        type: "ftbquests:item",
        title: "Collect items",
        optional: false,
        progress: { status: "in_progress", current: 3, target: 10, percentage: 30 },
      },
    ],
    progress: {
      status: "in_progress",
      completedTasks: 0,
      totalRequiredTasks: 1,
      percentage: 30,
    },
  };
}

export function makeSnapshot(
  overrides: Partial<MinecraftSnapshotPayload> = {},
): MinecraftSnapshotPayload {
  const quests = overrides.quests ?? [makeQuest("quest-a", "chapter-a", "First Quest")];
  return {
    worldName: "Test World",
    dimension: "minecraft:overworld",
    integratedServer: true,
    teamId: "team-test",
    teamName: "Test Team",
    chapters: MOCK_CHAPTERS,
    manualPinIds: quests.map((quest) => quest.id),
    quests,
    unresolvedPinnedQuestIds: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makePinsPayload(
  overrides: Partial<MinecraftPinsPayload> = {},
): MinecraftPinsPayload {
  return {
    capturedAt: "2026-01-01T00:00:09.000Z",
    manualPinIds: ["quest-a", "quest-missing"],
    quests: [makeQuest("quest-a", "chapter-a", "First Quest")],
    unresolvedPinnedQuestIds: ["quest-missing"],
    ...overrides,
  };
}

export function snapshotMessage(sequence: number, sessionId: string): ProtocolMessage {
  return createMessage("minecraft.snapshot", makeSnapshot(), {
    sequence,
    sessionId,
    timestamp: "2026-01-01T00:00:02.000Z",
  }) as ProtocolMessage;
}

export function progressMessage(sequence: number, sessionId: string): ProtocolMessage {
  return createMessage(
    "minecraft.progress",
    {
      capturedAt: "2026-01-01T00:00:07.000Z",
      chapters: [{ chapterId: "chapter-a", progress: 55, status: "available" }],
    },
    { sequence, sessionId, timestamp: "2026-01-01T00:00:07.000Z" },
  ) as ProtocolMessage;
}

export function heartbeatMessage(sequence: number, sessionId: string, ready = true): ProtocolMessage {
  return createMessage("minecraft.heartbeat", { ready }, { sequence, sessionId }) as ProtocolMessage;
}
