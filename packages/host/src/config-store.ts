import { mkdir, open, readFile, rename, rm, chmod, stat } from "node:fs/promises";
import { type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { DisplayConfig } from "@questbridge/protocol";

import {
  CONFIG_VERSION,
  createDefaultConfig,
  hostConfigSchema,
  type HostConfig,
} from "./config-schema.js";
import { ConfigError } from "./errors.js";
import type { Logger } from "./logging.js";

/**
 * Configuration persistence.
 *
 * `docs/phase-2-plan.md` §8.2 governs this module:
 *
 * - write to a temporary file in the same directory, flush, then rename;
 * - set mode `0600` where the platform supports it;
 * - keep the previous file if validation or a write fails;
 * - never overwrite an invalid configuration file with defaults;
 * - report the exact path and validation failure;
 * - serialize writes through one queue so there is no partial write.
 *
 * The asymmetry with `tokens.json` is deliberate and documented in
 * `docs/local-authentication.md` §2.2: chapter pins are irreplaceable, so an
 * invalid `config.json` fails closed; tokens are regenerable, so `tokens.json`
 * recovers. Do not copy the recovery behaviour into this module.
 */

export interface ConfigStoreOptions {
  /** Absolute path to `config.json`. */
  filePath: string;
  logger: Logger;
  /** Port used when creating a fresh configuration. */
  defaultPort?: number;
}

export interface LoadOutcome {
  config: HostConfig;
  /** True when the file did not exist and defaults were written. */
  created: boolean;
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
    })
    .join("; ");
}

/** Read and validate a config file's contents without touching the filesystem. */
function parseConfig(raw: string, filePath: string): HostConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(
      `Configuration file is not valid JSON: ${filePath}`,
      filePath,
      { invalidFile: true, cause: error },
    );
  }

  // A file written by a newer host must not be silently downgraded.
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof (parsed as { version: unknown }).version === "number"
  ) {
    const version = (parsed as { version: number }).version;
    if (version > CONFIG_VERSION) {
      throw new ConfigError(
        `Configuration file version ${version} is newer than this host supports (${CONFIG_VERSION}): ${filePath}`,
        filePath,
        { invalidFile: true },
      );
    }
    if (version < CONFIG_VERSION) {
      throw new ConfigError(
        `Configuration file version ${version} requires a migration this host does not implement: ${filePath}`,
        filePath,
        { invalidFile: true },
      );
    }
  }

  const result = hostConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(
      `Configuration file is invalid: ${filePath} (${formatIssues(result.error.issues)})`,
      filePath,
      { invalidFile: true },
    );
  }

  return result.data;
}

/** Deep copy so callers cannot mutate the store's state through a reference. */
function cloneConfig(config: HostConfig): HostConfig {
  return {
    version: config.version,
    server: { ...config.server },
    chapterPins: {
      maxPins: config.chapterPins.maxPins,
      pinnedChapters: config.chapterPins.pinnedChapters.map((pin) => ({ ...pin })),
    },
    display: { ...config.display },
  };
}

export class ConfigStore {
  readonly #filePath: string;
  readonly #logger: Logger;

  #config: HostConfig;
  /** Tail of the write queue; every save chains onto it. */
  #writes: Promise<void> = Promise.resolve();

  private constructor(options: ConfigStoreOptions, config: HostConfig) {
    this.#filePath = options.filePath;
    this.#logger = options.logger;
    this.#config = config;
  }

  /**
   * Load the configuration, creating it when absent.
   *
   * @throws {ConfigError} when the file exists but is invalid. The existing
   *   file is left untouched in that case; the caller decides how to report it.
   */
  static async load(options: ConfigStoreOptions): Promise<ConfigStore> {
    let raw: string;
    try {
      raw = await readFile(options.filePath, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        const config = createDefaultConfig(options.defaultPort);
        const store = new ConfigStore(options, config);
        await store.save();
        options.logger.info(
          `created default configuration at ${options.filePath} (no chapter pins seeded)`,
        );
        return store;
      }
      throw new ConfigError(
        `Could not read configuration file: ${options.filePath}`,
        options.filePath,
        { cause: error },
      );
    }

    const config = parseConfig(raw, options.filePath);
    options.logger.info(`loaded configuration from ${options.filePath}`);
    return new ConfigStore(options, config);
  }

