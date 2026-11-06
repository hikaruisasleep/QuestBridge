import { z } from "zod";

import {
  DEFAULT_DISPLAY_CONFIG,
  MAX_CHAPTER_PINS,
  chapterPinConfigSchema,
  displayConfigSchema,
  type ChapterPinConfig,
  type DisplayConfig,
} from "@questbridge/protocol";

/**
 * Host configuration schema.
 *
 * This is the on-disk shape of `config.json`, which is a superset of the
 * protocol's `ChapterPinConfig` and `DisplayConfig`: it additionally carries a
 * schema version and the persisted server port.
 *
 * `docs/phase-2-plan.md` §8.1 and `docs/chapter-pinning.md` §2 define the
 * rules. Objects are strict, so a typo in a hand-edited file is reported
 * rather than silently ignored.
 */

/** The only supported configuration file version. */
export const CONFIG_VERSION = 1 as const;

const portSchema = z.number().int().min(1).max(65_535);

export const serverConfigSchema = z.strictObject({
  port: portSchema,
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export const hostConfigSchema = z.strictObject({
  version: z.literal(CONFIG_VERSION),
  server: serverConfigSchema,
  chapterPins: chapterPinConfigSchema,
  display: displayConfigSchema,
});

export type HostConfig = z.infer<typeof hostConfigSchema>;

/** The port persisted in a fresh configuration, per `docs/phase-2-plan.md` §8.1. */
export const DEFAULT_SERVER_PORT = 8765;

/**
 * The configuration written on first run.
 *
 * No chapter pins are seeded: `AGENTS.md` §17 is explicit that QuestBridge must
 * never select chapters automatically, and the ATM10 TTS chapter IDs in
 * `docs/chapter-pinning.md` are documented examples, not defaults.
 */
export function createDefaultConfig(port: number = DEFAULT_SERVER_PORT): HostConfig {
  return {
    version: CONFIG_VERSION,
    server: { port },
    chapterPins: {
      maxPins: MAX_CHAPTER_PINS,
      pinnedChapters: [],
    },
    display: { ...DEFAULT_DISPLAY_CONFIG },
  };
}

/**
 * Extract the protocol-level chapter pin configuration.
 *
 * The stored object already satisfies the protocol schema, so this is a
 * narrowing copy rather than a translation.
 */
export function toChapterPinConfig(config: HostConfig): ChapterPinConfig {
  return {
    maxPins: config.chapterPins.maxPins,
    pinnedChapters: config.chapterPins.pinnedChapters.map((pin) => ({ ...pin })),
  };
}

/** Extract the protocol-level display configuration. */
export function toDisplayConfig(config: HostConfig): DisplayConfig {
  return { ...config.display };
}
