import { z } from "zod";

import {
  AUTOMATIC_PIN_ID,
  MAX_CHAPTER_PINS,
  MAX_CLIENT_NAME_LENGTH,
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_ID_LENGTH,
  PROTOCOL_VERSION,
} from "./version.js";

/**
 * Runtime schemas for protocol v1.
 *
 * Every object is strict: unknown fields are rejected. Cross-field invariants
 * from `docs/protocol.md` section 10.3 are enforced with `superRefine`.
 */

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Opaque protocol identifier: 1-128 characters, no control characters. */
export const idSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .refine((value) => !CONTROL_CHARACTERS.test(value), {
    message: "Identifiers must not contain control characters",
  });

const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** ISO 8601 instant with `Z` or an explicit numeric offset. */
export const isoTimestampSchema = z.string().refine(
  (value) => isoTimestampPattern.test(value) && !Number.isNaN(Date.parse(value)),
  { message: "Expected an ISO 8601 timestamp with Z or an explicit offset" },
);

export const sequenceSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const revisionSchema = z.number().int().min(0);
export const nonNegativeIntegerSchema = z.number().int().min(0);
export const percentageSchema = z.number().int().min(0).max(100);

// ---------------------------------------------------------------------------
// Chapter models
// ---------------------------------------------------------------------------

export const chapterStatusSchema = z.enum(["available", "locked", "completed", "unknown"]);
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;

export const chapterSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  order: nonNegativeIntegerSchema,
  progress: percentageSchema.nullable(),
  status: chapterStatusSchema,
});
export type Chapter = z.infer<typeof chapterSchema>;

export const chapterCatalogSchema = z.array(chapterSchema).superRefine((chapters, ctx) => {
  const ids = new Set<string>();
  const orders = new Set<number>();

  chapters.forEach((chapter, index) => {
    if (ids.has(chapter.id)) {
      addIssue(ctx, [index, "id"], `Duplicate chapter id "${chapter.id}"`);
    }
    ids.add(chapter.id);

    if (orders.has(chapter.order)) {
      addIssue(ctx, [index, "order"], `Duplicate chapter order ${chapter.order}`);
    }
    orders.add(chapter.order);
  });
});

export const chapterPinSchema = z.strictObject({
  chapterId: idSchema,
  position: nonNegativeIntegerSchema,
});
export type ChapterPin = z.infer<typeof chapterPinSchema>;

export const chapterPinConfigSchema = z
  .strictObject({
    maxPins: z.literal(MAX_CHAPTER_PINS),
    pinnedChapters: z.array(chapterPinSchema).max(MAX_CHAPTER_PINS),
  })
  .superRefine((config, ctx) => {
    const ids = new Set<string>();

    config.pinnedChapters.forEach((pin, index) => {
      if (ids.has(pin.chapterId)) {
        addIssue(
          ctx,
          ["pinnedChapters", index, "chapterId"],
          `Duplicate chapter pin "${pin.chapterId}"`,
        );
      }
      ids.add(pin.chapterId);

      // Array order is presentation order. Enforcing `position === index`
      // guarantees uniqueness, contiguity, and a normalized array in one rule.
      if (pin.position !== index) {
        addIssue(
          ctx,
          ["pinnedChapters", index, "position"],
          `Chapter pin positions must be contiguous and ordered; expected ${index}, received ${pin.position}`,
        );
      }
    });
  });
export type ChapterPinConfig = z.infer<typeof chapterPinConfigSchema>;

// ---------------------------------------------------------------------------
// Display configuration
// ---------------------------------------------------------------------------

export const displayConfigSchema = z.strictObject({
  showChapterProgress: z.boolean(),
  showQuestTasks: z.boolean(),
  showCompletedQuests: z.boolean(),
  completionAnimation: z.boolean(),
  theme: z.literal("minimal"),
  compactMode: z.boolean(),
});
export type DisplayConfig = z.infer<typeof displayConfigSchema>;

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = Object.freeze({
  showChapterProgress: true,
  showQuestTasks: true,
  showCompletedQuests: true,
  completionAnimation: true,
  theme: "minimal",
  compactMode: true,
});

// ---------------------------------------------------------------------------
// Quest and task models
// ---------------------------------------------------------------------------

