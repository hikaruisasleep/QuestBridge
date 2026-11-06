# FTB Quests Integration

**Status:** Reconnaissance complete against pack files and the exact FTB Quests `v2101.1.30` source; the target pack is installed locally, and its identity, exact mod versions, chapter catalog, FTB API class availability, network transport format, and team/pin semantics are verified from those sources; live quest synchronization in a running client is not yet verified

**Proposal status:** Proposal A is approved and applied. Proposal C is adopted and Phase 0 is applied. Proposal D is applied. Proposal B remains pending review in `docs/proposals.md`.  
**Date:** 2026-11-06  
**Target pack:** All the Mods 10: To the Sky (ATM10 TTS / ATM10SKY) 2.3.1  
**Minecraft:** 1.21.1  
**Loader:** NeoForge 21.1.250

This document records what was verified against the actual ATM10 TTS pack and the exact FTB Quests release it ships. It deliberately separates verified facts from assumptions and unverified runtime behavior.

---

## 1. Verification method

The following sources were inspected:

1. The published ATM10SKY 2.3.1 CurseForge pack archive.
2. Its `manifest.json`, `overrides/config/ftbquests/quests`, and language files.
3. FTB Quests source at tag `v2101.1.30`, commit `89b7a6d7acf86f02aa399b941f1e7d6b8d8476de`, including the `net/` payload classes, `BaseQuestFile`, `TeamData`, `PinnedQuestsTracker`, and the translation sync classes.
4. The published FTB Quests, FTB Teams, and FTB Library JARs, inspected with `javap`.
5. The NeoForge MDK build in this repository, compiled with JDK 21. The build declares the exact FTB Quests, Teams, and Library dependencies from Proposal D (applied).
6. The FTB documentation repository’s versioned 1.21.1 pages: the SNBT technical page and the quest/chapter developer pages. These document persistence and authoring, not the client-server wire protocol.

The target pack is installed locally as a Prism Launcher instance and was inspected directly on 2026-11-06; see section 1.1. Pack identity, mod versions, chapter catalog, API class availability, transport format, and team/pin semantics are therefore verified. Live quest synchronization in a running client remains unverified until Phase 5. The upstream `main` branch is not the target: it has moved to JSON5 and a newer Minecraft generation, while ATM10 TTS 2.3.1 ships `v2101.1.30`, which uses SNBT persistence and Architectury packet transport.

### Research sources

Primary sources used for the transport, team, pin, and completion findings:

- [FTB Quests `v2101.1.30` network payloads](https://github.com/FTBTeam/FTB-Quests/tree/v2101.1.30/common/src/main/java/dev/ftb/mods/ftbquests/net)
- [`SyncQuestsMessage`](https://github.com/FTBTeam/FTB-Quests/blob/v2101.1.30/common/src/main/java/dev/ftb/mods/ftbquests/net/SyncQuestsMessage.java)
- [`BaseQuestFile`](https://github.com/FTBTeam/FTB-Quests/blob/v2101.1.30/common/src/main/java/dev/ftb/mods/ftbquests/quest/BaseQuestFile.java)
- [`TeamData`](https://github.com/FTBTeam/FTB-Quests/blob/v2101.1.30/common/src/main/java/dev/ftb/mods/ftbquests/quest/TeamData.java)
- [`PinnedQuestsTracker`](https://github.com/FTBTeam/FTB-Quests/blob/v2101.1.30/common/src/main/java/dev/ftb/mods/ftbquests/client/PinnedQuestsTracker.java)
- [`ServerQuestFile` login sync flow](https://github.com/FTBTeam/FTB-Quests/blob/v2101.1.30/common/src/main/java/dev/ftb/mods/ftbquests/quest/ServerQuestFile.java)
- [`SyncTranslationTableMessage`](https://github.com/FTBTeam/FTB-Quests/blob/v2101.1.30/common/src/main/java/dev/ftb/mods/ftbquests/net/SyncTranslationTableMessage.java)
- [FTB docs: SNBT (1.21.1)](https://github.com/FTBTeam/docs/blob/main/mods_versioned_docs/version-1.21.1/mods/technical/SNBT/index.md)
- [FTB docs: quest developer pages (1.21.1)](https://github.com/FTBTeam/docs/tree/main/mods_versioned_docs/version-1.21.1/mods/suite/Quests/Developer)
- [FTB docs: pinning](https://github.com/FTBTeam/docs/blob/main/docs/marketplace/Addons/quests/howto/quests/pinning.md)

### Artifacts used

| Artifact | Version | CurseForge file ID |
|---|---:|---:|
| ATM10SKY | 2.3.1 | 9368148 |
| FTB Quests (NeoForge) | 2101.1.30 | 8589821 |
| FTB Teams (NeoForge) | 2101.1.10 | 7878281 |
| FTB Library (NeoForge) | 2101.1.35 | 8569579 |

The pack manifest pins those mod files as required and locked, so a normal installation of ATM10SKY 2.3.1 should use exactly these releases.

### Repository coordinates

FTB artifacts are published on the FTB Maven repository:

```text
https://maven.ftb.dev/releases
```

Relevant coordinates:

```text
dev.ftb.mods:ftb-quests-neoforge:2101.1.30
dev.ftb.mods:ftb-teams-neoforge:2101.1.10
dev.ftb.mods:ftb-library-neoforge:2101.1.35
```

FTB Quests depends on Architectury, which is available from:

```text
https://maven.architectury.dev/
```

---

### 1.1 Installed instance

The target pack is installed locally and was inspected directly on 2026-11-06:

```text
D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky
```

That path is specific to this development machine. The findings below are properties of the pack and its mods, not of the path.

Verified from the instance:

| Property | Value | Source |
|---|---|---|
| Pack | ATM10SKY 2.3.1 | `instance.cfg` (`ManagedPackName`, `ManagedPackVersionName`) |
| CurseForge file ID | 9368148 | `instance.cfg` (`ManagedPackVersionID`) |
| Minecraft | 1.21.1 | `mmc-pack.json`, `flame/manifest.json` |
| NeoForge | 21.1.250 | `mmc-pack.json`, `flame/manifest.json` |
| Mod count | 330 | `minecraft/mods` |
| Java | Oracle JDK 25.0.2 | `logs/debug.log` ModLauncher banner |

The instance overrides the Java location and sets `IgnoreJavaCompatibility=true`. It therefore runs on JDK 25.0.2 even though NeoForge 21.1.250 targets Java 21. A QuestBridge mod compiled for Java 21 will load on this runtime, but the adapter must not assume the client JVM is Java 21.

FTB mod versions were confirmed from each jar's `META-INF/neoforge.mods.toml`, not from filenames:

| Mod | Version | modId |
|---|---:|---|
| FTB Quests | 2101.1.30 | `ftbquests` |
| FTB Teams | 2101.1.10 | `ftbteams` |
| FTB Library | 2101.1.35 | `ftblibrary` |

These match the dependency versions declared in `minecraft-mod/build.gradle`.

The pack also ships `ftbquestslangsplitter-1.0.6.jar`, which splits the quest language file into per-chapter files under `config/ftbquests/quests/lang/en_us/chapters/`. The merged `lang/en_us.snbt` remains present alongside them. The adapter must resolve titles through FTB's translation manager and must not read language files directly.

---

### 1.2 Chapter catalog and quest volume

Measured from the installed instance:

- 55 chapter SNBT files in `config/ftbquests/quests/chapters`.
- 3,834 quest definitions, counted as quest objects inside the top-level `quests: [...]` array of each chapter file. All 3,834 quest IDs are distinct.
- 688 chapter images.
- 25 quest links.

`config/ftbquests/quests` is the only quest definition directory in the instance. The only other FTB Quests data present is per-world progression under `saves/<world>/ftbquests/`, which is runtime state, not definitions.

The earlier estimate of "roughly 3,800 quest definitions" is confirmed. The exact count is a pack property and will change with pack updates; it must not become a protocol constant.

---

### 1.3 Runtime evidence from the installed client

The instance has been launched at least twice, on 2026-11-04 and 2026-11-05. Logs from both sessions were inspected. The 2026-11-05 session loaded all mods and shut down cleanly at 18:27:31; no crash report is present in the instance.

The pack's own KubeJS client script, `kubejs/client_scripts/att_rpc.js`, loads FTB Quests classes during mod loading:

```text
[modloading-worker-0/INFO] [KubeJS Client/]: client_scripts:att_rpc.js#1: Loaded Java class 'dev.ftb.mods.ftbquests.client.ClientQuestFile'
[modloading-worker-0/INFO] [KubeJS Client/]: client_scripts:att_rpc.js#5: Loaded Java class 'dev.ftb.mods.ftbquests.events.ObjectCompletedEvent'
```

That script is part of the shipped pack and reaches this code path on every launch, so it is runtime confirmation that both classes exist and are loadable in ATM10 TTS 2.3.1 on NeoForge 21.1.250.

The same script is a working reference for the client-side access pattern this project needs:

- `ClientQuestFile.exists()` gates on the quest file having been received from the server.
- `ClientQuestFile.getInstance().selfTeamData` gates on team data having been received. The script's own comments distinguish "Quests not received from server yet" from "Quest player data not received from server yet".
- `file.getAllChapters()` and `chapter.getQuests()` enumerate the catalog and its quests.
- `file.getQuest(file.getID("504DEB70D9DAA547"))` resolves a quest from its string ID.
- `data.isCompleted(quest)` reads team completion state.
- `quest.hasTag("arr")` reads quest tags.
- `ObjectCompletedEvent.QUEST.register(...)` subscribes to quest completion and returns `EventResult.pass()`.
- World-join detection uses `Minecraft.getInstance().level` transitioning from null to non-null.
- The script polls every 40 ticks (2 seconds) with a 30-second fallback, matching the reconciliation interval recommended in this document.

What this establishes: the class names, the access pattern, and the readiness semantics in this document are correct for this exact pack and loader version.

What it does not establish: that quest data actually synchronizes in a live world, that progress values match the quest book, or that the QuestBridge adapter works. Those require Phase 5.

---

## 2. Verified ATM10 TTS chapter identifiers

The initial five chapters suggested by `AGENTS.md` were verified against the exact 2.3.1 pack files and its English language file.

| Position | Chapter ID | Title | SNBT file | `order_index` |
|---:|---|---|---|---:|
| 0 | `3B0302DB5E77C3A2` | Chapter 1: Starting out | `chapter_1_starting_out.snbt` | 0 |
| 1 | `28BCA5042050B140` | Chapter 2: The Cool Parts | `chapter_2_the_cool_parts.snbt` | 1 |
| 2 | `67E7552FDA3245F5` | Chapter 3: AllTheModium | `chapter_3_allthemodium.snbt` | 2 |
| 3 | `634794CB36D61302` | Chapter 4: The ATM Star | `chapter_4_atm_star.snbt` | 3 |
| 4 | `571D32BADC77CDD0` | Chapter 5: Creative Items | `chapter_5_creative_items.snbt` | 4 |

All five belong to chapter group `029264819125415F`, titled `Skyblock Quests`.

A stale `chapter.1A5BA37AB2194685` title entry also exists in the language file. The installed Chapter 5 file uses `571D32BADC77CDD0`. Chapter IDs must come from live FTB data, never from language-file inference.

The pack contains 55 chapter files and 3,834 quest definitions in 2.3.1, measured from the installed instance (section 1.2). The exact number is not a protocol constant and will change with pack updates.

---

## 3. Client-side data lifecycle

### 3.1 Quest file synchronization

Verified flow:

```text
ServerQuestFile.playerLoggedIn(...)
  -> SyncQuestsMessage
  -> ClientQuestFile.syncFromServer(message.file)
  -> old ClientQuestFile is deleted
  -> ClientQuestFile.INSTANCE is replaced
  -> client sends RequestTeamDataMessage
  -> server responds with SyncTeamDataMessage
  -> ClientQuestFile.selfTeamData is replaced
```

Relevant verified signatures:

```java
public static BaseQuestFile FTBQuestsClient.getClientQuestFile();
public static TeamData FTBQuestsClient.getClientPlayerData();
public static boolean FTBQuestsClient.isClientDataLoaded();

public static ClientQuestFile ClientQuestFile.INSTANCE;
public TeamData ClientQuestFile.selfTeamData;
public static boolean ClientQuestFile.exists();
public static ClientQuestFile ClientQuestFile.getInstance();
public static boolean ClientQuestFile.isQuestPinned(long id);
```

### 3.2 Readiness

`ClientQuestFile.exists()` is not sufficient on its own. `selfTeamData` starts as a locked placeholder with a nil UUID and the name `"Loading..."`.

The adapter should consider data ready only when:

```text
ClientQuestFile.exists()
&& ClientQuestFile.INSTANCE.selfTeamData != null
&& !ClientQuestFile.INSTANCE.selfTeamData.isLocked()
&& ClientQuestFile.INSTANCE.selfTeamData.getTeamId() != nil UUID
```

### 3.3 Translations

The quest-file sync and translation sync are separate. Chapter and quest titles are resolved through FTB's translation manager.

- `getTitle()` returns a localized `Component`.
- `getTitle().getString()` is suitable for the protocol.
- Immediately after quest sync, a title may temporarily resolve to a placeholder until translation data arrives.
- Periodic reconciliation will pick up the corrected title.

### 3.4 Reload, world, and team changes

The adapter must detect and publish a full snapshot after:

- `ClientQuestFile.INSTANCE` object identity changes.
- The quest file becomes unavailable.
- The player’s team ID changes.
- The client level/world identity changes.
- A disconnect or reconnect occurs.
- A translation refresh changes relevant titles.

FTB does not expose a stable world identifier for this purpose. World change detection should use Minecraft client state such as the level object identity, dimension, server data, and integrated-server world data. The exact detection fields are adapter implementation details, not part of the FTB protocol.

---

## 4. Chapter discovery

### 4.1 Verified APIs

```java
public List<Chapter> BaseQuestFile.getAllChapters();
public List<ChapterGroup> BaseQuestFile.getChapterGroups();
public Chapter BaseQuestFile.getChapter(long id);
public List<Chapter> BaseQuestFile.getVisibleChapters(TeamData data);
public void BaseQuestFile.forAllQuests(Consumer<Quest> consumer);
```

### 4.2 Catalog behavior

- `getAllChapters()` returns the complete catalog, including empty and invisible chapters.
- Chapters are grouped by `ChapterGroup`.
- Chapter order is the order within each group.
- The SNBT `order_index` values are loaded and used to sort chapters within each group.
- `Chapter.getIndex()` is group-local, not global.
- A global catalog order can be derived from the position in `getAllChapters()`.
- Chapter IDs are opaque uppercase hexadecimal strings from `QuestObjectBase.getCodeString(long)`.
- The protocol must treat chapter IDs as opaque strings.

### 4.3 Titles and descriptions

Verified APIs:

```java
Component QuestObjectBase.getTitle();
String QuestObjectBase.getRawTitle();
List<String> Chapter.getRawSubtitle();
```

- Titles are localized and may contain formatting; `getString()` removes formatting.
- FTB Quests 2101.1.30 has no chapter description accessor.
- Only chapter subtitles are available.
- The protocol may expose an optional `subtitle`; it must not claim that subtitle is a description.
- A `description` field may be omitted for chapters unless a future FTB release exposes one.

---

## 5. Chapter progress and status

### 5.1 Authoritative API

```java
public final int TeamData.getRelativeProgress(QuestObject object);
public boolean TeamData.isStarted(QuestObject object);
public boolean TeamData.isCompleted(QuestObject object);
```

`getRelativeProgress` returns an integer from 0 to 100.

Verified source behavior:

```text
if completed:
    100
else if not started:
    0
else:
    object.getRelativeProgressFromChildren(teamData)
```

### 5.2 Chapter calculation

`Chapter.getRelativeProgressFromChildren(TeamData)`:

- Returns `100` when `alwaysInvisible` is true.
- Returns `100` when the chapter has no quests.
- Returns `100` when every quest is optional for progression (count is zero).
- Otherwise iterates all chapter quests.
- Quests for which `isOptionalForProgression(data)` is true are excluded.
- `isOptionalForProgression` returns true for optional quests, repeatable quests, and quests excluded by another questline.
- Hidden/invisible quests are **not** excluded merely for being hidden.
- The remaining quest progress values are averaged using `getRelativeProgressFromChildren(sum, count)`.
- Incomplete dependencies can prevent a started quest from contributing progress.

Important consequences:

- Progress `100` does not prove the chapter was explicitly completed. Empty and `alwaysInvisible` chapters also return `100`.
- `progress` must be `null` when FTB data is unavailable. Never substitute an invented zero.
- Optional quests must not distort the chapter percentage.

### 5.3 Recommended status mapping

```text
completed  -> TeamData.isCompleted(chapter)
available  -> Chapter.isVisible(teamData)
locked     -> otherwise
unknown    -> FTB data unavailable
```

Do not derive `completed` solely from progress.

`TeamData.isCompleted(chapter)` is the only authoritative chapter-completion signal. FTB records a chapter as completed when a quest completion satisfies `chapter.isCompletedRaw(teamData)`; `Quest.onCompleted` then calls `chapter.onCompleted`, which writes the chapter ID into the team's `completed` map. Empty chapters, `alwaysInvisible` chapters, and chapters whose quests are all optional can report `progress = 100` without ever entering that map. The overlay must therefore render chapter completion from `status`, and treat `progress` as secondary information.

Chapter completion is team-wide, like all other progression state. It is not stored per player.

---

## 6. Quest and task progress

### 6.1 Verified APIs

```java
boolean TeamData.isStarted(QuestObject object);
boolean TeamData.isCompleted(QuestObject object);
long TeamData.getProgress(Task task);
int TeamData.getRelativeProgress(QuestObject object);
boolean TeamData.canStartTasks(Quest quest);

Collection<Task> Quest.getTasks();
boolean Quest.isOptional();
boolean Quest.isVisible(TeamData data);
boolean Quest.isCompletedRaw(TeamData data);
List<Component> Quest.getDescription();
Stream<QuestObject> Quest.streamDependencies();
Chapter Quest.getChapter();

TaskType Task.getType();
long Task.getMaxProgress();
boolean Task.isOptionalForProgression(TeamData data);
Component Task.getTitle();
```

### 6.2 Mapping

| Protocol value | FTB source |
|---|---|
| Quest title | `quest.getTitle().getString()` |
| Quest description | joined `quest.getDescription()` lines |
| Quest optional | `quest.isOptional()` |
| Quest hidden | `!quest.isVisible(teamData)` |
| Quest dependencies | `quest.streamDependencies()` mapped to IDs |
| Quest progress percentage | `teamData.getRelativeProgress(quest)` |
| Quest completed | `teamData.isCompleted(quest)` |
| Task title | `task.getTitle().getString()` |
| Task type | `task.getType().getTypeId().toString()` |
| Task current | `teamData.getProgress(task)` |
| Task target | `task.getMaxProgress()` |
| Task percentage | `teamData.getRelativeProgress(task)` |
| Task optional | `task.isOptionalForProgression(teamData)` |

`hidden` derived from visibility conflates explicitly hidden quests with dependency-hidden quests. That limitation should be documented in the UI or protocol notes.

### 6.3 Quest status

Recommended mapping:

```text
completed    -> teamData.isCompleted(quest)
in_progress  -> teamData.isStarted(quest) or any task progress > 0
locked       -> !teamData.canStartTasks(quest)
available    -> otherwise
unknown      -> no FTB data
```

### 6.4 Task status and numeric progress

Recommended mapping:

```text
completed    -> teamData.isCompleted(task) or progress >= maxProgress
in_progress  -> progress > 0 or teamData.isStarted(task)
incomplete   -> otherwise
unknown      -> no FTB data
```

Numeric task progress should be included whenever FTB exposes it. Boolean tasks commonly have `maxProgress == 1`; the overlay may suppress numbers for such tasks or for task types that do not display counts.

### 6.5 Required task counts

```text
totalRequiredTasks = tasks where !task.isOptionalForProgression(teamData)
completedTasks     = required tasks where teamData.isCompleted(task)
```

Optional tasks must never prevent a quest from being shown as completed.

---

## 7. Manual quest pins

### 7.1 Storage

Manual pins are per-player data stored inside the team data:

```java
LongSet TeamData.getPinnedQuestIds(Player player);
boolean TeamData.isQuestPinned(Player player, long id);
void TeamData.setQuestPinned(Player player, long id, boolean pinned);
```

The underlying storage is `TeamData.PerPlayerData.pinnedQuests`, keyed by player UUID.

This means:

- Progression is team-wide.
- Manual pin selection is per player.
- QuestBridge must read the current local player’s pins from `selfTeamData`.
- QuestBridge must never publish or modify pins.

### 7.2 Automatic pins

Verified from source and JAR:

```java
public static final int TeamData.AUTO_PIN_ID = 1;
```

Automatic tracking is represented by the special ID `1` inside the same pinned-ID set. It is not a real quest.

Verified native behavior in `PinnedQuestsTracker`:

- If the pinned set contains `AUTO_PIN_ID`, the native tracker ignores manual IDs and constructs an automatic list from currently available quests.
- Manual IDs and `AUTO_PIN_ID` can coexist.
- QuestBridge’s current-objectives list must use only real manual quest IDs.
- ID `1` must always be filtered out before resolving quests.

`TeamData.PerPlayerData` also serializes an `auto_pin` boolean, but `PinnedQuestsTracker` in this version decides auto mode from the presence of ID `1` in `pinned_quests`; the boolean is not consulted by the tracker. Auto-pin support is a lower-priority concern for QuestBridge: the MVP only needs to filter ID `1` out of the manual list. Mirroring the native auto-generated list is a later product decision.

### 7.3 Pin ordering limitation

FTB does not expose pin ordering.

- The pinned collection is a `LongOpenHashSet`.
- There is no ordering accessor.
- NBT persistence writes the IDs sorted numerically.
- Network sync writes set iteration order.

Therefore:

- QuestBridge cannot preserve native pin order.
- The overlay should use a deterministic fallback order.
- Recommended fallback: chapter catalog order, then quest order within the chapter.
- This fallback must be documented as an intentional presentation choice, not as FTB ordering.

### 7.4 Pin updates

Verified flow:

```text
TogglePinnedMessage (client -> server)
  -> server toggles PlayerData.pinnedQuests
  -> TogglePinnedResponseMessage (server -> client)
  -> client updates selfTeamData
```

There is no public client event dedicated to pin changes. The adapter must detect changes through reconciliation. A two-second interval is sufficient for the overlay.

Completed pinned quests are **removed by FTB**, not retained. In `TeamData.markTaskCompleted`, when a task completion causes the quest to become completed, the server removes that quest ID from every player’s `pinned_quests` and sends `TogglePinnedResponseMessage(questId, false)`. QuestBridge must follow FTB: once an objective disappears from the pin set it is no longer a current objective, and the overlay must not fabricate a completed pinned entry. A brief completed state may be observable only if a reconciliation snapshot races the completion packet. This also means the user-facing `pinning.md` wording (“until you unpin them or claim the reward”) is imprecise for `v2101.1.30`: the pin is removed at completion, before any reward claim.

Unresolved pinned quest IDs must be reported, not silently deleted or substituted.

---

## 8. Team progression and player data

Verified facts:

- FTB progression is team-wide. `task_progress`, `started`, `completed`, `completion_count`, and `repeatable` are stored on `TeamData`, not on individual players.
- Chapter and quest completion therefore come from the current team’s data. Selecting a player UUID is not required to read completion or progress.
- `player_data` is the only per-player section. It maps player UUID to `can_edit`, `auto_pin`, and `pinned_quests`; it carries no progression.
- `ClientQuestFile.selfTeamData` is the current team’s data.
- `TeamData.getTeamId()` exposes the team UUID.
- On a team change, FTB sends new team data and replaces `selfTeamData`.
- In ATM10TTS, quests are set up for team-wide completion and the team is treated as a single progression unit. Selecting a specific player UUID or an arbitrary `player_data` entry does not change the progression or chapter-completion data retrieved. The adapter should not gate chapter completion or progression on player selection.
- Stock FTB still stores pins per player. The ATM10TTS uniformity is a pack/usage property, not a universal FTB guarantee; revisit this assumption if a future pack gives team members different pin sets.

The adapter should publish a full snapshot when the team ID changes.

QuestBridge does not need to call the FTB Teams API directly for normal progression. `selfTeamData` already represents the correct team.

---

## 9. Events and reconciliation

### 9.1 Events available

```java
ObjectStartedEvent.GENERIC / QUEST / TASK / CHAPTER / FILE
ObjectCompletedEvent.GENERIC / QUEST / TASK / CHAPTER / FILE
ClearFileCacheEvent
```

These are internal FTB classes built on Architectury events.

### 9.2 Event limitations

- Start and completion events are useful for low-latency updates.
- `UpdateTaskProgressMessage` updates numeric task progress on the client without firing an event by itself.
- `ClearFileCacheEvent` fires on many cache invalidations and is too noisy to use as the sole trigger.
- Pin changes have no dedicated public client event.

### 9.3 Required approach

Use both:

1. Client-side event hooks for start, completion, and reload responsiveness.
2. Periodic reconciliation, initially every two seconds, as the authoritative fallback.

Reconciliation should compare:

- Quest file instance identity.
- Team ID.
- Player UUID (for pin storage; not required for ATM10TTS progression).
- Pinned ID set.
- Chapter progress values.
- Chapter completion values.
- Pinned quest and task progress.
- Relevant titles.
- Data readiness.

Snapshots must be captured on the Minecraft client thread. Serialization and network I/O must run on a background executor. FTB methods must not be called from arbitrary threads.

### 9.4 FTB’s own network transport (verified)

FTB does not use QuestBridge’s JSON/WebSocket format, and it does not send SNBT over the network. In `v2101.1.30`, synchronization uses Minecraft custom payloads:

- Payloads implement `CustomPacketPayload` and are registered through FTB Library’s `NetworkHelper` over Architectury’s `NetworkManager`.
- The payload body is a binary `FriendlyByteBuf` encoded by a `StreamCodec`, not JSON or NBT text.
- Packet type IDs are namespaced under `ftbquests`, for example `ftbquests:sync_quests_message` and `ftbquests:sync_team_data_message`.

Full synchronization on login:

```text
Server -> client: ftbquests:sync_quests_message
  BaseQuestFile.STREAM_CODEC -> writeNetDataFull(buf)
  - task type table (identifier -> internal id)
  - reward type table
  - file-level settings
  - chapter groups, chapters, quests, tasks, rewards, links, images
  - per-object network data (icons, tags, chapter/quest/task-specific fields)
Client  -> server: request team data
Server -> client: ftbquests:sync_team_data_message
  TeamData.STREAM_CODEC
  - team UUID and name
  - task progress map
  - started/completed/repeatable maps (timestamps sent relative to now)
  - completion counts
  - locked and rewards-blocked flags
  - claimed rewards
  - per-player data: can_edit, auto_pin, pinned_quests
```

Translations are separate. The server sends `ftbquests:sync_translation_table` for the active locale on login, and `ftbquests:sync_translation_to_client` when a quest object’s translation changes. Quest titles can therefore be unresolved immediately after the quest-file sync.

Ordinary changes are incremental packets, not full snapshots:

- `ftbquests:update_task_progress_message` — team UUID, task ID, new progress.
- `ftbquests:object_started_message` / `object_completed_message` — team UUID and object ID.
- `ftbquests:toggle_pinned_message` (client → server) and `toggle_pinned_response_message` (server → client).
- `ftbquests:team_data_changed_message`, `update_team_data_message`, `sync_lock_message`, `sync_reward_blocking_message`, and others.

Identifiers are binary `long` values on the wire. FTB renders them as 16-character uppercase hexadecimal strings with `QuestObjectBase.getCodeString(long)` (`%016X`). QuestBridge uses those strings as opaque IDs.

Persistence is a different format from transport. In `v2101.1.30`, quest definitions and team data are stored as SNBT (`.snbt`). The current upstream `main` branch has moved to JSON5 for a newer Minecraft generation; it must not be used as the target reference for ATM10 TTS 2.3.1.

Consequences for QuestBridge:

- The adapter must read FTB’s synchronized in-memory state; it must not parse, replay, or forward FTB packet bytes.
- The host must not depend on Minecraft, `FriendlyByteBuf`, FTB task/reward registry IDs, or NBT.
- QuestBridge’s WebSocket protocol remains the normalized boundary between the adapter and the host. FTB’s transport is internal, version-specific, and not available outside the Minecraft client connection.
- The docs repository documents SNBT and quest authoring, not this wire protocol; the source tag is authoritative for transport details.

---

## 10. Single-player and multiplayer

### 10.1 Single-player

Verified by source inspection:

- Single-player uses an integrated server.
- The integrated server uses the same `ServerQuestFile.playerLoggedIn()` path.
- It sends the same quest, team-data, and progression packets.
- The client uses the same `ClientQuestFile` path.

Therefore the client-only adapter should work without special single-player code.

### 10.2 Multiplayer

- FTB Quests and FTB Teams must be installed on the server; the ATM10 TTS pack includes them.
- QuestBridge requires no server-side mod.
- QuestBridge reads only synchronized client-side state.
- QuestBridge does not access server files, saved quest data, or Pterodactyl APIs.

### 10.3 Pending runtime verification

Both single-player and multiplayer must be manually tested in Phase 5.

---

## 11. Adapter design implications

The Java mod should isolate all FTB access behind a small interface, for example:

```java
interface QuestProgressProvider {
    boolean isAvailable();
    QuestSnapshot captureSnapshot();
    void registerListeners(ProgressListener listener);
}
```

The implementation may use internal FTB classes, but no other package should depend on them.

Requirements:

- Client-only mod.
- Read-only access.
- Read FTB’s synchronized in-memory client state; never parse, replay, or forward FTB packet bytes.
- Never call FTB APIs off the client thread.
- Never publish automatic pin ID `1` as a quest. Auto-pin mode reconstruction is out of MVP scope.
- Treat chapter completion as `TeamData.isCompleted(chapter)`; never infer it from progress.
- Publish full snapshots after reload, world change, team change, and reconnect.
- Publish only changed data during ordinary progression.
- Reconcile every two seconds.
- Fail gracefully when FTB data or translations are unavailable.
- Log FTB version mismatches clearly.

Implementation timing originally followed Proposal C, which placed the adapter after the protocol, mock publisher, host, and dashboard. By explicit product decision, Phase 2 (host) and Phase 3 (dashboard) are now deferred; the adapter proceeds against the standalone collector. The exact FTB build dependencies from Proposal D are declared, so the adapter can compile against them. The detailed Stage 4 plan is in `docs/phase-4-plan.md`.

---

## 12. Risks and assumptions

### Verified facts

- Exact ATM10 TTS 2.3.1 dependency versions.
- The target pack is installed locally and is exactly ATM10SKY 2.3.1 on Minecraft 1.21.1 and NeoForge 21.1.250 (section 1.1).
- The installed instance ships FTB Quests 2101.1.30, FTB Teams 2101.1.10, and FTB Library 2101.1.35, confirmed from each jar's mod manifest (section 1.1).
- `dev.ftb.mods.ftbquests.client.ClientQuestFile` and `dev.ftb.mods.ftbquests.events.ObjectCompletedEvent` exist and load at runtime in this pack (section 1.3).
- The installed chapter catalog contains 55 chapters and 3,834 quests (section 1.2).
- Exact five initial chapter IDs and titles.
- `AUTO_PIN_ID` is `1`. `PinnedQuestsTracker` uses that ID; the per-player `auto_pin` boolean is serialized but not consulted by the tracker.
- Manual pins are per-player and stored in `team_data.player_data[uuid].pinned_quests`.
- Progression, chapter completion, and quest completion are team-wide and live on `TeamData`, not in `player_data`.
- In ATM10TTS, the team is treated as a single progression unit; selecting a player UUID or an arbitrary `player_data` entry does not change the progression view.
- Pin order is not exposed.
- Chapter progress semantics and optional-quest exclusion.
- Chapter completion is recorded by `Quest.onCompleted` calling `chapter.onCompleted` after `chapter.isCompletedRaw(teamData)`; `TeamData.isCompleted(chapter)` is authoritative.
- FTB removes a completed quest from the pin set and notifies clients with `TogglePinnedResponseMessage(id, false)`.
- FTB’s sync transport is binary Minecraft custom payloads using `StreamCodec`/`FriendlyByteBuf`, not JSON or SNBT.
- Translations are synchronized separately from the quest file.
- Chapter descriptions are not exposed.
- Background: the FTB docs repository does not specify the client-server wire protocol; its SNBT and developer pages cover persistence and authoring.
- Single-player uses the same synchronization path as multiplayer.
- Baseline NeoForge build succeeds with JDK 21. The exact FTB dependency compilation is declared and resolves (Proposal D applied).

### Assumptions / unverified

- The pack installed on this machine is ATM10SKY 2.3.1; that is verified here but remains an assumption on any other machine.
- The ATM10TTS assumption that team members share the same effective pin/progression view may not hold for other packs or team configurations. Stock FTB stores pins per player.
- Translation data arrives reliably after quest sync. The pack ships a language splitter and keeps the merged file, so the translation source is not a single file.
- Client-side FTB events fire as expected in the real client. `ObjectCompletedEvent` is confirmed to exist and be loadable; its firing behaviour is not.
- Java’s WebSocket client works reliably inside the Minecraft client.
- OBS 33.0.1 behaves correctly with the chosen local authentication flow.
- Future FTB Quests updates may change internal classes or behavior.

### Compatibility policy

QuestBridge should compile against the exact installed FTB Quests release and declare a compatible version range. The adapter must check the detected FTB version and report a clear error rather than silently producing incorrect data.

---

## 13. Runtime verification checklist

Already established by inspection and client logs: the five chapter IDs and their titles exist in the pack data (section 2), the title and description accessors are documented from the FTB source and jars (section 4.3), and the client-side access pattern is loadable in this pack (section 1.3).

The remaining items require a live client and must be verified in Phase 5:

- [ ] Data unavailable during client startup.
- [ ] Data becomes ready after quest and team synchronization.
- [ ] All five ATM10 TTS chapters resolve by ID.
- [ ] Chapter titles come from FTB, not hardcoded strings.
- [ ] Chapter progress matches the FTB quest book.
- [ ] Chapter completion uses `TeamData.isCompleted(chapter)`, not `progress == 100`.
- [ ] Optional quests are excluded from chapter progress.
- [ ] Manual pins appear in the overlay.
- [ ] Automatic pin ID `1` is excluded.
- [ ] A completed quest is removed from the pin set by FTB, and the overlay reflects that removal rather than fabricating a retained objective.
- [ ] Task current/target progress matches FTB.
- [ ] Pin changes appear automatically within the reconciliation interval.
- [ ] Quest completion appears automatically.
- [ ] The adapter reads in-memory client state; it does not parse or forward FTB packet bytes.
- [ ] Quest reload triggers a fresh snapshot.
- [ ] World change triggers a fresh snapshot.
- [ ] Team change triggers a fresh snapshot.
- [ ] Single-player works.
- [ ] Multiplayer works without a server-side mod.
- [ ] Disconnect and reconnect restore correct state.
- [ ] Unresolved pinned quest IDs are reported safely.
- [ ] Unresolved chapter IDs remain in configuration.