  /** Current configuration. A defensive copy; mutate through `replace`. */
  get current(): HostConfig {
    return cloneConfig(this.#config);
  }

  get filePath(): string {
    return this.#filePath;
  }

  /** Chapter pin configuration in protocol form. */
  get chapterPins(): HostConfig["chapterPins"] {
    return {
      maxPins: this.#config.chapterPins.maxPins,
      pinnedChapters: this.#config.chapterPins.pinnedChapters.map((pin) => ({ ...pin })),
    };
  }

  /** Display configuration in protocol form. */
  get display(): DisplayConfig {
    return { ...this.#config.display };
  }

  /** Server port, as persisted. */
  get port(): number {
    return this.#config.server.port;
  }

  /**
   * Validate and commit a replacement configuration.
   *
   * Validation happens before any write, so an invalid replacement leaves
   * memory and disk unchanged.
   *
   * @throws {ConfigError} when the candidate is invalid or the write fails.
   */
  async replace(next: HostConfig): Promise<HostConfig> {
    const parsed = hostConfigSchema.safeParse(next);
    if (!parsed.success) {
      throw new ConfigError(
        `Refusing to persist an invalid configuration: ${formatIssues(parsed.error.issues)}`,
        this.#filePath,
        { invalidFile: false },
      );
    }

    const previous = this.#config;
    this.#config = parsed.data;

    try {
      await this.save();
    } catch (error) {
      // A failed write must not leave the in-memory config ahead of disk.
      this.#config = previous;
      throw error;
    }

    return cloneConfig(this.#config);
  }

  /** Replace only the chapter pin configuration. */
  async replaceChapterPins(pins: HostConfig["chapterPins"]): Promise<HostConfig> {
    return this.replace({ ...this.#config, chapterPins: pins });
  }

  /** Replace only the display configuration. */
  async replaceDisplay(display: DisplayConfig): Promise<HostConfig> {
    return this.replace({ ...this.#config, display });
  }

  /**
   * Persist the current configuration atomically.
   *
   * Serialized through `#writes` so concurrent callers cannot interleave a
   * temporary file with another writer's rename.
   */
  async save(): Promise<void> {
    const run = this.#writes.then(() => this.#writeAtomic(this.#config));
    // Keep the queue alive after a failure so later saves still run, but do not
    // let an unhandled rejection escape from the chain itself.
    this.#writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #writeAtomic(config: HostConfig): Promise<void> {
    const directory = dirname(this.#filePath);
    const tempPath = join(directory, `.config.${process.pid}.${Date.now()}.tmp`);
    const body = `${JSON.stringify(config, null, 2)}\n`;

    try {
      await mkdir(directory, { recursive: true });
    } catch (error) {
      throw new ConfigError(
        `Could not create configuration directory: ${directory}`,
        this.#filePath,
        { cause: error },
      );
    }

    let handle: FileHandle | null = null;
    try {
      handle = await open(tempPath, "w", 0o600);
      await handle.writeFile(body, "utf8");
      // Flush before rename so a crash cannot publish an empty file.
      await handle.sync();
      await handle.close();
      handle = null;

      await restrictPermissions(tempPath);
      await rename(tempPath, this.#filePath);
      await restrictPermissions(this.#filePath);
    } catch (error) {
      if (handle !== null) {
        await handle.close().catch(() => undefined);
      }
      await removeQuietly(tempPath);
      this.#logger.error(`failed to write configuration file: ${this.#filePath}`);
      throw new ConfigError(
        `Could not write configuration file: ${this.#filePath}`,
        this.#filePath,
        { cause: error },
      );
    }
  }
}

/**
 * Best-effort `0600`.
 *
 * On Windows the mode is largely advisory; `docs/phase-2-plan.md` §16 records
 * the limitation rather than pretending it is enforced.
 */
async function restrictPermissions(path: string): Promise<void> {
  try {
    await chmod(path, 0o600);
  } catch {
    // Not supported on every platform; the directory restriction still applies.
  }
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch {
    // Best effort: the temporary file is dot-prefixed and harmless if left.
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

/** True when a path exists and is a regular file. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}