export const taskStatusSchema = z.enum(["incomplete", "in_progress", "completed", "unknown"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskProgressSchema = z.strictObject({
  status: taskStatusSchema,
  current: nonNegativeIntegerSchema.optional(),
  target: nonNegativeIntegerSchema.optional(),
  percentage: percentageSchema.nullable(),
  unit: z.string().min(1).optional(),
});
export type TaskProgress = z.infer<typeof taskProgressSchema>;

export const taskSchema = z.strictObject({
  id: idSchema,
  type: z.string().min(1),
  title: z.string().min(1).optional(),
  optional: z.boolean(),
  progress: taskProgressSchema,
});
export type Task = z.infer<typeof taskSchema>;

const taskListSchema = z.array(taskSchema).superRefine((tasks, ctx) => {
  const ids = new Set<string>();

  tasks.forEach((task, index) => {
    if (ids.has(task.id)) {
      addIssue(ctx, [index, "id"], `Duplicate task id "${task.id}"`);
    }
    ids.add(task.id);
  });
});

export const questStatusSchema = z.enum([
  "locked",
  "available",
  "in_progress",
  "completed",
  "unknown",
]);
export type QuestStatus = z.infer<typeof questStatusSchema>;

export const questProgressSchema = z
  .strictObject({
    status: questStatusSchema,
    completedTasks: nonNegativeIntegerSchema,
    totalRequiredTasks: nonNegativeIntegerSchema,
    percentage: percentageSchema.nullable(),
  })
  .superRefine((progress, ctx) => {
    if (progress.completedTasks > progress.totalRequiredTasks) {
      addIssue(
        ctx,
        ["completedTasks"],
        `completedTasks (${progress.completedTasks}) must not exceed totalRequiredTasks (${progress.totalRequiredTasks})`,
      );
    }
  });
export type QuestProgress = z.infer<typeof questProgressSchema>;

export const questSchema = z.strictObject({
  id: idSchema,
  chapterId: idSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  optional: z.boolean(),
  hidden: z.boolean(),
  dependencies: z.array(idSchema),
  tasks: taskListSchema,
  progress: questProgressSchema,
});
export type Quest = z.infer<typeof questSchema>;

export const questListSchema = z.array(questSchema).superRefine((quests, ctx) => {
  const ids = new Set<string>();

  quests.forEach((quest, index) => {
    if (ids.has(quest.id)) {
      addIssue(ctx, [index, "id"], `Duplicate quest id "${quest.id}"`);
    }
    ids.add(quest.id);
  });
});

// ---------------------------------------------------------------------------
// Connection and identity
// ---------------------------------------------------------------------------

export const connectionStatusSchema = z.enum([
  "disconnected",
  "connecting",
  "connected",
  "synchronizing",
  "ready",
  "error",
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const connectionStateSchema = z.strictObject({
  status: connectionStatusSchema,
  stale: z.boolean(),
  lastSnapshotAt: isoTimestampSchema.nullable(),
  lastHeartbeatAt: isoTimestampSchema.nullable(),
  error: z.string().max(MAX_ERROR_MESSAGE_LENGTH).optional(),
});
export type ConnectionState = z.infer<typeof connectionStateSchema>;

export const minecraftIdentitySchema = z.strictObject({
  sessionId: idSchema.nullable(),
  worldName: z.string().optional(),
  dimension: z.string().optional(),
  teamId: z.string().optional(),
  teamName: z.string().optional(),
});
export type MinecraftIdentity = z.infer<typeof minecraftIdentitySchema>;

export const unresolvedQuestIdsSchema = z.array(idSchema);

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

export const appStateSchema = z
  .strictObject({
    revision: revisionSchema,
    connection: connectionStateSchema,
    minecraft: minecraftIdentitySchema,
    chapters: chapterCatalogSchema,
    quests: questListSchema,
    unresolvedPinnedQuestIds: unresolvedQuestIdsSchema,
    chapterPins: chapterPinConfigSchema,
    display: displayConfigSchema,
  })
  .superRefine((state, ctx) => {
    const chapterIds = new Set(state.chapters.map((chapter) => chapter.id));

    state.quests.forEach((quest, index) => {
      if (!chapterIds.has(quest.chapterId)) {
        addIssue(
          ctx,
          ["quests", index, "chapterId"],
          `Quest "${quest.id}" references unknown chapter "${quest.chapterId}"`,
        );
      }
    });

    const unresolved = state.unresolvedPinnedQuestIds;
    unresolved.forEach((id, index) => {
      if (index > 0 && unresolved[index - 1]! >= id) {
        addIssue(
          ctx,
          ["unresolvedPinnedQuestIds", index],
          "unresolvedPinnedQuestIds must be sorted ascending and unique",
        );
      }
    });

    const questIds = new Set(state.quests.map((quest) => quest.id));
    unresolved.forEach((id, index) => {
      if (questIds.has(id)) {
        addIssue(
          ctx,
          ["unresolvedPinnedQuestIds", index],
          `"${id}" cannot be both resolved and unresolved`,
        );
      }
    });
  });
export type AppState = z.infer<typeof appStateSchema>;

// ---------------------------------------------------------------------------
// Minecraft -> host payloads
// ---------------------------------------------------------------------------

const versionStringSchema = z.string().min(1).max(64);

export const minecraftHelloPayloadSchema = z.strictObject({
  modVersion: versionStringSchema,
  minecraftVersion: versionStringSchema,
  neoForgeVersion: versionStringSchema,
  ftbQuestsVersion: versionStringSchema,
  ftbTeamsVersion: versionStringSchema,
});
export type MinecraftHelloPayload = z.infer<typeof minecraftHelloPayloadSchema>;

export const minecraftStatusPhaseSchema = z.enum([
  "unavailable",
  "synchronizing",
  "ready",
  "error",
]);
export type MinecraftStatusPhase = z.infer<typeof minecraftStatusPhaseSchema>;

export const minecraftStatusPayloadSchema = z.strictObject({
  phase: minecraftStatusPhaseSchema,
  detail: z.string().max(MAX_ERROR_MESSAGE_LENGTH).optional(),
});
export type MinecraftStatusPayload = z.infer<typeof minecraftStatusPayloadSchema>;

interface ObjectiveSetLike {
  manualPinIds: string[];
  quests: Array<{ id: string; chapterId: string }>;
  unresolvedPinnedQuestIds: string[];
}

function refineObjectiveSet(value: ObjectiveSetLike, ctx: z.RefinementCtx): void {
  const manualIds = new Set<string>();
  value.manualPinIds.forEach((id, index) => {
    if (id === AUTOMATIC_PIN_ID) {
      addIssue(
        ctx,
        ["manualPinIds", index],
        `Automatic pin id "${AUTOMATIC_PIN_ID}" must not appear in manualPinIds`,
      );
    }
    if (manualIds.has(id)) {
      addIssue(ctx, ["manualPinIds", index], `Duplicate manual pin id "${id}"`);
    }
    manualIds.add(id);
  });

  const unresolved = value.unresolvedPinnedQuestIds;
  unresolved.forEach((id, index) => {
    if (index > 0 && unresolved[index - 1]! >= id) {
      addIssue(
        ctx,
        ["unresolvedPinnedQuestIds", index],
        "unresolvedPinnedQuestIds must be sorted ascending and unique",
      );
    }
  });

  const unresolvedSet = new Set(unresolved);
  const questIds = new Set(value.quests.map((quest) => quest.id));

  value.manualPinIds.forEach((id, index) => {
    if (!questIds.has(id) && !unresolvedSet.has(id)) {
      addIssue(
        ctx,
        ["manualPinIds", index],
        `Manual pin "${id}" is neither resolved in quests nor listed as unresolved`,
      );
    }
  });

  value.quests.forEach((quest, index) => {
    if (!manualIds.has(quest.id)) {
      addIssue(
        ctx,
        ["quests", index, "id"],
        `Resolved quest "${quest.id}" is not present in manualPinIds`,
      );
    }
  });

  unresolved.forEach((id, index) => {
    if (!manualIds.has(id)) {
      addIssue(
        ctx,
        ["unresolvedPinnedQuestIds", index],
        `Unresolved id "${id}" is not present in manualPinIds`,
      );
    }
    if (questIds.has(id)) {
      addIssue(
        ctx,
        ["unresolvedPinnedQuestIds", index],
        `"${id}" cannot be both resolved and unresolved`,
      );
    }
  });

  const expectedOrder = value.manualPinIds.filter((id) => !unresolvedSet.has(id));
  const actualOrder = value.quests.map((quest) => quest.id);
  if (
    expectedOrder.length !== actualOrder.length ||
    expectedOrder.some((id, index) => id !== actualOrder[index])
  ) {
    addIssue(
      ctx,
      ["quests"],
      "Resolved quests must follow manualPinIds order with unresolved entries removed",
    );
  }
}

export const minecraftSnapshotPayloadSchema = z
  .strictObject({
    worldName: z.string().nullable(),
    dimension: z.string().nullable(),
    integratedServer: z.boolean(),
    teamId: z.string().nullable(),
    teamName: z.string().nullable(),
    chapters: chapterCatalogSchema,
    manualPinIds: z.array(idSchema),
    quests: questListSchema,
    unresolvedPinnedQuestIds: unresolvedQuestIdsSchema,
    capturedAt: isoTimestampSchema,
  })
  .superRefine((snapshot, ctx) => {
    const chapterIds = new Set(snapshot.chapters.map((chapter) => chapter.id));

    snapshot.quests.forEach((quest, index) => {
      if (!chapterIds.has(quest.chapterId)) {
        addIssue(
          ctx,
          ["quests", index, "chapterId"],
          `Quest "${quest.id}" references unknown chapter "${quest.chapterId}"`,
        );
      }
    });

    refineObjectiveSet(snapshot, ctx);
  });
export type MinecraftSnapshotPayload = z.infer<typeof minecraftSnapshotPayloadSchema>;

export const chapterProgressUpdateSchema = z.strictObject({
  chapterId: idSchema,
  progress: percentageSchema.nullable(),
  status: chapterStatusSchema,
});
export type ChapterProgressUpdate = z.infer<typeof chapterProgressUpdateSchema>;

export const minecraftProgressPayloadSchema = z
  .strictObject({
    capturedAt: isoTimestampSchema,
    chapters: z.array(chapterProgressUpdateSchema).optional(),
    quests: questListSchema.optional(),
  })
  .superRefine((progress, ctx) => {
    if (progress.chapters === undefined && progress.quests === undefined) {
      addIssue(
        ctx,
        [],
        "minecraft.progress must contain at least one of chapters or quests",
      );
    }

    if (progress.chapters !== undefined) {
      const ids = new Set<string>();
      progress.chapters.forEach((chapter, index) => {
        if (ids.has(chapter.chapterId)) {
          addIssue(
            ctx,
            ["chapters", index, "chapterId"],
            `Duplicate chapter progress id "${chapter.chapterId}"`,
          );
        }
        ids.add(chapter.chapterId);
      });
    }
  });
export type MinecraftProgressPayload = z.infer<typeof minecraftProgressPayloadSchema>;

export const minecraftPinsPayloadSchema = z
  .strictObject({
    capturedAt: isoTimestampSchema,
    manualPinIds: z.array(idSchema),
    quests: questListSchema,
    unresolvedPinnedQuestIds: unresolvedQuestIdsSchema,
  })
  .superRefine((pins, ctx) => {
    refineObjectiveSet(pins, ctx);
  });
export type MinecraftPinsPayload = z.infer<typeof minecraftPinsPayloadSchema>;

export const minecraftHeartbeatPayloadSchema = z.strictObject({
  ready: z.boolean(),
});
export type MinecraftHeartbeatPayload = z.infer<typeof minecraftHeartbeatPayloadSchema>;

// ---------------------------------------------------------------------------
// Host -> Minecraft payloads
// ---------------------------------------------------------------------------

export const hostWelcomePayloadSchema = z.strictObject({
  hostVersion: z.string().min(1).max(64),
  heartbeatIntervalMs: z.number().int().min(1),
  staleAfterMs: z.number().int().min(1),
  disconnectAfterMs: z.number().int().min(1),
  reconcileIntervalMs: z.number().int().min(1),
});
export type HostWelcomePayload = z.infer<typeof hostWelcomePayloadSchema>;

export const snapshotRequestReasonSchema = z.enum([
  "sequence_gap",
  "reconnect",
  "recovery",
  "stale",
  "manual",
]);
export type SnapshotRequestReason = z.infer<typeof snapshotRequestReasonSchema>;

export const hostRequestSnapshotPayloadSchema = z.strictObject({
  reason: snapshotRequestReasonSchema,
});
export type HostRequestSnapshotPayload = z.infer<typeof hostRequestSnapshotPayloadSchema>;

export const errorCodeSchema = z.enum([
  "unsupported_protocol",
  "invalid_message",
  "invalid_request",
  "invalid_snapshot",
  "unauthorized",
  "role_mismatch",
  "session_mismatch",
  "message_too_large",
  "rate_limited",
  "duplicate_chapter",
  "too_many_pins",
  "unknown_chapter",
  "invalid_position",
  "invalid_reorder_set",
  "not_pinned",
  "stale_revision",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const hostErrorPayloadSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().min(1).max(MAX_ERROR_MESSAGE_LENGTH),
  fatal: z.boolean(),
});
export type HostErrorPayload = z.infer<typeof hostErrorPayloadSchema>;

// ---------------------------------------------------------------------------
// Browser -> host payloads
// ---------------------------------------------------------------------------

export const browserRoleSchema = z.enum(["overlay", "control"]);
export type BrowserRole = z.infer<typeof browserRoleSchema>;

export const browserHelloPayloadSchema = z.strictObject({
  role: browserRoleSchema,
  clientName: z.string().min(1).max(MAX_CLIENT_NAME_LENGTH).optional(),
});
export type BrowserHelloPayload = z.infer<typeof browserHelloPayloadSchema>;

export const chapterPinPayloadSchema = z.strictObject({
  chapterId: idSchema,
});
export type ChapterPinPayload = z.infer<typeof chapterPinPayloadSchema>;

export const chapterUnpinPayloadSchema = z.strictObject({
  chapterId: idSchema,
});
export type ChapterUnpinPayload = z.infer<typeof chapterUnpinPayloadSchema>;

export const chapterReorderPayloadSchema = z.strictObject({
  chapterIds: z.array(idSchema).max(MAX_CHAPTER_PINS),
});
export type ChapterReorderPayload = z.infer<typeof chapterReorderPayloadSchema>;

export const configUpdatePayloadSchema = z.strictObject({
  display: displayConfigSchema,
});
export type ConfigUpdatePayload = z.infer<typeof configUpdatePayloadSchema>;

export const resyncReasonSchema = z.enum([
  "sequence_gap",
  "revision_gap",
  "reconnect",
  "manual",
  "stale",
]);
export type ResyncReason = z.infer<typeof resyncReasonSchema>;

export const stateResyncPayloadSchema = z.strictObject({
  reason: resyncReasonSchema.optional(),
});
export type StateResyncPayload = z.infer<typeof stateResyncPayloadSchema>;

// ---------------------------------------------------------------------------
// Host -> browser payloads
// ---------------------------------------------------------------------------

export const stateSnapshotPayloadSchema = appStateSchema;
export type StateSnapshotPayload = z.infer<typeof stateSnapshotPayloadSchema>;

export const stateUpdatePayloadSchema = z
  .strictObject({
    revision: revisionSchema,
    connection: connectionStateSchema.optional(),
    minecraft: minecraftIdentitySchema.optional(),
    chapters: chapterCatalogSchema.optional(),
    quests: questListSchema.optional(),
    unresolvedPinnedQuestIds: unresolvedQuestIdsSchema.optional(),
    chapterPins: chapterPinConfigSchema.optional(),
    display: displayConfigSchema.optional(),
  })
  .superRefine((update, ctx) => {
    const changedSections = [
      update.connection,
      update.minecraft,
      update.chapters,
      update.quests,
      update.unresolvedPinnedQuestIds,
      update.chapterPins,
      update.display,
    ].filter((section) => section !== undefined);

    if (changedSections.length === 0) {
      addIssue(ctx, [], "state.update must contain at least one changed section");
    }
  });
export type StateUpdatePayload = z.infer<typeof stateUpdatePayloadSchema>;

export const chapterPinsUpdatePayloadSchema = z.strictObject({
  chapterPins: chapterPinConfigSchema,
});
export type ChapterPinsUpdatePayload = z.infer<typeof chapterPinsUpdatePayloadSchema>;

export const connectionStatusPayloadSchema = connectionStateSchema;
export type ConnectionStatusPayload = z.infer<typeof connectionStatusPayloadSchema>;

export const requestErrorPayloadSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().min(1).max(MAX_ERROR_MESSAGE_LENGTH),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type RequestErrorPayload = z.infer<typeof requestErrorPayloadSchema>;

// ---------------------------------------------------------------------------
// Message catalog
// ---------------------------------------------------------------------------

export const MINECRAFT_TO_HOST_TYPES = [
  "minecraft.hello",
  "minecraft.status",
  "minecraft.snapshot",
  "minecraft.progress",
  "minecraft.pins",
  "minecraft.heartbeat",
] as const;

export const HOST_TO_MINECRAFT_TYPES = [
  "host.welcome",
  "host.request_snapshot",
  "host.error",
] as const;

export const BROWSER_TO_HOST_TYPES = [
  "browser.hello",
  "chapter.pin",
  "chapter.unpin",
  "chapter.reorder",
  "config.update",
  "state.resync",
] as const;

export const HOST_TO_BROWSER_TYPES = [
  "state.snapshot",
  "state.update",
  "chapter.pins.update",
  "config.update",
  "connection.status",
  "request.error",
] as const;

export type MinecraftToHostType = (typeof MINECRAFT_TO_HOST_TYPES)[number];
export type HostToMinecraftType = (typeof HOST_TO_MINECRAFT_TYPES)[number];
export type BrowserToHostType = (typeof BROWSER_TO_HOST_TYPES)[number];
export type HostToBrowserType = (typeof HOST_TO_BROWSER_TYPES)[number];
export type MessageType =
  | MinecraftToHostType
  | HostToMinecraftType
  | BrowserToHostType
  | HostToBrowserType;

export type MessageDirection =
  | "minecraft_to_host"
  | "host_to_minecraft"
  | "browser_to_host"
  | "host_to_browser";

// ---------------------------------------------------------------------------
// Message envelopes
// ---------------------------------------------------------------------------

type SequenceMode = "required" | "optional" | "forbidden";
type SessionMode = "required" | "forbidden";

interface EnvelopeOptions {
  sequence: SequenceMode;
  session: SessionMode;
}

function messageSchema(
  type: string,
  payload: z.ZodTypeAny,
  options: EnvelopeOptions,
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal(type),
    timestamp: isoTimestampSchema,
    requestId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
    payload,
  };

  if (options.sequence === "required") {
    shape.sequence = sequenceSchema;
  } else if (options.sequence === "optional") {
    shape.sequence = sequenceSchema.optional();
  }

  if (options.session === "required") {
    shape.sessionId = idSchema;
  }

  return z.strictObject(shape);
}

const MINECRAFT_ENVELOPE: EnvelopeOptions = { sequence: "required", session: "required" };
const HOST_ENVELOPE: EnvelopeOptions = { sequence: "forbidden", session: "forbidden" };
const BROWSER_ENVELOPE: EnvelopeOptions = { sequence: "optional", session: "forbidden" };
const HOST_BROWSER_ENVELOPE: EnvelopeOptions = { sequence: "required", session: "forbidden" };

export const minecraftHelloMessageSchema = messageSchema(
  "minecraft.hello",
  minecraftHelloPayloadSchema,
  MINECRAFT_ENVELOPE,
);
export const minecraftStatusMessageSchema = messageSchema(
  "minecraft.status",
  minecraftStatusPayloadSchema,
  MINECRAFT_ENVELOPE,
);
export const minecraftSnapshotMessageSchema = messageSchema(
  "minecraft.snapshot",
  minecraftSnapshotPayloadSchema,
  MINECRAFT_ENVELOPE,
);
export const minecraftProgressMessageSchema = messageSchema(
  "minecraft.progress",
  minecraftProgressPayloadSchema,
  MINECRAFT_ENVELOPE,
);
export const minecraftPinsMessageSchema = messageSchema(
  "minecraft.pins",
  minecraftPinsPayloadSchema,
  MINECRAFT_ENVELOPE,
);
export const minecraftHeartbeatMessageSchema = messageSchema(
  "minecraft.heartbeat",
  minecraftHeartbeatPayloadSchema,
  MINECRAFT_ENVELOPE,
);

export const hostWelcomeMessageSchema = messageSchema(
  "host.welcome",
  hostWelcomePayloadSchema,
  HOST_ENVELOPE,
);
export const hostRequestSnapshotMessageSchema = messageSchema(
  "host.request_snapshot",
  hostRequestSnapshotPayloadSchema,
  HOST_ENVELOPE,
);
export const hostErrorMessageSchema = messageSchema(
  "host.error",
  hostErrorPayloadSchema,
  HOST_ENVELOPE,
);

export const browserHelloMessageSchema = messageSchema(
  "browser.hello",
  browserHelloPayloadSchema,
  BROWSER_ENVELOPE,
);
export const chapterPinMessageSchema = messageSchema(
  "chapter.pin",
  chapterPinPayloadSchema,
  BROWSER_ENVELOPE,
);
export const chapterUnpinMessageSchema = messageSchema(
  "chapter.unpin",
  chapterUnpinPayloadSchema,
  BROWSER_ENVELOPE,
);
export const chapterReorderMessageSchema = messageSchema(
  "chapter.reorder",
  chapterReorderPayloadSchema,
  BROWSER_ENVELOPE,
);
export const configUpdateFromBrowserMessageSchema = messageSchema(
  "config.update",
  configUpdatePayloadSchema,
  BROWSER_ENVELOPE,
);
export const stateResyncMessageSchema = messageSchema(
  "state.resync",
  stateResyncPayloadSchema,
  BROWSER_ENVELOPE,
);

export const stateSnapshotMessageSchema = messageSchema(
  "state.snapshot",
  stateSnapshotPayloadSchema,
  HOST_BROWSER_ENVELOPE,
);
export const stateUpdateMessageSchema = messageSchema(
  "state.update",
  stateUpdatePayloadSchema,
  HOST_BROWSER_ENVELOPE,
);
export const chapterPinsUpdateMessageSchema = messageSchema(
  "chapter.pins.update",
  chapterPinsUpdatePayloadSchema,
  HOST_BROWSER_ENVELOPE,
);
export const configUpdateFromHostMessageSchema = messageSchema(
  "config.update",
  configUpdatePayloadSchema,
  HOST_BROWSER_ENVELOPE,
);
export const connectionStatusMessageSchema = messageSchema(
  "connection.status",
  connectionStatusPayloadSchema,
  HOST_BROWSER_ENVELOPE,
);
export const requestErrorMessageSchema = messageSchema(
  "request.error",
  requestErrorPayloadSchema,
  HOST_BROWSER_ENVELOPE,
);

export const MESSAGE_SCHEMAS_BY_DIRECTION: Record<
  MessageDirection,
  Readonly<Record<string, z.ZodTypeAny>>
> = {
  minecraft_to_host: {
    "minecraft.hello": minecraftHelloMessageSchema,
    "minecraft.status": minecraftStatusMessageSchema,
    "minecraft.snapshot": minecraftSnapshotMessageSchema,
    "minecraft.progress": minecraftProgressMessageSchema,
    "minecraft.pins": minecraftPinsMessageSchema,
    "minecraft.heartbeat": minecraftHeartbeatMessageSchema,
  },
  host_to_minecraft: {
    "host.welcome": hostWelcomeMessageSchema,
    "host.request_snapshot": hostRequestSnapshotMessageSchema,
    "host.error": hostErrorMessageSchema,
  },
  browser_to_host: {
    "browser.hello": browserHelloMessageSchema,
    "chapter.pin": chapterPinMessageSchema,
    "chapter.unpin": chapterUnpinMessageSchema,
    "chapter.reorder": chapterReorderMessageSchema,
    "config.update": configUpdateFromBrowserMessageSchema,
    "state.resync": stateResyncMessageSchema,
  },
  host_to_browser: {
    "state.snapshot": stateSnapshotMessageSchema,
    "state.update": stateUpdateMessageSchema,
    "chapter.pins.update": chapterPinsUpdateMessageSchema,
    "config.update": configUpdateFromHostMessageSchema,
    "connection.status": connectionStatusMessageSchema,
    "request.error": requestErrorMessageSchema,
  },
};

export const MESSAGE_TYPES_BY_DIRECTION: Readonly<Record<MessageDirection, readonly string[]>> = {
  minecraft_to_host: MINECRAFT_TO_HOST_TYPES,
  host_to_minecraft: HOST_TO_MINECRAFT_TYPES,
  browser_to_host: BROWSER_TO_HOST_TYPES,
  host_to_browser: HOST_TO_BROWSER_TYPES,
};

function addIssue(
  ctx: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
): void {
  ctx.addIssue({
    code: "custom",
    message,
    path,
  });
}
