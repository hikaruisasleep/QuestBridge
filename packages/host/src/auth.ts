import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile, chmod } from "node:fs/promises";
import { dirname, basename, join } from "node:path";

import type { Logger } from "./logging.js";

/**
 * Transport authentication.
 *
 * The normative design is `docs/local-authentication.md`. Two points are easy
 * to get wrong and are stated here so they are not "corrected" later:
 *
 * 1. **Two tokens, not three.** Accepted risk R1 means the browser token does
 *    not distinguish `overlay` from `control`; a per-role token would advertise
 *    a boundary that is not enforced. `browserToken` and `minecraftToken` are
 *    the only real trust boundaries.
 * 2. **`tokens.json` recovers; `config.json` does not.** Tokens are
 *    regenerable, chapter pins are not. A corrupt token file is backed up and
 *    replaced rather than failing closed, which would lock the user out
 *    permanently.
 *
 * There are no cookies and no login redirect: the token travels in the query
 * string and is validated once, on the WebSocket upgrade.
 */

/** Token byte length. 32 bytes is 256 bits of entropy. */
const TOKEN_BYTES = 32;

/** The only supported token file version. */
export const TOKENS_VERSION = 1 as const;

/** A role a token can authorise. There is deliberately no third browser role. */
export type TokenRole = "browser" | "minecraft";

export interface Tokens {
  version: typeof TOKENS_VERSION;
  browserToken: string;
  minecraftToken: string;
}

export interface TokenStoreOptions {
  /** Absolute path to `tokens.json`. */
  filePath: string;
  logger: Logger;
}

/**
 * Generate a fresh 256-bit token as `base64url`.
 *
 * URL-safe so a token needs no percent-encoding when it appears in a URL.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function createTokens(): Tokens {
  return {
    version: TOKENS_VERSION,
    browserToken: generateToken(),
    minecraftToken: generateToken(),
  };
}

/**
 * Constant-time token comparison.
 *
 * Both values are hashed first so the comparison is over fixed-length digests.
 * `timingSafeEqual` throws on unequal lengths, and comparing raw tokens of
 * differing length would also leak the stored token's length.
 */
export function tokensMatch(presented: string | undefined | null, expected: string): boolean {
  if (presented === undefined || presented === null || presented.length === 0) {
    return false;
  }

  const presentedDigest = createHash("sha256").update(presented, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();

  return timingSafeEqual(presentedDigest, expectedDigest);
}

function isTokens(value: unknown): value is Tokens {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate["version"] === TOKENS_VERSION &&
    typeof candidate["browserToken"] === "string" &&
    candidate["browserToken"].length > 0 &&
    typeof candidate["minecraftToken"] === "string" &&
    candidate["minecraftToken"].length > 0
  );
}

async function restrictPermissions(path: string): Promise<void> {
  try {
    await chmod(path, 0o600);
  } catch {
    // Windows treats the mode as advisory; the directory restriction stands.
  }
}

export class TokenStore {
  readonly #filePath: string;

  #tokens: Tokens;

  private constructor(options: TokenStoreOptions, tokens: Tokens) {
    this.#filePath = options.filePath;
    this.#tokens = tokens;
  }

  /**
   * Load tokens, generating them on first run.
   *
   * A corrupt or unreadable file is moved aside and replaced, so a damaged
   * token file cannot lock the user out. The warning never contains token
   * values.
   */
  static async load(options: TokenStoreOptions): Promise<TokenStore> {
    let raw: string;
    try {
      raw = await readFile(options.filePath, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        const store = new TokenStore(options, createTokens());
        await store.#persist();
        options.logger.info(
          `generated new access tokens at ${options.filePath}; run with --print-urls to display them`,
        );
        return store;
      }
      // An unreadable file is treated as damaged and recovered, not fatal.
      options.logger.warn(
        `could not read ${options.filePath}; generating new access tokens`,
      );
      const store = new TokenStore(options, createTokens());
      await store.#persist();
      return store;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return TokenStore.#recover(options, "is not valid JSON");
    }

    if (!isTokens(parsed)) {
      return TokenStore.#recover(options, "does not match the expected token format");
    }

    return new TokenStore(options, parsed);
  }

  /**
   * Back up a damaged token file and replace it.
   *
   * The opposite of the `config.json` rule, and deliberately so.
   */
  static async #recover(options: TokenStoreOptions, reason: string): Promise<TokenStore> {
    const backupPath = await pickBackupPath(options.filePath);

    try {
      await rename(options.filePath, backupPath);
      options.logger.warn(
        `token file ${reason}; moved to ${basename(backupPath)} and regenerated`,
      );
    } catch {
      options.logger.warn(`token file ${reason}; regenerating in place`);
    }

    const store = new TokenStore(options, createTokens());
    await store.#persist();
    return store;
  }

  get tokens(): Tokens {
    return { ...this.#tokens };
  }

  get filePath(): string {
    return this.#filePath;
  }

  /**
   * Resolve a presented token to the role it authorises.
   *
   * Note the absence of any test against a requested role: per accepted risk
   * R1 the browser token authorises whichever browser role the connection
   * declares, and the host enforces that declared role for the connection's
   * lifetime instead.
   */
  roleFor(presented: string | undefined | null): TokenRole | null {
    if (tokensMatch(presented, this.#tokens.minecraftToken)) {
      return "minecraft";
    }
    if (tokensMatch(presented, this.#tokens.browserToken)) {
      return "browser";
    }
    return null;
  }

  /** Regenerate both tokens and persist them. */
  async rotate(): Promise<Tokens> {
    this.#tokens = createTokens();
    await this.#persist();
    return this.tokens;
  }

  async #persist(): Promise<void> {
    const directory = dirname(this.#filePath);
    const tempPath = join(directory, `.tokens.${process.pid}.${Date.now()}.tmp`);
    const body = `${JSON.stringify(this.#tokens, null, 2)}\n`;

    await mkdir(directory, { recursive: true });

    try {
      await writeFile(tempPath, body, { encoding: "utf8", mode: 0o600 });
      await restrictPermissions(tempPath);
      await rename(tempPath, this.#filePath);
      await restrictPermissions(this.#filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      // Fatal: without persisted tokens the printed URLs would not survive a
      // restart, so failing loudly is better than silently rotating forever.
      throw new Error(`Could not write token file ${this.#filePath}: ${message}`);
    }
  }
}

async function pickBackupPath(filePath: string): Promise<string> {
  const base = `${filePath}.invalid`;
  try {
    await readFile(base);
  } catch {
    return base;
  }
  // The plain backup name is taken; add a timestamp so nothing is lost.
  return `${base}.${Date.now()}`;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

/**
 * The URLs printed by `--print-urls`.
 *
 * Two URLs because there are two routes, and both are required: `/overlay` is
 * the OBS Browser Source and `/control` is the dashboard. They share one token
 * so there is a single credential to copy while the routes stay distinct.
 */
export function formatAccessUrls(baseUrl: string, tokens: Tokens): string {
  return [
    `Overlay:   ${baseUrl}/overlay?token=${tokens.browserToken}`,
    `Dashboard: ${baseUrl}/control?token=${tokens.browserToken}`,
  ].join("\n");
}
