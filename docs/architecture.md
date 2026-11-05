# QuestBridge Architecture

**Status:** Partial implementation verified. The repository layout, the npm workspace root with pinned toolchain versions, the exact FTB build dependencies, the baseline Java mod skeleton (NeoForge, compiles against 21.1.250), and the SvelteKit scaffold are implemented; the shared protocol package, mock publisher, host, and FTB Quests adapter are not yet implemented.  **Proposal status:** Proposal A is approved and applied. Proposal C is adopted and Phase 0 is applied. Proposal D is applied. Proposal B remains pending review in `docs/proposals.md`; where a pending proposal affects this document, the current state and the proposed state are noted.  **Date:** 2026-11-06  **Target:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250

QuestBridge is a local streaming companion that reads FTB Quests progression from a running Minecraft client and presents it in an OBS Browser Source. It also provides a separate local dashboard for selecting major chapter milestones.

The architecture keeps three authorities separate:

1. **FTB Quests** owns quest definitions, progress, completion state, and manual quest pins.
2. **The Minecraft adapter** owns translation of live client data into the QuestBridge protocol.
3. **The host** owns local configuration and presentation state.

The frontend never parses FTB data. The host never depends on Minecraft or Java libraries. The Minecraft adapter never knows about Svelte or OBS.

---

## 1. Repository layout

Proposal A is approved and applied. The Java project lives in a dedicated `minecraft-mod/` directory, and the SvelteKit scaffold lives at `apps/web-app/`. The planned `packages/` (protocol, host, mock-publisher) directory does not exist yet; `apps/` contains only the `apps/web-app` scaffold.

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
├── apps/
│   └── web-app/                 # Svelte 5 + SvelteKit scaffold
│       ├── AGENTS.md
│       ├── package.json        # npm-based; not yet in an npm workspace
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── src/
│       │   ├── lib/
│       │   └── routes/
│       └── ...
│
├── docs/
│   ├── architecture.md
│   ├── proposals.md
│   ├── ftb-quests-integration.md
│   └── chapter-pinning.md
│
└── ...
```

**Planned layout (packages and remaining docs not yet implemented):**

```text
questbridge/
├── README.md                    # planned
├── LICENSE                      # planned
├── package.json                 # npm workspace root
├── scripts/                     # planned
│
├── packages/                    # planned
│   ├── protocol/                # shared versioned protocol and schemas
│   ├── host/                    # Node.js host
│   └── mock-publisher/          # protocol-level mock Minecraft publisher
│
├── apps/
│   └── web-app/                 # Svelte 5 overlay and dashboard (scaffold exists)
│
├── docs/
│   ├── architecture.md
│   ├── proposals.md
│   ├── ftb-quests-integration.md
│   ├── chapter-pinning.md
│   ├── protocol.md              # planned
│   ├── development.md           # planned
│   └── troubleshooting.md       # planned
│
└── ...
```

Notes:

- **Implemented:** `minecraft-mod/`, `apps/web-app/`, `docs/` (4 files), `AGENTS.md`, `.gitignore`, root `package.json`, `package-lock.json`, `.nvmrc`.
- **Planned, not yet present:** `README.md`, `LICENSE`, `scripts/`, `packages/` (protocol, host, mock-publisher), `docs/protocol.md`, `docs/development.md`, `docs/troubleshooting.md`.
- `minecraft-mod/` contains the NeoForge client mod skeleton (a single `QuestBridge` mod class). It compiles against NeoForge `21.1.250` with JDK 21 and declares no FTB Quests, FTB Teams, or FTB Library dependencies yet.
- `apps/web-app/` contains the Svelte 5 + SvelteKit scaffold (layout, page, `lib/`, `routes/`, Vitest examples). The `/overlay` and `/control` routes are not yet implemented. It is a standalone npm-based scaffold and is not yet part of an npm workspace.
- No `packages/` and no root-level `package.json` exist yet. The root project plan (AGENTS.md) uses npm workspaces; the scaffold's own `apps/web-app/AGENTS.md` documents npm as its package manager.

The Java project is isolated from the TypeScript packages:

- Java does not import TypeScript code.
- TypeScript does not import Java classes.
- The only contract between them is the versioned WebSocket protocol (planned, not yet implemented).

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
- Capture chapter catalog, progress, quest/task progress, and manual pins.
- Filter out automatic pin ID `1`.
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

### 3.2 Protocol package (planned)

Responsibilities:

- Shared TypeScript types.
- Zod schemas.
- Protocol version constant.
- Message envelope helpers.
- Snapshot and update models.
- Validation helpers shared by host, mock, and frontend.

The Java adapter does not use this package. It must implement the same wire format manually and declare its supported protocol version.

### 3.3 Host (planned)

Responsibilities:

- Bind only to loopback.
- Accept Minecraft publisher connections and browser connections.
- Validate every incoming message.
- Maintain normalized application state.
- Own persistent chapter pin and display configuration.
- Resolve pinned chapter IDs against the live catalog.
- Preserve unresolved configuration entries.
- Broadcast snapshots and incremental updates to browsers.
- Serve the production Svelte build.
- Enforce authentication and origin restrictions.

Non-responsibilities:

- Reading FTB files.
- Depending on Minecraft classes.
- Reimplementing quest progression.
- Allowing browsers to publish progression.

### 3.4 Mock publisher (planned)

Responsibilities:

- Implement the Minecraft-side protocol.
- Simulate the real FTB data lifecycle, not just static fixtures.
- Provide deterministic scenarios for development and tests.
- Exercise unavailable, synchronizing, ready, progress, pin, completion, reload, world-change, team-change, and reconnect behavior.

Mock IDs must be synthetic. Real ATM10 TTS IDs are only used in recorded fixtures after runtime verification.

### 3.5 Svelte frontend (planned)

Two routes:

```text
/overlay   OBS Browser Source
/control   local configuration dashboard
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

