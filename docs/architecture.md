# QuestBridge Architecture

**Status:** Phase 3 implemented. The repository layout, the npm workspace root with pinned toolchain versions, the exact FTB build dependencies, the client-only Java Stage 4A live FTB probe (NeoForge, compiles against 21.1.250), the Svelte 5 + SvelteKit frontend built as a static site with three real routes, the shared protocol package, the protocol-level mock publisher, and the Phase 2 host core (`packages/host`, milestones 2A–2G) are implemented; the FTB Quests network adapter is not yet implemented. Phase 2 is documented in `docs/phase-2-plan.md`; its final acceptance item — that the host serves the Svelte routes — is now met. Phase 3 is implemented and specified in `docs/web-frontend.md` and `docs/phase-3-plan.md`, with results in the latter's §14. Stage 4A is implemented and verified against the live client; Stage 4B–4F are planned in `docs/phase-4-plan.md`. The target pack is installed locally as a Prism Launcher instance; its identity, exact mod versions, chapter catalog, and FTB API class availability are verified in `docs/ftb-quests-integration.md`.  **Proposal status:** Proposal A is approved and applied. Proposal C is adopted; Phase 0, Phase 1, Phase 2, and Phase 3 are applied. Proposal D is applied. Proposal B was adopted on 2026-11-06 and simplified to two tokens with no cookies; it is specified in `docs/local-authentication.md` and implemented by the host.  **Date:** 2026-11-07  **Target:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250

QuestBridge is a local streaming companion that reads FTB Quests progression from a running Minecraft client and presents it in an OBS Browser Source. It also provides a separate local dashboard for selecting major chapter milestones.

The architecture keeps three authorities separate:

1. **FTB Quests** owns quest definitions, progress, completion state, and manual quest pins.
2. **The Minecraft adapter** owns translation of live client data into the QuestBridge protocol.
3. **The host** owns local configuration and presentation state.

The frontend never parses FTB data. The host never depends on Minecraft or Java libraries. The Minecraft adapter never knows about Svelte or OBS.

---

## 1. Repository layout

Proposal A is approved and applied. The Java project lives in a dedicated `minecraft-mod/` directory, and the Svelte 5 + SvelteKit frontend lives at `apps/web-app/`, built as a static site. Phase 1 added the `packages/protocol` and `packages/mock-publisher` workspace packages. Phase 2 added `packages/host`, which serves the static frontend when `--build-dir` is supplied and a placeholder otherwise. Phase 3 added the `/overlay`, `/control`, and `/` route components.

**Current layout (implemented as of 2026-11-06):**

```text
questbridge/
├── AGENTS.md
├── .gitignore
├── .nvmrc                     # pinned Node version
├── package.json               # npm workspace root
├── package-lock.json
│
├── minecraft-mod/
│   ├── build.gradle
│   ├── gradle.properties        # NeoForge 21.1.250, Minecraft 1.21.1
│   ├── settings.gradle
│   ├── gradlew
│   ├── gradlew.bat
│   ├── gradle/wrapper/
│   ├── src/
│   │   └── main/
│   │       ├── java/xyz/jxcb/ftbquestoverlay/QuestBridge.java
│   │       └── templates/META-INF/neoforge.mods.toml
│   └── TEMPLATE_LICENSE.txt
│
├── packages/
│   ├── protocol/                # @questbridge/protocol
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── schemas.ts
│   │   │   ├── messages.ts
│   │   │   └── version.ts
│   │   └── tests/
│   └── mock-publisher/          # @questbridge/mock-publisher
│       ├── src/
│       │   ├── index.ts         # CLI entry
│       │   ├── client.ts
│       │   ├── collector.ts     # standalone collector CLI
│       │   ├── collector-model.ts
│       │   ├── fixtures.ts
│       │   └── scenarios.ts
│       └── tests/
│
│   └── host/                    # @questbridge/host
│       ├── src/
│       │   ├── index.ts         # CLI entry
│       │   ├── host.ts          # assembly, pin operations, broadcast
│       │   ├── server.ts        # loopback listener and shutdown
│       │   ├── http.ts          # Host validation, /health, routing
│       │   ├── static.ts        # browser routes and the placeholder
│       │   ├── websocket.ts     # upgrade auth and single-publisher rule
│       │   ├── minecraft-session.ts
│       │   ├── browser-session.ts
│       │   ├── state-store.ts
│       │   ├── config-store.ts  # config.json persistence
│       │   ├── config-schema.ts
│       │   ├── chapter-pins.ts  # pure pin/unpin/reorder
│       │   ├── chapter-resolver.ts
│       │   ├── auth.ts          # tokens.json and role resolution
│       │   ├── validation.ts    # origin, body, rate limits
│       │   ├── paths.ts
│       │   ├── constants.ts
│       │   ├── logging.ts       # redacted structured logs
│       │   └── errors.ts
│       └── tests/
│
├── apps/
│   └── web-app/                 # Svelte 5 + SvelteKit, built with adapter-static
│       ├── AGENTS.md
│       ├── package.json        # npm workspace member
│       ├── vite.config.ts      # adapter-static configured here
│       ├── tsconfig.json
│       ├── src/
│       │   ├── lib/
│       │   └── routes/
│       │       ├── +layout.ts  # prerender = true
│       │       └── +layout.svelte
│       └── build/              # generated; served by --build-dir
│
├── docs/
│   ├── architecture.md
│   ├── proposals.md
│   ├── ftb-quests-integration.md
│   ├── chapter-pinning.md
│   ├── protocol.md
│   ├── local-authentication.md
│   ├── web-frontend.md
│   ├── development.md
│   ├── versioning.md
│   ├── phase-2-plan.md
│   ├── phase-4-plan.md
│   └── testing-logs/
│
└── ...
```

