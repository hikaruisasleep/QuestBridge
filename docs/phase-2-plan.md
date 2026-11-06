# Phase 2 Plan — Host Core and Local Transport

**Status:** Implemented and verified through milestone 2G. All five Phase 2 acceptance
blockers are met by `packages/host` at `0.1.0`: 225 host tests pass, the host and the mock
publisher work end to end over real WebSockets, configuration survives restart, and the
security refusals are distinguishable. The static handoff is in place but no Svelte route
exists yet, so `/overlay` and `/control` serve the documented placeholder; that remains
Phase 3 work. Proposal B authentication is settled: adopted and simplified to two tokens
with no cookies on 2026-11-06, and specified in `docs/local-authentication.md`.  
**Date:** 2026-11-06  
**Target:** QuestBridge host on Node 24, protocol v1, ATM10 TTS 2.3.1 data supplied by the future adapter or the existing mock publisher.  
**Version:** The Minecraft mod remains on `0pre.1`; the private `@questbridge/host` package uses its own SemVer version (`0.1.0`).

---

## 1. Why Phase 2 now

Stage 4A is verified against the real client. The test log at
`docs/testing-logs/2026-11-06-1.log` records:

- the mod loading as `questbridge-0pre.1`;
- FTB readiness after synchronization;
- 55 chapters;
- the five expected ATM10 TTS chapter IDs and titles;
- a real manual pin (`Easy Ore Duping`) with two item tasks;
- chapter progress and task counts.

That establishes the real-data source. It does not provide a production host.
The standalone collector is a development tool: it has no configuration,
chapter pins, browser roles, persistence, or authentication.

Phase 2 builds the production host that the overlay, dashboard, mock publisher,
and eventual real adapter all use.

---

## 2. Goal

Deliver a loopback-only Node host that:

1. Accepts one authenticated Minecraft publisher at a time.
2. Accepts authenticated overlay and control browser clients.
3. Validates every message with `@questbridge/protocol`.
4. Owns persistent chapter-pin and display configuration.
5. Resolves configured chapter IDs against the live catalog without deleting
   unresolved entries.
6. Maintains normalized state with revisions, sequence handling, staleness, and
   resynchronization.
7. Serves the production frontend once Phase 3 provides a static build.
8. Exposes no remote, filesystem, shell, or arbitrary HTTP surface.

Phase 2 ends when the host and the mock publisher work end to end over real
WebSockets, configuration survives restart, and all host/auth tests pass.

---

## 3. Scope

### In scope

- `packages/host` workspace package.
- Host process entry point and CLI.
- Configuration store with atomic persistence and explicit migrations.
- Chapter-pin operations: read, pin, unpin, reorder.
- Chapter resolver with unresolved entries.
- Display configuration.
- State store, revision tracking, and stale/disconnected lifecycle.
- HTTP server bound to `127.0.0.1`.
- WebSocket endpoint at `/ws` with role handshake.
- Minecraft publisher handling: hello, status, snapshot, progress, pins,
  heartbeat.
- Browser handling: hello, initial snapshot, updates, resync, mutations.
- Proposal B authentication: query-string browser tokens and a Minecraft bearer
  token.
- Origin, `Host`, message-size, and mutation-rate enforcement.
- Host unit and integration tests.
- A minimal mock-publisher extension for the Minecraft bearer token, so the
  existing scenarios can exercise the authenticated host path.
- Manual host + mock publisher verification.

### Out of scope

- `/overlay` and `/control` Svelte implementations. Those are Phase 3.
- The real adapter's WebSocket publisher. That is Stage 4C/4D.
- Changes to protocol v1 payloads.
- Chapter auto-selection.
- Quest-pin management.
- Auto-pin tracker reconstruction.
- Cloud access, remote databases, user accounts, and server-side Minecraft code.

---

## 4. Preconditions and assumptions

- Protocol v1 remains stable. Phase 2 must not add fields or message types.
- The mock publisher already implements the Minecraft side of v1 and its
  scenarios are deterministic.
- The host uses `ws`, `zod`, and the shared protocol package only; no web
  framework is required for the host process.
- The web-app originally scaffolded with `adapter-node`; it now uses
  `adapter-static`, so the build contains real HTML the host can serve (see
  §5.2 and `docs/web-frontend.md`).
