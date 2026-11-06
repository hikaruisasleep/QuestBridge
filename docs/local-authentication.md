# Local Authentication and Transport Security

**Status:** Proposal B adopted; simplified on 2026-11-06 to two tokens and no cookies. Normative for Phase 2 onward.
**Date:** 2026-11-06
**Applies to:** the QuestBridge host, the Minecraft adapter, the mock publisher, and the Svelte frontend.
**Supersedes:** the “pending review” framing of Proposal B in `docs/proposals.md` §3 and `docs/architecture.md` §8, and the three-token cookie design previously recorded in this document.

This document is the normative description of the QuestBridge local authentication and origin strategy required by `AGENTS.md` §13. Where it disagrees with `docs/architecture.md` §8 or `docs/proposals.md` §3, this document wins.

---

## 1. Threat model and stated priorities

QuestBridge is a private, single-user application that runs only on the streamer's own machine. The primary control is that the host binds exclusively to `127.0.0.1`, so no traffic arrives from another machine.

Within that boundary the project deliberately prioritises speed and ease of use over defence in depth. Two consequences are **accepted, intended behaviours**, not defects. They must not be tightened without an explicit product decision.

| ID | Accepted behaviour | Consequence |
|---|---|---|
| R1 | The browser token does not distinguish the `overlay` and `control` roles. | Any holder of the browser token may declare `control` and gain write access. The overlay/control split is a UI convention, not a security boundary. |
| R2 | Origin allowlisting matches the loopback *hostname* only and ignores the port. | Any page served from `127.0.0.1` or `localhost` on any port may open a WebSocket to the host, provided it presents a token. |

Rationale for R1: one person owns the tokens on one machine, so a role-binding check would add a configuration step — remembering which token belongs in which browser route — without removing a real attacker. Ease of use wins.

Rationale for R2: the overlay and dashboard are served from the same loopback address, and matching by port would break the ordinary case of running the dashboard from a development server on another port while working on Phase 3.

### 1.1 What the credentials actually protect

There are exactly two trust boundaries in this design, and therefore exactly two tokens:

1. **Publisher vs. reader.** Only a peer holding `minecraftToken` may publish quest progression. Browsers can never write progression, and the adapter never reads browser state.
2. **A page we handed a URL to vs. an arbitrary local page.** Loopback binding and `Host` validation stop remote traffic. The `browserToken` is what stops an unrelated local web page — which under R2 passes the origin check — from reading streamer state.

`browserToken` is not a boundary between the overlay and the dashboard; per R1 that distinction does not exist at the transport layer. What `AGENTS.md` §13 requires is “separate Minecraft and dashboard permissions”, which is boundary 1, and that is preserved exactly.

### 1.2 Why two tokens and not one

The two surviving tokens are justified on a cost/benefit basis, and the dropped role split on the same basis. The asymmetry is the whole argument:

| Credential | Usability cost | Security benefit | Verdict |
|---|---|---|---|
| overlay/control split | High — two URLs to obtain, label, and keep straight | None, because R1 does not enforce it | **Dropped** |
| `minecraftToken` | None — machine-to-machine, configured once in the adapter, never typed by a person | Real — without it, any local process could connect as a publisher and inject fabricated quest data into the overlay | **Kept** |
| `browserToken` | Low — one URL, pasted into OBS once | Real — under R2 an unrelated local page passes the origin check, so a token is the only thing preventing it from reading streamer state | **Kept** |

Simplification should remove cost without removing benefit. The role split was pure cost under R1; `minecraftToken` is pure benefit at zero cost to a human. That is why the count lands at two.

Note that direction-aware message parsing independently blocks a browser from publishing progression — `parseFrame(..., "browser_to_host")` rejects every `minecraft.*` type regardless of token. `minecraftToken` is what prevents an *unauthorised publisher* from connecting at all, which the message contract alone cannot do.

What is **not** relaxed:

- Loopback-only binding. The host never binds `0.0.0.0`.
- `Host` header validation against loopback names.
- Every inbound message validated against the direction-aware v1 schemas.
- Message-size and rate limits.
- No filesystem, shell, or arbitrary HTTP surface.
- No credentials in frontend bundles, rendered HTML, or logs.
- Timing-safe token comparison.

---

## 2. Tokens

Two tokens exist, one per trust boundary in §1.1:

| Token | Authorises | Peer |
|---|---|---|
| `browserToken` | Reading state; declaring either browser role | OBS Browser Source, Chromium, local dashboard |
| `minecraftToken` | Publishing Minecraft state and progression | NeoForge mod or mock publisher |

Generation and storage:

- 32 random bytes from a CSPRNG, encoded as `base64url` (256-bit, URL-safe, so a token needs no percent-encoding in a URL).
- Generated on first run and on token-file recovery.
- Stored in a dedicated `tokens.json` with mode `0600`, deliberately separate from `config.json` so configuration files can be inspected without exposing credentials:

```json
{
  "version": 1,
  "browserToken": "…",
  "minecraftToken": "…"
}
```

- Compared with a timing-safe comparison: hash both the presented and the stored value with SHA-256 and compare the digests with `crypto.timingSafeEqual`, which avoids the equal-length precondition that the raw function imposes.
- Never logged and never embedded in HTML or JavaScript bundles.

### 2.1 Bootstrap URL output

A documented CLI command prints the URLs to **stdout only**, never to a log file:

```text
questbridge-host --print-urls

Overlay:   http://127.0.0.1:8765/overlay?token=<browserToken>
Dashboard: http://127.0.0.1:8765/control?token=<browserToken>
```

Both routes use the same token. The printed URL is the permanent access path: it is what OBS keeps as its source URL, and what a user bookmarks.

### 2.2 Token-file recovery

Tokens are regenerable credentials; chapter pins are not. The two files therefore take **opposite** failure rules, and this asymmetry is intentional:

| File | On invalid or unparseable content |
|---|---|
| `config.json` | Fail closed. Preserve the original file, report the exact path and validation error, do not overwrite. Chapter pins are irreplaceable user data. |
| `tokens.json` | Recover. Rename the bad file to `tokens.json.invalid` (timestamped if that name exists), generate fresh tokens, and continue. Log a warning that does not contain token values. |

Applied to tokens, the fail-closed rule would mean permanent lockout with no recovery path. Regeneration costs one re-copied URL.

If a fresh `tokens.json` cannot be written — for example a permissions failure — that is a fatal startup error reported with the exact path.

---

## 3. Transport authentication

**There are no cookies and no login redirect.** The token travels in the query string, is validated once per connection, and is never persisted by the host.

There is exactly **one authentication checkpoint: the WebSocket upgrade.** Page requests are not gated.

### 3.1 Browser

1. OBS or the user opens `http://127.0.0.1:8765/overlay?token=<browserToken>`.
2. The host serves the application shell. The shell is static and contains no state, no configuration, and no credentials, so serving it to an unauthenticated loopback request discloses nothing. A non-loopback `Host` is still refused with `403`.
3. The page reads the token from its own `location.search` at runtime and appends it to the WebSocket URL: `ws://127.0.0.1:8765/ws?token=<browserToken>`. The token appears in no bundle, no HTML, and no JavaScript constant.
4. The host validates the token on the WebSocket upgrade. This is the only place authentication decides anything.
5. The role is established from `browser.hello`.

Not gating the shell is deliberate, for two reasons. It removes a redundant checkpoint, since data is only ever delivered over the socket. And it produces a better failure mode: the real UI loads and can render a legible “not authorized — run `questbridge-host --print-urls`” message, instead of the browser displaying a bare `401` body with no styling and no instructions.

`Referrer-Policy: no-referrer` is set on the pages so the tokenized URL does not leak through a referrer.

Because the token is part of the URL, an OBS refresh — or any browser restart, cookie purge, or CEF profile reset — re-authenticates with no additional state. There is no session, no cookie lifetime, and no “logged out” state that can strand the overlay mid-stream.

### 3.2 Minecraft

The adapter presents `minecraftToken` on the WebSocket upgrade, as an `Authorization: Bearer` header with the `?token=` query parameter as an equivalent fallback for clients that cannot set headers. It sends no `Origin` and uses no browser mechanism.

---

## 4. Role handling

The role is established by the first message on the connection: `browser.hello` with `role: "overlay"` or `"control"`, or `minecraft.hello` for the adapter.

The host enforces the declared role for the life of the connection. An `overlay`-role connection that sends a mutation is rejected with `unauthorized` and nothing changes. This is required by `AGENTS.md` §13 and §16 and by the Phase 2 acceptance criterion “overlay cannot mutate; control can”.

