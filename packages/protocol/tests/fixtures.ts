import type {
  AppState,
  Chapter,
  DisplayConfig,
  MinecraftPinsPayload,
  MinecraftSnapshotPayload,
  Quest,
} from "../src/index.js";

/** Fixed timestamp so protocol tests are reproducible. */
export const NOW = "2026-01-01T00:00:00.000Z";

/** Synthetic session id; never a real Minecraft session. */
export const SESSION_ID = "00000000-0000-4000-8000-0000000000aa";

export const DISPLAY: DisplayConfig = {
  showChapterProgress: true,
  showQuestTasks: true,
  showCompletedQuests: true,
  completionAnimation: true,
  theme: "minimal",
  compactMode: true,
};

export const CHAPTERS: Chapter[] = [
  {
    id: "mock-chapter-01",
    title: "First Steps",
    subtitle: "Synthetic protocol fixture",
    order: 0,
    progress: 60,
    status: "available",
  },
  {
    id: "mock-chapter-02",
    title: "Power",
    order: 1,
    progress: 100,
    status: "completed",
  },
  {
    id: "mock-chapter-03",
    title: "Storage",
    order: 2,
    progress: null,
    status: "unknown",
  },
  {
    id: "mock-chapter-04",
    title: "Endgame",
    order: 3,
    progress: 0,
    status: "locked",
  },
  {
    id: "mock-chapter-05",
    title: "Bonus",
    order: 4,
    progress: 100,
    status: "available",
  },
  {
    id: "mock-chapter-06",
    title: "Side Quests",
    order: 5,
    progress: 25,
    status: "available",
  },
];

export const QUESTS: Quest[] = [
  {
    id: "mock-quest-01",
    chapterId: "mock-chapter-01",
    title: "Craft a Machine Frame",
    description: "Synthetic fixture quest",
    optional: false,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-01",
        type: "ftbquests:item",
        title: "Machine Frame",
        optional: false,
        progress: { status: "in_progress", current: 3, target: 10, percentage: 30 },
      },
      {
        id: "mock-task-02",
        type: "ftbquests:checkmark",
        title: "Optional checkmark",
        optional: true,
        progress: { status: "completed", percentage: 100 },
      },
    ],
    progress: {
      status: "in_progress",
      completedTasks: 0,
      totalRequiredTasks: 1,
      percentage: 30,
    },
  },
  {
    id: "mock-quest-02",
    chapterId: "mock-chapter-02",
    title: "Light the World",
    optional: false,
    hidden: false,
    dependencies: ["mock-quest-01"],
    tasks: [
      {
        id: "mock-task-03",
        type: "ftbquests:checkmark",
        title: "Place a light",
        optional: false,
        progress: { status: "completed", percentage: 100 },
      },
    ],
    progress: {
      status: "completed",
      completedTasks: 1,
      totalRequiredTasks: 1,
      percentage: 100,
    },
  },
  {
    id: "mock-quest-03",
    chapterId: "mock-chapter-03",
    title: "Forty-Two Chests",
    optional: true,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-04",
        type: "ftbquests:item",
        title: "Chest",
        optional: false,
        progress: { status: "incomplete", current: 0, target: 42, percentage: 0 },
      },
    ],
    progress: {
      status: "locked",
      completedTasks: 0,
      totalRequiredTasks: 1,
      percentage: 0,
    },
  },
  {
    id: "mock-quest-04",
    chapterId: "mock-chapter-06",
    title: "Secret Detour",
    optional: true,
    hidden: true,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-05",
        type: "ftbquests:advancement",
        optional: true,
        progress: { status: "unknown", percentage: null },
      },
    ],
    progress: {
      status: "available",
      completedTasks: 0,
      totalRequiredTasks: 0,
      percentage: null,
    },
  },
];

export const SNAPSHOT: MinecraftSnapshotPayload = {
  worldName: "Synthetic World",
  dimension: "minecraft:overworld",
  integratedServer: false,
  teamId: "00000000-0000-4000-8000-0000000000bb",
  teamName: "Synthetic Team",
  chapters: CHAPTERS,
  manualPinIds: ["mock-quest-01", "mock-quest-02", "mock-quest-missing"],
  quests: [QUESTS[0]!, QUESTS[1]!],
  unresolvedPinnedQuestIds: ["mock-quest-missing"],
  capturedAt: NOW,
};

export const PINS: MinecraftPinsPayload = {
  capturedAt: NOW,
  manualPinIds: ["mock-quest-01", "mock-quest-02"],
  quests: [QUESTS[0]!, QUESTS[1]!],
  unresolvedPinnedQuestIds: [],
};

export const APP_STATE: AppState = {
  revision: 0,
  connection: {
    status: "ready",
    stale: false,
    lastSnapshotAt: NOW,
    lastHeartbeatAt: NOW,
  },
  minecraft: {
    sessionId: SESSION_ID,
    worldName: "Synthetic World",
    dimension: "minecraft:overworld",
    teamId: "00000000-0000-4000-8000-0000000000bb",
    teamName: "Synthetic Team",
  },
  chapters: CHAPTERS,
  quests: [QUESTS[0]!, QUESTS[1]!],
  unresolvedPinnedQuestIds: ["mock-quest-missing"],
  chapterPins: {
    maxPins: 5,
    pinnedChapters: [
      { chapterId: "mock-chapter-01", position: 0 },
      { chapterId: "mock-chapter-02", position: 1 },
    ],
  },
  display: DISPLAY,
};