- The Minecraft mod version remains `0pre.1`; host changes do not touch it.

---

## 5. Decisions to settle before implementation

### 5.1 Proposal B authentication — settled

Proposal B was adopted on 2026-11-06 and simplified the same day to two tokens
with no cookies. The normative design is `docs/local-authentication.md`;
milestone 2D implements it. The decision is settled and is no longer a gate.

The simplification removed the overlay/control token split and the entire cookie
layer, on the grounds that accepted risk R1 already makes the two browser tokens
interchangeable. What remains is `browserToken` and `minecraftToken`, one per
real trust boundary, validated once on the WebSocket upgrade.

Two revisions affect 2D specifically:

- a corrupt `tokens.json` is backed up and regenerated rather than failing closed;
- the overlay renders a visible, actionable state rather than a blank frame when
  the socket cannot be established.

Two behaviours are adopted as intended rather than as defects, and must not be
"fixed" during implementation:

- the browser token is not bound to a role (accepted risk R1);
- origin matching ignores the port (accepted risk R2).

### 5.2 Static frontend strategy

**Resolved.** The web-app now uses `@sveltejs/adapter-static`, so the build
produces real HTML files that the host serves with its existing static path.
The full frontend requirements are in `docs/web-frontend.md`.

`adapter-node` was the wrong target because it emits a Node server
(`build/index.js`, `build/handler.js`, `build/client/`, `build/server/`) and
generates every page's HTML per request — it emits no `.html` file for the host
to stat. Two workarounds were rejected: spawning a second Node process is the
"second web server" this section rules out, and importing `build/handler.js`
would couple the host to the frontend framework, inverting the dependency
direction `AGENTS.md` §4 requires.

The host still ships a clear `503`-style placeholder for browser routes when no
static build is present, rather than inventing a second frontend server. The
placeholder is implemented as an explanatory page rather than an error status,
so a user with no build sees what to do; see `packages/host/src/static.ts`.

### 5.3 Configuration location

Recommended resolution order:

1. `QUESTBRIDGE_CONFIG_DIR`, for tests and development.
2. Windows: `%APPDATA%\QuestBridge`.
3. macOS: `~/Library/Application Support/QuestBridge`.
4. Linux: `$XDG_CONFIG_HOME/questbridge` or `~/.config/questbridge`.

The directory contains:

```text
config.json     # pins and display settings, mode 0600
tokens.json     # browser and Minecraft tokens, mode 0600
```

Tokens are kept out of `config.json` so configuration files can be inspected
without exposing credentials.

### 5.4 Package version

`@questbridge/host` starts at `0.1.0`. The `0pre.<minor>` policy applies to the
Minecraft mod artifact, not to private npm packages.

### 5.5 Mock publisher authentication

The collector currently accepts an unauthenticated publisher. Phase 2 needs the
mock publisher to optionally send the Minecraft bearer token so host integration
tests can cover the real authenticated path.

Recommended addition:

```text
npm run mock -- --scenario=ready --token=<minecraftToken>
```

or a `QUESTBRIDGE_MINECRAFT_TOKEN` environment variable. Without a token, the
mock keeps working against the unauthenticated collector.

---

## 6. Proposed package layout

```text
packages/host/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts              # CLI entry / startup
│   ├── server.ts             # HTTP + WebSocket lifecycle
│   ├── config-store.ts       # load, validate, migrate, atomic save
│   ├── config-schema.ts      # Zod schemas and defaults
│   ├── paths.ts              # platform config directory resolution
│   ├── chapter-resolver.ts   # catalog + configured pins
│   ├── chapter-pins.ts       # pure pin/unpin/reorder operations
│   ├── state-store.ts        # normalized state, revision, staleness
│   ├── minecraft-session.ts  # publisher handshake and message handling
│   ├── browser-session.ts    # browser roles and message handling
│   ├── auth.ts               # tokens, timing-safe comparison, role checks
│   ├── http.ts               # static files, token validation, /health
│   ├── validation.ts         # direction/domain validation helpers
│   ├── logging.ts            # redacted structured logging
│   └── errors.ts             # host error mapping
└── tests/
    ├── config-store.test.ts
    ├── chapter-pins.test.ts
    ├── chapter-resolver.test.ts
    ├── state-store.test.ts
    ├── minecraft-session.test.ts
    ├── browser-session.test.ts
    ├── auth.test.ts
    ├── http.test.ts
    └── integration.test.ts
```

