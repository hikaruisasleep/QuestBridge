# Stage 4 Plan — Minecraft Adapter

**Status:** Stage 4A implemented and verified against the live client. **Stage 4B–4F
have not started.** Phases 2 (host) and 3 (frontend) are complete, so this plan is
now the only thing standing between the mock-driven pipeline and real data.
**Date:** 2026-11-07 (rewritten; originally 2026-11-06, before Phases 2 and 3 existed)
**Target:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250, FTB Quests 2101.1.30
**Version:** `0pre.2` — the Stage 4B conversation's single bump from `0pre.1`
(`docs/versioning.md` §3.4). It stays `0pre.2` for this conversation.

---

## 1. Why this plan was rewritten

Stage 4A was built first, on purpose, to answer two questions with the least code:
can a NeoForge client mod load at all, and can it actually read FTB Quests data
from a running client? It answered both. At the time there was no host, no
frontend, and no browser roles — the only thing to publish to was a standalone
collector.

That context is gone. Phases 2 and 3 now exist and are verified, and they change
what "done" means for this stage:

| Then (4A) | Now |
|---|---|
| Target was the standalone collector | Target is the real host with two-token auth, roles, and persistence |
| "Snapshot" meant a log dump | A snapshot must be a validated protocol v1 message |
| No browser consumed the data | An overlay renders it; the host resolves chapter pins against the catalog |
| Collector validated messages | The host validates, and rejects with specific error codes |
| Nothing to configure | The host supplies `minecraftToken` and declares timings in `host.welcome` |

The remaining work is unchanged in substance but is better specified now, because
the receiving end of the pipeline is real and its expectations are testable.

**This plan does not change protocol v1.** Everything below emits the messages
`packages/protocol` already defines and `packages/mock-publisher` already emits.

---

## 2. Where the project stands

### 2.1 Implemented and verified

| Component | State | Evidence |
|---|---|---|
| `packages/protocol` | v1 complete | 85 tests |
| `packages/mock-publisher` | 11 deterministic scenarios | 30 tests |
| `packages/host` | Loopback HTTP/WS, two-token auth, chapter pins, state store, static serving | 250 tests |
| `apps/web-app` | `/`, `/overlay`, `/control` in a static build | 169 tests (74 in Chromium) |
| `minecraft-mod` | Stage 4A client probe only | Compiles; verified live 2026-11-06 |

`npm run build` and `npm test` pass: **534 tests**. Protocol v1 is unchanged since
Phase 1.

### 2.2 What the adapter must plug into

**Connection.** `ws://127.0.0.1:8765/ws`, authenticated with the Minecraft token.

- The host accepts the token as `Authorization: Bearer <token>` **or** `?token=`.
- A publisher sends **no `Origin` header**. The host only allows that for a valid
  Minecraft token, so a browser-mechanism connection will be refused with `403`.
- `java.net.http.WebSocket` allows an `Authorization` header on the upgrade
  request; that is the intended path. Verify it during 4C rather than assuming.
- The token lives in `tokens.json` in the host config directory.
  `questbridge-host --print-urls` prints **browser** URLs, not the Minecraft token.

**Handshake.** After TCP/WebSocket open:

1. Send `minecraft.hello` with `sequence: 1` and a `sessionId`.
   Required payload fields: `modVersion`, `minecraftVersion`, `neoForgeVersion`,
   `ftbQuestsVersion`, `ftbTeamsVersion`. Detection failures may send `"unknown"`;
   the host logs a mismatch but does not reject it.
2. The host replies `host.welcome` with `hostVersion`, `heartbeatIntervalMs`,
   `staleAfterMs`, `disconnectAfterMs`, `reconcileIntervalMs`. **Read these** rather
   than hard-coding 5 s / 2 s; they are the host's declared timings.
3. Send `minecraft.status` (`unavailable` or `synchronizing`), then heartbeat every
   `heartbeatIntervalMs`.
4. Send a full `minecraft.snapshot` once FTB data is ready. Never send an empty
   snapshot as though the catalog were complete.

**Host behaviour that shapes the adapter:**

- Only **one** publisher may be connected. A second is refused with HTTP `409`.
- Message frames above 256 KiB are rejected and close the connection.
- A sequence gap makes the host send `host.request_snapshot`; the adapter must
  answer with a fresh full snapshot, not a delta.
