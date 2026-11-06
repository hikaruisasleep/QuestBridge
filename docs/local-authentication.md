# Local Authentication and Transport Security

**Status:** Proposal B adopted with revisions on 2026-11-06. Normative for Phase 2 onward.
**Date:** 2026-11-06
**Applies to:** the QuestBridge host, the Minecraft adapter, the mock publisher, and the Svelte frontend.
**Supersedes:** the “pending review” framing of Proposal B in `docs/proposals.md` §3 and `docs/architecture.md` §8.

This document is the normative description of the QuestBridge local authentication and origin strategy required by `AGENTS.md` §13. Where it disagrees with `docs/architecture.md` §8 or `docs/proposals.md` §3, this document wins.

---

## 1. Threat model and stated priorities

QuestBridge is a private, single-user application that runs only on the streamer's own machine. The primary control is that the host binds exclusively to `127.0.0.1`, so no traffic arrives from another machine.

Within that boundary, the project deliberately prioritises speed and ease of use over defence in depth. The following are **accepted, intended behaviours**, not defects. They must not be tightened without an explicit product decision.

| ID | Accepted behaviour | Consequence |
|---|---|---|
| R1 | The host does not bind a token to a role. Any authenticated browser connection may declare `overlay` or `control` in `browser.hello`. | An overlay-token holder can obtain control (write) permission by declaring the `control` role. |
| R2 | Origin allowlisting matches the loopback *hostname* only and ignores the port. | Any page served from `127.0.0.1` or `localhost` on any port may open a WebSocket to the host, provided it can present a token. |
| R3 | Browsers do not scope cookies by port. | A QuestBridge cookie is also sent to other services listening on `127.0.0.1`. |

Rationale for R1: one person owns all three tokens on one machine, so a token-to-role check adds a configuration step — remembering which token belongs in which browser route — without removing a real attacker. Ease of use wins.

Rationale for R2: the overlay and dashboard are served from the same loopback address, and matching by port would break the ordinary case of running the dashboard from a development server on another port while working on Phase 3.

What is **not** relaxed by R1–R3:

- Loopback-only binding. The host never binds `0.0.0.0`.
- `Host` header validation against loopback names.
- Every inbound message validated against the direction-aware v1 schemas.
- Message-size and rate limits.
- No filesystem, shell, or arbitrary HTTP surface.
- No credentials in bundles, rendered HTML, logs, or static output.
- Timing-safe token comparison.

---

## 2. Tokens

Three independent random tokens exist, one per transport role:

| Token | Intended role | Peer |
|---|---|---|
| `overlayToken` | Overlay access (conventionally read-only) | OBS Browser Source or Chromium |
| `controlToken` | Dashboard access (conventionally read/write) | Local dashboard |
| `minecraftToken` | Publisher access | NeoForge mod or mock publisher |

The intended role is a convention the UI respects; per accepted risk R1, either browser token authorises either browser role. `minecraftToken` is the one credential that is a genuine boundary, because it is the only one that authorises publishing Minecraft progression.

Generation and storage:

- 32 random bytes from a CSPRNG, encoded as `base64url` (256-bit, URL-safe, so a bootstrap URL needs no percent-encoding).
- Generated on first run and on token-file recovery.
- Stored in a dedicated `tokens.json` with mode `0600`, deliberately separate from `config.json` so configuration files can be inspected without exposing credentials:

```json
{
  "version": 1,
  "overlayToken": "…",
  "controlToken": "…",
  "minecraftToken": "…"
}
```

- Compared with a timing-safe comparison. Hash both the presented and the stored value with SHA-256 and compare the digests with `crypto.timingSafeEqual`, which avoids the equal-length precondition that the raw function imposes.
- Never logged, never embedded in HTML or JavaScript bundles, and never written to static output.

### 2.1 Bootstrap URL output

A documented CLI command prints the tokenized URLs to **stdout only**, never to a log file:

```text
questbridge-host --print-urls

Overlay:   http://127.0.0.1:8765/overlay?token=<overlayToken>
Dashboard: http://127.0.0.1:8765/control?token=<controlToken>
```

The tokenized URL is the permanent recovery path. Nothing else needs to be memorised.

### 2.2 Token-file recovery (revision 3)

Tokens are regenerable credentials; chapter pins are not. The two files therefore take **opposite** failure rules, and this asymmetry is intentional:

| File | On invalid or unparseable content |
|---|---|
| `config.json` | Fail closed. Preserve the original file, report the exact path and validation error, do not overwrite. Chapter pins are irreplaceable user data. |
| `tokens.json` | Recover. Rename the bad file to `tokens.json.invalid` (timestamped if that name exists), generate fresh tokens, and continue. Log a warning that does not contain token values. |

Applied to tokens, the fail-closed rule would mean permanent lockout with no recovery path. Regeneration costs one re-copied URL.

If a fresh `tokens.json` cannot be written — for example a permissions failure — that is a fatal startup error reported with the exact path.

---

## 3. Browser bootstrap flow

1. OBS or the user opens `/overlay?token=<overlayToken>` or `/control?token=<controlToken>`.
2. The host validates the token with a timing-safe comparison.
3. On success it sets a cookie (see §3.1) and redirects to the clean URL.
4. The page's WebSocket authenticates from the cookie. No token appears in the URL, the HTML, or the bundle.
5. `Referrer-Policy: no-referrer` is set on the bootstrap redirect and on the pages, so a tokenized URL does not leak through a referrer.

