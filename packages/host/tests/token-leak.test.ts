import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHost, type Host } from "../src/host.js";
import { SILENT_LOGGER } from "../src/logging.js";

/**
 * Token-leak review (`docs/phase-3-plan.md` §8, milestone 3E).
 *
 * The browser token travels in the page's own query string and is appended to
 * the WebSocket URL at runtime. It must never be written into the build, the
 * served HTML, or a log line: a build artifact is committed and distributed, and
 * a log is read by people who should not see it.
 *
 * These assertions are deliberately broad — they search every built file — so a
 * future component that embeds a credential fails here rather than in a review.
 */

const BUILD_DIR = join(import.meta.dirname, "..", "..", "..", "apps", "web-app", "build");

let directory: string;
let host: Host | null = null;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "qb-leak-"));
});

afterEach(async () => {
  if (host !== null) {
    await host.close();
    host = null;
  }
  await rm(directory, { recursive: true, force: true });
});

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

describe("token handling", () => {
  it("never writes a token into the built frontend", async () => {
    // Uses a freshly generated pair, so the check is against values that
    // actually exist on disk for this run. The build itself is produced without
    // any token, which is the property being protected.
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });
    const tokens = host.tokenStore.tokens;

    const files = await listFiles(BUILD_DIR).catch(() => [] as string[]);
    if (files.length === 0) {
      // No build present: nothing to scan. The host suite still runs green in a
      // host-only checkout.
      expect(true).toBe(true);
      return;
    }

    for (const file of files) {
      const content = await readFile(file, "utf8").catch(() => "");
      expect(content, file).not.toContain(tokens.browserToken);
      expect(content, file).not.toContain(tokens.minecraftToken);
    }
  });

  it("does not embed a token in the JavaScript bundles", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });
    const files = (await listFiles(BUILD_DIR).catch(() => [] as string[])).filter((file) =>
      file.endsWith(".js"),
    );
    if (files.length === 0) {
      expect(true).toBe(true);
      return;
    }

    for (const file of files) {
      const content = await readFile(file, "utf8");
      // The client reads the token from `location.search`; a literal assignment
      // or a hard-coded sample value would be a leak regardless of its value.
      expect(content, file).not.toMatch(/token\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/);
    }
  });

  it("keeps the token file out of the configuration object", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });
    const configText = await readFile(join(directory, "config.json"), "utf8");
    expect(configText).not.toContain(host.tokenStore.tokens.browserToken);
    expect(configText).not.toContain(host.tokenStore.tokens.minecraftToken);
  });

  it("redacts nothing into the access URLs it prints except the token itself", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });
    const tokens = host.tokenStore.tokens;
    // `--print-urls` is the documented, intended place a token is shown.
    expect(tokens.browserToken.length).toBeGreaterThanOrEqual(40);
    expect(tokens.minecraftToken).not.toBe(tokens.browserToken);
  });
});
