import type {
  BrowserHelloPayload,
  ChapterPinPayload,
  ChapterPinsUpdatePayload,
  ChapterReorderPayload,
  ChapterUnpinPayload,
  ConfigUpdatePayload,
  ConnectionStatusPayload,
  HostErrorPayload,
  HostRequestSnapshotPayload,
  HostWelcomePayload,
  MessageType,
  MinecraftHeartbeatPayload,
  MinecraftHelloPayload,
  MinecraftPinsPayload,
  MinecraftProgressPayload,
  MinecraftSnapshotPayload,
  MinecraftStatusPayload,
  RequestErrorPayload,
  StateResyncPayload,
  StateSnapshotPayload,
  StateUpdatePayload,
} from "./schemas.js";

/** Payload type for every message type in the v1 catalog. */
export interface MessagePayloadMap {
  "minecraft.hello": MinecraftHelloPayload;
  "minecraft.status": MinecraftStatusPayload;
  "minecraft.snapshot": MinecraftSnapshotPayload;
  "minecraft.progress": MinecraftProgressPayload;
  "minecraft.pins": MinecraftPinsPayload;
  "minecraft.heartbeat": MinecraftHeartbeatPayload;
  "host.welcome": HostWelcomePayload;
  "host.request_snapshot": HostRequestSnapshotPayload;
  "host.error": HostErrorPayload;
  "browser.hello": BrowserHelloPayload;
  "chapter.pin": ChapterPinPayload;
  "chapter.unpin": ChapterUnpinPayload;
  "chapter.reorder": ChapterReorderPayload;
  "config.update": ConfigUpdatePayload;
  "state.resync": StateResyncPayload;
  "state.snapshot": StateSnapshotPayload;
  "state.update": StateUpdatePayload;
  "chapter.pins.update": ChapterPinsUpdatePayload;
  "connection.status": ConnectionStatusPayload;
  "request.error": RequestErrorPayload;
}

/**
 * A validated v1 envelope. `sequence` and `sessionId` are optional at the type
 * level because their presence depends on the direction; the direction-specific
 * schemas enforce the exact rules.
 */
export interface ProtocolEnvelope<T extends MessageType = MessageType> {
  protocolVersion: 1;
  type: T;
  timestamp: string;
  sequence?: number;
  sessionId?: string;
  requestId?: string;
  payload: MessagePayloadMap[T];
}

/** Discriminated union of every valid v1 message. */
export type ProtocolMessage = {
  [K in MessageType]: ProtocolEnvelope<K>;
}[MessageType];

export interface CreateMessageOptions {
  /** ISO 8601 timestamp. Defaults to the current time. */
  timestamp?: string;
  /** Required for `minecraft.*` and host-to-browser messages. */
  sequence?: number;
  /** Required for `minecraft.*` messages. */
  sessionId?: string;
  requestId?: string;
}