**Remaining planned layout (frontend routes not yet implemented):**

```text
questbridge/
├── README.md                    # planned
├── LICENSE                      # planned
├── scripts/                     # planned
│
├── apps/
│   └── web-app/
│       └── src/routes/
│           ├── overlay/         # planned (Phase 3)
│           └── control/         # planned (Phase 3)
│
├── docs/
│   └── troubleshooting.md       # planned
│
└── ...
```

Notes:

- **Implemented:** `minecraft-mod/`, `apps/web-app/` (static build with three routes), `packages/protocol`, `packages/mock-publisher`, `packages/host`, `docs/` (architecture, proposals, FTB integration, chapter pinning, protocol, local authentication, web frontend, development, versioning, Phase 2 and Stage 4 plans), `AGENTS.md`, `.gitignore`, root `package.json`, `package-lock.json`, `.nvmrc`.
- **Planned, not yet present:** `README.md`, `LICENSE`, `scripts/`, `docs/troubleshooting.md`.
- **Planned tree note:** the tree above lists `troubleshooting.md` (a planned
  document) and a `packages/host/src/routes/` directory that were proposed and
  never created. The host has no `routes/` directory because its routing is small
  enough to live in `http.ts`. The planned troubleshooting content currently
  lives in `docs/development.md` §8 and
  `docs/testing-logs/2026-11-07-phase3-overlay.md` §4.
- `packages/protocol` exports the v1 envelope, Zod schemas, models, factories, parsers, and sequence/revision trackers. Its 85 tests cover the contract invariants.
- `packages/mock-publisher` implements the Minecraft side of the protocol with synthetic fixtures and eleven deterministic lifecycle scenarios. It also includes a standalone collector CLI for user testing. Its 30 tests cover fixture requirements, scenario validity and ordering, the normalized collector model, and real WebSocket collector replays.
- `packages/host` implements the Phase 2 host core: loopback HTTP and WebSocket transport, two-token authentication, config and state stores, chapter pin resolution, Minecraft and browser sessions, and static serving with per-file-class caching. Its 232 tests cover the units plus end-to-end runs against the mock publisher.
- `minecraft-mod/` contains the client-only NeoForge Stage 4A live probe. It compiles against NeoForge `21.1.250` with JDK 21, declares the exact FTB Quests, FTB Teams, and FTB Library dependencies, gates on FTB readiness from the client tick, and logs chapter, manual-pin, quest, and task state. It does not publish network messages yet.
- `apps/web-app/` contains the Svelte 5 + SvelteKit frontend, built as a static site with `@sveltejs/adapter-static`. The root `+layout.ts` sets `prerender = true`, so the build emits real HTML that the host serves as opaque files. All three routes (`/`, `/overlay`, `/control`) are implemented and resolve to their own pages in the build; without a build the host serves its placeholder. It is an npm workspace member. See `docs/web-frontend.md`.
- The root `package.json` declares npm workspaces for `packages/*` and `apps/*`; the scaffold's own `apps/web-app/AGENTS.md` documents npm as its package manager.

The Java project is isolated from the TypeScript packages:

- Java does not import TypeScript code.
- TypeScript does not import Java classes.
- The only contract between them is the versioned WebSocket protocol, implemented in `packages/protocol` and documented in `docs/protocol.md`.

Repository hygiene is complete (Phase 0):

- The root `.gitignore` exists and is tracked.
- `minecraft-mod/.gradle/` and `minecraft-mod/build/` are ignored and no longer tracked.
- Pinning npm and declaring the exact FTB build dependencies are applied (Phase 0).

The Java build compiles against NeoForge `21.1.250` with JDK 21 and declares the exact FTB Quests, FTB Teams, and FTB Library dependencies.

---

## 2. System context

