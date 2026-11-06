import {
  MESSAGE_SCHEMAS_BY_DIRECTION,
  MESSAGE_TYPES_BY_DIRECTION,
  type ErrorCode,
  type MessageDirection,
  type MessageType,
} from "./schemas.js";
import type {
  CreateMessageOptions,
  MessagePayloadMap,
  ProtocolEnvelope,
  ProtocolMessage,
} from "./types.js";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from "./version.js";

/**
 * Envelope construction, parsing, and sequence/revision tracking.
 *
 * Parsing is always direction-aware: a message type is only accepted on the
 * connection direction that owns it. This prevents, for example, a browser from
 * publishing a `minecraft.snapshot`.
 */

const FATAL_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "unsupported_protocol",
  "role_mismatch",
  "session_mismatch",
  "message_too_large",
  "rate_limited",
]);

export interface ProtocolErrorOptions {
  fatal?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class ProtocolError extends Error {
  readonly code: ErrorCode;
  readonly fatal: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, options: ProtocolErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProtocolError";
    this.code = code;
    this.fatal = options.fatal ?? FATAL_ERROR_CODES.has(code);
    this.details = options.details;
  }
}

export function isFatalErrorCode(code: ErrorCode): boolean {
  return FATAL_ERROR_CODES.has(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function messageTypesForDirection(direction: MessageDirection): readonly string[] {
  return MESSAGE_TYPES_BY_DIRECTION[direction];
}

/**
 * Validate an already-parsed JSON value against a direction's message catalog.
 *
 * @throws {ProtocolError} `unsupported_protocol` for a non-v1 version,
 * `invalid_message` for any structural or schema failure.
 */
export function parseMessage(raw: unknown, direction: MessageDirection): ProtocolMessage {
  if (!isRecord(raw)) {
    throw new ProtocolError("invalid_message", "Message must be a JSON object");
  }

  const version = raw["protocolVersion"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new ProtocolError(
      "invalid_message",
      "Message must contain an integer protocolVersion",
    );
  }
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      "unsupported_protocol",
      `QuestBridge protocol version ${version} is not supported (expected ${PROTOCOL_VERSION})`,
      { fatal: true, details: { protocolVersion: version, supportedVersion: PROTOCOL_VERSION } },
    );
  }

  const type = raw["type"];
  if (typeof type !== "string" || type.length === 0) {
    throw new ProtocolError("invalid_message", "Message must contain a non-empty type");
  }

  const allowedTypes = MESSAGE_TYPES_BY_DIRECTION[direction];
  if (!allowedTypes.includes(type)) {
    throw new ProtocolError(
      "invalid_message",
      `Message type "${type}" is not valid for the ${direction} direction`,
      { details: { type, direction } },
    );
  }

  const schema = MESSAGE_SCHEMAS_BY_DIRECTION[direction][type];
  if (schema === undefined) {
    throw new ProtocolError("invalid_message", `No schema is registered for "${type}"`);
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    const first = issues[0];
    const detail = first === undefined ? "schema validation failed" : `${first.path}: ${first.message}`;
    const suffix = detail.startsWith(":") ? detail.slice(1).trim() : detail;
    throw new ProtocolError("invalid_message", `Invalid ${type}: ${suffix}`, {
      details: { type, issues },
    });
  }

  return result.data as ProtocolMessage;
}

/**
 * Enforce the frame size limit, parse JSON, and validate the message.
 */
export function parseFrame(
  frame: string | Uint8Array,
  direction: MessageDirection,
): ProtocolMessage {
  const bytes = typeof frame === "string" ? new TextEncoder().encode(frame) : frame;
  if (bytes.byteLength > MAX_MESSAGE_BYTES) {
    throw new ProtocolError(
      "message_too_large",
      `Frame is ${bytes.byteLength} bytes; the limit is ${MAX_MESSAGE_BYTES}`,
      { fatal: true, details: { byteLength: bytes.byteLength, maxBytes: MAX_MESSAGE_BYTES } },
    );
  }

  const text = typeof frame === "string" ? frame : new TextDecoder().decode(frame);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProtocolError("invalid_message", "Frame is not valid JSON", {
      cause: error,
    });
  }

  return parseMessage(parsed, direction);
}

/**
 * Validate and serialize a message. Serializing an invalid message throws
 * `ProtocolError` rather than emitting corrupt protocol data.
 */
export function serializeMessage(message: ProtocolMessage, direction: MessageDirection): string {
  return JSON.stringify(parseMessage(message, direction));
}

/** Create an envelope. Structural validity is enforced by `serializeMessage`. */
export function createMessage<T extends MessageType>(
  type: T,
  payload: MessagePayloadMap[T],
  options: CreateMessageOptions = {},
): ProtocolEnvelope<T> {
  const message: ProtocolEnvelope<T> = {
    protocolVersion: PROTOCOL_VERSION,
    type,
    timestamp: options.timestamp ?? new Date().toISOString(),
    payload,
  };

  if (options.sequence !== undefined) {
    message.sequence = options.sequence;
  }
  if (options.sessionId !== undefined) {
    message.sessionId = options.sessionId;
  }
  if (options.requestId !== undefined) {
    message.requestId = options.requestId;
  }

  return message;
}

export type SequenceObservation = "accepted" | "duplicate" | "gap";

/**
 * Tracks inbound sequence numbers for one connection.
 *
 * - `accepted`: the message is next in order.
 * - `duplicate`: the sequence was already accepted; ignore it.
 * - `gap`: a message was missed. The caller requests a fresh snapshot.
 *
 * A full snapshot is self-contained and resets the expected sequence to
 * `snapshot.sequence + 1`, even when earlier updates were lost.
 */
export class SequenceTracker {
  #lastAccepted = 0;

  get lastAccepted(): number {
    return this.#lastAccepted;
  }

  reset(): void {
    this.#lastAccepted = 0;
  }

  observe(sequence: number, options: { snapshot?: boolean } = {}): SequenceObservation {
    if (sequence <= this.#lastAccepted) {
      return "duplicate";
    }

    if (options.snapshot === true) {
      this.#lastAccepted = sequence;
      return "accepted";
    }

    if (sequence > this.#lastAccepted + 1) {
      return "gap";
    }

    this.#lastAccepted = sequence;
    return "accepted";
  }
}

export type RevisionObservation = "accepted" | "stale" | "gap";

/**
 * Tracks host state revisions for one browser connection.
 *
 * - `accepted`: apply the update.
 * - `stale`: revision is not newer; ignore it.
 * - `gap`: state was lost; request a full `state.snapshot`.
 */
export class RevisionTracker {
  #lastRevision = -1;

  get lastRevision(): number {
    return this.#lastRevision;
  }

  reset(): void {
    this.#lastRevision = -1;
  }

  observe(revision: number, options: { snapshot?: boolean } = {}): RevisionObservation {
    if (revision <= this.#lastRevision) {
      return "stale";
    }

    if (options.snapshot === true) {
      this.#lastRevision = revision;
      return "accepted";
    }

    if (revision > this.#lastRevision + 1) {
      return "gap";
    }

    this.#lastRevision = revision;
    return "accepted";
  }
}

/** Monotonic outbound sequence counter, starting at 1 per connection. */
export class SequenceCounter {
  #next = 1;

  next(): number {
    const value = this.#next;
    this.#next += 1;
    return value;
  }

  reset(): void {
    this.#next = 1;
  }
}