- After 20 s without a heartbeat the host marks the data stale; after 30 s, or on
  socket close, `disconnected`. The overlay fades out on `disconnected`, so a
  silent adapter is visible on stream.
- The host does **not** delete chapter pins when the catalog changes. A pinned
  chapter ID the adapter stops reporting renders as "Unresolved chapter" on the
  overlay, which is correct behaviour and must stay reachable.

### 2.3 What already exists in `minecraft-mod`

```text
minecraft-mod/src/main/java/xyz/jxcb/ftbquestoverlay/
├── QuestBridge.java                 # @Mod(dist = CLIENT); constructs QuestBridgeClient
├── client/QuestBridgeClient.java    # ClientTickEvent.Post, 40-tick (2 s) probe loop
├── adapter/ProbeReport.java         # FTB-free record; chapter/quest/task probes
└── adapter/ftb/FtbQuestProbe.java   # the only file importing FTB and Minecraft
```

4A is reusable, not throwaway: `FtbQuestProbe` already performs the readiness gate,
catalog enumeration, manual-pin resolution, and task progress reads on the client
thread, and `ProbeReport` already is an FTB-free DTO. 4B extends that shape rather
than replacing it.

What is missing for the protocol is the parts a log dump never needed:
`subtitle`, `order`, `dependencies`, `optional`, `hidden`, `description`,
`integratedServer`, `capturedAt`, and the fallback pin ordering rule.

---

## 3. Verified baseline

Confirmed from the installed pack and the exact FTB `v2101.1.30` classes:

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

Verified events (Architectury; register with `Event.register(EventActor)`, callback
returns `EventResult.pass()`, and registration must follow the adapter lifecycle):

```text
ObjectStartedEvent.QUEST / TASK / CHAPTER / FILE
ObjectCompletedEvent.QUEST / TASK / CHAPTER / FILE
ClearFileCacheEvent.EVENT
```

Verified NeoForge client lifecycle events:

```text
net.neoforged.neoforge.client.event.ClientTickEvent.Post
net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent.LoggingIn
net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent.LoggingOut
net.neoforged.neoforge.event.level.LevelEvent.Load
net.neoforged.neoforge.event.level.LevelEvent.Unload
```

The mod is client-only: `@Mod(value = QuestBridge.MODID, dist = Dist.CLIENT)`, with
`side="CLIENT"` metadata dependencies.

---

## 4. Java structure

```text
xyz.jxcb.ftbquestoverlay/
├── QuestBridge.java                     # mod entry, client-only            (exists)
├── client/
│   └── QuestBridgeClient.java           # client tick/event wiring          (exists; extended)
├── adapter/
│   ├── QuestSnapshot.java               # immutable normalized DTOs         (from ProbeReport)
│   ├── QuestProgressProvider.java       # FTB-independent capture interface
│   ├── SnapshotDiffer.java              # changed sections between snapshots
│   └── ftb/
│       ├── FtbQuestProgressProvider.java # from FtbQuestProbe
│       └── FtbSnapshotMapper.java        # all FTB imports live here
├── protocol/
│   ├── ProtocolJson.java                # v1 JSON encoding
│   └── ProtocolMessages.java            # hello/status/snapshot/progress/pins/heartbeat
└── transport/
    ├── WebSocketPublisher.java          # java.net.http.WebSocket client
    └── ConnectionController.java        # reconnect, sequence, heartbeat
```

Package rules:

- `adapter.ftb` may import FTB and Minecraft classes; nothing else may import FTB.
- `adapter` DTOs and `protocol` may not import FTB classes.
- `transport` may not import FTB or Minecraft classes. This is what keeps WebSocket
  work off the client thread by construction rather than by discipline.
- `client` is the only package that decides when capture is allowed.

JSON: use `com.google.gson`, which Minecraft already ships. Confirm it is on the
mod's compile classpath at the start of 4B. If it is not, hand-write a small strict
encoder; do not add a runtime library. Encode exactly the v1 field names — protocol
objects are `strictObject` on the receiving side, so an extra field is rejected.

### 4.1 Reuse from Stage 4A