```text
                 Minecraft server
                        |
                   FTB Quests
                        |
              synchronized client state
                        |
                        v
                 Minecraft client
                        |
                  QuestBridge mod
                        |
                 local WebSocket
                        |
                        v
                  QuestBridge host
                   Node.js / TS
                        |
          +-------------+-------------+
          |                           |
          v                           v
   local configuration          normalized state
   chapter pins                 + connection status
   display settings                   |
          |                           |
          +-------------+-------------+
                        |
                        v
                   Svelte frontend
                        |
          +-------------+-------------+
          |                           |
          v                           v
   /control dashboard          /overlay OBS source
```

The same client integration works for:

- Single-player integrated servers.
- Remote multiplayer servers.

No server-side mod, Pterodactyl integration, SFTP access, or server filesystem access is required.

---

## 3. Component responsibilities

### 3.1 Minecraft adapter

Responsibilities:

- Detect when FTB Quests client data is available.
- Capture chapter catalog, chapter completion, progress, quest/task progress, and manual pins.
- Filter out automatic pin ID `1`. Auto-pin mode reconstruction is out of MVP scope.
- Detect quest reloads, world changes, team changes, disconnect, and reconnect.
- Publish protocol messages to the local host.
- Reconcile periodically to catch changes that FTB does not expose via events.
- Serialize and transmit outside the Minecraft client thread.

Non-responsibilities:

- Chapter pin selection.
- Display settings.
- Svelte rendering.
- OBS configuration.
- Quest pin mutation.
- Quest completion or reward claiming.

### 3.2 Protocol package (implemented)

`packages/protocol` (`@questbridge/protocol`) provides:

- Shared TypeScript types.
- Strict Zod schemas and cross-field refinements.
- Protocol version constant.
- Message envelope factories, direction-aware parsing, and serialization.
- Sequence and revision trackers.
- Validation helpers shared by host, mock, and frontend.

The Java adapter does not use this package. It must implement the same wire format manually and declare its supported protocol version.

### 3.3 Host (implemented, Phase 2)

`packages/host` (`@questbridge/host`) implements:

- Bind only to loopback.
- Accept Minecraft publisher connections and browser connections.
- Validate every incoming message.
- Maintain normalized application state.
- Own persistent chapter pin and display configuration.
- Resolve pinned chapter IDs against the live catalog.
- Preserve unresolved configuration entries.
- Broadcast snapshots and incremental updates to browsers.
- Serve the production Svelte build, or an explicit placeholder when none exists.
- Enforce authentication and origin restrictions.

Non-responsibilities:

- Reading FTB files.
- Depending on Minecraft classes.
- Reimplementing quest progression.
- Allowing browsers to publish progression.

Chapter pin and display configuration is owned solely by the host. The
Minecraft publisher is the only writer of progression; browsers never write it.

### 3.4 Mock publisher (implemented)

`packages/mock-publisher` (`@questbridge/mock-publisher`) provides:

- The Minecraft-side protocol implementation.
- A simulation of the real FTB data lifecycle, not just static fixtures.
- Deterministic scenarios for development and tests.
- Coverage for unavailable, synchronizing, ready, progress, pin, completion, reload, world-change, team-change, disconnect, stale, and reconnect behavior.
- A standalone loopback-only collector CLI (`npm run collect`) that validates and displays the Minecraft-side data flow for user testing. It is not the host and does not own chapter pins, display settings, or browser connections.

Mock IDs are synthetic. Real ATM10 TTS IDs are only used in recorded fixtures after runtime verification.

### 3.5 Svelte frontend (implemented)

One application, statically built, with two routes:

```text
/overlay   OBS Browser Source (non-interactive)
/control   local chapter-pin selector and display settings (interactive)
```

The overlay contains:

- Major progression from configured chapter pins.
- Current objectives from manual FTB Quests pins.
- Connection and stale-data indicators.

The control dashboard contains:

- Discovered chapter catalog.
- Search.
- Pin/unpin.
- Reordering.
- Maximum-five enforcement.
- Display settings.
- Live overlay preview.

The dashboard selects **chapters**, not quests. It does not manage FTB quest
pins; FTB Quests remains the only quest-pinning interface.

The host never depends on the frontend, and the frontend always depends on the
host. The frontend is a static build (`adapter-static`) that the host serves
without understanding it, and it renders an explicit failure state — never a
blank frame and never inoperative controls — when the host is unreachable, the
token is rejected, or no Minecraft data has arrived. See
`docs/web-frontend.md`.

---

## 4. Data ownership

| Data | Authority | Persistence |
|---|---|---|
| Quest definitions | FTB Quests | FTB/server |
| Quest progress | FTB Quests | FTB/server |
| Manual quest pins | FTB Quests | FTB/server |
| Chapter pin selection | QuestBridge | local host config |
| Display settings | QuestBridge | local host config |
| Connection status | QuestBridge host | in memory |
| Overlay presentation | QuestBridge frontend | derived |

The host must never fabricate progression.

Unavailable progress is `null`, not zero.

---

