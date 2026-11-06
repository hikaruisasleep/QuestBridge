import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Platform configuration directory resolution.
 *
 * Resolution order, per `docs/phase-2-plan.md` §5.3:
 *
 * 1. `QUESTBRIDGE_CONFIG_DIR` — used by tests and development.
 * 2. Windows: `%APPDATA%\QuestBridge`.
 * 3. macOS: `~/Library/Application Support/QuestBridge`.
 * 4. Linux: `$XDG_CONFIG_HOME/questbridge`, else `~/.config/questbridge`.
 *
 * This module is pure: it computes paths and never touches the filesystem.
 */

export interface ConfigPathDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Injectable for deterministic tests on any platform. */
  home?: string;
}

export interface ConfigPaths {
  /** Directory holding `config.json` and `tokens.json`. */
  directory: string;
  configFile: string;
  tokensFile: string;
  /** Which resolution rule produced the directory. */
  source: "env" | "windows-appdata" | "macos-application-support" | "xdg" | "home-config";
}

/** Environment variable that overrides every platform default. */
export const CONFIG_DIR_ENV = "QUESTBRIDGE_CONFIG_DIR";

export function resolveConfigPaths(deps: ConfigPathDeps = {}): ConfigPaths {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();

  const fromEnv = env[CONFIG_DIR_ENV];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return buildPaths(fromEnv.trim(), "env");
  }

  if (platform === "win32") {
    const appData = env["APPDATA"];
    if (appData !== undefined && appData.trim().length > 0) {
      return buildPaths(join(appData.trim(), "QuestBridge"), "windows-appdata");
    }
    // Fall back to the home-relative location when APPDATA is unset.
    return buildPaths(join(home, "AppData", "Roaming", "QuestBridge"), "windows-appdata");
  }

  if (platform === "darwin") {
    return buildPaths(
      join(home, "Library", "Application Support", "QuestBridge"),
      "macos-application-support",
    );
  }

  const xdg = env["XDG_CONFIG_HOME"];
  if (xdg !== undefined && xdg.trim().length > 0) {
    return buildPaths(join(xdg.trim(), "questbridge"), "xdg");
  }

  return buildPaths(join(home, ".config", "questbridge"), "home-config");
}

function buildPaths(directory: string, source: ConfigPaths["source"]): ConfigPaths {
  return {
    directory,
    configFile: join(directory, "config.json"),
    tokensFile: join(directory, "tokens.json"),
    source,
  };
}