The host must not import Minecraft or FTB classes. The only Minecraft-facing
contract is the v1 JSON protocol.

---

## 7. Runtime architecture

One Node process owns:

- one HTTP server bound to `127.0.0.1`;
- one WebSocket server attached to `/ws`;
- one configuration store;
- one state store;
- zero or one active Minecraft publisher;
- zero or more browser clients.

```text
Minecraft publisher ── WebSocket /ws ──┐
                                       ├── host process
Browser (overlay) ─── WebSocket /ws ───┤   ├── auth
Browser (control) ─── WebSocket /ws ───┘   ├── validation
                                            ├── state store
                                            ├── config store
                                            └── chapter resolver
```

The host is the only writer of chapter-pin and display configuration. The
Minecraft publisher is the only writer of quest progression. Browsers never
publish progression.

Timers:

- heartbeat expectation: 5 s;
- stale threshold: 10 s without heartbeat;
- disconnected threshold: 15 s without heartbeat, or socket close;
- stale-check interval: 1 s;
- browser mutation rate: 10/s per connection;
- first-message timeout: 5 s.

---

## 8. Configuration and persistence

### 8.1 File schema

```json
{
  "version": 1,
  "server": {
    "port": 8765
  },
  "chapterPins": {
    "maxPins": 5,
    "pinnedChapters": [
      { "chapterId": "3B0302DB5E77C3A2", "position": 0 }
    ]
  },
  "display": {
    "showChapterProgress": true,
    "showQuestTasks": true,
    "showCompletedQuests": true,
    "completionAnimation": true,
    "theme": "minimal",
    "compactMode": true
  }
}
```

Rules:

- `maxPins` is always `5`.
- No chapter pins are seeded automatically.
- Empty pin configuration is valid.
- Unresolved chapter IDs remain stored.
- Display settings are always complete; no partial objects.
- The port is persisted, but the default remains `8765`.

### 8.2 Persistence behavior

- Write to a temporary file in the same directory.
- Flush, then rename over `config.json`.
- Set mode `0600` where the platform supports it.
- Keep the previous file if validation or write fails.
- Never overwrite an invalid configuration file with defaults.
- Report the exact path and validation failure at startup.
- Serialize all writes through one queue; no concurrent partial writes.

### 8.3 Migration

`version: 1` is the initial format. A future migration must:

1. read and validate the old file,
2. transform explicitly,
3. write the new version atomically,
4. preserve unresolved chapter IDs and display settings.

Unknown newer versions fail closed with a clear message.

---

## 9. Chapter pin operations

Pure functions in `chapter-pins.ts` operate on a validated config and return a
new config or a typed error.

### Pin

- Reject a duplicate chapter ID: `duplicate_chapter`.
- Reject more than five pins: `too_many_pins`.
- Reject an ID absent from the live catalog: `unknown_chapter`.
- Append at the end.
- Normalize positions.

### Unpin

- Reject an ID not currently pinned: `not_pinned`.
- Allow unpinning an unresolved ID.
- Normalize positions.

### Reorder

- Require exactly the current pinned ID set.
- Reject additions, removals, duplicates, and more than five IDs:
  `invalid_reorder_set`.
- Assign positions from array order.

### Persistence and broadcast

For every successful mutation:

1. apply the operation;
2. validate the complete config;
3. persist atomically;
4. update state revision;
5. broadcast `chapter.pins.update` and/or `state.update`;
6. let the requesting dashboard learn the authoritative result from the
   broadcast.

A failed persistence step must leave state unchanged and return
`invalid_request` or an internal error without a partial broadcast.

### Display configuration

`config.update` from a control client must carry the complete `DisplayConfig`.
Unknown fields, partial objects, and invalid theme values are rejected. On
success, persist atomically and broadcast `config.update` plus the new revision.

---

## 10. Chapter resolution

The resolver joins:

- stored `chapterPins.pinnedChapters`;
- the latest catalog from `minecraft.snapshot`.

For each configured pin:

- if the ID exists, expose the catalog chapter;
- if it does not, expose an unresolved entry preserving the ID and position.

Rules:

- Never delete an unresolved pin.
- Never substitute a different chapter.
- Never reorder based on catalog order; configuration order wins.
- If no catalog has ever been received, every pin is unresolved and the UI sees
  the disconnected/synchronizing state.
- Resolution is recomputed after a snapshot, catalog change, config mutation, or
  restart.

---

## 11. State store and broadcasting

### 11.1 State

The host owns one normalized `AppState`:

```typescript
interface AppState {
  revision: number;
  connection: ConnectionState;
  minecraft: MinecraftIdentity;
  chapters: Chapter[];
  quests: Quest[];
  unresolvedPinnedQuestIds: string[];
  chapterPins: ChapterPinConfig;
  display: DisplayConfig;
}
```

The state store:

- starts at revision `0`;
- increments revision once per committed state change;
- retains the last Minecraft snapshot across disconnect, marked stale;
- never fabricates progression;
- clears or replaces data only after a new publisher's first valid snapshot;
- recomputes chapter-pin resolution on relevant changes.

### 11.2 Update behavior

Send a full `state.snapshot`:

- immediately after a browser hello;
- after the first Minecraft snapshot;
- after quest reload, world change, team change, or publisher reconnect;
- after host recovery;
- in response to `state.resync`.

Send `state.update` only for changed sections. Section messages
(`chapter.pins.update`, `config.update`, `connection.status`) are allowed for
the same change, but the revision must remain consistent.

Never broadcast unchanged state on a timer.

### 11.3 Sequence and revision

- Browser connection sequence starts at `1` and increments per message.
- Browser revision starts at the host's current revision.
- A gap in host-to-browser sequence causes `state.resync`.
- A gap in revision also causes `state.resync`.
- Duplicate/stale browser requests are rejected or ignored without mutation.

---

## 12. WebSocket roles and lifecycle

### 12.1 Minecraft publisher

- One active publisher. A second connection is rejected with
  `invalid_request`.
- First message must be `minecraft.hello`, sequence `1`, within 5 s.
- Validate protocol version and session ID.
- Reply with `host.welcome`.
- Require `minecraft.snapshot` before treating progression as ready.
- Track sequence gaps; request `host.request_snapshot` with
  `reason: "sequence_gap"`.
- Enforce `sessionId` consistency.
- On socket close: retain the snapshot, mark stale, then disconnected.
- On heartbeat timeout: stale at 10 s, disconnected at 15 s.
- A new publisher clears the stale state only after its first valid snapshot.
- A full snapshot replaces catalog, objectives, identity, and pin IDs
  atomically.

### 12.2 Browser clients

- First message must be `browser.hello` with `role: "overlay"` or `"control"`.
- Authenticate the transport before trusting the role.
- Send `state.snapshot` immediately after hello.
- Overlay: read-only; mutation attempts return `unauthorized`.
- Control: may pin, unpin, reorder, and update display config.
- Browser disconnect never changes host state.
- OBS refresh must not require a new Minecraft snapshot.
- At most 20 new browser connections per minute.

### 12.3 Limits

- Maximum WebSocket message: 256 KiB.
- Maximum HTTP request body: 64 KiB.
- Reject binary frames.
- Reject fragmented messages if they exceed the limit.
- Rate-limit control mutations.

---

## 13. HTTP, authentication, and static serving

### 13.1 Listener

- Bind only to `127.0.0.1`.
- Default port `8765`.
- Validate the `Host` header against loopback names.
- Reject unknown upgrade paths.
- No arbitrary filesystem paths, shell endpoints, or proxying.

### 13.2 Token authentication

Implement Proposal B as adopted and simplified. The normative design is
`docs/local-authentication.md`; the summary below is the implementation checklist.

- Two tokens generated on first run: `browserToken` and `minecraftToken`.
- 32 random bytes as `base64url`, stored in `tokens.json` with mode `0600`.
- Browser opens `/overlay?token=<browserToken>` or
  `/control?token=<browserToken>`. Both routes share one token.
- Page requests are **not** gated; the static shell is served unconditionally.
- The page reads the token from `location.search` and appends it to the
  WebSocket URL.
- The WebSocket upgrade is the single authentication checkpoint.
- Enforce the declared role for the life of the connection, but do not bind the
  token to a role (accepted risk R1).
