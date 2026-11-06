# Stage 4 Plan — Minecraft Adapter, Real Data First

**Status:** Planning only. No Stage 4 implementation has started.
**Date:** 2026-11-06
**Target:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250, FTB Quests 2101.1.30
**Sequencing decision:** Phase 2 (host core) and Phase 3 (Svelte UI) are deferred. Stage 4 proceeds against the standalone mock collector until a host exists.

---

## 1. Decision

The normal Proposal C order is protocol → host → dashboard → adapter. That order is now changed by explicit product decision:

1. Keep the completed protocol and mock collector.
2. Defer the host and Svelte routes.
3. Build the Minecraft adapter next.
4. Validate it against the standalone collector at `ws://127.0.0.1:8765/ws`.

The protocol does not change. The adapter emits the same v1 messages the mock publisher emits. The collector already validates them, so it is a sufficient first integration target.

The missing pieces in this early path are host-owned behavior: chapter pin configuration, display settings, browser state, and Proposal B authentication. They are intentionally out of scope for Stage 4.

---

## 2. Goal

Read real FTB Quests client state from a running ATM10 TTS client and publish it in QuestBridge protocol v1, with the shortest possible path to seeing actual data.

Success for Stage 4:

- The client-only mod loads in the actual ATM10 TTS 2.3.1 instance.
- It reads chapters, chapter progress/status, manual quest pins, quest progress, and task progress from FTB's synchronized in-memory state.
- It publishes a valid `minecraft.snapshot` to the standalone collector.
- It sends progress, pin, and heartbeat updates without republishing unchanged data.
- It survives world change, quest reload, team change, disconnect, and reconnect.
- All FTB access happens on the Minecraft client thread.
- No server-side mod, server files, or FTB packet parsing is involved.

Passing Stage 4 does not complete Phase 5; single-player, multiplayer, and real pack progression still need explicit verification.

---

## 3. Verified baseline

The following was confirmed from the installed pack and the exact FTB `v2101.1.30` classes, not inferred:

| Item | Verified value |
|---|---|
| Pack | ATM10SKY 2.3.1 |
| Minecraft | 1.21.1 |
| NeoForge | 21.1.250 |
| FTB Quests | 2101.1.30 |
| FTB Teams | 2101.1.10 |
| FTB Library | 2101.1.35 |
| Client runtime JVM | Oracle JDK 25.0.2 |
| Compile target | Java 21 |
| Chapters / quests | 55 chapters, 3,834 quest definitions |
| Auto-pin ID | `1` |
| Pin storage | `TeamData.player_data[player]`, per-player |
| Progression storage | `TeamData`, team-wide |

Verified client APIs:

```java
ClientQuestFile.exists()
ClientQuestFile.INSTANCE
ClientQuestFile.INSTANCE.selfTeamData
ClientQuestFile.getInstance()
ClientQuestFile.isQuestPinned(long)

FTBQuestsClient.getClientQuestFile()
FTBQuestsClient.getClientPlayer()
FTBQuestsClient.getClientLevel()
FTBQuestsClient.isClientDataLoaded()
FTBQuestsClient.getClientPlayerData()

TeamData.isLocked()
TeamData.getTeamId()
TeamData.getName()
TeamData.isCompleted(QuestObject)
TeamData.isStarted(QuestObject)
TeamData.getRelativeProgress(QuestObject)
TeamData.canStartTasks(Quest)
TeamData.getProgress(Task)
TeamData.getPinnedQuestIds(Player)
TeamData.isQuestPinned(Player, long)

BaseQuestFile.getAllChapters()
BaseQuestFile.getQuest(long)
BaseQuestFile.getChapter(long)
Chapter.getQuests()
Chapter.getTitle()
Chapter.getRawSubtitle()
Quest.getTasks()
Quest.getTitle()
Quest.getDescription()
Quest.isOptional()
Quest.isVisible(TeamData)
Quest.streamDependencies()
Task.getType()
Task.getTitle()
Task.getMaxProgress()
Task.isOptionalForProgression(TeamData)
QuestObjectBase.getCodeString(long)
QuestObjectBase.getCodeString(QuestObjectBase)
```

Verified events:

```text
ObjectStartedEvent.QUEST / TASK / CHAPTER / FILE
ObjectCompletedEvent.QUEST / TASK / CHAPTER / FILE
ClearFileCacheEvent.EVENT
```

These are Architectury events. Registration uses `Event.register(EventActor)` and the callback returns `EventResult.pass()`. They must be registered and unregistered with the adapter lifecycle.

Verified NeoForge client lifecycle events:

```text
net.neoforged.neoforge.client.event.ClientTickEvent.Post
net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent.LoggingIn
net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent.LoggingOut
net.neoforged.neoforge.event.level.LevelEvent.Load
net.neoforged.neoforge.event.level.LevelEvent.Unload
```

The mod must be client-only:

```java
@Mod(value = QuestBridge.MODID, dist = Dist.CLIENT)
```

and the mod metadata dependencies must use `side="CLIENT"`.

The exact approach for World identity accessors (`Minecraft.getInstance().level`, integrated server world name, multiplayer server name, dimension) is an implementation detail. Verify the exact accessors during 4A; they do not affect the protocol.

---

## 4. Proposed Java structure

Keep FTB imports isolated to one package.

```text
xyz.jxcb.ftbquestoverlay/
├── QuestBridge.java                     # mod entry, client-only
├── client/
│   └── QuestBridgeClient.java           # client tick/event wiring
├── adapter/
│   ├── QuestProgressProvider.java       # FTB-independent capture interface
│   ├── QuestSnapshot.java               # immutable normalized DTOs
│   ├── SnapshotDiffer.java              # changed sections between snapshots
│   └── ftb/
│       ├── FtbQuestProgressProvider.java
│       └── FtbSnapshotMapper.java       # all FTB imports live here
├── protocol/
│   ├── ProtocolJson.java                # JSON encoding for v1 payloads
│   └── ProtocolMessages.java            # hello/snapshot/progress/pins/heartbeat
└── transport/
    ├── WebSocketPublisher.java          # java.net.http.WebSocket client
    └── ConnectionController.java        # reconnect, sequence, heartbeat
```

Rules:

- `adapter.ftb` may import FTB and Minecraft classes.
- `adapter` DTOs and `protocol` may not import FTB classes.
- `transport` may not import FTB or Minecraft classes.
- `client` coordinates the pieces and is the only package that decides when capture is allowed.

JSON strategy for 4B:

- Use `com.google.gson`, which Minecraft already ships, and do not shade or add a JSON dependency.
- Confirm it is on the mod's compile classpath at the start of 4B.
- If it is not, write a small strict JSON encoder in `ProtocolJson`; do not add an external runtime library.
- Encode exactly the v1 field names and reject/omit nothing silently. Unknown or unavailable data is `null` only where v1 permits it.

Proposed interface:

```java
interface QuestProgressProvider {
    boolean isAvailable();
    QuestSnapshot captureSnapshot();
    void registerListeners(Runnable invalidationCallback);
    void unregisterListeners();
}
```

`captureSnapshot()` asserts it is running on the Minecraft client thread.

---

## 5. Data mapping

### 5.1 Readiness

Data is ready only when all are true:

```text
ClientQuestFile.exists()
&& ClientQuestFile.INSTANCE.selfTeamData != null
&& !ClientQuestFile.INSTANCE.selfTeamData.isLocked()
&& ClientQuestFile.INSTANCE.selfTeamData.getTeamId() != nil UUID
```

Before readiness, publish `minecraft.status` with `unavailable` or `synchronizing`. Never publish an empty snapshot as if FTB data were complete.

### 5.2 Chapters

| Protocol field | Source |
|---|---|
| `id` | `QuestObjectBase.getCodeString(chapter)` |
| `title` | `chapter.getTitle().getString()` |
| `subtitle` | `String.join("\n", chapter.getRawSubtitle())`, omitted when empty |
| `order` | index in `file.getAllChapters()` |
| `progress` | `teamData.getRelativeProgress(chapter)` |
| `status.completed` | `teamData.isCompleted(chapter)` |
| `status.available` | `chapter.isVisible(teamData)` |
| `status.locked` | neither completed nor visible |

Chapter completion is never derived from `progress == 100`.