| 4A asset | Becomes |
|---|---|
| `ProbeReport` | `QuestSnapshot`, extended with the fields listed in §2.3 |
| `ProbeReport.ChapterProbe` | `ChapterSnapshot`, adding `subtitle` and `order` |
| `ProbeReport.QuestProbe` | `QuestSnapshot` quest record, adding `optional`, `hidden`, `description`, `dependencies`, `percentage` |
| `FtbQuestProbe.isReady()` | `FtbQuestProgressProvider.isAvailable()` |
| `FtbQuestProbe.capture()` | `FtbQuestProgressProvider.captureSnapshot()` |
| `QuestBridgeClient`'s 40-tick loop | The reconciliation clock, driven by `tickDelta` |

The probe's `fingerprint` string is a debugging aid, not a substitute for
`SnapshotDiffer`: the differ must emit **which** sections changed, because v1
distinguishes `minecraft.progress` from `minecraft.pins` from a full snapshot.

---

## 5. Data mapping

### 5.1 Readiness

```text
ClientQuestFile.exists()
&& ClientQuestFile.INSTANCE.selfTeamData != null
&& !ClientQuestFile.INSTANCE.selfTeamData.isLocked()
&& ClientQuestFile.INSTANCE.selfTeamData.getTeamId() != nil UUID
```

Before readiness, publish `minecraft.status` with `unavailable` or
`synchronizing`. Never publish an empty snapshot as though FTB data were complete.

### 5.2 Chapters

| Protocol field | Source |
|---|---|
| `id` | `QuestObjectBase.getCodeString(chapter)` |
| `title` | `chapter.getTitle().getString()` |
| `subtitle` | `String.join("\n", chapter.getRawSubtitle())`, omitted when empty |
| `order` | index in `file.getAllChapters()`; must be unique and 0-based |
| `progress` | `teamData.getRelativeProgress(chapter)`, `null` where unavailable |
| `status` | see below |

Status mapping. FTB has no chapter-level lock API (`docs/ftb-quests-integration.md`
§5.3), so availability is derived:

```text
completed   teamData.isCompleted(chapter)
available   chapter started || any required quest teamData.canStartTasks(quest) || no required quests
locked      otherwise, when required quests exist
unknown     the derivation could not be performed
```

Chapter completion is **never** derived from `progress == 100`: empty,
`alwaysInvisible`, and all-optional chapters can report 100 without a completion
record. Chapter visibility is not progression availability — `isVisible` must not
become `locked`.

**Protocol v1 has no chapter visibility field.** The 4A probe reports `visible` and
`explicitlyHidden`; they stay a probe-only diagnostic and must not be squeezed into
`status`. Adding them to the wire requires a version change.

### 5.3 Manual pins

1. Get the local player: `Minecraft.getInstance().player` or `FTBQuestsClient.getClientPlayer()`.
2. Read `selfTeamData.getPinnedQuestIds(player)`.
3. Remove `TeamData.AUTO_PIN_ID` (`1`) before anything else.
4. Resolve each remaining ID with `file.getQuest(id)`.
5. Keep unresolved IDs, sorted ascending.
6. Order resolved quests by chapter catalog order, then by position in `chapter.getQuests()`.
7. Never write pins, never call `setQuestPinned`, never reconstruct FTB's auto tracker.

The protocol's `manualPinIds` order must equal its resolved quest order with
unresolved entries removed. That is a cross-field invariant the host enforces, so
violating it rejects the whole snapshot as `invalid_message`.

FTB does not expose pin ordering; step 6 is a deterministic QuestBridge fallback and
must be described as such, not as FTB order.

### 5.4 Quests

Only resolved manual pins are transmitted.

| Protocol field | Source |
|---|---|
| `id` | `QuestObjectBase.getCodeString(quest)` |
| `chapterId` | `QuestObjectBase.getCodeString(quest.getChapter())` |
| `title` | `quest.getTitle().getString()` |
| `description` | joined `quest.getDescription()` strings; omitted when empty |
| `optional` | `quest.isOptional()` |
| `hidden` | `!quest.isVisible(teamData)` |
| `dependencies` | `quest.streamDependencies()` mapped to code strings |
| `progress.status` | `completed` / `in_progress` / `locked` / `available` |
| `progress.percentage` | `teamData.getRelativeProgress(quest)` |
| `progress.completedTasks` | required tasks completed |
| `progress.totalRequiredTasks` | required tasks total |

