import type { ErrorCode } from "@questbridge/protocol";

/**
 * Host error mapping.
 *
 * Domain failures are represented as a typed result rather than exceptions, so
 * a rejected mutation cannot leave state partially applied
 * (`docs/chapter-pinning.md` §11).
 */

/** A structured, user-presentable failure with a protocol error code. */
export interface HostError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function hostError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): HostError {
  return details === undefined ? { code, message } : { code, message, details };
}

/**
 * A successful operation result or a structured failure.
 *
 * Callers must branch on `ok`; the error path carries no partially applied
 * data by construction.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: HostError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(error: HostError): Result<T> {
  return { ok: false, error };
}

/**
 * Configuration load/save failures.
 *
 * Distinct from a `HostError` because they are startup conditions, not
 * protocol rejections, and a corrupt `config.json` must be preserved rather
 * than reported over the wire.
 */
export class ConfigError extends Error {
  /** Absolute path of the offending file. */
  readonly path: string;
  /** True when the file exists but is not valid QuestBridge configuration. */
  readonly invalidFile: boolean;

  constructor(
    message: string,
    path: string,
    options: { invalidFile?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ConfigError";
    this.path = path;
    this.invalidFile = options.invalidFile ?? false;
  }
}