- Minecraft uses `minecraftToken` as a bearer header, or `?token=` as a fallback.
- Compare tokens with a timing-safe comparison.
- Set `Referrer-Policy: no-referrer` on the pages so the tokenized URL does not
  leak through referrers.
- Tokens never appear in served HTML, JavaScript bundles, or logs.
- No cookies and no redirect flow, so an OBS refresh or CEF profile reset
  re-authenticates with no stored state.
- A documented `--print-urls` command prints access URLs to stdout only.
- A corrupt `tokens.json` is backed up and regenerated; a corrupt `config.json`
  is preserved and fails closed. The asymmetry is intentional.
- Reject an unauthorized upgrade with `401` and a disallowed origin or
  non-loopback `Host` with `403`.

### 13.3 Static frontend

Implemented:

- `index.html`, JS, CSS, and assets are served from `--build-dir`.
- `/overlay` and `/control` return a clear placeholder when the build is absent.
- No second web server exists.
- The build is a static SvelteKit build (`adapter-static`); see §5.2 and
  `docs/web-frontend.md`.

Host-side details settled in 2G and its hardening follow-up:

- Route resolution tries `<route>/index.html`, `<route>.html`, then
  `index.html`, so the frontend's `trailingSlash` choice needs no coordination.
- `Cache-Control` is set per file class: `_app/immutable/…` is immutable for a
  year, HTML is `no-store`, everything else revalidates. `Referrer-Policy:
  no-referrer` is set on every served file.

The placeholder must not contain tokens or fake progression.

### 13.4 Health

Add a minimal loopback `/health` endpoint returning host status and version.
It must not expose configuration, tokens, player names, or server addresses.

---

## 14. Testing strategy

### 14.1 Unit tests

- Config schema: valid, invalid, missing fields, unknown fields.
- Atomic save and load round-trip.
- Invalid config is preserved and reported.
- Pin, unpin, reorder, duplicate, five-limit, unresolved IDs.
- Position normalization.
- Resolver with empty, partial, missing, and full catalogs.
- State revision increments only on real changes.
- Staleness transitions.
- Auth token generation, timing-safe comparison, role checks.
- Host/origin validation.

### 14.2 WebSocket integration tests

Use an ephemeral loopback port and a temporary config directory.

- Start host with no Minecraft data; browser receives an empty snapshot.
- Mock publisher connects; hello/welcome; snapshot reaches a browser.
- Browser refresh receives the retained snapshot without a new snapshot.
- Pin/unpin/reorder persists and broadcasts.
- More than five pins rejected.
- Duplicate chapter rejected.
- Unresolved pin survives a catalog reload and restart.
- Sequence gap triggers `host.request_snapshot`.
- Browser sequence/revision gap triggers `state.resync`.
- Overlay mutation rejected.
- Second publisher rejected.
- Disconnect retains stale state; reconnect replaces it.
- Host restart recovers configuration and serves empty state until a new
  snapshot arrives.

### 14.3 Security tests

- Missing/invalid `browserToken` rejected.
- Missing/invalid `minecraftToken` rejected.
- `browserToken` cannot authorise a publisher, and `minecraftToken` cannot
  authorise a browser.
- A valid token connects and reaches the intended role.
- An `overlay`-role connection cannot mutate; a `control`-role connection can.
- Declaring `control` with the browser token succeeds (R1, asserted deliberately).
- A loopback Origin on a non-default port is accepted (accepted risk R2).
- Invalid `Host` header rejected.
- Disallowed Origin rejected.
- Oversized message rejected.
- Mutation rate limit.
- Tokens never logged.
- Corrupt `tokens.json` is backed up and regenerated; the host still starts.
- Invalid `config.json` is preserved and reported, not overwritten.

### 14.4 Test tools

- Small test WebSocket client using `ws`.
- Shared host factory with injected config directory, clock, and timers.
- Reuse `@questbridge/mock-publisher` scenarios.
- No browser test required until Phase 3.

---

## 15. Milestones

Each milestone must be independently testable and committed.

### 2A — Host package and process shell

**Status:** Implemented. `ca24989`.

- Create `packages/host` workspace.
- Add build/test config.
- Start HTTP server on loopback with `/health`.
- Graceful shutdown.
- CLI and configuration of port/config directory.