Required task rules — optional tasks must never block completion:

```text
totalRequiredTasks = tasks where !task.isOptionalForProgression(teamData)
completedTasks     = required tasks where teamData.isCompleted(task)
```

`completedTasks <= totalRequiredTasks` is enforced by the host.

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
| `status` | `completed` / `in_progress` / `incomplete` |

`current` and `target` are emitted only when FTB exposes meaningful numeric
progress. **Omit rather than synthesize `0`/`1`** — the overlay renders an em dash
for absent progress and a fabricated number would be indistinguishable from real
data. Boolean tasks with `maxProgress == 1` may still carry numbers; the UI decides
whether to show them.

`unit` is reserved and v1 adapters do not emit it.

### 5.6 Identity

| Protocol field | Source |
|---|---|
| `worldName` | integrated server level name, or current server display name; nullable |
| `dimension` | current level dimension location string |
| `integratedServer` | whether the client owns an integrated server |
| `teamId` | `teamData.getTeamId().toString()` |
| `teamName` | `teamData.getName()` |
| `capturedAt` | capture instant |

World identity is display data, never a security identifier. `null` is the correct
value when it is unavailable — not an empty string.

---

## 6. Threading and lifecycle

Hard rule: **FTB and Minecraft state is read only on the Minecraft client thread.**

```text
client tick (20/s)
  -> if adapter enabled and data ready
  -> every reconcileIntervalMs or when invalidated:
       capture immutable QuestSnapshot on client thread
       hand off to transport executor
       transport diffs against last sent snapshot
       serializes and sends on executor
```

- One daemon single-thread executor owns serialization and WebSocket work.
- At most one pending snapshot handoff; coalesce newer requests rather than
  building an unbounded queue.
- Heartbeat on the transport executor at the host-declared `heartbeatIntervalMs`.
- `ClientTickEvent.Post` drives reconciliation. Use `tickDelta` so a slow tick does
  not stretch the interval silently.
- FTB start/completion events set an invalidation flag; the next tick captures
  immediately.
- **Pin changes have no event** and are caught only by reconciliation. This is why
  the reconciliation interval matters to perceived latency.
- `LevelEvent.Load` / `LoggingIn` / `LoggingOut` invalidate and force a fresh capture.
- A quest-file identity change, team ID change, or world identity change forces a
  full snapshot.
- Serialization must not run on the client thread.

Connection policy:

- The host being absent must cause no client lag and no log spam.
- Reconnect with backoff 1, 2, 4, 8, 16, 30 s, capped.
- Sequence resets to 1 on every WebSocket connection; `sessionId` is generated once
  per client process and reused.
- On connect: hello → status → fresh full snapshot.
- On `host.request_snapshot`, force a fresh capture.
- Log connection failures at most once per backoff stage. Never log the token or a
  server address (the host rejects `detail` strings containing them).

---

## 7. Change detection and cadence

| Change | Message |
|---|---|
| File identity, world identity, team ID, or reconnect | Full `minecraft.snapshot` |
| Chapter progress/status | `minecraft.progress` with only changed chapters |
| Pinned quest/task progress | `minecraft.progress` with full changed quests |
| Pin set added/removed/unresolved | `minecraft.pins` with the **full** objective set |
| Nothing changed | `minecraft.heartbeat` only |
| Before readiness | `minecraft.status` only |

Do not transmit unchanged data every reconciliation tick. A `minecraft.pins` message
replaces the objective set atomically and is never a delta.

Completion removes an objective: FTB drops a completed quest from the player's pin
set, so the adapter reports the new set via `minecraft.pins` and the overlay drops
the row. QuestBridge must not fabricate a retained completed pin.

---

## 8. Milestones

Each milestone has a real-data exit criterion. Do not start a later milestone
before the earlier one shows live FTB data reaching its target.

### 4A — Live FTB probe, no network — **DONE**

**Status (2026-11-06):** Implemented and verified. `./gradlew build` produces
`build/libs/questbridge-0pre.1.jar`. The capture is in
`docs/testing-logs/2026-11-06-1.log`: 55 chapters, the five expected chapters, a real
manual pin (`Easy Ore Duping`) with task progress.

