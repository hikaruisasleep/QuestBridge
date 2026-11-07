# Stage 4 Plan — Minecraft Adapter

**Status:** Stage 4A implemented and verified against the live client. **Stages 4B–4E
are implemented and verified against the real host (no Minecraft client required).
The former Stage 4F has been retired and folded into Phase 5 as its first test
sequence — see `docs/phase-5-plan.md` §1 and §6 (Sequence A).** Phases 2 and 3 are
complete.
**Date:** 2026-11-07 (rewritten; originally 2026-11-06, before Phases 2 and 3 existed)
**Target:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250, FTB Quests 2101.1.30
**Version:** `0pre.2` — the Stage 4B conversation's single bump from `0pre.1`
(`docs/versioning.md` §3.4). It stayed `0pre.2` for that conversation. **The mod
is now `0pre.3`**, written by the later Proposal E conversation
(`docs/proposals.md` §6.1, `docs/phase-5-plan.md` §12); this document describes
the Stage 4 work as it was done and its version line is historical.

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
â”œâ”€â”€ QuestBridge.java                 # @Mod(dist = CLIENT); constructs QuestBridgeClient
â”œâ”€â”€ client/QuestBridgeClient.java    # ClientTickEvent.Post, 40-tick (2 s) probe loop
â”œâ”€â”€ adapter/ProbeReport.java         # FTB-free record; chapter/quest/task probes
â””â”€â”€ adapter/ftb/FtbQuestProbe.java   # the only file importing FTB and Minecraft
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
â”œâ”€â”€ QuestBridge.java                     # mod entry, client-only            (exists)
â”œâ”€â”€ client/
â”‚   â””â”€â”€ QuestBridgeClient.java           # client tick/event wiring          (exists; extended)
â”œâ”€â”€ adapter/
â”‚   â”œâ”€â”€ QuestSnapshot.java               # immutable normalized DTOs         (from ProbeReport)
â”‚   â”œâ”€â”€ QuestProgressProvider.java       # FTB-independent capture interface
â”‚   â”œâ”€â”€ SnapshotDiffer.java              # changed sections between snapshots
â”‚   â””â”€â”€ ftb/
â”‚       â”œâ”€â”€ FtbQuestProgressProvider.java # from FtbQuestProbe
â”‚       â””â”€â”€ FtbSnapshotMapper.java        # all FTB imports live here
â”œâ”€â”€ protocol/
â”‚   â”œâ”€â”€ ProtocolJson.java                # v1 JSON encoding
â”‚   â””â”€â”€ ProtocolMessages.java            # hello/status/snapshot/progress/pins/heartbeat
â””â”€â”€ transport/
    â”œâ”€â”€ WebSocketPublisher.java          # java.net.http.WebSocket client
    â””â”€â”€ ConnectionController.java        # reconnect, sequence, heartbeat
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

**Status (2026-11-07): implemented and verified against the real host.**
Live-data exit criterion was validated via `scripts/validate-snapshot.mjs` over
messages produced by the actual Java encoder (`EncoderHarness`), through the
host's `parseFrame` path. The missing live ATM10 capture remains blocked on a
live client launch — the encoder itself is proven.

Delivered:

- `adapter/QuestSnapshot.java` — immutable DTOs. Chapter `progress` is
  `Integer`, task `current`/`target` are `Long`, so "unavailable" can be
  represented instead of a fabricated `0`. `QuestSnapshot.Identity` carries the
  file/team/world keys that force a full snapshot.
- `adapter/QuestProgressProvider.java` — FTB-free capture interface, including
  the `Unavailable` phase that maps to `minecraft.status`.
- `adapter/ftb/FtbQuestProgressProvider.java` — readiness gate, pin capture with
  the automatic ID removed before resolution, fallback ordering, and event
  hooks. Listeners increment an atomic counter only; they never touch FTB state.
- `adapter/ftb/FtbSnapshotMapper.java` — the field mapping in §5. All FTB imports
  stay in `adapter.ftb`.
- `protocol/ProtocolJson.java`, `protocol/JsonObjectBuilder.java`,
  `protocol/ProtocolMessages.java` — the v1 encoder. Gson is on the compile
  classpath (`com.google.code.gson:gson:2.10.1`, via NeoForge/FML), so no
  handwritten encoder and no added runtime dependency.
