import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";

import { BROWSER_ROUTES } from "./constants.js";
import type { Logger } from "./logging.js";

/**
 * Static frontend serving.
 *
 * Phase 3 replaces this with a real SvelteKit static build. Until then the host
 * must not invent a second web server, and must not pretend to serve an app it
 * does not have, so a missing build produces an explicit placeholder.
 *
 * Two rules from `docs/local-authentication.md` §3 govern this module:
 *
 * - **Page requests are not authenticated.** The shell is static and carries no
 *   state or credentials, so serving it to an unauthenticated loopback request
 *   discloses nothing. Data only ever travels over the WebSocket, which *is*
 *   authenticated. Learning this lets the real UI render a legible "not
 *   authorized" message instead of a bare `401` body.
 * - **The placeholder must contain no tokens and no fake progression.**
 */

export interface StaticServerOptions {
  /** Directory containing the built frontend, if any. */
  buildDir: string | undefined;
  logger: Logger;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function contentTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * `Cache-Control` for a served file, chosen from its build-relative path.
 *
 * A single blanket value would be wrong in one direction or the other, so the
 * three cases are separated deliberately:
 *
 * - **Content-hashed assets** (`_app/immutable/…`, SvelteKit's convention) can
 *   never change under the same name, so they are cached for a year. Serving
 *   them `no-store` would re-download the whole bundle on every OBS refresh.
 * - **HTML entry points** are the opposite: they name the current asset hashes,
 *   so a stale copy can reference files a newer build no longer ships. They are
 *   never stored. This is also the only file class a browser might otherwise
 *   cache heuristically, which is what could leave a user looking at a shell
 *   that the running host no longer serves.
 * - **Everything else** (favicons, `robots.txt`, arbitrary assets) revalidates.
 */
export function cacheControlFor(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (normalized.startsWith("_app/immutable/")) {
    return "public, max-age=31536000, immutable";
  }
  if (normalized.endsWith(".html")) {
    return "no-store";
  }
  return "no-cache";
}

/**
 * Resolve a request path to an absolute path inside `root`.
 *
 * Returns `null` when the path would leave the root, which is what keeps this
 * from becoming an arbitrary filesystem read.
 *
 * The implementation treats the request as **always relative** to the root:
 * leading slashes and backslashes are stripped before resolving, so an absolute
 * request path cannot replace the root outright (`resolve(root, "/etc/passwd")`
 * would otherwise return `/etc/passwd` on POSIX). Containment is then verified
 * with a prefix check that also requires a separator, so a sibling directory
 * sharing a name prefix cannot be reached.
 */
export function resolveWithinRoot(root: string, requestPath: string): string | null {
  const absoluteRoot = resolve(root);

  const withoutQuery = requestPath.split("?")[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) {
    return null;
  }

  // Force a relative interpretation regardless of platform separators.
  const relative = decoded.replace(/^[/\\]+/, "");
  const candidate = resolve(absoluteRoot, relative);

  if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot + sep)) {
    return null;
  }

  return candidate;
}

/** True when `path` is a readable regular file. */
async function isFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * The placeholder served when no frontend build is present.
 *
 * Deliberately minimal and honest: it states that the UI is not built and names
 * the command that produces the access URLs. It contains no tokens, no
 * progression, and no suggestion that data is available.
 */
export function placeholderHtml(route: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>QuestBridge host</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 2rem; background: #12141a; color: #d7dae0;
    font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  main { max-width: 40rem; margin: 0 auto; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; color: #fff; }
  p { margin: 0 0 1rem; }
  code { background: #1d2028; padding: .15rem .4rem; border-radius: 3px; color: #9ad; }
  .muted { color: #8b9099; }
</style>
</head>
<body>
<main>
  <h1>QuestBridge host is running</h1>
  <p>The frontend is not built yet, so <code>${route}</code> has no application to serve.</p>
  <p class="muted">The host itself is working: it is listening on loopback, owns the chapter pin
  configuration, and accepts an authenticated Minecraft publisher on <code>/ws</code>.</p>
  <p class="muted">Run <code>questbridge-host --print-urls</code> for the overlay and dashboard
  addresses once a frontend build exists.</p>
</main>
</body>
</html>
`;
}

export interface StaticResult {
  served: boolean;
}

function sendPlaceholder(route: string, res: ServerResponse, headOnly: boolean): StaticResult {
  const body = placeholderHtml(route);
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(headOnly ? undefined : body);
  return { served: true };
}

async function sendFile(
  path: string,
  relativePath: string,
  res: ServerResponse,
  headOnly: boolean,
): Promise<StaticResult> {
  const info = await stat(path);
  res.writeHead(200, {
    "content-type": contentTypeFor(path),
    "content-length": info.size,
    "cache-control": cacheControlFor(relativePath),
    // A tokenized URL is a credential; never let it travel as a referrer.
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });

  if (headOnly) {
    res.end();
    return { served: true };
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise());
    stream.pipe(res);
  });

  return { served: true };
}

/**
 * Attempt to serve a browser route or asset from `buildDir`.
 *
 * @returns `served: false` when nothing matched, leaving the caller to answer
 *   with 404. Only the two browser routes fall back to the placeholder; an
 *   unknown path is still a 404.
 */
export async function serveStatic(
  options: StaticServerOptions,
  requestPath: string,
  res: ServerResponse,
  headOnly: boolean,
): Promise<StaticResult> {
  const { buildDir, logger } = options;

  const isRoute = (BROWSER_ROUTES as readonly string[]).includes(requestPath);

  if (buildDir === undefined) {
    // Without a build there is nothing to serve. Only the browser routes have
    // an explanation to give.
    return isRoute ? sendPlaceholder(requestPath, res, headOnly) : { served: false };
  }

  // Candidate relative paths, tried in order.
  //
  // A route accepts both SvelteKit prerender layouts, because the filename it
  // emits depends on the route's `trailingSlash` setting, which is a frontend
  // concern the host must not have to know: `trailingSlash: 'always'` produces
  // `overlay/index.html`, while the default `'never'` produces `overlay.html`.
  // Trying both keeps the host independent of that choice.
  const routeName = requestPath.slice(1);
  const candidates: string[] = isRoute
    ? [`${routeName}/index.html`, `${routeName}.html`, "index.html"]
    : [requestPath];

  for (const relative of candidates) {
    const candidate = resolveWithinRoot(buildDir, relative);
    if (candidate === null) {
      continue;
    }
    if (await isFile(candidate)) {
      return sendFile(candidate, relative, res, headOnly);
    }
  }

  // A route without a build output still explains itself; an ordinary missing
  // asset is left to the caller.
  if (isRoute) {
    logger.warn(`no frontend build found for ${requestPath}; serving the placeholder`);
    return sendPlaceholder(requestPath, res, headOnly);
  }

  return { served: false };
}
