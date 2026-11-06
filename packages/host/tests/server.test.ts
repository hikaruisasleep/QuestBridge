import { request } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { HEALTH_PATH, HOST_VERSION, LOOPBACK_ADDRESS } from "../src/constants.js";
import { isLoopbackHostHeader, normalizeHostHeader, pathnameOf } from "../src/http.js";
import { createLogger, redactSecrets } from "../src/logging.js";
import { resolveConfigPaths, CONFIG_DIR_ENV } from "../src/paths.js";
import { startHost, type HostHandle } from "../src/server.js";

/**
 * Milestone 2A verification: the process shell.
 *
 * Covers loopback binding, `/health`, graceful shutdown, `Host` validation,
 * config path resolution, and log redaction.
 */

interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function httpGet(
  port: number,
  path: string,
  options: { host?: string; method?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: LOOPBACK_ADDRESS,
        port,
        path,
        method: options.method ?? "GET",
        headers: options.host === undefined ? {} : { host: options.host },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("host process shell", () => {
  let host: HostHandle | null = null;

  afterEach(async () => {
    if (host !== null) {
      await host.close();
      host = null;
    }
  });

  it("reports health on the loopback interface", async () => {
    host = await startHost({ port: 0 });
    expect(host.port).toBeGreaterThan(0);

    const res = await httpGet(host.port, HEALTH_PATH);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");

    const payload = JSON.parse(res.body) as Record<string, unknown>;
    expect(payload["status"]).toBe("ok");
    expect(payload["version"]).toBe(HOST_VERSION);
    expect(typeof payload["uptimeMs"]).toBe("number");
  });

  it("binds 127.0.0.1 and never 0.0.0.0", async () => {
    host = await startHost({ port: 0 });
    const address = host.server.address();
    expect(address).not.toBeNull();
    expect(typeof address).not.toBe("string");
    if (address !== null && typeof address !== "string") {
      expect(address.address).toBe(LOOPBACK_ADDRESS);
      expect(address.family).toBe("IPv4");
    }
  });

  it("answers HEAD without a body and rejects unsupported methods", async () => {
    host = await startHost({ port: 0 });

    const head = await httpGet(host.port, HEALTH_PATH, { method: "HEAD" });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");

    const post = await httpGet(host.port, HEALTH_PATH, { method: "POST" });
    expect(post.statusCode).toBe(405);
    expect(post.headers["allow"]).toBe("GET, HEAD");
  });

  it("returns 404 for unknown paths", async () => {
    host = await startHost({ port: 0 });
    const res = await httpGet(host.port, "/nonexistent");
    expect(res.statusCode).toBe(404);
  });

  it("rejects a non-loopback Host header", async () => {
    host = await startHost({ port: 0 });
    const res = await httpGet(host.port, HEALTH_PATH, { host: "evil.example.com" });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "forbidden" });
  });

  it("accepts loopback Host headers with any port", async () => {
    host = await startHost({ port: 0 });

    for (const value of [
      `127.0.0.1:${host.port}`,
      `localhost:${host.port}`,
      "127.0.0.1",
      "localhost",
      "[::1]:8765",
    ]) {
      const res = await httpGet(host.port, HEALTH_PATH, { host: value });
      expect(res.statusCode, `Host: ${value}`).toBe(200);
    }
  });

  it("shuts down cleanly and is idempotent", async () => {
    const local = await startHost({ port: 0 });
    const port = local.port;

    await local.close();
    // A second close must resolve rather than reject.
    await local.close();

    await expect(httpGet(port, HEALTH_PATH)).rejects.toThrow();
  });

  it("refuses a port already in use", async () => {
    host = await startHost({ port: 0 });
    await expect(startHost({ port: host.port })).rejects.toThrow();
  });

  it("rejects an out-of-range port", async () => {
    await expect(startHost({ port: 70_000 })).rejects.toThrow(/between 0 and 65535/);
    await expect(startHost({ port: 1.5 })).rejects.toThrow(/between 0 and 65535/);
  });
});