## 5. Protocol

FTB’s own client-server synchronization is internal, version-specific, and binary (Minecraft custom payloads using `StreamCodec`). QuestBridge does not reuse or tunnel it. The adapter reads FTB’s synchronized in-memory state and publishes this separate JSON contract. See `docs/protocol.md` section 2.2.

All messages use a versioned envelope:

```json
{
  "protocolVersion": 1,
  "type": "state.snapshot",
  "timestamp": "2026-11-06T12:34:56.789Z",
  "sequence": 42,
  "payload": {}
}
```

Rules:

- `protocolVersion` must be supported by both sides.
- Unsupported versions are rejected with a clear error.
- Every incoming payload is validated with Zod.
- Sequence numbers are monotonic per host-to-browser connection.
- A gap in host-to-browser sequence numbers causes the browser to request a resync.
- The Minecraft publisher includes a session ID and sequence numbers so the host can detect reconnects and gaps.
- Binary messages are not used.
- Unknown message types are rejected or ignored explicitly; they must not crash the host.

### 5.1 Minecraft → host

```text
minecraft.hello
minecraft.status
minecraft.snapshot
minecraft.progress
minecraft.pins
minecraft.heartbeat
```

`minecraft.hello` includes:

- Protocol version.
- Mod version.
- Minecraft version.
- NeoForge version.
- FTB Quests version.
- FTB Teams version.
- Client session ID.

`minecraft.snapshot` includes:

- Session ID.
- World/server identity.
- Team ID and optional team name.
- Complete chapter catalog with progress and status.
- Manual pinned quest IDs with automatic ID `1` excluded.
- Resolved quest and task data for those pinned quests only.
- Capture timestamp.

Only pinned objectives are transmitted in full. The mod does not send the entire quest book: ATM10 TTS 2.3.1 has roughly 3,800 quest definitions and sending them all would be wasteful and could exceed message limits.

`minecraft.progress` contains changed chapter progress and changed progress for the currently pinned quests and tasks.

`minecraft.pins` is sent when the manual pin set changes. It contains:

- The current manual pin IDs, with automatic ID `1` excluded.
- Resolved quest and task data for the new pin set.
- Any pinned IDs that could not be resolved against the quest file.

The host replaces its objective set atomically from this message. If a newly pinned quest is missing from the quest file, its ID is preserved and exposed as unresolved rather than dropped.

`minecraft.heartbeat` proves liveness and supports stale detection.

Full snapshots are sent when:

- The mod initially connects to the host.
- FTB quest synchronization completes.
- The quest file reloads.
- The world or server changes.
- The team changes.
- The host reconnects.
- The adapter recovers from an error.

### 5.2 Host → browser

```text
state.snapshot
state.update
chapter.pins.update
config.update
connection.status
```

`state.snapshot` is sent immediately when a browser connects. It contains:

1. Current Minecraft connection status.
2. Latest chapter catalog, if available.
3. Current chapter pin configuration.
4. Current manually pinned objectives.
5. Display configuration.
6. Staleness information.

OBS must never need a new Minecraft snapshot merely because the browser source refreshed.

`state.update` contains only changed sections. The host must not broadcast unchanged state every two seconds.

### 5.3 Dashboard → host

```text
chapter.pin
chapter.unpin
chapter.reorder
config.update
state.resync
```

The browser must never publish Minecraft progression.

### 5.4 Host → Minecraft

```text
host.welcome
host.error
host.request_snapshot
```

`host.welcome` acknowledges protocol compatibility. `host.error` reports version or validation failures. `host.request_snapshot` requests a fresh full snapshot after a gap or recovery event.

---

## 6. Normalized state model

The host maintains one normalized state used by the dashboard and overlay.

Conceptual snapshot:

```typescript
interface AppState {
  revision: number;

  connection: {
    status:
      | "disconnected"
      | "connecting"
      | "connected"
      | "synchronizing"
      | "ready"
      | "error";
    stale: boolean;
    lastSnapshotAt: string | null;
    lastHeartbeatAt: string | null;
    error?: string;
  };

  minecraft: {
    sessionId: string | null;
    worldName?: string;
    dimension?: string;
    teamId?: string;
    teamName?: string;
  };

  chapters: Chapter[];

  // Resolved manual pin objectives only, not the whole FTB quest book.
  quests: Quest[];
  unresolvedPinnedQuestIds: string[];

  chapterPins: ChapterPin[];
  display: DisplayConfig;
}
```

### 6.1 Derived selectors

The frontend derives:

```typescript
getChapterCatalog()
getPinnedChapters()
getChapterProgress(chapterId)
getManuallyPinnedQuests()
getConnectionStatus()
getUnresolvedChapterPins()
getUnresolvedPinnedQuestIds()
```

Selectors must be shared where practical, not duplicated across components.

### 6.2 Chapter pins

