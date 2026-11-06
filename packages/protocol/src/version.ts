/**
 * Protocol v1 constants.
 *
 * The wire contract is documented in `docs/protocol.md`. These values are
 * runtime constants shared by the host, the mock publisher, and the frontend.
 */

/** The only supported protocol version. */
export const PROTOCOL_VERSION = 1 as const;

/** Hard limit on an inbound WebSocket text frame, in UTF-8 bytes. */
export const MAX_MESSAGE_BYTES = 262_144;

/** The chapter pin limit is a product invariant, not a configuration value. */
export const MAX_CHAPTER_PINS = 5 as const;

/** Maximum length of any protocol identifier. */
export const MAX_ID_LENGTH = 128;

/** Maximum length of `browser.hello.clientName`. */
export const MAX_CLIENT_NAME_LENGTH = 64;

/** Maximum length of an error message. */
export const MAX_ERROR_MESSAGE_LENGTH = 512;

/** FTB's automatic tracker identifier. It is never a manual quest pin. */
export const AUTOMATIC_PIN_ID = "1" as const;

/**
 * Host-declared timing defaults from `docs/protocol.md` and
 * `docs/architecture.md`. These are sent to the adapter in `host.welcome`.
 *
 * The stale and disconnect thresholds are deliberately generous relative to the
 * 5 s heartbeat. They exist to catch a publisher that has genuinely gone away —
 * a game crash, a server or world switch — not to surface a brief scheduling
 * hiccup or a deferred update. Showing an on-stream overlay that reacts to a
 * two-second stutter would be a worse failure than the stutter itself
 * (`docs/web-frontend.md` §3.4).
 */
export const DEFAULT_TIMINGS = {
  heartbeatIntervalMs: 5_000,
  staleAfterMs: 20_000,
  disconnectAfterMs: 30_000,
  reconcileIntervalMs: 2_000,
} as const;