- `protocol/Sanitizer.java` — coerces values into schema-legal ranges (ID
  length, empty titles, percentage bounds, non-negative task counts).
- `scripts/validate-snapshot.mjs` — validates files through the same
  `parseFrame(text, "minecraft_to_host")` path the host uses, printing every
  issue rather than the first.

Decisions taken during implementation:

1. **Encode by hand, not with reflection.** Protocol objects are strict; a field
   written by a reflective serializer cannot be audited against the schema. Every
   field is written explicitly in `ProtocolMessages`.
2. **Sanitize at capture, not at encode.** An out-of-range value must not reach
   the encoder at all.
3. **A pinned quest that cannot be represented is withheld from all three
   objective arrays at once**, not just from one. `quests`,
   `manualPinIds` and `unresolvedPinnedQuestIds` are validated as a partition;
   dropping an entry from only one breaks the invariant and rejects the whole
   snapshot. Withheld quests are counted in a warning log.

Exit criterion status:

- [x] Real encoder output validates against `minecraftSnapshotPayloadSchema` —
      proven by `scripts/validate-snapshot.mjs` over messages produced by the
      actual Java encoder (`EncoderHarness`), and the validator was itself proven
      to reject a missing required field, an extra field, and auto pin ID `1`.
- [ ] A **live ATM10 capture** validates. Requires launching the Prism instance
      with the jar and `-Dquestbridge.dumpSnapshot=<path>`.
- [ ] At least one chapter with `progress: null` and one `status: completed`
      from live data.
- [ ] One task with `current`/`target` from live data.

The three unchecked items need a running Minecraft client, which this
conversation did not have. They are not claimed.

Do not proceed to 4C on the strength of "it looks right"; the schema is strict and
will reject a missing required field.

### 4C — Minimal WebSocket publisher

**Status (2026-11-07): implemented and verified against the real host.**
Verified without a Minecraft client, using the transport classes directly.

Delivered:

- `transport/WebSocketConnection.java` — `java.net.http.WebSocket`, bearer
  token on the upgrade, no `Origin` header.
- `transport/ConnectionController.java` — connect, hello, welcome, status,
  heartbeat, reconnect with backoff, and coalescing of client captures.
- `transport/SnapshotDiffer.java` — message selection and per-connection
  sequence numbering.
- `transport/TransportExecutor.java` — the single transport thread.
- `transport/TransportLog.java` — transport logging with no dependency on the
  mod entry class.
- `QuestBridgeConfig.java` — `config/questbridge-client.toml`, with system
  property and environment variable overrides.

**Three defects were found during 4C, all of which presented identically as "the
host accepted the hello and then received nothing".** They are recorded because
each one is a silent failure with no stack trace:

1. **Transport code logged through `QuestBridge.LOGGER`.** A log call made from a
   socket callback that ran where FML classes were not resolvable threw
   `NoClassDefFoundError`, which ended the connection with no diagnostic.
   Transport classes now use `TransportLog`, which reaches the mod logger
   reflectively and falls back to stdout.
2. **The WebSocket listener returned `null` after re-requesting.** Handled
   frames now return a completed future.
3. **A silent failure was also an unlogged one**, because no SLF4J binding was
   present outside the game. Diagnostics had to be added before any of the
   above could be seen.

Evidence against the real host (`packages/host`, not the collector):

| Check | Result |
|---|---|
| hello accepted | Host logs `publisher hello: MC 1.21.1, NeoForge 21.1.250, FTB Quests 2101.1.30, FTB Teams 2101.1.10, mod 0pre.2` |
| `Authorization: Bearer` on upgrade | Works; a missing token is reported as HTTP 401 |
| snapshot / progress / pins | All accepted, no `host.error`, no `host.request_snapshot` |
| persistent connection | `connection=ready, stale=false`; 1 snapshot, 2 status, 4 heartbeats, 10 progress messages, 0 closes |
| reconnect | 4 failed handshakes backed off 1, 2, 4, 8 s, then connected and published a fresh snapshot |
| host down 20 s | 5 attempts across 20 s, routine log volume ~0 lines |

### 4D — Incremental updates and lifecycle