Raw chapter pin configuration is stored separately from the chapter catalog.

The host does not delete a configured chapter ID if the catalog no longer contains it. The frontend renders an unresolved entry for that ID.

Chapter completion is FTB’s `TeamData.isCompleted(chapter)`. It is not derived from `progress === 100`: empty, `alwaysInvisible`, and all-optional chapters can report 100 without being completed. The overlay should present completion as the primary chapter state, with progress as secondary information.

Chapter visibility and progression availability are separate properties. `Chapter.isVisible(teamData)` reports whether the chapter is presented (and is false for `alwaysInvisible` chapters or chapters with no visible quests); it must not be used to derive `locked`. FTB has no chapter-level lock API, so availability is derived from chapter start state and quest-level `TeamData.canStartTasks(quest)`.

### 6.3 Manual objectives

Manual quest pin IDs come from FTB. The host resolves them against the quest catalog.

- Missing quest IDs are exposed as unresolved.
- FTB removes a quest from the player’s pin set when the quest completes. The objective normally disappears on completion, and the host must not fabricate a retained completed objective.
- Automatic pin ID `1` is never exposed as a quest. Auto-pin mode is out of MVP scope; only the ID filter is required.
- The source does not expose pin ordering; a deterministic fallback is used.

---

## 7. Connection lifecycle

```typescript
type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "synchronizing"
  | "ready"
  | "error";
```

Handled events:

- Minecraft startup.
- World loading.
- Single-player connection.
- Multiplayer connection.
- FTB quest synchronization.
- Translation synchronization.
- Quest reload.
- Team change.
- Server disconnect.
- World change.
- Host restart.
- OBS browser refresh.
- Network interruption.

Rules:

- The overlay must not present stale progression as live.
- The host may retain the latest snapshot internally.
- A stale state is **not** marked visibly on the overlay; the overlay fades out
  on disconnection instead. The thresholds are raised (20 s stale, 30 s
  disconnected) so that only a publisher that has genuinely gone away is
  affected. See `docs/web-frontend.md` §3.4.
- A full snapshot is required after reconnection.
- A host restart does not require a Minecraft restart; the mod reconnects automatically.
- A browser refresh must not require a Minecraft snapshot.

Suggested timing:

- Mod heartbeat: every 5 seconds.
- Mod reconciliation: every 2 seconds.
- Host stale threshold: 20 seconds without heartbeat.
- Host disconnected threshold: WebSocket closed or 30 seconds without heartbeat.
- Mod reconnect backoff: 1, 2, 4, 8 seconds, capped.

These values are implementation defaults and may be tuned.

The thresholds are deliberately loose against a 5 s heartbeat. They are sized to
detect a publisher that has genuinely gone away — a crash, or a switch of game,
world, or server — not to react to a deferred update or a momentary stutter. The
overlay is on stream, so a threshold that fired on a two-second hiccup would
create the visible problem it was meant to describe. A closed socket is still
acted on immediately; only the heartbeat-age path is this lenient.

---

## 8. Security

The host is local-only. Proposal B was adopted on 2026-11-06 and simplified to two tokens with no cookies. The normative design, including the accepted risks below, is `docs/local-authentication.md`.

Requirements:

- Bind exclusively to `127.0.0.1`.
- Never bind to `0.0.0.0`.
- Validate the HTTP `Host` header against `127.0.0.1` and `localhost`.
- Restrict WebSocket origins to loopback hostnames, matching the hostname only and ignoring the port (accepted risk R2).
- Separate the Minecraft publisher transport from the browser transport by credential.
- Read-only overlay.
- Dashboard-only configuration mutations.
- Validate every message.
- Enforce message-size limits.
- No arbitrary filesystem access.
- No shell execution endpoints.
- No credentials in frontend bundles, served HTML, or logs.
- Redact tokens from logs.

Accepted risks, stated plainly and not to be tightened without an explicit product decision:

- **R1** — The browser token does not distinguish `overlay` from `control`. Any browser connection may declare `control` and gain write access. The overlay/control split is a UI convention enforced by the UI having no mutation controls, not a security boundary.
- **R2** — Origin allowlisting ignores the port, so any page served from a loopback hostname may connect given a token.

These follow from the product being a private, single-user, loopback-only application that prioritises speed and ease of use over defence in depth.

### 8.1 Tokens

Two tokens exist, one per real trust boundary:

```text
browserToken    read state; declare either browser role
minecraftToken  publish Minecraft state and progression
```

The role split was dropped because R1 makes the two browser tokens interchangeable: it would have advertised a boundary that is not enforced, which is worse than no control because it changes user behaviour without changing risk. `minecraftToken` is kept because it stops an arbitrary local process from injecting fabricated quest progression, and it costs a human nothing since it is configured once in the adapter and never typed. The two routes `/overlay` and `/control` are unaffected and both remain.

