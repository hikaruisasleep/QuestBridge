import process from "node:process";

/**
 * Structured, redacted logging.
 *
 * The host must never write a token to a log, and `docs/local-authentication.md`
 * §2 requires the same for any configuration-derived secret. `redactSecrets`
 * is applied to every emitted line so a token that reaches a message by
 * accident — for example inside a URL — cannot reach the output.
 */

export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerOptions {
  /** Sink for formatted lines. Defaults to stdout. */
  write?: (line: string) => void;
  /** Formats an ISO timestamp into the short clock used in output. */
  clock?: (timestamp: string) => string;
  /** Level filter. Defaults to `info` (everything). */
  minLevel?: LogLevel;
}

/**
 * Matches a `token=` query parameter in a URL or free text.
 *
 * Tokens are 43-character `base64url` strings, but the pattern deliberately
 * matches any value so a malformed or truncated token is redacted too.
 */
const TOKEN_QUERY_PATTERN = /([?&]token=)[^&\s"'`]+/gi;

/**
 * Matches a bearer credential in an HTTP header rendering.
 */
const BEARER_PATTERN = /\b(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;

/**
 * Redact credential material from a string before it is logged.
 *
 * This is a defence-in-depth measure, not a licence to pass secrets to the
 * logger: callers must still avoid logging tokens deliberately.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(TOKEN_QUERY_PATTERN, "$1<redacted>")
    .replace(BEARER_PATTERN, "$1<redacted>");
}

function defaultClock(timestamp: string): string {
  return timestamp.slice(11, 23);
}

const LEVEL_ORDER: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

export function createLogger(options: LoggerOptions = {}): Logger {
  const write =
    options.write ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`);
    });
  const clock = options.clock ?? defaultClock;
  const minLevel = options.minLevel ?? "info";
  const threshold = LEVEL_ORDER[minLevel];

  const emit = (level: LogLevel, message: string): void => {
    if (LEVEL_ORDER[level] < threshold) {
      return;
    }
    const stamp = clock(new Date().toISOString());
    const label = level.toUpperCase().padEnd(5);
    write(`[${stamp}] ${label} ${redactSecrets(message)}`);
  };

  return {
    info: (message) => emit("info", message),
    warn: (message) => emit("warn", message),
    error: (message) => emit("error", message),
  };
}

/** A logger that discards everything. Used by tests that do not assert output. */
export const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