### 5.3 Manual pins

1. Get the local player: `Minecraft.getInstance().player` or `FTBQuestsClient.getClientPlayer()`.
2. Read `selfTeamData.getPinnedQuestIds(player)`.
3. Remove `TeamData.AUTO_PIN_ID` (`1`) before anything else.
4. Resolve each remaining ID with `file.getQuest(id)`.
5. Keep unresolved IDs, sorted ascending.
6. Order resolved quests by chapter catalog order, then by position in `chapter.getQuests()`.
7. Never write pins, never call `setQuestPinned`, and never reconstruct FTB's auto-generated tracker list.

The protocol's `manualPinIds` order must match its resolved quest order with unresolved entries removed.

### 5.4 Quests

Only resolved manual pins are transmitted.

| Protocol field | Source |
|---|---|
| `id` | `QuestObjectBase.getCodeString(quest)` |
| `chapterId` | `QuestObjectBase.getCodeString(quest.getChapter())` |
| `title` | `quest.getTitle().getString()` |
| `description` | joined `quest.getDescription()` strings |
| `optional` | `quest.isOptional()` |
| `hidden` | `!quest.isVisible(teamData)` |
| `dependencies` | `quest.streamDependencies()` mapped to code strings |
| `progress.status` | completed / in_progress / locked / available |
| `progress.percentage` | `teamData.getRelativeProgress(quest)` |
| `progress.completedTasks` | required tasks completed |
| `progress.totalRequiredTasks` | required tasks total |

Required task rules:

```text
totalRequiredTasks = tasks where !task.isOptionalForProgression(teamData)
completedTasks     = required tasks where teamData.isCompleted(task)
```

### 5.5 Tasks

| Protocol field | Source |
|---|---|
| `id` | `QuestObjectBase.getCodeString(task)` |
| `type` | `task.getType().getTypeId().toString()` |
| `title` | `task.getTitle().getString()` |
| `optional` | `task.isOptionalForProgression(teamData)` |
| `current` | `teamData.getProgress(task)` |
| `target` | `task.getMaxProgress()` |
| `percentage` | `teamData.getRelativeProgress(task)` |
| `status` | completed / in_progress / incomplete |

`current` and `target` are emitted only when FTB exposes meaningful numeric progress. Boolean tasks with `maxProgress == 1` may still carry numbers; the UI decides whether to show them.

### 5.6 Identity

| Protocol field | Source |
|---|---|
| `worldName` | integrated server level name, or current server display name; nullable |
| `dimension` | current level dimension location string |
| `integratedServer` | whether the client owns an integrated server |
| `teamId` | `teamData.getTeamId().toString()` |
| `teamName` | `teamData.getName()` |
| `capturedAt` | capture instant |

World identity is display data. It is not used for security.

---

## 6. Threading and lifecycle

Hard rule: **FTB and Minecraft state is read only on the Minecraft client thread.**

Model:

```text
client tick (20/s)
  -> if adapter enabled and data ready
  -> every 2 s or when invalidated:
       capture immutable QuestSnapshot on client thread
       hand off to transport executor
       transport computes diff vs last sent snapshot
       serializes and sends on executor
```

- One daemon single-thread executor for serialization and WebSocket work.
- At most one pending snapshot handoff; coalesce newer requests instead of building an unbounded queue.
- Heartbeat every 5 seconds from the transport executor.
- `ClientTickEvent.Post` drives the 2-second reconciliation clock.
- FTB start/completion events set an invalidation flag; the next tick captures immediately.
- Pin changes have no event and are caught by reconciliation.
- `LevelEvent.Load` / `LoggingIn` / `LoggingOut` mark the current snapshot invalid and force a fresh capture.
- A quest-file identity change, team ID change, or world identity change forces a full snapshot.
- Snapshot serialization must not occur on the client thread.

Connection policy:

- Node and collector absent must produce no client lag.
- Reconnect with exponential backoff: 1, 2, 4, 8, 16, 30 seconds.
- Sequence resets to 1 on every WebSocket connection.
- Session ID is generated once per client process and reused across reconnects.
- On connect: send `minecraft.hello` with sequence 1, wait for welcome if available, send status, then a fresh snapshot.
- On `host.request_snapshot`, force a fresh capture.
- On sequence gaps detected by the collector, the collector requests a snapshot; the adapter answers.
- Log connection failures at most once per backoff stage. Never log tokens or server addresses.

