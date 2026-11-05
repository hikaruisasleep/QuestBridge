# QuestBridge
## AGENTS.md

**Project:** QuestBridge  
**Purpose:** FTB Quests progression observer and OBS overlay  
**Initial target:** ATM10 To The Sky  
**Minecraft:** 1.21.1  
**Modloader:** NeoForge  
**Minecraft integration:** Java  
**Companion host:** Node.js + TypeScript  
**Frontend:** Svelte 5 + TypeScript + Vite  
**Package manager:** pnpm  
**Deployment:** Local desktop application

---

# 1. PROJECT MISSION

QuestBridge is a local streaming companion that reads FTB Quests progression from a running Minecraft client and presents it in a dedicated OBS Browser Source.

It consists of two independent progression displays.

### A. Major progression

A configurable overview of up to five pinned chapters.

The user selects chapters through the QuestBridge dashboard.

These chapter pins represent long-term pack progression.

### B. Current objectives

A dynamic checklist sourced from the player's manually pinned FTB Quests.

The user manages these objectives through the native FTB Quests interface inside Minecraft.

These quest pins represent short-term goals.

The two systems must remain independent.

**FTB Quests remains the source of truth for quest data and progression. QuestBridge manages only the presentation and selection of major chapter milestones.**

The application must support both multiplayer and single-player.

It must not require server-side modifications, Pterodactyl API access, or access to the server filesystem.

---

# 2. PRODUCT REQUIREMENTS

## 2.1 Chapter pins

The application must provide a dashboard interface for selecting up to five chapters from the discovered FTB Quests chapter catalog.

Requirements:

- Maximum five pinned chapters.
- Manual chapter selection.
- Manual ordering.
- Pinning and unpinning.
- Persistent configuration.
- Chapter titles obtained from FTB Quests.
- Chapter progress obtained from FTB Quests.
- Missing chapter detection.
- Unresolved chapter indication.
- No automatic chapter selection.
- No dependency on the currently open quest-book chapter.

The overlay must display exactly the configured chapter pins.

It must not automatically fill empty positions.

An empty chapter-pin configuration should produce an empty or appropriately configured progression section, not fabricated chapter entries.

For ATM10 TTS, the expected initial selections are:

1. Starting Out
2. The Cool Parts
3. AllTheModium
4. The ATM Star
5. Creative Items

These are suggested initial selections, not hardcoded requirements.

Verify actual chapter IDs against the installed modpack.

The application must remain usable with other FTB Quests modpacks without code changes.

## 2.2 Quest pins

The objective checklist must use manually pinned FTB Quests.

The dashboard must not implement a second quest-selection system.

Requirements:

- Read manual quest pin identifiers.
- Display pinned quest titles.
- Display quest completion state.
- Display task completion counts.
- Display numeric task progress when available.
- Preserve pin ordering when the source exposes it.
- Reflect pinning and unpinning automatically.
- Keep completed pinned quests visible while they remain pinned.
- Handle unresolved pinned quest IDs.
- Handle chapter or quest reloads.

Automatic FTB Quests pins must not be included in the manual objective list unless explicitly enabled in a future feature.

Investigate the actual installed FTB Quests implementation to determine how manual and automatic pins are represented.

## 2.3 Visual requirements

The overlay should be minimal.

Characteristics:

- Transparent background.
- Compact typography.
- Thin progress bars.
- Muted secondary labels.
- Clear completion indicators.
- Minimal borders.
- No elaborate Minecraft-themed textures.
- No unnecessary decorative panels.
- No external assets or fonts.
- Readable over Minecraft gameplay.

The chapter section and objective section must be visually distinct.

The overlay must work independently of the control dashboard.

## 2.4 Non-goals

Do not implement:

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
- A second quest pinning mechanism.

---

# 3. TECHNOLOGY STACK

## Minecraft

- Java.
- NeoForge.
- Minecraft 1.21.1.
- FTB Quests.
- FTB Teams.
- Gradle.

Use the exact dependency versions installed in the target ATM10 TTS instance.

Do not blindly use the latest standalone FTB Quests release.

## Companion host

- Node.js.
- TypeScript.
- WebSocket (`ws`).
- Zod.
- Lightweight HTTP server.
- Vitest.

## Frontend

- Svelte 5.
- TypeScript.
- Vite.
- CSS.
- Vitest.

Use pnpm workspaces.