Delivered: client-only entry, readiness gate, two-second reconciliation, structured
change-only logging, client-side FTB metadata dependencies, FTB imports isolated to
`adapter/ftb`.

### 4B — Normalized snapshot and JSON

**The first milestone that should be started.** No network yet.

Scope:

- `QuestSnapshot` and nested DTOs, extended per §2.3.
- `FtbSnapshotMapper` producing them from live FTB state on the client thread.
- v1 JSON encoder for `minecraft.hello`, `minecraft.status`, `minecraft.snapshot`.
- Keep the 4A logger as the observation channel; the encoder's output is the artifact.

Exit criterion:

- A snapshot captured from the live ATM10 client validates against
  `minecraftSnapshotPayloadSchema` from `@questbridge/protocol`.
- Validation is run for real — write the JSON to a file and check it with a Node
  script, rather than eyeballing it.
- At least one chapter arrives with `progress: null` and one with
  `status: completed` if the live data exposes them.
- At least one pinned quest carries a `subtitle`-bearing chapter and one task with
  `current`/`target` present.

Do not proceed to 4C on the strength of "it looks right"; the schema is strict and
will reject a missing required field.

### 4C — Minimal WebSocket publisher

Scope:

- `java.net.http.WebSocket`, authenticated per §2.2.
- `minecraft.hello` + `minecraft.status` + full snapshot.
- Heartbeat at the host-declared interval.
- Session ID and per-connection sequence.
- Configuration via `-Dquestbridge.wsUrl` (default `ws://127.0.0.1:8765/ws`) and the
  token. Until a config file exists, the token comes from
  `-Dquestbridge.minecraftToken` or the `QUESTBRIDGE_MINECRAFT_TOKEN` environment
  variable, mirroring the mock publisher.

Exit criterion:

- The **real host** (`npm run host -- --build-dir apps/web-app/build`), not the
  standalone collector, accepts every message with no protocol errors.
- A browser at `/control` shows the real catalog; the overlay renders the real
  pinned objectives.
- The host log reports the hello versions.

The collector remains useful as a first smoke test because it prints every message,
but it is no longer the target.

### 4D — Incremental updates and lifecycle

Scope:

- Reconciliation on the host-declared interval.
- `minecraft.progress` and `minecraft.pins`.
- Full snapshots on reload, world change, team change, reconnect, and request.
- Event hooks for start/completion.
- Reconnect with backoff.

Exit criterion:

- Pinning a quest in FTB appears in the overlay within one reconciliation interval.
- Unpinning removes it.
- Completing a pinned quest removes the objective, as FTB does.
- Completing a chapter updates status without fabricating progress-only completion.
- Quest reload and world change produce fresh snapshots and no stale catalog.
- Pinning a chapter whose ID the adapter stops reporting leaves it pinned and the
  overlay shows "Unresolved chapter" — configuration is never auto-deleted.

### 4E — Hardening

Scope:

- Bounded serialization queue and coalescing.
- Thread assertions around FTB access.
- Message-size guard against the 256 KiB host limit.
- Behaviour before login, during sync, on disconnect, and with the host down.
- Log redaction; no token or server address in any message or log.
- Clean listener registration/unregistration across world reloads.

Exit criterion:

- No client-thread FTB access from transport code.
- No crash, stall, or log spam when the host is absent.
- Restarting the host restores a fresh snapshot without restarting Minecraft.
- The host's own `--print-urls` output and `tokens.json` never appear in logs.

### 4F — ATM10 verification and recorded fixtures

Scope:

- Single-player and multiplayer runs with the built jar in Prism.
- Five initial chapters; manual pins and automatic ID `1` exclusion.
- Completion-driven pin removal.
- Team change; quest reload; world change.
- Export one sanitized real snapshot for reference fixtures
  (`AGENTS.md` §11.1).

Exit criterion:

- The Definition of Done items that require a real client are genuinely verified.
  These currently all sit unchecked in `AGENTS.md` §18, and are the reason the
  release is not complete.
- The recorded snapshot contains no player names, server addresses, or tokens.

---

## 9. Validation

### Build

```text
cd minecraft-mod
./gradlew compileJava
./gradlew build
```

