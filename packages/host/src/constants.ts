/**
 * Host-wide constants.
 *
 * Protocol-level constants (timings, limits, pin caps) live in
 * `@questbridge/protocol`; this module holds only host-owned values.
 */

/**
 * Host version reported in `host.welcome` and `/health`.
 *
 * Must match `version` in `packages/host/package.json`. The private npm
 * packages use independent SemVer; the `0pre.<minor>` policy in
 * `docs/versioning.md` applies to the Minecraft mod artifact only.
 */
export const HOST_VERSION = "0.1.0";

/** Default loopback port, per `docs/phase-2-plan.md` §13.1 and `AGENTS.md` §14. */
export const DEFAULT_PORT = 8765;

/** The only interface the host ever binds. */
export const LOOPBACK_ADDRESS = "127.0.0.1";

/** WebSocket and HTTP path served by the host. */
export const WEBSOCKET_PATH = "/ws";

/** Health endpoint path. */
export const HEALTH_PATH = "/health";

/** Application routes served once a frontend build exists. */
export const BROWSER_ROUTES = ["/overlay", "/control"] as const;

/** Hostnames accepted in the HTTP `Host` header. */
export const LOOPBACK_HOSTNAMES: readonly string[] = [
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1",
];

/** Maximum HTTP request body, in bytes, per `docs/local-authentication.md` §7. */
export const MAX_HTTP_BODY_BYTES = 65_536;