Per R1 the host does **not** bind the token to the role it may declare, so declaring `control` with the browser token yields write access. The overlay/control distinction is a convention the UI respects — the overlay simply has no mutation controls — not a security boundary.

`minecraftToken` is checked separately and cannot be substituted for `browserToken`, or the reverse.

---

## 5. Origin and `Host` rules

WebSocket and page requests:

- Allow a request whose `Origin` (or `Host`) has a loopback name: `127.0.0.1`, `localhost`, `[::1]`, or `::1`. **Any port is accepted** (accepted risk R2).
- Allow a connection with no `Origin` header only when it presents a valid `minecraftToken`.
- Reject every other origin with `403`.
- Reject cross-origin mutation requests.

`Host` header validation is what defeats DNS rebinding. It is retained independently of the origin rule.

---

## 6. Failure states and recovery

An authorization rejection must be distinguishable from “no data yet”, and the overlay must never render as a blank frame when it is rejected. A silently blank overlay during a stream is the worst failure mode this component has.

| Condition | Host response | Client behaviour |
|---|---|---|
| WebSocket upgrade with no, or an invalid, token | `401` | UI renders the actionable “not authorized” state |
| WebSocket upgrade from a disallowed origin, or a page request with a non-loopback `Host` | `403` | Same |
| Authorized, but the first message is invalid | `host.error` with `fatal: true`, then close | Existing protocol handling |
| Authorized overlay sends a mutation | `request.error` code `unauthorized`, no state change | Overlay has no mutation controls |
| Host not running, or connection refused | — | “Waiting for the host” state, distinct from unauthorized |
| Authorized, no Minecraft data yet | Normal `state.snapshot` with an empty catalog | Normal disconnected/synchronizing presentation |

A rejected WebSocket handshake does not expose its HTTP status to JavaScript — the page observes only a generic close — so the page cannot distinguish `401` from “host down” by inspecting the socket. The required behaviour is therefore the weaker but sufficient one: on any failure to establish the socket, the overlay renders a visible, instructive message naming the `--print-urls` command as the remedy, rather than an empty frame. No diagnostic probe endpoint is required.

Because the shell is served unconditionally, this message is rendered by the real UI in all failure cases, which is what makes the “never a blank frame” requirement achievable without extra machinery.

The overlay's authorization-failure presentation is rendered in Phase 3. The Phase 2 host deliverable is the distinguishable `401`/`403` responses.

---

## 7. Limits

Enforced by the host, independently of the message payload:

| Limit | Value |
|---|---|
| WebSocket message size | 256 KiB (262,144 bytes), enforced before parsing |
| HTTP request body | 64 KiB |
| Binary frames | Rejected |
| Browser mutations | 10 per second per connection |
| New browser connections | 20 per minute |
| New Minecraft connections | 5 per minute |

Exceeding a limit is `rate_limited`. These are host configuration, not protocol constants.

---

## 8. Verification

Security tests required for Phase 2:

- Missing and invalid `browserToken` rejected on the WebSocket upgrade.
- Missing and invalid `minecraftToken` rejected.
- `browserToken` cannot authorise a publisher, and `minecraftToken` cannot authorise a browser.
- An `overlay`-role connection cannot mutate; a `control`-role connection can.
- Declaring `control` with the browser token succeeds (R1, asserted so the behaviour is deliberate rather than accidental).
- Disallowed `Origin` rejected; loopback origin on a non-default port accepted (R2).
- Invalid `Host` header rejected.
- Oversized message rejected.
- Mutation rate limit enforced.
- Tokens never appear in logs, static output, or served HTML/JS.
- Corrupt `tokens.json` is backed up and regenerated, and the host still starts.
- Invalid `config.json` is preserved, not overwritten, and the host reports the failure.

---

## 9. Relationship to other documents

- `AGENTS.md` §13 states the security requirements this document implements.
- `docs/proposals.md` §3 records Proposal B as submitted and the decision taken.
- `docs/architecture.md` §8 summarises the same strategy at a higher level.
- `docs/phase-2-plan.md` §13.2 and milestone 2D schedule the implementation.
- `docs/protocol.md` §12 defines the security boundary the message contract assumes.