Tokens are 256-bit random values generated on first run and persisted in a dedicated `tokens.json` with mode `0600`, separate from `config.json`. They are compared with a timing-safe comparison, printed only to stdout by `--print-urls`, and never appear in served HTML, JavaScript bundles, or logs.

Unlike `config.json`, which fails closed and is never overwritten when invalid, a corrupt `tokens.json` is backed up and regenerated, so a damaged token file cannot lock the user out permanently.

### 8.2 Browser authentication

There are no cookies and no login redirect.

1. OBS or the user opens `/overlay?token=<browserToken>`.
2. The host serves the static application shell. Page requests are not gated: the shell contains no state or credentials, and serving it lets the real UI render a legible authorization-failure message instead of a bare `401` body.
3. The page reads the token from its own `location.search` and appends it to the WebSocket URL.
4. The host validates the token on the WebSocket upgrade — the single authentication checkpoint — and establishes the role from `browser.hello`.

`Referrer-Policy: no-referrer` is set on the pages so the tokenized URL does not leak through a referrer. Because the token lives in the URL, an OBS refresh or CEF profile reset re-authenticates with no stored state, so there is no session to expire mid-stream.

An authorization rejection is distinguishable from absent data, and the overlay renders a visible, actionable state rather than a blank frame; see `docs/local-authentication.md` §6.

### 8.3 Minecraft authentication

The Minecraft adapter connects with the dedicated `minecraftToken` as a bearer token or dedicated header. It does not use browser mechanisms or origin handling.

### 8.4 Origin rules

- Allow browser connections whose `Origin` has a loopback hostname, on any port (R2).
- Allow native Minecraft connections with no `Origin` header only with a valid `minecraftToken`.
- Reject all other origins.
- Reject cross-origin mutation requests.

### 8.5 Limits

Defaults:

- Maximum WebSocket message: 256 KiB.
- Maximum HTTP request body: 64 KiB.
- Rate limit dashboard mutations: 10 per second per connection.
- Limit concurrent browser connections: 20 new per minute.

---

## 9. Host configuration

Configuration is owned by the host and persisted independently of Minecraft state.

Example:

```json
{
  "version": 1,
  "server": {
    "port": 8765
  },
  "chapterPins": {
    "maxPins": 5,
    "pinnedChapters": [
      { "chapterId": "3B0302DB5E77C3A2", "position": 0 },
      { "chapterId": "28BCA5042050B140", "position": 1 },
      { "chapterId": "67E7552FDA3245F5", "position": 2 },
      { "chapterId": "634794CB36D61302", "position": 3 },
      { "chapterId": "571D32BADC77CDD0", "position": 4 }
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

The example uses real ATM10 TTS IDs for clarity. The application must not seed these automatically.

Persistence requirements:

- Atomic writes.
- File permissions `0600` where supported.
- Preserve configuration across Minecraft restart, host restart, world change, and modpack update.
- Preserve unresolved chapter IDs.
- Migrate older config versions explicitly.
- Never silently delete user configuration.

---

## 10. Frontend architecture

The frontend is **one application with two routes**, not two applications, and
it is built as a **static site** that the host serves as opaque files. The
normative description — including the chapter-versus-quest rule, the dependency
direction, the build-output contract, and the failure states — is
`docs/web-frontend.md`. This section summarises it.

### 10.0 Dependency direction and packaging

- **The host never depends on the frontend.** It serves a directory of files; it
  does not import Svelte, parse a manifest, or call application code, and it
  builds and runs with the frontend absent.
- **The frontend depends on the host.** It is a shell that either connects to
  the host's authenticated WebSocket or explains why it cannot.
- The app uses `@sveltejs/adapter-static` and **not** `adapter-node`, because the
  host is a plain static file server and `adapter-node` generates HTML per
  request rather than emitting `.html` files.

One app rather than two, because `/control` must embed a live overlay preview
and both routes share the protocol client, connection lifecycle, and selectors.
SvelteKit code-splits per route, so the overlay loads no dashboard code.

### 10.0.1 Chapters, not quests

> The `/control` selector selects **chapters**. It never selects quests.

Chapter pins belong to QuestBridge; quest pins belong to FTB Quests. The
dashboard manages the former and only *reads* the latter. It must not offer any
quest-selection or quest-pinning interface (`AGENTS.md` §2.4, §10.2).

### 10.1 Overlay

- Solid key background for OBS chroma keying, with no UI colour in the active
  key's family.
- No scrollbars.
- Compact typography.
- Thin progress bars.
- Muted secondary labels.
- No external fonts or assets.
- No quest-selection controls.
- No automatic filling of empty chapter slots.
- No automatic display of every discovered chapter.

Sections:

1. Major progression from chapter pins.
2. Current objectives from manual FTB Quests pins.

The overlay must never render as a blank frame: a disconnected, unauthorized, or
stale state is presented explicitly (`docs/web-frontend.md` §3).

### 10.2 Dashboard

Main purpose: chapter pin management.

Chapter catalog:

- Search.
- Title.
- Subtitle where available.
- Progress.
- Status.
- Pin/unpin action.
- Already-pinned indication.
- Maximum-five enforcement.

Chapter pins:

- Ordered list.
- Manual reordering.
- Unpin.
- Unresolved indication.
- Live preview.

Settings:

- Chapter progress visibility.
- Task counter visibility.
- Completed quest visibility.
- Completion animation.
- Compact mode.
- Overlay preview.

No quest pin management.

Mutation controls must not appear usable when they cannot work: while
disconnected, unauthenticated, or before the first snapshot they are disabled
with a stated reason, and host error codes are surfaced rather than collapsed
into a generic failure (`docs/web-frontend.md` §3.3).

### 10.3 State management

- Host is authoritative for configuration.
- Minecraft adapter is authoritative for quest progression.
- Svelte components consume normalized state.
- Progression calculations are not duplicated in components.

---

## 11. Mock lifecycle

Mock mode must reproduce the FTB data lifecycle, not just display fixtures.

Required scenarios:

- Initial unavailable state.
- Hello and status.
- Quest synchronization.
- Full snapshot.
- Chapter catalog.
- Manual pins.
- Chapter progress.
- Task progress.
- Pin changes.
- Progress updates.
- Quest completion.
- Quest reload.
- World change.
- Team change.
- Disconnect.
- Reconnection.
- Stale heartbeat.

Fixtures should include:

- At least six chapters.
- At least ten quests.
- Multiple task types.
- Optional quests.
- Optional tasks.
- Locked quests.
- Completed quests.
- Numeric task progress.
- Tasks without numeric progress.
- Manually pinned quests.
- Chapter progress.

The mock must be deterministic so tests are reproducible.

UI fixtures, protocol-level mock data, and real Minecraft integration are three distinct testing layers. Mock success does not prove FTB compatibility.

---

## 12. Testing strategy

### Protocol tests

- Valid snapshot accepted.
- Invalid snapshot rejected.
- Unsupported protocol version rejected.
- Sequence ordering and gap detection.
- Missing progress treated as `null`.
- Duplicate IDs rejected where required.
- Invalid chapter pin configuration rejected.
- More than five chapter pins rejected.

### Host tests

- Minecraft connection lifecycle.
- Browser connection lifecycle.
- Snapshot broadcasting.
- Incremental update behavior.
- Configuration persistence.
- Chapter pinning.
- Chapter unpinning.
- Chapter reordering.
- Duplicate chapter prevention.
- Missing chapter detection.
- Catalog reload.
- Stale pin handling.
- Host restart recovery.
- Token and origin enforcement.

### Frontend tests

- Empty catalog.
- Empty pin list.
- One through five pinned chapters.
- Exactly five maximum.
- Reordering.
- Unpinning.
- Unresolved chapters.
- Completed chapters.
- Locked chapters.
- Manual quest pins.
- Completion-driven pin removal (FTB unpins a completed quest).
- Task progress.
- Disconnected state.
- Stale state.
- Browser refresh.

### Minecraft integration tests

- Data unavailable during startup.
- Data available after synchronization.
- Chapter catalog extraction.
- Chapter progress extraction.
- Manual pin extraction.
- Automatic pins excluded.
- Task progress changes.
- Quest completion.
- Team progression.
- Single-player.
- Multiplayer.
- Disconnect.
- Reconnect.
- World change.
- Quest reload.

---

## 13. OBS integration

Production frontend served by the local host.

Defaults:

```text
Overlay:   http://127.0.0.1:8765/overlay
Dashboard: http://127.0.0.1:8765/control
```

Suggested starting OBS configuration:

```text
Source: Browser
Width: 380
Height: 650
FPS: 30
Shutdown source when not visible: Disabled
Refresh browser when scene becomes active: Disabled
```

The overlay must:

- Support chroma keying.
- Avoid scrollbars.
- Work in Chromium/OBS CEF.
- Recover after refresh.
- Show disconnected and stale states accurately.
- Not require OBS-specific APIs.

Note: the current environment has OBS Studio 33.0.1 for manual verification.

---

## 14. Development and deployment

Implementation originally followed Proposal C. Proposal A is approved and applied: the Java project lives in `minecraft-mod/`. Phase 0 (baseline and repository hygiene) and Phase 1 (protocol and mock publisher) are applied. Phase 4 (Minecraft adapter) was started first by explicit product decision and is planned in `docs/phase-4-plan.md`. Stage 4A (the client-only live probe) is implemented, builds, and is verified against the live client. Stage 4B–4F are pending. Phase 2 (host core) is implemented through milestone 2G, as documented in `docs/phase-2-plan.md`, and Phase 3 (the Svelte UI) is implemented as documented in `docs/phase-3-plan.md`. The Minecraft adapter plan was rewritten on 2026-11-07 to reflect the finished host and frontend; Stage 4B is the next milestone.

Current build state, verified 2026-11-06:

```text
minecraft-mod$ ./gradlew compileJava
BUILD SUCCESSFUL (compileJava UP-TO-DATE)

