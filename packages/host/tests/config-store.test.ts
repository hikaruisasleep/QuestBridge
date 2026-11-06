import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_CHAPTER_PINS } from "@questbridge/protocol";

import { CONFIG_VERSION, createDefaultConfig } from "../src/config-schema.js";
import { ConfigStore } from "../src/config-store.js";
import { ConfigError } from "../src/errors.js";
import { SILENT_LOGGER } from "../src/logging.js";

/**
 * Configuration persistence.
 *
 * The scenarios that matter most here are the destructive ones: an invalid or
 * newer file must never be overwritten, and a failed write must not advance
 * in-memory state past what reached disk.
 */

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "qb-config-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function configPath(): string {
  return join(directory, "config.json");
}

async function load(): Promise<ConfigStore> {
  return ConfigStore.load({ filePath: configPath(), logger: SILENT_LOGGER });
}

describe("ConfigStore loading", () => {
  it("creates a default configuration when none exists", async () => {
    const store = await load();

    expect(store.chapterPins.pinnedChapters).toEqual([]);
    expect(store.chapterPins.maxPins).toBe(MAX_CHAPTER_PINS);
    expect(store.display.theme).toBe("minimal");
    expect(store.port).toBe(8765);

    const written = JSON.parse(await readFile(configPath(), "utf8")) as {
      version: number;
      chapterPins: { pinnedChapters: unknown[] };
    };
    expect(written.version).toBe(CONFIG_VERSION);
    // No chapter pins are seeded automatically.
    expect(written.chapterPins.pinnedChapters).toEqual([]);
  });

  it("round-trips configuration through disk", async () => {
    const store = await load();
    const pins = {
      maxPins: MAX_CHAPTER_PINS,
      pinnedChapters: [
        { chapterId: "a", position: 0 },
        { chapterId: "ghost", position: 1 },
      ],
    } as const;

    await store.replaceChapterPins({ maxPins: MAX_CHAPTER_PINS, pinnedChapters: [...pins.pinnedChapters] });

    const reloaded = await load();
    expect(reloaded.chapterPins.pinnedChapters).toEqual([
      { chapterId: "a", position: 0 },
      { chapterId: "ghost", position: 1 },
    ]);
  });

  it("preserves configuration across a reset in-memory instance", async () => {
    const first = await load();
    await first.replaceDisplay({
      showChapterProgress: false,
      showQuestTasks: true,
      showCompletedQuests: false,
      completionAnimation: false,
      theme: "minimal",
      compactMode: false,
    });

    const second = await load();
    expect(second.display.showChapterProgress).toBe(false);
    expect(second.display.completionAnimation).toBe(false);
    expect(second.display.compactMode).toBe(false);
  });

  it("rejects malformed JSON without overwriting the file", async () => {
    const original = "{ this is not json";
    await writeFile(configPath(), original, "utf8");

    await expect(load()).rejects.toThrow(ConfigError);
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });

  it("rejects an invalid schema without overwriting the file", async () => {
    const original = JSON.stringify({
      version: 1,
      server: { port: 8765 },
      chapterPins: { maxPins: 5, pinnedChapters: [{ chapterId: "a", position: 3 }] },
      display: {
        showChapterProgress: true,
        showQuestTasks: true,
        showCompletedQuests: true,
        completionAnimation: true,
        theme: "minimal",
        compactMode: true,
      },
    });
    await writeFile(configPath(), original, "utf8");

    // position 3 with a single entry violates the contiguity invariant.
    await expect(load()).rejects.toThrow(/contiguous/i);
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });

  it("rejects unknown fields", async () => {
    const original = JSON.stringify({
      ...createDefaultConfig(),
      unexpected: true,
    });
    await writeFile(configPath(), original, "utf8");

    await expect(load()).rejects.toThrow(ConfigError);
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });

  it("fails closed on a newer configuration version", async () => {
    const original = JSON.stringify({ ...createDefaultConfig(), version: 99 });
    await writeFile(configPath(), original, "utf8");

    await expect(load()).rejects.toThrow(/newer than this host supports/);
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });

  it("fails closed on an older configuration version", async () => {
    const original = JSON.stringify({ ...createDefaultConfig(), version: 0 });
    await writeFile(configPath(), original, "utf8");

    await expect(load()).rejects.toThrow(/migration/);
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });

  it("reports the exact failing path", async () => {
    await writeFile(configPath(), "{ nope", "utf8");

    await expect(load()).rejects.toMatchObject({ path: configPath(), invalidFile: true });
  });

  it("creates missing parent directories", async () => {
    const nested = join(directory, "a", "b", "config.json");
    const store = await ConfigStore.load({ filePath: nested, logger: SILENT_LOGGER });
    expect(store.chapterPins.pinnedChapters).toEqual([]);
    expect((await stat(nested)).isFile()).toBe(true);
  });
});

describe("ConfigStore updates", () => {
  it("rejects an invalid replacement before writing", async () => {
    const store = await load();
    const before = await readFile(configPath(), "utf8");

    await expect(
      store.replace({
        ...createDefaultConfig(),
        chapterPins: {
          maxPins: MAX_CHAPTER_PINS,
          // Six pins violate the protocol maximum.
          pinnedChapters: [0, 1, 2, 3, 4, 5].map((position) => ({
            chapterId: `c${position}`,
            position,
          })),
        },
      }),
    ).rejects.toThrow(ConfigError);

    expect(await readFile(configPath(), "utf8")).toBe(before);
    expect(store.chapterPins.pinnedChapters).toEqual([]);
  });

  it("rolls back in-memory state when the write fails", async () => {
    const store = await load();

    // Occupy the config path with a directory so the rename cannot succeed.
    await rm(configPath(), { force: true });
    await mkdir(configPath());

    await expect(
      store.replaceChapterPins({
        maxPins: MAX_CHAPTER_PINS,
        pinnedChapters: [{ chapterId: "a", position: 0 }],
      }),
    ).rejects.toThrow(ConfigError);

    // Memory must not be ahead of disk.
    expect(store.chapterPins.pinnedChapters).toEqual([]);
  });

  it("returns defensive copies", async () => {
    const store = await load();

    const pins = store.chapterPins;
    pins.pinnedChapters.push({ chapterId: "injected", position: 0 });

    expect(store.chapterPins.pinnedChapters).toEqual([]);
  });

  it("serializes concurrent writes without corrupting the file", async () => {
    const store = await load();

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.replaceChapterPins({
          maxPins: MAX_CHAPTER_PINS,
          pinnedChapters: [{ chapterId: `c${index}`, position: 0 }],
        }),
      ),
    );

    // The last committed write wins, and the file must be valid JSON.
    const written = JSON.parse(await readFile(configPath(), "utf8")) as {
      chapterPins: { pinnedChapters: { chapterId: string; position: number }[] };
    };
    expect(written.chapterPins.pinnedChapters).toHaveLength(1);
    expect(written.chapterPins.pinnedChapters[0]?.position).toBe(0);

    const reloaded = await load();
    expect(reloaded.chapterPins.pinnedChapters).toEqual(
      written.chapterPins.pinnedChapters,
    );
  });

  it("writes valid formatting with a trailing newline", async () => {
    const store = await load();
    await store.save();

    const raw = await readFile(configPath(), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe("createDefaultConfig", () => {
  it("honours an explicit port and seeds no pins", () => {
    const config = createDefaultConfig(9000);
    expect(config.server.port).toBe(9000);
    expect(config.chapterPins.pinnedChapters).toEqual([]);
    expect(config.chapterPins.maxPins).toBe(5);
  });
});
