/**
 * WebSocket endpoint resolution.
 *
 * The page is normally served by the QuestBridge host itself, so the socket
 * address is simply the page's own origin. Two things break that simplicity and
 * are handled explicitly here rather than implicitly:
 *
 * 1. **The development server.** Under `vite dev` the page is served by Vite on
 *    its own port, and that server has no `/ws` endpoint. The host accepts a
 *    loopback origin on any port (accepted risk R2, `docs/local-authentication.md`
 *    §5), so a dev page *can* connect — but only if it knows the host's address.
 *    `resolveEndpoint` therefore accepts an explicit override.
 * 2. **Tests.** Calling `new URL()` against a real `location` is untestable in
 *    the subset of Node that has no DOM. The resolution logic is a pure
 *    function of an injected `location`-like object so it can be exercised
 *    directly.
 *
 * Token handling is deliberately separated from URL building. The token is a
 * credential (`docs/local-authentication.md` §2): it is read once from the page
 * URL and appended to the socket URL, and it must never be rendered, logged, or
 * placed in a link the user is expected to copy.
 */

/** The subset of `Location` this module needs. */
export interface LocationLike {
  protocol: string;
  host: string;
  search: string;
}

export interface EndpointOptions {
  /**
   * Explicit WebSocket base, e.g. `ws://127.0.0.1:8765/ws`.
   *
   * Used by the development server, where the page origin is not the host.
   * Malformed values are rejected rather than silently falling back, because a
   * silent fallback would present a broken dev server as a working one.
   */
  override?: string | null;
  /** The host's WebSocket path. Defaults to `/ws`. */
  path?: string;
}

export interface ResolvedEndpoint {
  /** Full WebSocket URL including the token query parameter. */
  url: string;
  /** True when the token was present. This is *not* proof of authorization. */
  hasToken: boolean;
}

const DEFAULT_WS_PATH = "/ws";

/**
 * Read `token` from a query string.
 *
 * Returns `null` when absent or empty. An empty value is treated as absent:
 * `?token=` should fail as "no token", not as "wrong token", and both are
 * indistinguishable to the page anyway (`docs/web-frontend.md` §3.2).
 */
export function readToken(search: string): string | null {
  const params = new URLSearchParams(search);
  const token = params.get("token");
  return token === null || token.length === 0 ? null : token;
}

/**
 * Derive the WebSocket base URL for a page.
 *
 * `http:` maps to `ws:` and `https:` to `wss:`. A page loaded over `http:` from
 * the host is the normal case; the `https:` branch exists because a mixed
 * content block is a far more confusing failure than an unencrypted attempt to
 * a loopback host that would reject nothing.
 */
export function websocketBaseFor(location: LocationLike, path = DEFAULT_WS_PATH): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${path}`;
}

/**
 * Resolve the socket URL for a page.
 *
 * @throws {TypeError} when an explicit override is not a usable `ws:`/`wss:`
 *   URL. Callers surface this as a visible configuration error rather than
 *   attempting a connection that cannot succeed.
 */
export function resolveEndpoint(
  location: LocationLike,
  options: EndpointOptions = {},
): ResolvedEndpoint {
  const token = readToken(location.search);

  const requested = options.override ?? null;
  let base: string;

  if (requested !== null && requested.length > 0) {
    const parsed = parseWebSocketUrl(requested);
    if (parsed === null) {
      throw new TypeError(
        "The WebSocket override must be an absolute ws:// or wss:// URL",
      );
    }
    base = parsed;
  } else {
    base = websocketBaseFor(location, options.path ?? DEFAULT_WS_PATH);
  }

  if (token === null) {
    return { url: base, hasToken: false };
  }

  const separator = base.includes("?") ? "&" : "?";
  return { url: `${base}${separator}token=${encodeURIComponent(token)}`, hasToken: true };
}

/** Validate and normalize a WebSocket URL; `null` when unusable. */
export function parseWebSocketUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    return null;
  }
  if (url.host.length === 0) {
    return null;
  }
  return url.toString();
}

/**
 * Build the tokenized URLs for a route and its siblings, for the landing page.
 *
 * The token is carried through from the current page's query string rather than
 * stored anywhere. Returns `null` when there is no token to carry, so the
 * landing page can explain how to obtain one instead of linking to a page that
 * will render "not authorized".
 */
export function tokenCarryingHref(
  location: LocationLike,
  path: string,
): string | null {
  const token = readToken(location.search);
  if (token === null) {
    return null;
  }
  return `${path}?token=${encodeURIComponent(token)}`;
}
