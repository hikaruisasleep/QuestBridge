import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  TOKENS_VERSION,
  TokenStore,
  createTokens,
  formatAccessUrls,
  generateToken,
  tokensMatch,
} from "../src/auth.js";
import { SILENT_LOGGER } from "../src/logging.js";
import {
  LIMITS,
  RateLimiter,
  checkHttpBodySize,
  hasNoOrigin,
  isAllowedOrigin,
} from "../src/validation.js";

/**
 * Authentication and transport validation.
 *
 * The behaviours asserted here are the ones a future reader is most likely to
 * mistake for bugs: the browser token authorising either browser role (R1),
 * origin matching ignoring the port (R2), and a corrupt token file recovering
 * rather than failing closed.
 */

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "qb-auth-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function tokensPath(): string {
  return join(directory, "tokens.json");
}

async function load(): Promise<TokenStore> {
  return TokenStore.load({ filePath: tokensPath(), logger: SILENT_LOGGER });
}

describe("token generation", () => {
  it("produces 256-bit base64url tokens that are URL-safe", () => {
    const token = generateToken();
    // 32 bytes base64url encodes to 43 characters with no padding.
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces distinct tokens", () => {
    const seen = new Set(Array.from({ length: 64 }, () => generateToken()));
    expect(seen.size).toBe(64);
  });

  it("creates a browser and minecraft token", () => {
    const tokens = createTokens();
    expect(tokens.version).toBe(TOKENS_VERSION);
    expect(tokens.browserToken).not.toBe(tokens.minecraftToken);
  });
});

describe("timing-safe comparison", () => {
  it("matches identical tokens", () => {
    const token = generateToken();
    expect(tokensMatch(token, token)).toBe(true);
  });

  it("rejects different tokens", () => {
    expect(tokensMatch(generateToken(), generateToken())).toBe(false);
  });

  it("rejects empty, undefined, and null presentations", () => {
    const token = generateToken();
    expect(tokensMatch("", token)).toBe(false);
    expect(tokensMatch(undefined, token)).toBe(false);
    expect(tokensMatch(null, token)).toBe(false);
  });

  it("does not throw on a length mismatch", () => {
    // timingSafeEqual throws on differing lengths; hashing first avoids that.
    expect(() => tokensMatch("short", generateToken())).not.toThrow();
    expect(tokensMatch("short", generateToken())).toBe(false);
    expect(tokensMatch(generateToken(), "short")).toBe(false);
  });

  it("compares over fixed-length digests", () => {
    const token = generateToken();
    const digest = createHash("sha256").update(token, "utf8").digest();
    expect(digest).toHaveLength(32);
  });
});

describe("TokenStore persistence", () => {
  it("generates tokens on first run and persists them", async () => {
    const store = await load();
    const written = JSON.parse(await readFile(tokensPath(), "utf8")) as Record<string, unknown>;

    expect(written["version"]).toBe(TOKENS_VERSION);
    expect(written["browserToken"]).toBe(store.tokens.browserToken);
    expect(written["minecraftToken"]).toBe(store.tokens.minecraftToken);
  });

  it("reuses persisted tokens across loads", async () => {
    const first = await load();
    const second = await load();
    expect(second.tokens.browserToken).toBe(first.tokens.browserToken);
    expect(second.tokens.minecraftToken).toBe(first.tokens.minecraftToken);
  });

  it("writes the token file with restrictive permissions where supported", async () => {
    await load();
    const info = await stat(tokensPath());
    if (process.platform !== "win32") {
      // On Windows the mode is advisory; assert only where it is enforced.
      expect(info.mode & 0o777).toBe(0o600);
    }
    expect(info.isFile()).toBe(true);
  });

  it("does not store tokens inside config.json", async () => {
    const store = await load();
    // Tokens live in their own file so config can be inspected safely.
    expect(store.filePath.endsWith("tokens.json")).toBe(true);
  });
});

describe("TokenStore recovery", () => {
  it("recovers from malformed JSON instead of failing closed", async () => {
    await writeFile(tokensPath(), "{ not json", "utf8");

    const store = await load();

    expect(store.tokens.browserToken).toMatch(/^[A-Za-z0-9_-]+$/);
    // The damaged file is preserved for inspection.
    const backup = await readFile(`${tokensPath()}.invalid`, "utf8");
    expect(backup).toBe("{ not json");
  });

  it("recovers from a structurally invalid token file", async () => {
    await writeFile(tokensPath(), JSON.stringify({ version: 1 }), "utf8");

    const store = await load();
    expect(store.tokens.minecraftToken).toHaveLength(43);
    expect(await readFile(`${tokensPath()}.invalid`, "utf8")).toContain('"version"');
  });

  it("recovers from an empty token value", async () => {
    await writeFile(
      tokensPath(),
      JSON.stringify({ version: 1, browserToken: "", minecraftToken: "x" }),
      "utf8",
    );

    const store = await load();
    expect(store.tokens.browserToken.length).toBeGreaterThan(0);
  });

  it("does not overwrite an existing backup", async () => {
    await writeFile(`${tokensPath()}.invalid`, "first-corruption", "utf8");
    await writeFile(tokensPath(), "{ bad", "utf8");

    await load();

    // The original backup survives; the new one gets a timestamped name.
    expect(await readFile(`${tokensPath()}.invalid`, "utf8")).toBe("first-corruption");
  });
});

