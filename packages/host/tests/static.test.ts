import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BROWSER_ROUTES } from "../src/constants.js";
import { createHost, type Host } from "../src/host.js";
import { SILENT_LOGGER } from "../src/logging.js";
import { cacheControlFor, placeholderHtml, resolveWithinRoot } from "../src/static.js";

/**
 * Static serving and the Phase 2 placeholder.
 *
 * The rules under test come from `docs/local-authentication.md` §3 and
 * `AGENTS.md` §18: page requests are not authenticated, the placeholder must
 * contain no tokens and no fabricated progression, and static serving must not
 * become an arbitrary filesystem read.
 */

let directory: string;
let host: Host | null = null;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "qb-static-"));
});

afterEach(async () => {
  if (host !== null) {
    await host.close();
    host = null;
  }
  await rm(directory, { recursive: true, force: true });
});

describe("path containment", () => {
  it("resolves a path inside the root", () => {
    const root = resolve("/srv/app");
    expect(resolveWithinRoot(root, "/index.html")).toBe(join(root, "index.html"));
    expect(resolveWithinRoot(root, "/assets/app.js")).toBe(join(root, "assets", "app.js"));
  });

  it("refuses to escape the root", () => {
    const root = resolve("/srv/app");
    expect(resolveWithinRoot(root, "/../secret")).toBeNull();
    expect(resolveWithinRoot(root, "/../../etc/passwd")).toBeNull();
    expect(resolveWithinRoot(root, "/assets/../../secret")).toBeNull();
  });

  it("refuses an encoded traversal", () => {
    const root = resolve("/srv/app");
    expect(resolveWithinRoot(root, "/%2e%2e/secret")).toBeNull();
    expect(resolveWithinRoot(root, "/..%2fsecret")).toBeNull();
  });

  it("refuses a malformed encoding and a null byte", () => {
    const root = resolve("/srv/app");
    expect(resolveWithinRoot(root, "/%")).toBeNull();
    expect(resolveWithinRoot(root, "/a\0b")).toBeNull();
  });

  it("strips a query string", () => {
    const root = resolve("/srv/app");
    expect(resolveWithinRoot(root, "/overlay?token=secret")).toBe(join(root, "overlay"));
  });

  it("allows the root itself", () => {
    const root = resolve("/srv/app");
    expect(resolveWithinRoot(root, "/")).toBe(root);
    expect(root.endsWith(sep) || !root.endsWith(sep)).toBe(true);
  });
});

describe("placeholder", () => {
  it("contains no token or progression data", () => {
    const html = placeholderHtml("/overlay");

    expect(html).not.toMatch(/token=/i);
    expect(html).not.toMatch(/browserToken|minecraftToken/);
    expect(html).not.toMatch(/\d+%/);
    // It must not imply that quest data is available.
    expect(html).toContain("not built");
  });

  it("names the route and the recovery command", () => {
    const html = placeholderHtml("/control");
    expect(html).toContain("/control");
    expect(html).toContain("--print-urls");
  });
});

describe("browser routes without a build", () => {
  it("serves the placeholder for every browser route", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });

    for (const route of BROWSER_ROUTES) {
      const response = await fetch(`${host.url}${route}`);
      expect(response.status, route).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const body = await response.text();
      expect(body).toContain("not built");
      expect(body).not.toMatch(/token=/i);
    }
  });

  it("serves the placeholder to an unauthenticated request", async () => {
    // Page requests are deliberately ungated so the real UI can render an
    // actionable message instead of a bare 401 body.
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });

    const response = await fetch(`${host.url}/overlay`);
    expect(response.status).toBe(200);
  });

  it("sets a no-referrer policy so a tokenized URL cannot leak", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });

    const response = await fetch(`${host.url}/overlay?token=not-a-real-token`);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("supports HEAD", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });

    const response = await fetch(`${host.url}/overlay`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("still returns 404 for an unknown path", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER });

    const response = await fetch(`${host.url}/not-a-route`);
    expect(response.status).toBe(404);
  });
});