Keep the Java project separate from the TypeScript workspace.

Share TypeScript protocol definitions between the host and frontend.

---

# 4. SYSTEM ARCHITECTURE

```text
             MINECRAFT SERVER
                    |
                    |
               FTB Quests
                    |
            Synchronized state
                    |
                    v
             MINECRAFT CLIENT
                    |
                    |
             QuestBridge Mod
                    |
              Local WebSocket
                    |
                    v
             QUESTBRIDGE HOST
                 Node.js
                    |
          +---------+----------+
          |                    |
          v                    v
     FTB DATA             LOCAL CONFIG
          |                    |
          |              Chapter pins
          |              Display settings
          |                    |
          +---------+----------+
                    |
                    v
               SVELTE UI
                    |
                    v
            OBS BROWSER SOURCE
```

The Minecraft mod extracts and publishes FTB Quests information.

The host maintains normalized state and local configuration.

The frontend presents the combined state.

The frontend must not directly parse FTB Quests data.

The host must not depend on Minecraft Java libraries.

The Minecraft adapter must not know anything about Svelte or OBS.

## 4.1 Multiplayer and single-player

The same client integration must support:

- Remote multiplayer servers.
- Single-player integrated servers.

Read synchronized in-memory client data.

Do not use saved quest files as the primary source of live progression.

The application must detect world changes, server changes, disconnections, and quest reloads.

---

# 5. REPOSITORY STRUCTURE

Use a monorepo.

```text
questbridge/
├── AGENTS.md
├── README.md
├── LICENSE
├── .gitignore
│
├── packages/
│   ├── protocol/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── schemas.ts
│   │       ├── messages.ts
│   │       └── version.ts
│   │
│   └── host/
│       ├── src/
│       │   ├── index.ts
│       │   ├── server.ts
│       │   ├── websocket.ts
│       │   ├── state-store.ts
│       │   ├── config-store.ts
│       │   ├── chapter-resolver.ts
│       │   ├── validation.ts
│       │   └── routes/
│       └── tests/
│
├── apps/
│   └── web-app/
│       ├── src/
│       │   ├── lib/
│       │   │   ├── api/
│       │   │   ├── stores/
│       │   │   ├── components/
│       │   │   ├── types/
│       │   │   └── utils/
│       │   ├── routes/
│       │   │   ├── overlay/
│       │   │   └── control/
│       │   ├── app.css
│       │   └── main.ts
│       └── tests/
│
├── minecraft-mod/
│   ├── build.gradle
│   └── src/
│
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   ├── ftb-quests-integration.md
│   ├── chapter-pinning.md
│   ├── development.md
│   └── troubleshooting.md
│
└── scripts/
```

Adjust the structure when justified, but preserve clear component boundaries.

---

# 6. FTB QUESTS INTEGRATION

This is the highest-risk technical component.

Do not invent API signatures.

Before implementation:

1. Identify the installed ATM10 TTS version.
2. Identify the installed NeoForge version.
3. Identify FTB Quests version.
4. Identify FTB Teams version.
5. Inspect installed mod JARs.
6. Inspect source JARs if available.
7. Otherwise inspect bytecode and mappings.
8. Verify client-side quest access.
9. Verify team progression access.
10. Verify manual pin access.
11. Verify chapter progress calculations.
12. Verify task progress calculations.

Document findings in:

`docs/ftb-quests-integration.md`

Investigate these starting points where available:

```java
FTBQuestsClient.getClientQuestFile()
FTBQuestsClient.getClientPlayerData()
```

Also investigate:

- `ClientQuestFile`
- `selfTeamData`
- Team progression.
- Player-specific pin data.
- Chapter-relative progress.
- Quest-relative progress.
- Task-relative progress.
- Quest dependencies.
- Optional quests.
- Optional tasks.
- Quest visibility.
- Synchronization events.
- Reload behavior.

These are investigation targets, not guaranteed APIs.

## 6.1 Team progress and player pins

Treat team progression and personal pin selection as separate information.

Team progression may be shared between multiple players.

Manual quest pins may belong to individual player data.

The adapter must combine the correct team progress with the current player's manual pins.

Verify this behavior against the actual installed version.

## 6.2 Manual versus automatic pins

FTB Quests has native automatic tracking.

The initial QuestBridge checklist must consume manually pinned quests only.

Investigate:

- Manual pin identifiers.
- Automatic pin identifiers.
- Special automatic tracker IDs.
- Pin ordering.
- Auto-pin settings.
- Tracker visibility settings.

Do not accidentally interpret automatically generated quests as manual pins.

If manual pins cannot be reliably distinguished, document the limitation.

Do not substitute QuestBridge-managed quest selections.

## 6.3 Chapter discovery

Discover the complete chapter catalog from FTB Quests.

A chapter entry should contain:

- Stable chapter ID.
- Display name.
- Description where available.
- Ordering metadata where available.
- Relative progress.
- Completion state.
- Availability state.

Chapter IDs must be opaque strings in the application protocol.

Never use chapter names as identifiers.

Do not assume that every chapter is available or visible.

Do not infer the five most important chapters automatically.

The user decides which chapters to pin.

## 6.4 Chapter progress

Prefer FTB Quests' own chapter progress calculation.

Investigate how it handles:

- Optional progression quests.
- Hidden quests.
- Locked quests.
- Incomplete dependencies.
- Empty chapters.
- Multiple quest categories.
- Completed chapters.

Do not silently substitute a simple quest count if FTB exposes an authoritative relative-progress value.

If the source calculation is unavailable, document the fallback calculation and its limitations.

Unavailable progress must be `null`, not an invented zero.

---

# 7. DATA MODEL

All IDs are strings.

The frontend must consume normalized data, not raw Java object representations.

## 7.1 Chapter

```typescript
interface Chapter {
  id: string;
  title: string;
  description?: string;
  order: number;
  progress: number | null;
  status:
    | "available"
    | "locked"
    | "completed"
    | "unknown";
}
```

## 7.2 Chapter pins

```typescript
interface ChapterPin {
  chapterId: string;
  position: number;
}

interface ChapterPinConfig {
  pinnedChapters: ChapterPin[];
  maxPins: 5;
}
```

Invariants:

- `maxPins` is always 5.
- A chapter may appear only once.
- Positions must be unique.
- Positions must be normalized after reorder operations.
- The selected chapter order is controlled by local configuration.
- Unresolved IDs remain stored.
- Missing chapters must not be silently substituted.
- Fewer than five pins are valid.

## 7.3 Quest

```typescript
interface Quest {
  id: string;
  chapterId: string;
  title: string;
  description?: string;
  optional: boolean;
  hidden: boolean;
  dependencies: string[];
  tasks: Task[];
  progress: QuestProgress;
}
```

## 7.4 Task

```typescript
interface Task {
  id: string;
  type: string;
  title?: string;
  optional: boolean;
  progress: TaskProgress;
}
```

## 7.5 Progress

```typescript
type QuestStatus =
  | "locked"
  | "available"
  | "in_progress"
  | "completed"
  | "unknown";

interface QuestProgress {
  status: QuestStatus;
  completedTasks: number;
  totalRequiredTasks: number;
  percentage: number | null;
}

interface TaskProgress {
  status:
    | "incomplete"
    | "in_progress"
    | "completed"
    | "unknown";

  current?: number;
  target?: number;

  percentage: number | null;
  unit?: string;
}
```

Do not fabricate numeric progress when the source does not expose it.

Optional tasks must not prevent a quest from being marked completed.

---

# 8. HOST CONFIGURATION

The host owns persistent chapter pin configuration.

Example:

```json
{
  "version": 1,
  "chapterPins": {
    "maxPins": 5,
    "pinnedChapters": [
      {
        "chapterId": "example-id-1",
        "position": 0
      },
      {
        "chapterId": "example-id-2",
        "position": 1
      }
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

This is an illustrative schema.

The actual IDs must originate from FTB Quests.

Persist configuration independently of Minecraft state.

Configuration must survive:

- Minecraft restart.
- Host restart.
- World changes.
- Modpack updates.

If a chapter ID is missing after an update, preserve the configuration entry and report it as unresolved.

Do not silently delete user configuration.

## 8.1 Chapter pin operations

Implement host operations for:

- Pin chapter.
- Unpin chapter.
- Reorder chapters.
- Read chapter pin configuration.

Reject:

- Duplicate chapter pins.
- More than five pins.
- Invalid positions.
- Unknown operation types.

The dashboard should receive the updated configuration after each successful change.

---

# 9. WEBSOCKET PROTOCOL

Create a versioned protocol shared by host and frontend.

All messages must include:

- Protocol version.
- Message type.
- Timestamp.
- Sequence number where appropriate.
- Payload.

Suggested message types:

### Minecraft to host

```text
minecraft.hello
minecraft.snapshot
minecraft.progress
minecraft.pins
minecraft.status
minecraft.heartbeat
```

### Host to browser

```text
state.snapshot
state.update
chapter.catalog
chapter.pins.update
connection.status
config.update
```

### Dashboard to host

```text
chapter.pin
chapter.unpin
chapter.reorder
config.update
```

The browser must not publish Minecraft progression.

Validate all incoming data using Zod.

Reject unsupported protocol versions.

## 9.1 Initial connection behavior

When a browser client connects, immediately provide:

1. Current Minecraft connection status.
2. Latest quest snapshot, if available.
3. Complete chapter catalog.
4. Current chapter pin configuration.
5. Current manually pinned quests.
6. Display configuration.

OBS refreshes must not require a new Minecraft snapshot.

## 9.2 Update behavior

Send a full snapshot when:

- Minecraft initially connects.
- Quest synchronization completes.
- The world changes.
- The server changes.
- The host reconnects.
- Quest definitions reload.
- A recovery snapshot is needed.

Send incremental updates for ordinary progression changes.

Use sequence numbers to detect missing or out-of-order updates.

Do not transmit unchanged data every game tick.

---

# 10. SVELTE APPLICATION

Use Svelte 5 and TypeScript.

Two routes are required.

## 10.1 `/overlay`

The OBS Browser Source.

Contains two sections:

**Major progression**

- Displays configured chapter pins.
- Displays chapter names.
- Displays chapter progress.
- Displays completion state.
- Displays unresolved chapter state.
- Preserves dashboard-defined ordering.

**Current objectives**

- Displays manually pinned FTB Quests.
- Displays quest titles.
- Displays quest completion.
- Displays task completion counts.
- Displays numeric task progress where available.

The overlay must not contain quest-selection controls.

It must not automatically populate empty chapter slots.

It must not show every discovered chapter.

It must not require the control dashboard to be open.

## 10.2 `/control`

The local configuration dashboard.

Its main purpose is chapter pin management.

### Chapter catalog

Display discovered FTB Quests chapters.

Provide:

- Search.
- Chapter name.
- Chapter description.
- Current progress.
- Completion state.
- Pin/unpin action.
- Indication when already pinned.

### Chapter pins

Display currently pinned chapters.

Provide:

- Manual reordering.
- Unpinning.
- Current position.
- Live preview of the resulting overlay.

When five slots are occupied, disable additional pinning until an existing pin is removed.

### General settings

Provide:

- Chapter progress visibility.
- Task counter visibility.
- Completed quest visibility.
- Completion animation.
- Compact mode.
- Overlay preview.

Do not implement quest pin management in the dashboard.

FTB Quests already provides that interface.

## 10.3 State management

Maintain a single normalized application state.

The host is authoritative for configuration.

The Minecraft adapter is authoritative for quest progression.

Do not duplicate progression calculations in Svelte components.

Create reusable selectors for:

```typescript
getChapterCatalog()
getPinnedChapters()
getChapterProgress(chapterId)
getManuallyPinnedQuests()
getConnectionStatus()
```

---

# 11. MOCK MODE

Mock mode must reproduce the FTB Quests data lifecycle, not merely provide hardcoded UI fixtures.

Create a mock quest publisher implementing the same protocol as the real Minecraft mod.

It must support:

- Initial unavailable state.
- Quest synchronization.
- Full snapshot.
- Chapter catalog.
- Manual quest pins.
- Chapter progress.
- Task progress.
- Pin changes.
- Progress updates.
- Quest completion.
- Quest reload.
- World changes.
- Disconnect.
- Reconnection.
- Team changes.

Use realistic fixture data.

The fixture should include:

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

Include a mock configuration with five pinned chapters.

Provide deterministic scenarios so UI and protocol tests are reproducible.

## 11.1 Recorded snapshots

Once the actual ATM10 TTS adapter works, add a development-only snapshot exporter.

Record sanitized data including:

- Chapter IDs.
- Chapter titles.
- Quest IDs.
- Quest titles.
- Task IDs.
- Task types.
- Optional flags.
- Dependencies.
- Progress values.
- Manual pin IDs.

Use real ATM10 TTS snapshots as reference fixtures.

Do not fabricate actual FTB identifiers.

Do not include personal or sensitive server information in committed fixtures.

## 11.2 Mock separation

Maintain three testing layers:

1. UI fixtures.
2. Protocol-level mock publisher.
3. Actual Minecraft integration.

A successful mock test does not establish real FTB Quests compatibility.

---

# 12. MINECRAFT MOD IMPLEMENTATION

Create a client-only NeoForge mod.

Use a dedicated adapter for FTB Quests.

Conceptual interface:

```java
interface QuestProgressProvider {
    boolean isAvailable();