---

## 7. Change detection and cadence

Compare each new snapshot with the last successfully sent one:

| Change | Message |
|---|---|
| File identity, world identity, team ID, or reconnect | Full `minecraft.snapshot` |
| Chapter progress/status | `minecraft.progress` with changed chapters |
| Pinned quest/task progress | `minecraft.progress` with full changed quests |
| Pin set added/removed/unresolved | `minecraft.pins` with the full objective set |
| Nothing changed | `minecraft.heartbeat` only |
| Before readiness | `minecraft.status` only |

Do not transmit unchanged data every reconciliation tick.

A pins message replaces the objective set atomically. It must carry everything needed to render the new set, not a delta.

---

## 8. Milestones

Each milestone has a real-data exit criterion. Do not build later milestones before the earlier one shows live FTB data.

### 4A — Live FTB probe, no network

Purpose: prove the client can read the actual pack state with the least code.

Scope:

- Client-only mod entry and client tick hook.
- Readiness gate.
- One-shot structured log dump per world/team:
  - chapter count
  - five expected chapter IDs/titles/progress/status
  - resolved manual pins and unresolved IDs
  - pinned quest/task progress
- Rate-limit the dump; log again only on a detected change or explicit debug flag.

Exit criterion:

- Launch the real ATM10 TTS instance, load a world, open the quest book once, and capture the live log dump.
- The five expected chapter IDs and titles match the pack.
- At least one manual pin and one task progress value are real, not fixture data.

This is the fastest point at which “we are reading real Minecraft data” is true.

### 4B — Normalized snapshot and JSON

Scope:

- Immutable `QuestSnapshot` DTOs.
- `FtbSnapshotMapper` from live FTB state.
- v1 JSON encoder for snapshot/status/hello.
- Validate generated JSON with `@questbridge/protocol` or the collector before adding transport logic.

Exit criterion:

- A captured real snapshot validates as `minecraft.snapshot` v1.
- At least one chapter with `progress: null` and one with `status: completed` is handled correctly, if the live data exposes them.

### 4C — Minimal WebSocket publisher

Scope:

- `java.net.http.WebSocket` client, no new Java dependency.
- `minecraft.hello` + `minecraft.status` + full snapshot.
- Heartbeat every 5 seconds.
- Session ID and per-connection sequence.
- Config through `-Dquestbridge.wsUrl` with default `ws://127.0.0.1:8765/ws`.

Exit criterion:

- The standalone collector prints a real ATM10 snapshot from the live client.
- The collector accepts every message without protocol errors.
- The collector shows a non-zero chapter catalog and real manual objectives.

### 4D — Incremental updates and lifecycle

Scope:

- Two-second reconciliation.
- Progress and pins messages.
- Full snapshots on reload/world/team change/reconnect.
- Event hooks for start/completion.
- Request-snapshot handling.
- Reconnect with backoff.

Exit criterion:

- Pinning a quest in FTB appears in the collector within one reconciliation interval.
- Unpinning removes it.
- Completing a pinned quest removes the objective as FTB does.
- Completing a chapter updates status without a fabricated progress-only completion.
- Reloading quests and changing worlds produce fresh snapshots.

### 4E — Hardening

Scope:

- Bounded serialization queue and coalescing.
- Thread assertions around FTB access.
- Message-size guard.
- Graceful behavior before login, during sync, on disconnect, and with collector down.
- Log redaction.
- Disable/unregister listeners cleanly.

Exit criterion:

- No client-thread FTB access from transport code.
- No crash or stall when the collector is absent.
- Reconnect after collector restart restores a fresh snapshot.

### 4F — ATM10 verification

Scope:

- Single-player and multiplayer runs with the built jar installed in Prism.
- Five initial chapters.
- Manual pins and automatic ID `1` exclusion.
- Completion-driven pin removal.
- Team change.
- Quest reload and world change.
- Export one sanitized real snapshot for fixtures.

Exit criterion:

- Phase 5 checklists in `docs/ftb-quests-integration.md` pass for the items reachable now.
- Recorded snapshot contains no personal or server-identifying data.

---

## 9. Validation plan

### Build

```text
cd minecraft-mod
./gradlew compileJava
./gradlew build
```

The runtime JVM is JDK 25; compile with Java 21 bytecode. Do not require JDK 25 APIs.

### Fast local loop

1. Start the standalone collector: `npm run collect`.
2. Launch the actual Prism instance with the built mod.
3. Load a single-player world.
4. Wait for FTB quest and team data.
5. Observe the collector output.

`runClient` is useful for compile/runtime smoke tests, but it does not contain the ATM10 TTS quest files. Real data verification must use the Prism instance.

### Protocol validation

Every emitted message is validated by the collector. A generated snapshot should also be validated directly with `@questbridge/protocol` or the mock collector test utilities before transport is added.

### Manual test matrix

| Area | Test |
|---|---|
| Startup | No FTB data yet → status unavailable/synchronizing, no empty snapshot |
| Ready | Quest and team sync complete → one snapshot |
| Chapters | Five expected IDs, titles, progress, completion |
| Pins | Add, remove, complete, unresolved ID |
| Auto pin | ID `1` never appears in objectives |
| Tasks | Numeric and boolean tasks, optional tasks excluded from required count |
| Reload | Fresh snapshot, no stale catalog |
| World | Fresh snapshot, new world identity |
| Team | Fresh snapshot, new team ID/progress |
| Disconnect | Status disconnected, reconnect with fresh snapshot |
| Collector down | No client lag, reconnect backoff |
| Single-player | Works without a server-side mod |
| Multiplayer | Works from synchronized client state |

---

## 10. Risks and open questions

### High risk

1. **Thread safety.** Calling FTB off the client thread can corrupt state or crash. Enforce capture-on-client-thread and keep all transport work separate.
2. **Translation timing.** Titles may be placeholders until translation sync completes. Reconciliation must refresh them.
3. **World identity accessors.** The exact integrated-server world name and multiplayer server name accessors must be verified in 4A; do not guess them in the protocol.
4. **Java WebSocket on the client JVM.** `java.net.http.WebSocket` is expected to work on JDK 25, but must be exercised in the real client.
5. **Client-only distribution.** Confirm the jar is not loaded on a dedicated server and that FTB dependencies are marked client-side.
6. **Large chapter catalog.** 55 chapters are small, but message size must stay under 256 KiB. Only pinned quests are transmitted, never the full 3,834-quest book.

### Medium risk

- Event registration lifetime and duplicate listeners across world reloads.
- `ClientQuestFile.INSTANCE` replacement while a background serialization is in progress; handoff must be immutable.
- Pin changes racing completion (FTB may remove a completed pin).
- Player UUID changes on reconnect; team progression stays valid but pins are per-player.
- JDK 25 runtime with Java 21 target; avoid runtime-version-specific APIs.

### Open decisions

1. **Configuration transport.** Recommended: system properties for early testing (`questbridge.wsUrl`, `questbridge.debug`), with a client config file only when the host exists.
2. **First log format.** A human-readable one-line-per-object dump is enough for 4A; no JSON exporter is required yet.
3. **World name policy.** Display-only; exact fallback when unavailable is `null`.
4. **Subtitle joining.** Recommended newline join; the protocol accepts one optional string.

No decision changes protocol v1.

---

## 11. First implementation action when approved

Start with 4A only:

1. Replace the empty mod constructor with client-only initialization.
2. Add `ClientTickEvent.Post` registration.
3. Add the FTB readiness check and one-shot live probe logger.
4. Build the jar.
5. Install it into the ATM10 TTS Prism instance.
6. Load a world and capture the log.

Do not add WebSocket code until the live probe shows real chapter and pin data.

---

## 12. Out of scope

- Host core and persistence.
- Svelte overlay and dashboard.
- Chapter pin configuration and browser roles.
- Proposal B authentication.
- Auto-pin tracker reconstruction.
- Quest pin mutation.
- Full quest-book transmission.
- Server-side code.
- Parsing or forwarding FTB packets.
- Reading SNBT files directly.