The dashboard does not manage FTB quest pins. FTB Quests remains the only quest-pinning interface.

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

### 6.3 Manual objectives

Manual quest pin IDs come from FTB. The host resolves them against the quest catalog.

- Missing quest IDs are exposed as unresolved.
- Completed quests remain present while pinned.
- Automatic pin ID `1` is never exposed as a quest.
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
- When stale, the UI must indicate staleness.
- A full snapshot is required after reconnection.
- A host restart does not require a Minecraft restart; the mod reconnects automatically.
- A browser refresh must not require a Minecraft snapshot.

Suggested timing:

- Mod heartbeat: every 5 seconds.
- Mod reconciliation: every 2 seconds.
- Host stale threshold: 10 seconds without heartbeat.
- Host disconnected threshold: WebSocket closed or 15 seconds without heartbeat.
- Mod reconnect backoff: 1, 2, 4, 8 seconds, capped.

These values are implementation defaults and may be tuned.

---

## 8. Security

The host is local-only. The requirements in this section are target security properties. The specific token and browser-authentication mechanism that implements them is Proposal B, which is pending review and is not final.

Requirements:

- Bind exclusively to `127.0.0.1`.
- Never bind to `0.0.0.0`.
- Validate the HTTP `Host` header against `127.0.0.1` and `localhost`.
- Restrict WebSocket origins.
- Separate permissions for Minecraft, overlay, and dashboard.
- Read-only overlay.
- Dashboard-only configuration changes.
- Validate every message.
- Enforce message-size limits.
- No arbitrary filesystem access.
- No shell execution endpoints.
- No credentials in frontend bundles.
- Redact tokens from logs.

### 8.1 Tokens — Proposal B, pending review

Proposed tokens:

```text
overlayToken    read-only overlay access
controlToken    dashboard read/write access
minecraftToken  Minecraft publisher access
```

Tokens would be random, generated on first run, and persisted in the host configuration with mode `0600`.

### 8.2 Browser authentication — Proposal B, pending review

Proposed flow:

1. OBS or the user opens `/overlay?token=<overlayToken>`.
2. Host validates the token.
3. Host sets an `HttpOnly`, `SameSite=Strict` overlay cookie.
4. Host redirects to `/overlay` without the token in the visible URL.
5. Overlay WebSocket authenticates with the cookie.

The same pattern applies to the dashboard with the control token.

If OBS clears cookies, the original tokenized URL still works.

The page must never embed tokens in JavaScript bundles or rendered HTML.

### 8.3 Minecraft authentication — Proposal B, pending review

The Minecraft adapter would connect with a bearer token or a dedicated header. It would not use browser cookies or origin handling.

### 8.4 Origin rules

- Allow browser connections from the host's own loopback origins.
- Allow native Minecraft connections with no Origin header.
- Reject all other origins.
- Reject cross-origin mutation requests.

### 8.5 Limits

Suggested defaults:

- Maximum WebSocket message: 256 KiB.
- Maximum HTTP request body: 64 KiB.
- Rate limit dashboard mutations.
- Limit concurrent browser connections.

If Proposal B is not adopted, an alternative mechanism must still provide equivalent role separation, loopback-only access, and credential protection before the host is implemented.

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

### 10.1 Overlay

- Transparent background.
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
- Completed pinned quests.
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

- Support transparency.
- Avoid scrollbars.
- Work in Chromium/OBS CEF.
- Recover after refresh.
- Show disconnected and stale states accurately.
- Not require OBS-specific APIs.

Note: the current environment has OBS Studio 33.0.1 for manual verification.

---

## 14. Development and deployment

Implementation order follows Proposal C. Proposal A is approved and applied: the Java project lives in `minecraft-mod/`. Phase 0 (baseline and repository hygiene) is applied: the npm workspace root, pinned toolchain versions, and exact FTB build dependencies are in place.

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

The Java build lives in `minecraft-mod/` and can be compiled independently. The Svelte scaffold in `apps/web-app/` is built with Vite (its own `package.json` uses npm as its package manager).

The shared protocol package, mock publisher, host, and the `/overlay` and `/control` dashboard are planned but not implemented. The root npm workspace exists, so `npm install`, `npm run build`, and `npm test` work; `npm run mock` does not exist yet.

Available now:

```text
npm install
npm run build --workspaces --if-present
npm test --workspaces --if-present
cd minecraft-mod && ./gradlew compileJava
./gradlew dependencies --configuration compileClasspath
```

Planned (for later phases):

```text
npm run mock -- --scenario=basic
```

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