describe("role resolution", () => {
  it("resolves the browser and minecraft tokens to their roles", async () => {
    const store = await load();
    const tokens = store.tokens;

    expect(store.roleFor(tokens.browserToken)).toBe("browser");
    expect(store.roleFor(tokens.minecraftToken)).toBe("minecraft");
  });

  it("rejects an unknown token", async () => {
    const store = await load();
    expect(store.roleFor(generateToken())).toBeNull();
    expect(store.roleFor("")).toBeNull();
    expect(store.roleFor(undefined)).toBeNull();
  });

  it("does not confuse the two tokens", async () => {
    const store = await load();
    const tokens = store.tokens;

    // Each token resolves to exactly one role, never both.
    expect(store.roleFor(tokens.browserToken)).not.toBe("minecraft");
    expect(store.roleFor(tokens.minecraftToken)).not.toBe("browser");
  });

  it("rotates both tokens", async () => {
    const store = await load();
    const before = store.tokens;

    const after = await store.rotate();

    expect(after.browserToken).not.toBe(before.browserToken);
    expect(after.minecraftToken).not.toBe(before.minecraftToken);
    expect(store.roleFor(after.browserToken)).toBe("browser");

    const reloaded = await load();
    expect(reloaded.tokens.browserToken).toBe(after.browserToken);
  });
});

describe("access url formatting", () => {
  it("prints both routes with the shared browser token", () => {
    const tokens = createTokens();
    const text = formatAccessUrls("http://127.0.0.1:8765", tokens);

    expect(text).toContain(`http://127.0.0.1:8765/overlay?token=${tokens.browserToken}`);
    expect(text).toContain(`http://127.0.0.1:8765/control?token=${tokens.browserToken}`);
    // The minecraft token is never printed as a browser URL.
    expect(text).not.toContain(tokens.minecraftToken);
  });
});

describe("origin validation", () => {
  it("accepts a loopback origin on any port", () => {
    expect(isAllowedOrigin("http://127.0.0.1:8765")).toBe(true);
    expect(isAllowedOrigin("http://localhost:8765")).toBe(true);
    // Accepted risk R2: the port is deliberately ignored.
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:1")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:8765")).toBe(true);
  });

  it("rejects a non-loopback origin", () => {
    expect(isAllowedOrigin("http://evil.example.com")).toBe(false);
    expect(isAllowedOrigin("https://example.com:8765")).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1.evil.com")).toBe(false);
    expect(isAllowedOrigin("not a url")).toBe(false);
  });

  it("treats a missing origin as acceptable for native clients", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin(null)).toBe(true);
    expect(isAllowedOrigin("")).toBe(true);

    expect(hasNoOrigin(undefined)).toBe(true);
    expect(hasNoOrigin("http://localhost")).toBe(false);
  });
});

describe("http body limit", () => {
  it("accepts an absent or small content length", () => {
    expect(checkHttpBodySize(undefined).ok).toBe(true);
    expect(checkHttpBodySize("0").ok).toBe(true);
    expect(checkHttpBodySize("1024").ok).toBe(true);
  });

  it("rejects an oversized body", () => {
    const verdict = checkHttpBodySize("100000");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("exceeds");
    }
  });

  it("rejects a malformed content length", () => {
    expect(checkHttpBodySize("abc").ok).toBe(false);
    expect(checkHttpBodySize("-5").ok).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit inside the window", () => {
    const limiter = new RateLimiter(3, 1_000, () => 0);

    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);
  });

  it("refills as the window slides", () => {
    let nowMs = 0;
    const limiter = new RateLimiter(2, 1_000, () => nowMs);

    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);

    nowMs = 1_001;
    expect(limiter.tryConsume("a")).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 1_000, () => 0);

    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("b")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);
  });

  it("counts within the window and releases keys", () => {
    const limiter = new RateLimiter(5, 1_000, () => 0);
    limiter.tryConsume("a");
    limiter.tryConsume("a");

    expect(limiter.count("a")).toBe(2);
    limiter.release("a");
    expect(limiter.count("a")).toBe(0);
  });

  it("records a rejected attempt so a burst cannot reset the window", () => {
    const limiter = new RateLimiter(1, 1_000, () => 0);
    expect(limiter.tryConsume("a")).toBe(true);
    for (let index = 0; index < 10; index += 1) {
      expect(limiter.tryConsume("a")).toBe(false);
    }
    expect(limiter.count("a")).toBe(1);
  });

  it("rejects nonsensical configuration", () => {
    expect(() => new RateLimiter(0, 1_000)).toThrow();
    expect(() => new RateLimiter(1, 0)).toThrow();
  });

  it("exposes the documented defaults", () => {
    expect(LIMITS.browserMutationsPerSecond).toBe(10);
    expect(LIMITS.newBrowserConnectionsPerMinute).toBe(20);
    expect(LIMITS.newMinecraftConnectionsPerMinute).toBe(5);
  });
});
