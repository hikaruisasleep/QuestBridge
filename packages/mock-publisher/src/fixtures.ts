import type {
  Chapter,
  ChapterPinConfig,
  DisplayConfig,
  MinecraftPinsPayload,
  MinecraftSnapshotPayload,
  Quest,
  Task,
  TaskProgress,
} from "@questbridge/protocol";

/**
 * Synthetic fixture data for the mock publisher.
 *
 * Every identifier is synthetic. No real ATM10 TTS identifiers appear here, so
 * a passing mock test can never be mistaken for FTB Quests compatibility.
 */

/** Fixed epoch for every fixture and scenario timestamp. */
export const MOCK_NOW = "2026-01-01T00:00:00.000Z";
export const MOCK_EPOCH_MS = Date.parse(MOCK_NOW);

/** Synthetic adapter session id, stable across reconnects. */
export const MOCK_SESSION_ID = "11111111-1111-4111-8111-111111111111";

export function timestampAt(offsetMs: number): string {
  return new Date(MOCK_EPOCH_MS + offsetMs).toISOString();
}

export const MOCK_WORLD = {
  worldName: "Synthetic World",
  dimension: "minecraft:overworld",
  integratedServer: false,
  teamId: "22222222-2222-4222-8222-222222222222",
  teamName: "Synthetic Team",
} as const;

export const DISPLAY: DisplayConfig = deepFreeze({
  showChapterProgress: true,
  showQuestTasks: true,
  showCompletedQuests: true,
  completionAnimation: true,
  theme: "minimal",
  compactMode: true,
});

function progress(
  status: TaskProgress["status"],
  extra: Omit<TaskProgress, "status"> = { percentage: null },
): TaskProgress {
  return { status, ...extra };
}

export const CHAPTERS: Chapter[] = deepFreeze([
  {
    id: "mock-chapter-start",
    title: "Getting Started",
    subtitle: "Synthetic starter chapter",
    order: 0,
    progress: 62,
    status: "available",
  },
  {
    id: "mock-chapter-power",
    title: "Power Generation",
    order: 1,
    progress: 45,
    status: "available",
  },
  {
    id: "mock-chapter-storage",
    title: "Advanced Storage",
    order: 2,
    progress: null,
    status: "unknown",
  },
  {
    id: "mock-chapter-endgame",
    title: "The Endgame",
    order: 3,
    progress: 0,
    status: "locked",
  },
  {
    id: "mock-chapter-completed",
    title: "Completed Chapter",
    order: 4,
    progress: 100,
    status: "completed",
  },
  {
    id: "mock-chapter-bonus",
    title: "Bonus Objectives",
    order: 5,
    progress: 100,
    status: "available",
  },
  {
    id: "mock-chapter-side",
    title: "Side Quests",
    order: 6,
    progress: 30,
    status: "available",
  },
]);

