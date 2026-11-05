# FTB Quests Integration

**Status:** Reconnaissance complete; runtime integration not yet verified  
**Proposal status:** Proposals A–D in `docs/proposals.md` are pending review, not rejected. Proposals C and D affect adapter implementation timing and build dependencies.  
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
3. FTB Quests source at tag `v2101.1.30`, commit `89b7a6d7acf86f02aa399b941f1e7d6b8d8476de`.
4. The published FTB Quests, FTB Teams, and FTB Library JARs, inspected with `javap`.
5. The NeoForge MDK build in this repository, compiled with JDK 21. This verifies the baseline NeoForge toolchain only; the FTB Quests, Teams, and Library build dependencies are not yet declared (Proposal D, pending review).

No Minecraft client or ATM10 TTS installation exists in the development environment used for this reconnaissance. Runtime behavior therefore remains unverified until Phase 5.

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

The pack contains 55 chapter files. Those files contain roughly 3,800 quest definitions in 2.3.1. The exact number is not a protocol constant and will change with pack updates.

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

Completed pinned quests remain in the pinned set and must remain visible while pinned.

Unresolved pinned quest IDs must be reported, not silently deleted or substituted.

---

## 8. Team progression

Verified facts:

- `ClientQuestFile.selfTeamData` is the current team’s progression data.
- `TeamData.getTeamId()` exposes the team UUID.
- Team progression is shared between team members.
- Manual pins remain per player.
- On a team change, FTB sends new team data and replaces `selfTeamData`.

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
- Player UUID.
- Pinned ID set.
- Chapter progress values.
- Pinned quest and task progress.
- Relevant titles.
- Data readiness.

Snapshots must be captured on the Minecraft client thread. Serialization and network I/O must run on a background executor. FTB methods must not be called from arbitrary threads.

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
- Never call FTB APIs off the client thread.
- Never publish automatic pin ID `1` as a quest.
- Publish full snapshots after reload, world change, team change, and reconnect.
- Publish only changed data during ordinary progression.
- Reconcile every two seconds.
- Fail gracefully when FTB data or translations are unavailable.
- Log FTB version mismatches clearly.

Implementation timing follows Proposal C, which is pending review and places the adapter after the protocol, mock publisher, host, and dashboard. Compiling this adapter requires adding the exact FTB build dependencies from Proposal D, which is also pending review; the current build does not declare them.

---

## 12. Risks and assumptions

### Verified facts

- Exact ATM10 TTS 2.3.1 dependency versions.
- Exact five initial chapter IDs and titles.
- `AUTO_PIN_ID` is `1`.
- Manual pins are per-player and stored in team data.
- Pin order is not exposed.
- Chapter progress semantics and optional-quest exclusion.
- Chapter descriptions are not exposed.
- Single-player uses the same synchronization path as multiplayer.
- Baseline NeoForge build succeeds with JDK 21. FTB dependency compilation remains pending Proposal D.

### Assumptions / unverified

- The user’s installed pack is exactly ATM10SKY 2.3.1.
- Translation data arrives reliably after quest sync.
- Client-side FTB events fire as expected in the real client.
- Java’s WebSocket client works reliably inside the Minecraft client.
- OBS 33.0.1 behaves correctly with the chosen local authentication flow.
- Future FTB Quests updates may change internal classes or behavior.

### Compatibility policy

QuestBridge should compile against the exact installed FTB Quests release and declare a compatible version range. The adapter must check the detected FTB version and report a clear error rather than silently producing incorrect data.

---

## 13. Runtime verification checklist

Phase 5 must verify:

- [ ] Data unavailable during client startup.
- [ ] Data becomes ready after quest and team synchronization.
- [ ] All five ATM10 TTS chapters resolve by ID.
- [ ] Chapter titles come from FTB, not hardcoded strings.
- [ ] Chapter progress matches the FTB quest book.
- [ ] Optional quests are excluded from chapter progress.
- [ ] Manual pins appear in the overlay.
- [ ] Automatic pin ID `1` is excluded.
- [ ] Completed pinned quests remain visible.
- [ ] Task current/target progress matches FTB.
- [ ] Pin changes appear automatically within the reconciliation interval.
- [ ] Quest completion appears automatically.
- [ ] Quest reload triggers a fresh snapshot.
- [ ] World change triggers a fresh snapshot.
- [ ] Team change triggers a fresh snapshot.
- [ ] Single-player works.
- [ ] Multiplayer works without a server-side mod.
- [ ] Disconnect and reconnect restore correct state.
- [ ] Unresolved pinned quest IDs are reported safely.
- [ ] Unresolved chapter IDs remain in configuration.