On failure the host does not set a cookie and does not redirect; see §6.

### 3.1 Cookie attributes (revision 5)

| Attribute | Value | Note |
|---|---|---|
| Name | `qb_overlay` or `qb_control` | Distinct per role. Both roles share one origin, so a shared name would let one clobber the other. |
| `HttpOnly` | yes | Not readable from JavaScript. |
| `SameSite` | `Strict` | Correct here rather than `Lax`: the first request carries the token in the query and needs no cookie, and the following redirect is same-origin, so the cookie is still sent. |
| `Path` | `/` | |
| `Secure` | **omitted** | The host serves plain HTTP over loopback. Setting `Secure` on `http://127.0.0.1` breaks the cookie outright. Do not add it as “hardening”. |

Because `Secure` is required for the `__Host-` cookie prefix, that prefix cannot be used. The consequence is accepted risk R3.

---

## 4. Role handling

The role is established by the first message on the connection: `browser.hello` with `role: "overlay"` or `"control"` for browsers, or `minecraft.hello` for the adapter.

Two separable checks exist, and the project adopts one of them:

| Check | Status |
|---|---|
| The host enforces the role a connection declares, for the life of that connection. An `overlay`-role connection that sends a mutation is rejected with `unauthorized` and nothing changes. | **Enforced.** Required by `AGENTS.md` §13 and §16, and by the Phase 2 acceptance criterion “overlay cannot mutate; control can”. |
| The host binds a token to the role it may declare, so `overlayToken` cannot authorise a `control` claim. | **Not enforced** (accepted risk R1). |

Consequence, stated plainly: possessing either browser token and declaring `role: "control"` yields write access. The overlay/control distinction therefore remains a *convention* the UI respects — the overlay simply has no mutation controls — not a security boundary. What the browser tokens genuinely protect is access to the port: a page or process with no valid token cannot connect at all.

`minecraftToken` remains a separate credential from the browser tokens. Native adapter connections present it as a bearer token or dedicated header, send no `Origin`, and use no browser cookie.

---

## 5. Origin and `Host` rules

WebSocket origins:

- Allow a browser connection whose `Origin` has a loopback hostname: `127.0.0.1`, `localhost`, `[::1]`, or `::1`. **Any port is accepted** (accepted risk R2).
- Allow a connection with no `Origin` header only when it presents a valid `minecraftToken`.
- Reject every other origin.
- Reject cross-origin mutation requests.

`Host` header:

- Validate against loopback names (`127.0.0.1`, `localhost`, `[::1]`). This is what defeats DNS rebinding, and it is retained even though R2 relaxes origin port matching.
- Reject a request whose `Host` is not a loopback name.

---

## 6. Failure states and recovery (revision 4)

An authorization rejection must be distinguishable from “no data yet”, and the overlay must never render as a blank frame when it is rejected. A silently blank overlay during a stream is the worst failure mode this component has.

| Condition | Host response | Client behaviour |
|---|---|---|
| WebSocket upgrade with no, or an invalid, token | Reject the upgrade with `401` | Page renders the actionable “not authorized” state |
| WebSocket upgrade from a disallowed origin | Reject the upgrade with `403` | Same |
| Valid token, but the cookie was cleared | `401` on the next upgrade | Page renders the actionable state |
| Authorized, but the first message is invalid | `host.error` with `fatal: true`, then close | Existing protocol handling |
| Authorized overlay sends a mutation | `request.error` code `unauthorized`, no state change | Overlay has no mutation controls |
| Host not running, or connection refused | — | “Waiting for the host” state, distinct from unauthorized |
| Authorized, no Minecraft data yet | Normal `state.snapshot` with an empty catalog | Normal disconnected/synchronizing presentation |

Recommended mechanism for the actionable state: a read-only `GET /auth/status` on the same loopback listener, answered from the cookie, returning the authorization result and the role. A failed WebSocket handshake does not expose its HTTP status to JavaScript — the page sees only a generic close — so this probe is what lets the overlay distinguish `401` from `403` from “host down”. The endpoint returns no tokens, no configuration, and no player or server data.

Acceptable fallback if that probe is not implemented: any non-blank, instructive message on connection failure, naming the tokenized URL printed by `--print-urls` as the remedy. The requirement is that the state is visible and actionable, not that the cause is perfectly diagnosed.

The overlay's authorization-failure presentation is rendered in Phase 3; the Phase 2 host deliverable is the distinguishable `401`/`403` response and, if adopted, `/auth/status`.

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

- Missing and invalid overlay token rejected.
- Missing and invalid control token rejected.
- Valid token reaches the intended role.
- An `overlay`-role connection cannot mutate; a `control`-role connection can.
- Disallowed `Origin` rejected; loopback origin on a non-default port accepted (R2).
- Invalid `Host` header rejected.
- Oversized message rejected.
- Mutation rate limit enforced.
- Tokens never appear in logs or static output.
- Corrupt `tokens.json` is backed up and regenerated, and the host still starts (revision 3).
- Invalid `config.json` is preserved, not overwritten, and the host reports the failure.

---

## 9. Relationship to other documents

- `AGENTS.md` §13 states the security requirements this document implements.
- `docs/proposals.md` §3 records Proposal B as submitted and the decision taken.
- `docs/architecture.md` §8 summarises the same strategy at a higher level.
- `docs/phase-2-plan.md` §13.2 and milestone 2D schedule the implementation.
- `docs/protocol.md` §12 defines the security boundary the message contract assumes.
