import { describe, expect, it } from "vitest";

import {
  parseWebSocketUrl,
  readToken,
  resolveEndpoint,
  tokenCarryingHref,
  websocketBaseFor,
} from "./endpoint.js";

/**
 * Endpoint resolution.
 *
 * The token is a credential (`docs/local-authentication.md` §2). These tests
 * care most about two properties: the token is only ever appended to the socket
 * URL, and a missing token is reported rather than papered over.
 */

const PAGE = {
  protocol: "http:",
  host: "127.0.0.1:8765",
  search: "?token=abc123",
};

describe("readToken", () => {
  it("reads the token from the query string", () => {
    expect(readToken("?token=abc123")).toBe("abc123");
  });

  it("reads it alongside other parameters", () => {
    expect(readToken("?ws=ws%3A%2F%2Fx&token=abc123")).toBe("abc123");
  });

  it("treats an empty token as absent", () => {
    // `?token=` must fail as "no token"; the page cannot tell the two apart
    // anyway, so pretending a value exists would only mislead the UI.
    expect(readToken("?token=")).toBeNull();
  });

  it("returns null when there is no token", () => {
    expect(readToken("")).toBeNull();
    expect(readToken("?other=1")).toBeNull();
  });
});

describe("websocketBaseFor", () => {
  it("derives the socket from the page origin", () => {
    expect(websocketBaseFor(PAGE)).toBe("ws://127.0.0.1:8765/ws");
  });

  it("uses wss for an https page", () => {
    expect(websocketBaseFor({ ...PAGE, protocol: "https:" })).toBe("wss://127.0.0.1:8765/ws");
  });

  it("honours a custom path", () => {
    expect(websocketBaseFor(PAGE, "/socket")).toBe("ws://127.0.0.1:8765/socket");
  });
});

describe("resolveEndpoint", () => {
  it("appends the token to the socket URL", () => {
    const resolved = resolveEndpoint(PAGE);
    expect(resolved.url).toBe("ws://127.0.0.1:8765/ws?token=abc123");
    expect(resolved.hasToken).toBe(true);
  });

  it("omits the query when there is no token", () => {
    const resolved = resolveEndpoint({ ...PAGE, search: "" });
    expect(resolved.url).toBe("ws://127.0.0.1:8765/ws");
    expect(resolved.hasToken).toBe(false);
  });

  it("percent-encodes a token containing reserved characters", () => {
    // base64url tokens should never need this, but a hand-edited URL might.
    const resolved = resolveEndpoint({ ...PAGE, search: "?token=a%26b%20c" });
    expect(resolved.url).toBe("ws://127.0.0.1:8765/ws?token=a%26b%20c");
  });

  it("prefers an explicit override", () => {
    // The development server serves the page from its own port, so the page
    // origin is not the host. The override is how that case is expressed.
    const resolved = resolveEndpoint(PAGE, { override: "ws://127.0.0.1:9999/ws" });
    expect(resolved.url).toBe("ws://127.0.0.1:9999/ws?token=abc123");
  });

  it("rejects a malformed override instead of silently falling back", () => {
    // A silent fallback would present a misconfigured dev server as working.
    expect(() => resolveEndpoint(PAGE, { override: "http://example.com/ws" })).toThrow(TypeError);
    expect(() => resolveEndpoint(PAGE, { override: "not a url" })).toThrow(TypeError);
  });
});

describe("parseWebSocketUrl", () => {
  it("accepts ws and wss URLs", () => {
    expect(parseWebSocketUrl("ws://127.0.0.1:8765/ws")).not.toBeNull();
    expect(parseWebSocketUrl("wss://127.0.0.1:8765/ws")).not.toBeNull();
  });

  it("rejects non-websocket schemes", () => {
    expect(parseWebSocketUrl("http://127.0.0.1/ws")).toBeNull();
    expect(parseWebSocketUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("tokenCarryingHref", () => {
  it("carries the token into a sibling route link", () => {
    expect(tokenCarryingHref(PAGE, "/control")).toBe("/control?token=abc123");
  });

  it("returns null when there is no token to carry", () => {
    // The landing page must explain how to get a URL rather than linking to a
    // page that will render "not authorized".
    expect(tokenCarryingHref({ ...PAGE, search: "" }, "/overlay")).toBeNull();
  });
});