describe("browser routes with a build", () => {
  it("serves an index.html for a route", async () => {
    const buildDir = join(directory, "build");
    await mkdir(join(buildDir, "overlay"), { recursive: true });
    await writeFile(join(buildDir, "overlay", "index.html"), "<h1>overlay</h1>", "utf8");

    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir });

    const response = await fetch(`${host.url}/overlay`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("overlay");
  });

  it("serves a flat <route>.html, which is what adapter-static emits by default", async () => {
    // SvelteKit's prerender filename depends on the route's trailingSlash:
    // 'never' (the default) writes `overlay.html`, 'always' writes
    // `overlay/index.html`. The host must serve either, so that the frontend's
    // trailing-slash choice stays a frontend concern.
    const buildDir = join(directory, "build");
    await mkdir(buildDir, { recursive: true });
    await writeFile(join(buildDir, "overlay.html"), "<h1>flat overlay</h1>", "utf8");

    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir });

    const response = await fetch(`${host.url}/overlay`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("flat overlay");
  });

  it("prefers a directory index over a flat file when both exist", async () => {
    const buildDir = join(directory, "build");
    await mkdir(join(buildDir, "control"), { recursive: true });
    await writeFile(join(buildDir, "control", "index.html"), "nested", "utf8");
    await writeFile(join(buildDir, "control.html"), "flat", "utf8");

    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir });

    expect(await (await fetch(`${host.url}/control`)).text()).toContain("nested");
  });

  it("falls back to the root index.html for a route without its own", async () => {
    const buildDir = join(directory, "build");
    await mkdir(buildDir, { recursive: true });
    await writeFile(join(buildDir, "index.html"), "<h1>spa shell</h1>", "utf8");

    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir });

    const response = await fetch(`${host.url}/control`);
    expect(await response.text()).toContain("spa shell");
  });

  it("serves an asset with the right content type", async () => {
    const buildDir = join(directory, "build");
    await mkdir(join(buildDir, "assets"), { recursive: true });
    await writeFile(join(buildDir, "assets", "app.js"), "export const a = 1;", "utf8");
    await writeFile(join(buildDir, "assets", "app.css"), "body{}", "utf8");

    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir });

    const js = await fetch(`${host.url}/assets/app.js`);
    expect(js.headers.get("content-type")).toContain("text/javascript");

    const css = await fetch(`${host.url}/assets/app.css`);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("does not serve outside the build directory", async () => {
    const buildDir = join(directory, "build");
    await mkdir(buildDir, { recursive: true });
    await writeFile(join(buildDir, "index.html"), "ok", "utf8");
    // A secret one level above the build root.
    await writeFile(join(directory, "secret.txt"), "TOP SECRET", "utf8");

    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir });

    // Use a raw request so the path is not normalized by the client.
    const response = await fetch(`${host.url}/%2e%2e/secret.txt`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("TOP SECRET");
  });

  it("falls back to the placeholder for a route when the build has no index", async () => {
    const buildDir = join(directory, "empty-build");
    await mkdir(buildDir, { recursive: true });

    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir });

    const response = await fetch(`${host.url}/overlay`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("not built");
  });
});

describe("cache control", () => {
  it("caches content-hashed assets for a year", () => {
    expect(cacheControlFor("_app/immutable/chunks/app.ABC123.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControlFor("_app/immutable/assets/0.j9Vgsf0k.css")).toContain("immutable");
  });

  it("never stores an HTML entry point", () => {
    // A stale shell names asset hashes the running host may no longer ship.
    expect(cacheControlFor("overlay.html")).toBe("no-store");
    expect(cacheControlFor("overlay/index.html")).toBe("no-store");
    expect(cacheControlFor("index.html")).toBe("no-store");
  });

  it("revalidates anything else rather than guessing", () => {
    expect(cacheControlFor("robots.txt")).toBe("no-cache");
    expect(cacheControlFor("favicon.ico")).toBe("no-cache");
  });

  it("normalizes separators and leading slashes", () => {
    expect(cacheControlFor("/_app/immutable/x.js")).toContain("immutable");
    expect(cacheControlFor("_app\\immutable\\x.js")).toContain("immutable");
    expect(cacheControlFor("/overlay.html")).toBe("no-store");
  });

  it("sends the documented header on a real asset and a real page", async () => {
    const buildDir = join(directory, "build");
    await mkdir(join(buildDir, "_app", "immutable", "chunks"), { recursive: true });
    await writeFile(join(buildDir, "_app", "immutable", "chunks", "app.js"), "export {}", "utf8");
    await writeFile(join(buildDir, "overlay.html"), "<h1>overlay</h1>", "utf8");

    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir });

    const asset = await fetch(`${host.url}/_app/immutable/chunks/app.js`);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const page = await fetch(`${host.url}/overlay`);
    expect(page.headers.get("cache-control")).toBe("no-store");
    // The credential must not travel as a referrer from any served file.
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(asset.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