    QuestSnapshot captureSnapshot();

    void registerListeners(ProgressListener listener);
}
```

The actual implementation must reflect verified FTB APIs.

Requirements:

- Client-only distribution.
- Read-only access.
- Correct team progression.
- Correct manual pin data.
- Chapter discovery.
- Chapter progress.
- Quest progress.
- Task progress.
- Event-driven updates.
- Periodic reconciliation.
- Background network transmission.
- Automatic reconnection.
- Full snapshot after reconnecting.

Do not block the Minecraft client thread.

Respect Minecraft thread-safety requirements.

Do not assume FTB Quests methods can run from arbitrary threads.

Use periodic reconciliation as a fallback, initially every two seconds.

Avoid full snapshot serialization on every tick.

---

# 13. SECURITY

The host must bind exclusively to:

```text
127.0.0.1
```

Do not bind to `0.0.0.0`.

Requirements:

- Random local authentication token.
- Separate Minecraft and dashboard permissions.
- Read-only overlay.
- Dashboard-only configuration changes.
- Message validation.
- WebSocket origin restrictions.
- Message-size limits.
- No arbitrary filesystem access.
- No shell execution endpoints.
- No credentials in frontend bundles.
- No unnecessary sensitive logging.

OBS must be able to access the overlay without exposing authentication credentials in the rendered page.

Document the chosen local authentication and origin strategy.

---

# 14. OBS INTEGRATION

Serve the production frontend from the local host.

Default overlay URL:

```text
http://127.0.0.1:8765/overlay
```

Default dashboard URL:

```text
http://127.0.0.1:8765/control
```

Suggested OBS starting configuration:

```text
Source: Browser
Width: 380
Height: 650
FPS: 30
Shutdown source when not visible: Disabled
Refresh browser when scene becomes active: Disabled
```

These are starting values.

The overlay must:

- Support transparency.
- Avoid scrollbars.
- Avoid requiring OBS-specific APIs.
- Work in a normal Chromium browser.
- Recover after browser refresh.
- Display a disconnected state accurately.

---

# 15. CONNECTION LIFECYCLE

Use explicit connection states:

```typescript
type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "synchronizing"
  | "ready"
  | "error";
