import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMessage, type ProtocolMessage } from "@questbridge/protocol";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHost, type Host } from "../src/host.js";
import { SILENT_LOGGER } from "../src/logging.js";

/**
 * The real frontend build, served by the real host.
 *
 * `docs/phase-3-plan.md` §7 asks for this to live in the host suite rather than
 * only in manual steps, because it is the test that would have caught the
 * `adapter-node` mismatch: the host is a plain static file server, and a build
 * that emits no `.html` file serves nothing.
 *
 * The build is produced by `npm run build -w web-app`. When it is absent these
 * tests skip rather than fail, so a host-only checkout stays green; the
 * workspace `npm test` runs the web-app build first in practice, and the skip is
 * visible in the report rather than silent.
 */

// `import.meta.dirname` is `packages/host/tests`, so three levels up reach the
// repository root that hosts `apps/web-app/build`.
const BUILD_DIR = join(import.meta.dirname, "..", "..", "..", "apps", "web-app", "build");
const hasBuild = existsSync(join(BUILD_DIR, "overlay.html"));

let directory: string;
let host: Host | null = null;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "qb-e2e-"));
});

afterEach(async () => {
  if (host !== null) {
    await host.close();
    host = null;
  }
  await rm(directory, { recursive: true, force: true });
});

describe.skipIf(!hasBuild)("served frontend build", () => {
  it("emits real HTML files for every route", async () => {
    // The specific property adapter-node fails: it generates HTML per request
    // and writes none to disk.
    for (const file of ["index.html", "overlay.html", "control.html"]) {
      expect(existsSync(join(BUILD_DIR, file)), file).toBe(true);
    }
  });

  it("serves the landing page at the root", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir: BUILD_DIR });

    const response = await fetch(`${host.url}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const html = await response.text();
    // The landing page names both routes; the token is added client-side.
    expect(html).toContain("QuestBridge");
    expect(html).toContain("_app/immutable");
  });

  it("serves the overlay page, not the root page, at /overlay", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir: BUILD_DIR });

    const response = await fetch(`${host.url}/overlay`);
    expect(response.status).toBe(200);
    const served = await response.text();
    const onDisk = await readFile(join(BUILD_DIR, "overlay.html"), "utf8");
    expect(served).toBe(onDisk);

    // A 200 alone is not enough: the root page would also answer 200 through the
    // route fallback, so the content has to be the overlay's own.
    const landing = await readFile(join(BUILD_DIR, "index.html"), "utf8");
    expect(served).not.toBe(landing);
  });

  it("serves the control page at /control", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir: BUILD_DIR });

    const response = await fetch(`${host.url}/control`);
    expect(response.status).toBe(200);
    const served = await response.text();
    expect(served).toBe(await readFile(join(BUILD_DIR, "control.html"), "utf8"));
  });

  it("serves the content-hashed assets the pages reference", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir: BUILD_DIR });

    const html = await (await fetch(`${host.url}/overlay`)).text();
    const assets = [...html.matchAll(/href="\.?\/?(_app\/[^"]+)"/g)].map((match) => match[1]!);
    expect(assets.length).toBeGreaterThan(0);

    for (const asset of assets) {
      const response = await fetch(`${host.url}/${asset}`);
      expect(response.status, asset).toBe(200);
      // Content-hashed files are immutable; that is what keeps an OBS refresh
      // from re-downloading the bundle.
      expect(response.headers.get("cache-control"), asset).toContain("immutable");
    }
  });

  it("still answers unknown paths with 404", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir: BUILD_DIR });

    for (const path of ["/overvie", "/nope", "/overlay/extra", "/controlx"]) {
      expect((await fetch(`${host.url}${path}`)).status, path).toBe(404);
    }
  });

  it("never exposes a token in the served HTML", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir: BUILD_DIR });

    const tokens = host.tokenStore.tokens;
    for (const path of ["/", "/overlay", "/control"]) {
      const html = await (await fetch(`${host.url}${path}`)).text();
      expect(html, path).not.toContain(tokens.browserToken);
      expect(html, path).not.toContain(tokens.minecraftToken);
    }
  });

  it("delivers a real state snapshot to a browser connecting to the served app", async () => {
    host = await createHost({ configDir: directory, logger: SILENT_LOGGER, buildDir: BUILD_DIR });
    const { browserToken, minecraftToken } = host.tokenStore.tokens;

    const publisher = new WebSocket(`${host.url.replace("http", "ws")}/ws`, {
      headers: { authorization: `Bearer ${minecraftToken}` },
      origin: "http://127.0.0.1",
    });
    await new Promise((resolve) => publisher.once("open", resolve));

    let sequence = 0;
    const send = (message: ProtocolMessage): void => {
      publisher.send(JSON.stringify(message));
    };
    send(
      createMessage(
        "minecraft.hello",
        {
          modVersion: "e2e",
          minecraftVersion: "1.21.1",
          neoForgeVersion: "21.1.250",
          ftbQuestsVersion: "2101.1.30",
          ftbTeamsVersion: "2101.1.10",
        },
        { sequence: ++sequence, sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      ),
    );
    // Wait for host.welcome before publishing.
    await new Promise((resolve) => publisher.once("message", resolve));

    const browser = new WebSocket(`${host.url.replace("http", "ws")}/ws?token=${browserToken}`, {
      origin: `${host.url}`,
    });
    await new Promise((resolve) => browser.once("open", resolve));

    const snapshot = new Promise<string>((resolve) => {
      browser.on("message", (data: Buffer) => {
        const message = JSON.parse(data.toString()) as ProtocolMessage;
        if (message.type === "state.snapshot") {
          resolve(JSON.stringify(message.payload));
        }
      });
    });

    browser.send(
      JSON.stringify(
        createMessage("browser.hello", { role: "control", clientName: "e2e test" }),
      ),
    );

    const payload = await snapshot;
    // The snapshot reached the browser over the real socket with no Minecraft
    // snapshot yet: empty catalog, empty pins, defaults intact.
    expect(payload).toContain('"chapters":[]');
    expect(payload).toContain('"lastSnapshotAt":null');

    publisher.close();
    browser.close();
  });
});