**Exit:** host builds, starts, reports health, and exits cleanly; tests cover
binding and shutdown.

### 2B — Configuration store and chapter-pin operations

**Status:** Implemented. `e34ee98`.

- Zod config schema and defaults.
- Platform config paths.
- Atomic persistence and invalid-file preservation.
- Pure pin/unpin/reorder operations.
- Tests for limits, duplicates, normalization, and unresolved IDs.

**Exit:** configuration survives restart; invalid config is not overwritten;
five-pin and duplicate rules pass.

### 2C — Chapter resolver and state store

**Status:** Implemented. `9ed93c7`. The resolver lives in `chapter-resolver.ts`;
the pure pin operations are `chapter-pins.ts`.

- Catalog/pin resolution.
- Unresolved entries.
- Revisioned state store.
- Staleness and disconnect transitions.
- Snapshot composition.

**Exit:** state tests cover empty, unresolved, completed, locked, and stale
cases; revisions only move on real changes.

### 2D — Authentication and HTTP security

**Status:** Implemented. `2b94c52`.

- Token generation/storage, plus the `--print-urls` command.
- Token authentication on the WebSocket upgrade; ungated static shell.
- Token-file recovery: back up and regenerate a corrupt `tokens.json`.
- Role enforcement from `browser.hello`, and the Minecraft bearer token.
- Distinguishable `401`/`403` responses.
- `Host` and Origin checks.
- Message and mutation limits.
- Security tests.

**Exit:** missing/invalid tokens fail; valid tokens connect and reach the intended
role; tokens never appear in logs or static output.

### 2E — Minecraft WebSocket session

**Status:** Implemented. `c397afd`. The WebSocket transport and the Minecraft
publisher session were committed together; the browser factory stayed injectable
until 2F.

- `/ws` upgrade and first-message timeout.
- Minecraft hello/session/sequence handling.
- Snapshot/progress/pins/heartbeat ingestion.
- Single-publisher enforcement.
- Stale/disconnect lifecycle.
- Gap-triggered snapshot requests.
- Optional bearer-token support in the mock publisher.

**Exit:** all mock scenarios connect and update host state; reconnects produce a
fresh snapshot; no protocol errors.

### 2F — Browser WebSocket session and mutations

**Status:** Implemented. `263586f`.

- Browser hello and roles.
- Immediate state snapshot.
- Sequence/revision tracking.
- Read-only overlay enforcement.
- Control mutations and persistence.
- Broadcasts and resync.
- Browser refresh behavior.

**Exit:** overlay and control clients can be simulated; pins persist; mutation
errors are correct; refresh gets current state without a Minecraft snapshot.

### 2G — Static serving, integration, and hardening

**Status:** Implemented. `4bee5fc`.

- Static build directory support and placeholders.
- End-to-end host + mock publisher + browser-client tests.
- Log redaction.
- Graceful error handling.
- Documentation and manual verification instructions.

**Exit:** full host test suite passes; manual run with the mock publisher works;
Phase 3 can point a Svelte build at the host without changing the transport.

#### 2G results

Verified on 2026-11-06:

- `npm run build` succeeds for `@questbridge/protocol`,
  `@questbridge/mock-publisher`, `@questbridge/host`, and `web-app`.
- `npm test` passes: 85 protocol, 30 mock-publisher, 225 host, and 2 web-app
  tests (342 total).
- Manual run against a real host on `127.0.0.1:8799`, driven by
  `npm run mock -- --scenario=full --speed=5`:
  - the full scenario reached a browser as `state.update` with 8 chapters and
    the three manual objectives, then ended with the retained state stale;
  - pin, reorder, unpin, and `config.update` all persisted to `config.json`;
  - a sixth pin was refused with `too_many_pins`, a duplicate with
    `duplicate_chapter`, an unknown catalog ID with `unknown_chapter`, a wrong
    reorder set with `invalid_reorder_set`, and unpinning an unpinned ID with
    `not_pinned`;
  - an `overlay`-role connection's mutation was refused with `unauthorized`;
  - a restart reloaded the five stored pins with an empty catalog and
    `disconnected`/`stale`, then resolved them once a publisher sent a
    snapshot;
  - a stored pin absent from the new catalog stayed stored, was reported
    unresolved, and could still be unpinned;
  - an OBS-style refresh received identical pins without a new Minecraft
    snapshot.