describe("HTTP helpers", () => {
  it("normalizes Host headers, including IPv6", () => {
    expect(normalizeHostHeader("127.0.0.1:8765")).toBe("127.0.0.1");
    expect(normalizeHostHeader("LOCALHOST")).toBe("localhost");
    expect(normalizeHostHeader("[::1]:8765")).toBe("[::1]");
    expect(normalizeHostHeader("::1")).toBe("::1");
    expect(normalizeHostHeader("  localhost:80  ")).toBe("localhost");
    expect(normalizeHostHeader("")).toBeNull();
    expect(normalizeHostHeader("[::1")).toBeNull();
  });

  it("accepts only loopback Host headers", () => {
    expect(isLoopbackHostHeader("127.0.0.1:1")).toBe(true);
    expect(isLoopbackHostHeader("localhost")).toBe(true);
    expect(isLoopbackHostHeader("[::1]:8765")).toBe(true);
    expect(isLoopbackHostHeader("example.com")).toBe(false);
    expect(isLoopbackHostHeader("127.0.0.1.evil.com")).toBe(false);
    expect(isLoopbackHostHeader(undefined)).toBe(false);
  });

  it("strips the query string and trailing slashes", () => {
    expect(pathnameOf("/health?token=abc")).toBe("/health");
    expect(pathnameOf("/overlay/")).toBe("/overlay");
    expect(pathnameOf("/")).toBe("/");
    expect(pathnameOf("")).toBe("/");
    expect(pathnameOf("/a/b?x=1&y=2")).toBe("/a/b");
  });
});

describe("logging redaction", () => {
  it("redacts token query parameters and bearer credentials", () => {
    expect(redactSecrets("http://127.0.0.1:8765/overlay?token=SECRET123")).toBe(
      "http://127.0.0.1:8765/overlay?token=<redacted>",
    );
    expect(redactSecrets("ws://x/ws?token=a.b-c_d&other=1")).toBe(
      "ws://x/ws?token=<redacted>&other=1",
    );
    expect(redactSecrets("Authorization: Bearer abcDEF123")).toBe(
      "Authorization: Bearer <redacted>",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("host started on port 8765")).toBe("host started on port 8765");
  });

  it("redacts through the logger", () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line) });

    logger.info("access http://127.0.0.1:8765/control?token=LEAKME");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("LEAKME");
    expect(lines[0]).toContain("<redacted>");
  });

  it("honours the minimum level", () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line), minLevel: "error" });

    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("error");
  });
});

describe("config path resolution", () => {
  /**
   * `node:path` joins with the running platform's separator, so these
   * assertions normalize to `/` and check the chosen components rather than
   * the separator style. At runtime `resolveConfigPaths` is called with the
   * real platform, so the separator is correct by construction.
   */
  const posix = (value: string): string => value.replace(/\\/g, "/");

  it("prefers the environment override", () => {
    const paths = resolveConfigPaths({
      platform: "linux",
      env: { [CONFIG_DIR_ENV]: "/tmp/qb-test" },
      home: "/home/tester",
    });

    expect(paths.source).toBe("env");
    expect(paths.configFile).toContain("config.json");
    expect(paths.tokensFile).toContain("tokens.json");
  });

  it("resolves per platform", () => {
    const win = resolveConfigPaths({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\t\\AppData\\Roaming" },
      home: "C:\\Users\\t",
    });
    expect(win.source).toBe("windows-appdata");
    expect(win.directory).toContain("QuestBridge");

    const mac = resolveConfigPaths({
      platform: "darwin",
      env: {},
      home: "/Users/tester",
    });
    expect(mac.source).toBe("macos-application-support");
    expect(posix(mac.directory)).toBe("/Users/tester/Library/Application Support/QuestBridge");

    const xdg = resolveConfigPaths({
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/xdg" },
      home: "/home/tester",
    });
    expect(xdg.source).toBe("xdg");
    expect(posix(xdg.directory)).toBe("/xdg/questbridge");

    const home = resolveConfigPaths({ platform: "linux", env: {}, home: "/home/tester" });
    expect(home.source).toBe("home-config");
    expect(posix(home.directory)).toBe("/home/tester/.config/questbridge");
  });

  it("falls back to a home path when APPDATA is unset on Windows", () => {
    const paths = resolveConfigPaths({
      platform: "win32",
      env: {},
      home: "C:\\Users\\tester",
    });
    expect(paths.source).toBe("windows-appdata");
    expect(paths.directory).toContain("QuestBridge");
  });

  it("ignores a blank override", () => {
    const paths = resolveConfigPaths({
      platform: "linux",
      env: { [CONFIG_DIR_ENV]: "   " },
      home: "/home/tester",
    });
    expect(paths.source).toBe("home-config");
  });
});