Runtime JVM is JDK 25; compile to Java 21 bytecode. Do not use JDK 25-only APIs.

### Fast local loop

1. `npm run build -w web-app`
2. `npm run host -- --build-dir apps/web-app/build`, note `minecraftToken` from `tokens.json`
3. Launch the Prism instance with the built jar
4. Load a world and wait for FTB sync
5. Watch the host log and `/overlay`

`runClient` is fine for compile and runtime smoke tests, but it contains no ATM10
quest files. Real data verification must use the Prism instance.

### Protocol validation

Validate against `@questbridge/protocol` directly, as well as through the host. The
host validates on receipt, but it only tells you the *first* failure; a standalone
script that prints every schema issue is faster to iterate against.

### Manual test matrix

| Area | Test |
|---|---|
| Startup | No FTB data yet → status unavailable/synchronizing, no empty snapshot |
| Ready | Quest and team sync complete → exactly one snapshot |
| Chapters | Five expected IDs, titles, progress, completion |
| Pins | Add, remove, complete, unresolved ID |
| Auto pin | ID `1` never appears in objectives |
| Tasks | Numeric and boolean tasks; optional tasks excluded from required count |
| Reload | Fresh snapshot, no stale catalog |
| World | Fresh snapshot with new world identity |
| Team | Fresh snapshot with new team ID and progress |
| Disconnect | Host reports disconnected; overlay fades; reconnect gives a fresh snapshot |
| Host down | No client lag, no log spam, backoff reconnect |
| Single-player | Works without a server-side mod |
| Multiplayer | Works from synchronized client state |

---

## 10. Risks

### High

1. **Thread safety.** Reading FTB off the client thread can corrupt state or crash.
   Capture on the client thread; keep transport FTB-free.
2. **Translation timing.** Titles may be placeholders until translation sync lands.
   Reconciliation must refresh them, and the overlay will show placeholders briefly.
3. **`java.net.http.WebSocket` auth.** Sending a header on the upgrade must be
   exercised in the real client, not assumed.
4. **Client-only distribution.** Confirm the jar is not loaded on a dedicated server
   and that FTB dependencies are `side="CLIENT"`.
5. **Message size.** 55 chapters is small, but stay under 256 KiB. Only pinned quests
   travel, never the 3,834-quest book.
6. **Strict schemas.** The host rejects unknown or missing fields. A single extra
   field fails the whole message with `invalid_message`.

### Medium

- Event registration lifetime and duplicate listeners across world reloads.
- `ClientQuestFile.INSTANCE` replaced while background serialization is in progress;
  the handoff must be immutable.
- Pin changes racing completion (FTB may remove a completed pin).
- Player UUID changes on reconnect: team progression stays valid, pins are per-player.
- The overlay fades after 30 s without a heartbeat, so a stalled adapter is visible on
  stream rather than silently showing stale data.

### Open decisions

1. **Configuration transport.** System properties and an environment variable for
   now, mirroring the mock publisher. A client config file is worth adding once the
   token and URL are stable; it is not needed to reach 4F.
2. **Subtitle joining.** Newline join; the protocol carries one optional string.
3. **World name policy.** Display-only; `null` when unavailable.

None of these changes protocol v1.

---

## 11. First implementation action

Start with **4B**, not 4A — 4A is done.

1. Copy `ProbeReport` to `adapter/QuestSnapshot.java` and add the fields in §2.3.
2. Rename `FtbQuestProbe` to `FtbQuestProgressProvider` behind the
   `QuestProgressProvider` interface.
3. Write `FtbSnapshotMapper` to produce single-line JSON per §5, using Gson.
4. Keep writing the human-readable 4A log alongside the JSON during this milestone.
5. Validate the JSON with `@questbridge/protocol` before writing any transport code.

Do not add WebSocket code until a real captured snapshot validates.

---

## 12. Out of scope

- Host core, persistence, authentication (Phase 2 — done).
- Svelte overlay and dashboard (Phase 3 — done).
- Chapter pin configuration and browser roles (Phase 2/3 — done).
- Auto-pin tracker reconstruction.
- Quest pin mutation.
- Full quest-book transmission.
- Server-side code.
- Parsing or forwarding FTB packets.
- Reading SNBT files directly.
- Protocol v1 changes. Chapter visibility in particular would require one.
