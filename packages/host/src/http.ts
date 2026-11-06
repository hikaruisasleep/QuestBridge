import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

import { HEALTH_PATH, LOOPBACK_HOSTNAMES } from "./constants.js";
import type { Logger } from "./logging.js";
import { serveStatic } from "./static.js";
import { checkHttpBodySize } from "./validation.js";

/**
 * Plain HTTP request handling.
 *
 * Every request is subject to `Host` header validation against loopback names;
 * that check is what defeats DNS rebinding (`docs/local-authentication.md` §5)
 * and it belongs on the listener rather than on any individual route.
 *
 * Only `/health` and the browser routes are handled here. Page requests are
 * deliberately **not** authenticated: the shell is static and carries no state,
 * and gating it would replace a legible in-app message with a bare `401` body.
 * All real authorization happens on the WebSocket upgrade.
 */

export interface HttpHandlerDeps {
  version: string;
  /** Process start time in epoch milliseconds, used for uptime reporting. */
  startedAtMs: number;
  logger: Logger;
  /** Built frontend directory, if one exists. */
  buildDir?: string;
}

export interface HealthPayload {
  status: "ok";
  version: string;
  uptimeMs: number;
}

/**
 * Reduce a `Host` header to its hostname, dropping any port.
 *
 * Handles the bracketed IPv6 form used in `Host` headers (`[::1]:8765`) and the
 * bare IPv6 form (`::1`, whose colons are not a port separator). Returns `null`
 * when the value cannot be interpreted.
 */
export function normalizeHostHeader(host: string): string | null {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) {
      return null;
    }
    return trimmed.slice(0, end + 1);
  }

  const firstColon = trimmed.indexOf(":");
  if (firstColon === -1) {
    return trimmed;
  }

  // More than one colon means a bare IPv6 address, not `host:port`.
  if (trimmed.indexOf(":", firstColon + 1) !== -1) {
    return trimmed;
  }

  return trimmed.slice(0, firstColon);
}

export function isLoopbackHostHeader(host: string | undefined): boolean {
  if (host === undefined) {
    return false;
  }
  const hostname = normalizeHostHeader(host);
  return hostname !== null && LOOPBACK_HOSTNAMES.includes(hostname);
}

/** Strip the query string and any trailing slash (except for the root path). */
export function pathnameOf(url: string): string {
  const queryIndex = url.indexOf("?");
  const raw = queryIndex === -1 ? url : url.slice(0, queryIndex);
  if (raw.length > 1 && raw.endsWith("/")) {
    return raw.slice(0, -1);
  }
  return raw.length === 0 ? "/" : raw;
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  headOnly: boolean,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    // The host serves loopback only; do not invite indexing or framing.
    "x-content-type-options": "nosniff",
  });
  res.end(headOnly ? undefined : body);
}

export function createHttpHandler(deps: HttpHandlerDeps): RequestListener {
  const { version, startedAtMs, logger, buildDir } = deps;

  return (req: IncomingMessage, res: ServerResponse): void => {
    const method = req.method ?? "GET";
    const headOnly = method === "HEAD";

    if (!isLoopbackHostHeader(req.headers.host)) {
      logger.warn(
        `rejected request with disallowed Host header: ${req.headers.host ?? "(none)"}`,
      );
      sendJson(res, 403, { error: "forbidden" }, headOnly);
      return;
    }

    const path = pathnameOf(req.url ?? "/");

    // Body handling is a transport concern, so it is decided before routing:
    // no Phase 2 route accepts a request body, and an oversized one must be
    // refused as too large rather than reported as a routing or method error.
    const contentLength = req.headers["content-length"];
    const declaredLength = typeof contentLength === "string" ? contentLength : undefined;
    const hasBody =
      (declaredLength !== undefined && declaredLength !== "0") ||
      req.headers["transfer-encoding"] !== undefined;

    if (hasBody) {
      const verdict = checkHttpBodySize(declaredLength);
      if (!verdict.ok) {
        logger.warn(`rejected request body: ${verdict.message}`);
        sendJson(res, 413, { error: "payload_too_large" }, headOnly);
        return;
      }
      sendJson(res, 405, { error: "method_not_allowed" }, headOnly);
      return;
    }

    if (path === HEALTH_PATH) {
      if (method !== "GET" && !headOnly) {
        res.writeHead(405, { allow: "GET, HEAD", "content-length": 0 });
        res.end();
        return;
      }

      const payload: HealthPayload = {
        status: "ok",
        version,
        uptimeMs: Math.max(0, Date.now() - startedAtMs),
      };
      sendJson(res, 200, payload, headOnly);
      return;
    }

    if (method !== "GET" && !headOnly) {
      res.writeHead(405, { allow: "GET, HEAD", "content-length": 0 });
      res.end();
      return;
    }

    void serveStatic({ buildDir, logger }, path, res, headOnly)
      .then((result) => {
        if (!result.served) {
          sendJson(res, 404, { error: "not_found" }, headOnly);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`static serving failed for ${path}: ${message}`);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "internal_error" }, headOnly);
        } else {
          res.end();
        }
      });
  };
}