**Status (2026-11-07): implemented and verified against the real host.**
All transport-level lifecycle behavior was verified against the real host:
full snapshot on new connection, `host.request_snapshot` answered, reconnect
backoff 1→2→4→8→16→30 s capped, oversize frame skipped, host-down 20 s →
5 attempts across 20 s, routine log volume ~0 lines.

Parts still requiring a live client: pinning a quest appearing within one
interval, completion removing an objective, a chapter completing, a quest reload,
and a world change.

### 4E — Hardening

**Status (2026-11-07): implemented and verified against the real host.**

- **Thread contract.** `adapter/ClientThreadGuard` records a violation when FTB
  is read off the client thread. It is fail-open by design and identifies the
  client thread by name (`Render thread`), which is a heuristic: `Minecraft` has
  no public accessor for its client thread.
- **Message size.** A frame above 256 KiB is never sent; it is logged and
  skipped, because the host reacts to an oversize frame by closing the
  connection.
- **Coalescing.** At most one handoff is pending; a newer capture replaces an
  older one.
- **Bounded queue.** Only pinned quests travel, never the quest book.
- **Log redaction.** Transport log messages carry only message types, sizes,
  status phases, and host-declared values. The token and server address are
  never formatted into a message; the URL is logged only in its configured form,
  which the user supplied and which contains no credential.
- **Host down.** Verified: escalating backoff, no routine log spam, and no
  client-thread blocking, since every offer is a single reference store.

The following remain documented caveats (not yet verified against a live client):
- No crash or stall in a live client with the host absent
- Listener registration across repeated world reloads.

### 4F — ATM10 verification and recorded fixtures — **retired into Phase 5**

**Status (2026-11-07):** retired. The live-verification half is now **Sequence A**
of Phase 5 (`docs/phase-5-plan.md` §6), run with the tooling in
`scripts/phase5/`. The operator's runbook is
`docs/phase-5-verification-guide.md`; `docs/4f-verification-guide.md` is kept
only as a redirect and a record of the defects in the retired guide.

Why it was folded rather than kept as a gate: 4F contained no code, asked the
same questions of the same system as Phase 5, and its "blocked" status described
a calendar problem, not an engineering one. Keeping it separate made the project
read as more blocked than it was, and produced two documents describing one
session (`docs/phase-5-plan.md` §1).

The fixture half of 4F remains done, from real ATM10 data already present on this
machine:

- `packages/protocol/fixtures/atm10-recorded-snapshot.json` — a sanitized
  `minecraft.snapshot` built from the 2026-11-06 live run, validated through the
  host's `parseFrame` path. `fixtures/README.md` states its provenance and, more
  importantly, that it proves the **encoder** handles real ATM10 shapes and not
  that the **mapper** extracted them correctly.

Still not established, and not obtainable from committed material:

- Single-player and multiplayer runs with the built jar.
- Completion-driven pin removal, team change, quest reload, and world change.
- Confirmation that `FtbSnapshotMapper` produced the recorded values, rather
  than the 4A probe log.

Why it needed a human in the loop, which shaped the Phase 5 protocol:

1. **The client is a GUI game** needing an account login. This environment cannot
   spawn windows or drive a first-person game.
2. **The installed jar was Stage 4A.** `questbridge-0pre.1.jar` in the Prism
   instance's `mods` folder contains no transport and no configuration. A launch
   with it would publish nothing and prove nothing.
3. **The setup steps write outside this repository** — into the Prism instance and
   the host config directory — and are not performed without the user's
   confirmation.

Everything this milestone listed as "ready" is now wired into the Phase 5
scripts rather than described as manual steps:

| 4F asset | Now |
|---|---|
| `CapturePlan.java` | The expectations in `docs/phase-5-plan.md` §6, Sequence A |
| `scripts/validate-snapshot.mjs` | `npm run phase5:validate` |
| `-Dquestbridge.dumpSnapshot=<path>` | Read by `npm run phase5:capture` |
| Manual host start | `npm run phase5:session` |
| Manual launch checklist | `docs/phase-5-verification-guide.md` |

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

1. **Configuration transport — resolved.** The client config file was added, and
   `0pre.3` fixed the ordering that made it unreadable at startup. Token
   resolution is now four-deep (property, environment variable, config file,
   discovery) and normative in `docs/ftb-quests-integration.md` §11.1. Closed by
   `docs/proposals.md` §6.1.
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

