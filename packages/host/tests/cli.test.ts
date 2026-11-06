import { describe, expect, it } from "vitest";

import { DEFAULT_PORT } from "../src/constants.js";
import { parseCliOptions } from "../src/index.js";

/**
 * CLI argument parsing for milestone 2A.
 *
 * `parseCliOptions` returns a discriminated result rather than calling
 * `process.exit`, so `--help` is testable in-process.
 */

describe("CLI parsing", () => {
  it("defaults the port and config directory", () => {
    const parsed = parseCliOptions([]);
    expect(parsed.kind).toBe("run");
    if (parsed.kind === "run") {
      expect(parsed.options.port).toBe(DEFAULT_PORT);
      expect(parsed.options.configDir).toBeUndefined();
    }
  });

  it("accepts an explicit port, including the ephemeral port 0", () => {
    const parsed = parseCliOptions(["--port", "9000"]);
    expect(parsed.kind === "run" && parsed.options.port).toBe(9000);

    const ephemeral = parseCliOptions(["--port", "0"]);
    expect(ephemeral.kind === "run" && ephemeral.options.port).toBe(0);
  });

  it("accepts a config directory", () => {
    const parsed = parseCliOptions(["--config-dir", "/tmp/qb"]);
    expect(parsed.kind === "run" && parsed.options.configDir).toBe("/tmp/qb");
  });

  it("returns help text instead of exiting", () => {
    const parsed = parseCliOptions(["--help"]);
    expect(parsed.kind).toBe("help");
    if (parsed.kind === "help") {
      expect(parsed.text).toContain("questbridge-host");
      expect(parsed.text).toContain("127.0.0.1");
    }
  });

  it("rejects invalid ports", () => {
    expect(() => parseCliOptions(["--port", "abc"])).toThrow(/--port/);
    expect(() => parseCliOptions(["--port", "-1"])).toThrow(/--port/);
    expect(() => parseCliOptions(["--port", "70000"])).toThrow(/--port/);
    expect(() => parseCliOptions(["--port", "1.5"])).toThrow(/--port/);
  });

  it("rejects unknown arguments", () => {
    expect(() => parseCliOptions(["--nope"])).toThrow();
    expect(() => parseCliOptions(["positional"])).toThrow();
  });
});
