import { LOOPBACK_HOSTNAMES, MAX_HTTP_BODY_BYTES } from "./constants.js";
import type { ErrorCode } from "@questbridge/protocol";

/**
 * Transport-level validation: origin policy, body limits, and rate limits.
 *
 * `docs/local-authentication.md` §5 governs the origin rules. The important
 * and easily-misread point: allowlisting matches the loopback **hostname only
 * and ignores the port** (accepted risk R2). That is intentional, not an
 * oversight — tightening it to include the port would break running the
 * dashboard from a development server on another port during Phase 3.
 */

/**
 * True when a WebSocket `Origin` header is acceptable.
 *
 * - A missing origin is acceptable only for a token-authenticated native
 *   client (the adapter sends no `Origin`); the caller enforces that.
 * - Otherwise the origin's hostname must be a loopback name, on any port.
 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (origin === undefined || origin === null || origin.length === 0) {
    return true;
  }

  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  // `URL` normalises `[::1]` to `::1`; accept both spellings.
  return LOOPBACK_HOSTNAMES.includes(hostname) || LOOPBACK_HOSTNAMES.includes(`[${hostname}]`);
}

/** True when a request declares no origin, i.e. it is a native client. */
export function hasNoOrigin(origin: string | undefined | null): boolean {
  return origin === undefined || origin === null || origin.length === 0;
}

/** Outcome of validating a frame or body against a size limit. */
export type LimitVerdict = { ok: true } | { ok: false; code: ErrorCode; message: string };

/** Enforce the HTTP request body limit declared in the `Content-Length` header. */
export function checkHttpBodySize(contentLength: string | undefined): LimitVerdict {
  if (contentLength === undefined) {
    return { ok: true };
  }
  const length = Number(contentLength);
  if (!Number.isFinite(length) || length < 0) {
    return { ok: false, code: "invalid_message", message: "Invalid Content-Length" };
  }
  if (length > MAX_HTTP_BODY_BYTES) {
    return {
      ok: false,
      code: "invalid_message",
      message: `Request body exceeds ${MAX_HTTP_BODY_BYTES} bytes`,
    };
  }
  return { ok: true };
}

/**
 * A sliding-window counter per key.
 *
 * Used for browser mutations, new browser connections, and new Minecraft
 * connections. Windows are minute- and second-scale, so a simple timestamp
 * list is accurate enough and avoids a dependency.
 */
export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #hits = new Map<string, number[]>();

  constructor(limit: number, windowMs: number, now: () => number = () => Date.now()) {
    if (limit <= 0) {
      throw new Error(`Rate limit must be positive, received ${limit}`);
    }
    if (windowMs <= 0) {
      throw new Error(`Rate window must be positive, received ${windowMs}`);
    }
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  /**
   * Record an attempt for `key`.
   *
   * @returns `true` when the attempt is within the limit, `false` when it
   *   should be rejected. A rejected attempt is still recorded so a burst
   *   cannot reset the window by being refused.
   */
  tryConsume(key: string): boolean {
    const nowMs = this.#now();
    const cutoff = nowMs - this.#windowMs;

    const existing = this.#hits.get(key);
    const recent = existing === undefined ? [] : existing.filter((time) => time > cutoff);

    if (recent.length >= this.#limit) {
      this.#hits.set(key, recent);
      return false;
    }

    recent.push(nowMs);
    this.#hits.set(key, recent);
    return true;
  }

  /** Number of attempts currently inside the window for `key`. */
  count(key: string): number {
    const cutoff = this.#now() - this.#windowMs;
    const existing = this.#hits.get(key);
    if (existing === undefined) {
      return 0;
    }
    return existing.filter((time) => time > cutoff).length;
  }

  /** Forget a key, e.g. when a connection closes. */
  release(key: string): void {
    this.#hits.delete(key);
  }

  /** Drop all recorded attempts. */
  clear(): void {
    this.#hits.clear();
  }
}

/** Default limits, from `docs/local-authentication.md` §7. */
export const LIMITS = {
  browserMutationsPerSecond: 10,
  newBrowserConnectionsPerMinute: 20,
  newMinecraftConnectionsPerMinute: 5,
} as const;