export const QUESTS: Quest[] = deepFreeze([
  {
    id: "mock-quest-machine-frame",
    chapterId: "mock-chapter-start",
    title: "Craft a Machine Frame",
    description: "Synthetic item-crafting objective",
    optional: false,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-frame",
        type: "ftbquests:item",
        title: "Machine Frame",
        optional: false,
        progress: progress("in_progress", { current: 3, target: 10, percentage: 30 }),
      },
      {
        id: "mock-task-optional-check",
        type: "ftbquests:checkmark",
        title: "Optional checkmark",
        optional: true,
        progress: progress("completed", { percentage: 100 }),
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
    id: "mock-quest-collect-wood",
    chapterId: "mock-chapter-start",
    title: "Collect Wood",
    optional: false,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-wood",
        type: "ftbquests:item",
        title: "Oak Log",
        optional: false,
        progress: progress("in_progress", { current: 24, target: 64, percentage: 37 }),
      },
    ],
    progress: {
      status: "in_progress",
      completedTasks: 0,
      totalRequiredTasks: 1,
      percentage: 37,
    },
  },
  {
    id: "mock-quest-light",
    chapterId: "mock-chapter-power",
    title: "Light the World",
    optional: false,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-light",
        type: "ftbquests:checkmark",
        title: "Place a light",
        optional: false,
        progress: progress("completed", { percentage: 100 }),
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
    id: "mock-quest-generator",
    chapterId: "mock-chapter-power",
    title: "Build a Generator",
    optional: false,
    hidden: false,
    dependencies: ["mock-quest-light"],
    tasks: [
      {
        id: "mock-task-generator-frame",
        type: "ftbquests:item",
        title: "Generator Frame",
        optional: false,
        progress: progress("in_progress", { current: 2, target: 4, percentage: 50 }),
      },
      {
        id: "mock-task-generator-energy",
        type: "ftbquests:energy",
        title: "Generate energy",
        optional: false,
        progress: progress("in_progress", { current: 0, target: 100, percentage: 0 }),
      },
    ],
    progress: {
      status: "in_progress",
      completedTasks: 1,
      totalRequiredTasks: 2,
      percentage: 50,
    },
  },
  {
    id: "mock-quest-chests",
    chapterId: "mock-chapter-storage",
    title: "Forty-Two Chests",
    optional: false,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-chests",
        type: "ftbquests:item",
        title: "Chest",
        optional: false,
        progress: progress("in_progress", { current: 12, target: 42, percentage: 28 }),
      },
    ],
    progress: {
      status: "in_progress",
      completedTasks: 0,
      totalRequiredTasks: 1,
      percentage: 28,
    },
  },
  {
    id: "mock-quest-digital-storage",
    chapterId: "mock-chapter-storage",
    title: "Digital Storage",
    optional: false,
    hidden: false,
    dependencies: ["mock-quest-chests"],
    tasks: [
      {
        id: "mock-task-storage-cells",
        type: "ftbquests:item",
        title: "Storage Cell",
        optional: false,
        progress: progress("incomplete", { current: 0, target: 5, percentage: 0 }),
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
    id: "mock-quest-final-widget",
    chapterId: "mock-chapter-endgame",
    title: "The Final Widget",
    optional: false,
    hidden: false,
    dependencies: ["mock-quest-digital-storage"],
    tasks: [
      {
        id: "mock-task-widget",
        type: "ftbquests:item",
        title: "Final Widget",
        optional: false,
        progress: progress("incomplete", { current: 0, target: 1, percentage: 0 }),
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
    id: "mock-quest-finish-line",
    chapterId: "mock-chapter-completed",
    title: "Finish the Line",
    optional: false,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-line-item",
        type: "ftbquests:item",
        title: "Finishing Item",
        optional: false,
        progress: progress("completed", { current: 1, target: 1, percentage: 100 }),
      },
      {
        id: "mock-task-line-kill",
        type: "ftbquests:kill",
        title: "Defeat the guardian",
        optional: false,
        progress: progress("completed", { current: 1, target: 1, percentage: 100 }),
      },
    ],
    progress: {
      status: "completed",
      completedTasks: 2,
      totalRequiredTasks: 2,
      percentage: 100,
    },
  },
  {
    id: "mock-quest-overachiever",
    chapterId: "mock-chapter-bonus",
    title: "Overachiever",
    optional: true,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-overachiever",
        type: "ftbquests:advancement",
        title: "Optional advancement",
        optional: true,
        progress: progress("incomplete", { percentage: null }),
      },
    ],
    progress: {
      status: "available",
      completedTasks: 0,
      totalRequiredTasks: 0,
      percentage: null,
    },
  },
  {
    id: "mock-quest-secret-detour",
    chapterId: "mock-chapter-side",
    title: "Secret Detour",
    optional: true,
    hidden: true,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-secret",
        type: "ftbquests:advancement",
        title: "Hidden advancement",
        optional: true,
        progress: progress("unknown", { percentage: null }),
      },
    ],
    progress: {
      status: "available",
      completedTasks: 0,
      totalRequiredTasks: 0,
      percentage: null,
    },
  },
  {
    id: "mock-quest-stat",
    chapterId: "mock-chapter-side",
    title: "Statistical Anomaly",
    optional: false,
    hidden: false,
    dependencies: [],
    tasks: [
      {
        id: "mock-task-stat",
        type: "ftbquests:stat",
        title: "Walk 10,000 blocks",
        optional: false,
        progress: progress("in_progress", { current: 5_000, target: 10_000, percentage: 50 }),
      },
    ],
    progress: {
      status: "in_progress",
      completedTasks: 0,
      totalRequiredTasks: 1,
      percentage: 50,
    },
  },
]);

export const QUEST_BY_ID: ReadonlyMap<string, Quest> = new Map(
  QUESTS.map((quest) => [quest.id, quest]),
);

export const CHAPTER_BY_ID: ReadonlyMap<string, Chapter> = new Map(
  CHAPTERS.map((chapter) => [chapter.id, chapter]),
);

/** Manual pins in the fallback order: chapter order, then quest order. */
export const BASE_PIN_IDS = [
  "mock-quest-machine-frame",
  "mock-quest-light",
  "mock-quest-chests",
  "mock-quest-stat",
] as const;

export const UNRESOLVED_PIN_ID = "mock-quest-missing" as const;