Two notes from that run:

- A structural snapshot whose `percentage` was `37.5` was rejected. The
  protocol schema requires an integer percentage, so this is correct
  validation rather than a defect; the manual fixture was corrected to `38`.
- A burst of more than ten mutations per second returns `rate_limited`. Paced
  mutation checks then exercised the real limits. The limiter, not the pin
  rules, was what the first burst hit.

**Known limitation:** `/overlay` and `/control` serve the placeholder until
Phase 3 supplies a static build. The host never fabricates progression to fill
the gap.

---

## 16. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Token-file corruption locks the user out | No browser can connect | Regenerate `tokens.json` and back up the bad file, unlike `config.json` |
| Overlay renders blank on an auth failure | Silent mid-stream failure | Distinguishable `401`/`403` plus an actionable overlay state |
| Web-app used `adapter-node` | Host cannot serve a static bundle | **Resolved:** switched to `adapter-static`, so the build emits real HTML (§5.2) |
| Config corruption | User loses pins | Atomic write, validate-before-save, preserve invalid file |
| Windows permission semantics | `0600` not fully enforceable | Use best-effort mode; restrict directory; document limitation |
| Mutation races | Two dashboards overwrite each other | Serialize mutations; broadcast authoritative config |
| Stale state shown as live | Incorrect overlay | Revisioned state plus stale/disconnected flags |
| Mock success mistaken for real integration | False confidence | Keep mock and real adapter verification separate |
| Sequence/revision gaps | Missed updates | Resync path and explicit tests |
| Token leakage | Local privilege issue | Separate token file, redacted logs, no bundle embedding |

---

## 17. Acceptance criteria

Every criterion below is met. The evidence is the host test suite and the
manual run recorded in §15 under 2G, except where noted.

- [x] `packages/host` builds and tests pass.
- [x] The host binds only to `127.0.0.1`.
- [x] A mock publisher connects and its snapshot reaches a browser client.
- [x] A browser refresh receives the retained state without a new snapshot.
- [x] Chapter pins persist across host restart.
- [x] Pin, unpin, and reorder work; duplicates and six pins are rejected.
- [x] Display settings persist and broadcast after a valid `config.update`.
- [x] Unresolved chapter IDs survive config reload and catalog changes.
- [x] Overlay cannot mutate; control can.
- [x] Invalid versions, roles, sessions, messages, origins, and tokens are
      rejected with the documented errors.
- [x] A corrupt `tokens.json` regenerates; a corrupt `config.json` is preserved.
- [x] An unauthorized upgrade is refused with `401`, distinct from a `403` origin
      or `Host` rejection.
- [x] Stale and disconnected states are represented, not silently shown as live.
- [x] Sequence and revision gaps trigger a resync/snapshot request.
- [x] No tokens or sensitive data appear in logs.
- [ ] Phase 3 can serve the Svelte routes through the host without changing the
      protocol.

The last item is left unchecked deliberately, but its status improved
substantially and the reason for leaving it open is narrower than before.

**Proven end to end:** a real `adapter-static` build is served by the host. With
`--build-dir apps/web-app/build`, `build/index.html` is returned for both routes
byte-identical to the file on disk, `_app/immutable/…` assets resolve with
`max-age=31536000, immutable`, HTML carries `no-store`, and no protocol or
transport change was needed. Route filename resolution is tested for both
prerender layouts (`overlay.html` and `overlay/index.html`). Nothing further is
required of the host for Phase 3.

**Still open:** the `/overlay` and `/control` route components do not exist, so
`/overlay` currently resolves to the root scaffold page through the `index.html`
candidate. The criterion names "the Svelte routes", and serving a scaffold in
their place is not the same thing. It becomes checkable the moment those two
routes exist.

Passing Phase 2 does not complete the UI, the real adapter, or the project
Definition of Done.

---

## 18. First implementation action when approved

Start with 2A only:

1. Create the `packages/host` skeleton and workspace scripts.
2. Add the loopback HTTP server and `/health`.
3. Add graceful shutdown and a configurable port.
4. Add host lifecycle tests.
5. Do not add configuration, WebSocket roles, or authentication until 2A
   passes.

This keeps the first increment small and verifiable.