```

Handle:

- Minecraft startup.
- World loading.
- Multiplayer connection.
- Single-player connection.
- Quest synchronization.
- Quest reload.
- Team change.
- Server disconnect.
- World change.
- Host restart.
- OBS browser refresh.
- Network interruption.

Do not present stale progression as live.

A previous snapshot may be retained internally, but the UI must indicate when it is stale.

When reconnecting, request or publish a fresh snapshot.

---

# 16. TESTING

## Protocol tests

- Valid snapshot accepted.
- Invalid snapshot rejected.
- Unsupported version rejected.
- Sequence ordering.
- Missing progress.
- Duplicate IDs.
- Invalid chapter pin configuration.
- More than five chapter pins rejected.

## Host tests

- Minecraft connection lifecycle.
- Browser connection lifecycle.
- Snapshot broadcasting.
- Configuration persistence.
- Chapter pinning.
- Chapter unpinning.
- Chapter reordering.
- Duplicate chapter prevention.
- Missing chapter detection.
- Chapter catalog reload.
- Stale pin handling.
- Host restart recovery.

## Frontend tests

- Empty chapter catalog.
- Empty chapter pin list.
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
- Stale snapshot state.
- Browser refresh.

## Minecraft integration tests

- Data unavailable during startup.
- Data becomes available after synchronization.
- Chapter catalog extraction.
- Chapter progress extraction.
- Manual pin extraction.
- Automatic pins excluded.
- Task progress changes.
- Quest completion.
- Team progression.
- Single-player operation.
- Multiplayer operation.
- Disconnect.
- Reconnect.
- World changes.
- Quest reload.

---

# 17. DEVELOPMENT PRINCIPLES

All agents must:

1. Inspect the repository before modifying it.
2. Read this document completely.
3. Verify actual dependency versions.
4. Never invent FTB Quests APIs.
5. Keep protocol definitions centralized.
6. Keep the Java adapter isolated.
7. Keep the host independent of Minecraft.
8. Keep Svelte independent of Minecraft.
9. Preserve user configuration.
10. Avoid unnecessary dependencies.
11. Avoid speculative features.
12. Test every meaningful change.
13. Report actual build results.
14. Distinguish implemented, tested, and verified functionality.
15. Document unresolved assumptions.
16. Avoid unrelated refactoring.
17. Never silently discard unresolved chapter pins.
18. Never automatically select chapters.
19. Never automatically modify FTB quest pins.
20. Check out a new branch before starting every session.
21. Commit changes after every major action.

## 17.1 Git workflow

### Branch per session

Every coding session must begin on a new branch:

1. Inspect `git status` before changing anything.
2. Preserve any existing uncommitted work. Never discard or overwrite unrelated changes.
3. Create and switch to a new branch from the current base branch:

```text
git switch -c <type>/<short-description>
```

Use a descriptive name, for example:

```text
feat/protocol-package
fix/chapter-pin-reorder
docs/ftb-reconnaissance
```

Do not work directly on `main` or `master`. Do not reuse a branch from a previous session unless the user explicitly asks.

### Commit after every major action

Commit after each coherent, independently reviewable unit of work. Major actions include:

- Adding or changing a protocol message, schema, or state model.
- Implementing or changing a host operation, route, or persistence behavior.
- Implementing or changing an overlay or dashboard route/component.
- Changing the Minecraft adapter or FTB integration.
- Adding or updating tests.
- Changing build configuration or dependencies.
- Adding or updating documentation.

Rules:

- Do not batch unrelated changes into one commit.
- Do not leave a session with uncommitted changes unless the user explicitly asks to stop.
- If a task is intentionally incomplete, commit the working increment and report the remaining work.
- Run the relevant build or tests before committing when practical.
- Never claim a successful build or test without actually running it.

### Commit hygiene

- Use an imperative commit subject and include a body explaining what and why when needed.
- Do not commit generated build output, dependency caches, secrets, tokens, or local configuration.
- Do not rewrite history or force-push unless the user explicitly requests it.

At the end of each milestone report:

- Files created or modified.
- Architectural decisions.
- Tests executed.
- Build results.
- Known limitations.
- Outstanding issues.
- Manual verification instructions.

---

# 18. DEFINITION OF DONE

The initial release is complete when:

- [ ] Monorepo builds.
- [ ] Host runs locally.
- [ ] Mock publisher connects.
- [ ] Chapter catalog is received.
- [ ] Chapter pin configuration persists.
- [ ] Up to five chapters can be selected.
- [ ] Chapters can be reordered.
- [ ] Missing chapters are handled safely.
- [ ] Manual FTB Quests pins are received.
- [ ] Automatic pins are excluded.
- [ ] Chapter progress is displayed.
- [ ] Quest progress is displayed.
- [ ] Task progress is displayed where available.
- [ ] Overlay is transparent.
- [ ] OBS Browser Source works.
- [ ] Disconnects are represented accurately.
- [ ] Reconnection restores current state.
- [ ] Actual NeoForge integration compiles.
- [ ] Client-only installation is verified.
- [ ] Single-player integration is tested.
- [ ] Multiplayer integration is tested.
- [ ] Actual ATM10 TTS progression is verified.

Do not mark the release complete if only mock mode works.

---

# 19. FUTURE EXTENSIONS

Keep the architecture compatible with:

- Additional modpacks.
- Additional chapter pin profiles.
- Multiple OBS layouts.
- Quest completion notifications.
- Chapter completion notifications.
- Session progression history.
- Custom typography and sizing.
- Additional task progress renderers.

Do not implement these until the initial product is reliable.

---

# FINAL PRODUCT PRINCIPLE

QuestBridge does not manage quests.

FTB Quests manages quests.

QuestBridge lets the streamer decide which major chapters matter to the audience, observes the player's actual in-game objectives, and presents both in a clean independent overlay.

**The chapter pins belong to QuestBridge. The quest pins belong to FTB Quests. Progress belongs to FTB Quests.**