/** FTB's automatic tracker id, used only by the filter test fixture. */
export const AUTOMATIC_PIN_ID_FIXTURE = "1";

export function questsForPinIds(
  manualPinIds: readonly string[],
  unresolvedPinnedQuestIds: readonly string[] = [],
  overrides: ReadonlyMap<string, Quest> = new Map(),
): Quest[] {
  const unresolved = new Set(unresolvedPinnedQuestIds);

  return manualPinIds
    .filter((id) => !unresolved.has(id))
    .map((id) => {
      const quest = QUEST_BY_ID.get(id);
      if (quest === undefined) {
        throw new Error(`Fixture quest "${id}" is not defined`);
      }
      const override = overrides.get(id);
      return structuredClone(override ?? quest);
    });
}

export function pinsPayload(
  manualPinIds: readonly string[],
  unresolvedPinnedQuestIds: readonly string[] = [],
  capturedAt: string = MOCK_NOW,
  questOverrides: ReadonlyMap<string, Quest> = new Map(),
): MinecraftPinsPayload {
  return {
    capturedAt,
    manualPinIds: [...manualPinIds],
    quests: questsForPinIds(manualPinIds, unresolvedPinnedQuestIds, questOverrides),
    unresolvedPinnedQuestIds: [...unresolvedPinnedQuestIds],
  };
}

export function createSnapshot(
  capturedAt: string = MOCK_NOW,
  overrides: Partial<MinecraftSnapshotPayload> = {},
): MinecraftSnapshotPayload {
  const manualPinIds = overrides.manualPinIds ?? [...BASE_PIN_IDS];
  const unresolvedPinnedQuestIds = overrides.unresolvedPinnedQuestIds ?? [];
  const quests = overrides.quests ?? questsForPinIds(manualPinIds, unresolvedPinnedQuestIds);

  return {
    ...MOCK_WORLD,
    chapters: structuredClone(CHAPTERS),
    manualPinIds: [...manualPinIds],
    quests,
    unresolvedPinnedQuestIds: [...unresolvedPinnedQuestIds],
    capturedAt,
    ...overrides,
  };
}

export function snapshotWithUnresolvedPin(capturedAt: string): MinecraftSnapshotPayload {
  const manualPinIds = [...BASE_PIN_IDS, UNRESOLVED_PIN_ID];
  return createSnapshot(capturedAt, {
    manualPinIds,
    unresolvedPinnedQuestIds: [UNRESOLVED_PIN_ID],
  });
}

export function snapshotWithoutCompletedPin(capturedAt: string): MinecraftSnapshotPayload {
  const manualPinIds = BASE_PIN_IDS.filter((id) => id !== "mock-quest-light");
  return createSnapshot(capturedAt, { manualPinIds });
}

export function questWithProgress(
  questId: string,
  overrides: Partial<Quest>,
): Quest {
  const quest = QUEST_BY_ID.get(questId);
  if (quest === undefined) {
    throw new Error(`Fixture quest "${questId}" is not defined`);
  }
  return { ...structuredClone(quest), ...overrides };
}

export function taskWithProgress(taskId: string, progressOverride: TaskProgress): Task {
  for (const quest of QUESTS) {
    const task = quest.tasks.find((candidate) => candidate.id === taskId);
    if (task !== undefined) {
      return { ...structuredClone(task), progress: progressOverride };
    }
  }
  throw new Error(`Fixture task "${taskId}" is not defined`);
}

export const EMPTY_PIN_CONFIG: ChapterPinConfig = deepFreeze({
  maxPins: 5,
  pinnedChapters: [],
});

export const ONE_PIN_CONFIG: ChapterPinConfig = deepFreeze({
  maxPins: 5,
  pinnedChapters: [{ chapterId: "mock-chapter-start", position: 0 }],
});

export const FIVE_PIN_CONFIG: ChapterPinConfig = deepFreeze({
  maxPins: 5,
  pinnedChapters: [
    { chapterId: "mock-chapter-start", position: 0 },
    { chapterId: "mock-chapter-power", position: 1 },
    { chapterId: "mock-chapter-storage", position: 2 },
    { chapterId: "mock-chapter-endgame", position: 3 },
    { chapterId: "mock-chapter-completed", position: 4 },
  ],
});

export const UNRESOLVED_PIN_CONFIG: ChapterPinConfig = deepFreeze({
  maxPins: 5,
  pinnedChapters: [
    { chapterId: "mock-chapter-missing", position: 0 },
    { chapterId: "mock-chapter-start", position: 1 },
  ],
});

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