minecraft-mod$ ./gradlew dependencies --configuration compileClasspath
+--- dev.ftb.mods:ftb-quests-neoforge:2101.1.30
+--- dev.ftb.mods:ftb-teams-neoforge:2101.1.10
+--- dev.ftb.mods:ftb-library-neoforge:2101.1.35
```

The NeoForge baseline compiles against `21.1.250` with JDK 21. The build declares the exact FTB Quests `2101.1.30`, FTB Teams `2101.1.10`, and FTB Library `2101.1.35` dependencies as `compileOnly` plus `localRuntime`, matching ATM10 TTS 2.3.1.

The Java build lives in `minecraft-mod/` and can be compiled independently. The Svelte frontend in `apps/web-app/` is built with Vite and `@sveltejs/adapter-static`, producing a static site in `apps/web-app/build` (its own `package.json` uses npm as its package manager).

The shared protocol contract is documented in `docs/protocol.md` and implemented in `packages/protocol`. The protocol-level mock publisher in `packages/mock-publisher` implements the Minecraft side of that contract. The host is implemented in `packages/host` through Phase 2 milestone 2G, and the frontend routes through Phase 3. The host serves a real static build when `--build-dir` is given and its placeholder otherwise. The root npm workspace exists, so `npm install`, `npm run build`, and `npm test` work, and `npm run mock` and `npm run host` start their respective CLIs.

Phase 1 verification on 2026-11-06:

- `npm run build` passes for `@questbridge/protocol`, `@questbridge/mock-publisher`, and `web-app`.
- `npm test` passed 85 protocol tests, 30 mock-publisher tests, and the 2 existing web-app scaffold tests at that point.
- The collector tests prove the normalized model and the full scenario lifecycle over a real WebSocket, including disconnect and reconnect.
- `node packages/mock-publisher/dist/index.js --scenario full --speed=5` was smoke-tested against the standalone collector CLI.

Phase 2 verification on 2026-11-06 (milestone 2G):

- `npm run build` passes for all four workspaces, including `@questbridge/host`.
- `npm test` passed 85 protocol, 30 mock-publisher, 232 host, and 2 web-app tests (349 total) at that point; the current total is given in §14.
- Manual run: the host on `127.0.0.1:8799` and `npm run mock -- --scenario=full` reached a browser with the catalog and manual objectives; pin, reorder, unpin, and display updates persisted to `config.json`; the pin cap, duplicate, unknown-chapter, wrong-reorder-set, unpinned-id, and overlay-mutation refusals each returned their documented code; and a restart reloaded the stored pins before resolving them against a new snapshot.
- The full results, including two non-defects found during the manual run, are in `docs/phase-2-plan.md` §15 under 2G.

Phase 2 follow-up on 2026-11-06 (static serving hardening and build target):

- `Cache-Control` is now set per file class: `_app/immutable/…` is immutable for a year, HTML is `no-store`, everything else revalidates.
- Route resolution accepts both `overlay/index.html` and `overlay.html`, so the frontend's `trailingSlash` choice needs no coordination with the host.
- The web-app switched from `adapter-node` to `adapter-static`. Verified against the running host: `/_app/immutable/…` serves `max-age=31536000, immutable`, and `/overlay` returns the real prerendered page, byte-identical to `build/index.html`, with `cache-control: no-store`.

Available now:

```text
npm install
npm run build
npm test
npm run host
npm run host -- --print-urls
npm run host -- --build-dir apps/web-app/build
npm run collect
npm run mock -- --scenario=ready
npm run mock -- --scenario=progress --speed=2
npm run mock -- --list
cd minecraft-mod && ./gradlew compileJava
./gradlew dependencies --configuration compileClasspath
```

The web-app uses Vitest browser mode. On a fresh machine, install its Chromium binary once before running the full test suite:

```text
npx playwright install chromium
```

`npm run host` starts the production host at `http://127.0.0.1:8765`; `npm run mock -- --scenario=ready --token=<minecraftToken>` feeds it. `npm run collect` starts the standalone collector, which remains a development tool with no configuration, authentication, or browser roles.

---

## 15. Non-goals

The architecture does not include:

- Server-side Minecraft mods.
- Pterodactyl integration.
- SFTP integration.
- Cloud services.
- User accounts.
- Remote databases.
- Quest completion or reward claiming.
- Inventory inspection.
- Automated gameplay.
- Automatic quest suggestions.
- Automatic chapter selection.
- Independent quest dependency solving.
- A replacement for the FTB Quests GUI.
- A second quest-pinning mechanism.
