# Chapter Pinning

**Status:** Specification, not yet implemented  
**Proposal status:** Proposal A is approved and applied. Proposals B–D remain pending review in `docs/proposals.md`. Implementation timing is subject to Proposal C, and dashboard access control is subject to Proposal B.  
**Date:** 2026-11-06

Chapter pins are QuestBridge’s only quest-related selection mechanism. They represent long-term pack progression and are managed exclusively through the QuestBridge dashboard.

They are independent from FTB Quests manual quest pins:

- **Chapter pins belong to QuestBridge.** The user selects up to five major chapters.
- **Quest pins belong to FTB Quests.** The user manages current objectives inside Minecraft.

QuestBridge must never automatically select chapters, automatically fill empty slots, or manage FTB quest pins.

---

## 1. Purpose

The overlay’s major-progression section must show exactly the chapters configured by the user.

It must not:

- Show every discovered chapter.
- Infer “important” chapters.
- Depend on the currently open FTB quest-book chapter.
- Substitute a different chapter if an ID is missing.
- Delete an unresolved configuration entry.

The dashboard exists primarily to manage this list.

---

## 2. Configuration model

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

### 2.1 Persisted example

```json
{
  "version": 1,
  "chapterPins": {
    "maxPins": 5,
    "pinnedChapters": [
      { "chapterId": "3B0302DB5E77C3A2", "position": 0 },
      { "chapterId": "28BCA5042050B140", "position": 1 },
      { "chapterId": "67E7552FDA3245F5", "position": 2 },
      { "chapterId": "634794CB36D61302", "position": 3 },
      { "chapterId": "571D32BADC77CDD0", "position": 4 }
    ]
  }
}
```

Those are the actual ATM10 TTS 2.3.1 chapter IDs for the suggested initial chapters:

| Position | Chapter ID | Title |
|---:|---|---|
| 0 | `3B0302DB5E77C3A2` | Chapter 1: Starting out |
| 1 | `28BCA5042050B140` | Chapter 2: The Cool Parts |
| 2 | `67E7552FDA3245F5` | Chapter 3: AllTheModium |
| 3 | `634794CB36D61302` | Chapter 4: The ATM Star |
| 4 | `571D32BADC77CDD0` | Chapter 5: Creative Items |

They are documented as examples and recommended starting selections. The application must not seed them automatically.

---

## 3. Invariants

The following must always hold:

1. `maxPins` is always `5`.
2. `pinnedChapters` contains zero to five entries.
3. A chapter ID appears at most once.
4. Positions are unique.
5. Positions are contiguous, starting at `0`, after every successful operation.
6. Fewer than five pins is valid.
7. Empty configuration is valid.
8. Chapter IDs are opaque strings. They must not be parsed as names or assumed to be numeric.
9. Unresolved chapter IDs remain stored.
10. Pin order is controlled by QuestBridge configuration, not by FTB.

Positions are presentation order. They are not FTB chapter indices.

---

## 4. Operations

The host is authoritative for chapter pin configuration.

### 4.1 Read configuration

Returns the current `ChapterPinConfig` and the current chapter catalog.

The dashboard receives both:

- The raw pin configuration.
- The resolved catalog, including any missing chapters represented as unresolved.

### 4.2 Pin a chapter

Request:

```json
{
  "type": "chapter.pin",
  "payload": {
    "chapterId": "3B0302DB5E77C3A2"
  }
}
```

Rules:

- Reject if the chapter ID is already pinned.
- Reject if five chapters are already pinned.
- Reject if the chapter ID is not present in the current catalog.
- Reject unknown or malformed IDs.
- New pins are appended at the end.
- Positions are normalized after insertion.

### 4.3 Unpin a chapter

Request:

```json
{
  "type": "chapter.unpin",
  "payload": {
    "chapterId": "3B0302DB5E77C3A2"
  }
}
```

Rules:

- Reject if the chapter is not pinned.
- Unpinning an unresolved chapter ID is allowed.
- Positions are normalized after removal.

### 4.4 Reorder chapters

Request:

```json
{
  "type": "chapter.reorder",
  "payload": {
    "chapterIds": [
      "28BCA5042050B140",
      "3B0302DB5E77C3A2",
      "67E7552FDA3245F5",
      "634794CB36D61302",
      "571D32BADC77CDD0"
    ]
  }
}
```

Rules:

- The list must contain exactly the currently pinned chapter IDs.
- The list must not add or remove IDs.
- Duplicates are rejected.
- More than five IDs are rejected.
- Positions are assigned from the array order.
- Unresolved IDs are allowed in the reorder list because they are part of the existing configuration.

### 4.5 Update display configuration

Request:

```json
{
  "type": "config.update",
  "payload": {
    "display": {
      "showChapterProgress": true,
      "showQuestTasks": true,
      "showCompletedQuests": true,
      "completionAnimation": true,
      "theme": "minimal",
      "compactMode": true
    }
  }
}
```

Only the dashboard may perform this operation. The authorization mechanism is subject to Proposal B, which is pending review; the proposed design uses a separate control token and dashboard cookie.

### 4.6 Response

After every successful mutation, the host:

1. Persists the new configuration atomically.
2. Recomputes normalized state.
3. Broadcasts the updated configuration and state to connected browsers.
4. Returns the updated configuration to the requesting dashboard.

---

## 5. Position normalization

After every mutation:

```text
sort entries by position
assign position = index
```

The output must always have contiguous positions.

Example:

Before unpin:

```json
[
  { "chapterId": "A", "position": 0 },
  { "chapterId": "B", "position": 1 },
  { "chapterId": "C", "position": 2 }
]
```

After unpinning `B`:

```json
[
  { "chapterId": "A", "position": 0 },
  { "chapterId": "C", "position": 1 }
]
```

---

## 6. Resolution against the catalog

The live FTB chapter catalog is authoritative for:

- Chapter existence.
- Title.
- Subtitle.
- Progress.
- Status.
- Ordering metadata.

The host matches configured `chapterId` values against catalog IDs.

### 6.1 Resolved chapter

A configured pin resolves when the catalog contains the exact ID.

The overlay displays:

- Chapter title from FTB.
- Progress from FTB.
- Completion/locked state.
- Position from QuestBridge configuration.

### 6.2 Unresolved chapter

A configured pin is unresolved when:

- No Minecraft data is available yet.
- The chapter was removed by a modpack update.
- The chapter ID changed.
- FTB data has not synchronized.

Rules:

- Preserve the stored entry.
- Do not automatically remove it.
- Do not substitute another chapter.
- Do not hide the problem silently.
- Display an explicit unresolved state in the dashboard.
- Display an appropriately minimal unresolved entry in the overlay if that pin occupies a visible slot.

Unresolved entries are configuration, not errors to be repaired automatically.

### 6.3 Missing catalog before synchronization

Before the first FTB snapshot, all pins are unresolved. The overlay must show a disconnected/synchronizing state rather than implying the chapters no longer exist.

---

## 7. Persistence

Configuration is owned by the host and must survive:

- Minecraft restart.
- Host restart.
- World changes.
- Server changes.
- Modpack updates.
- OBS refresh.

Requirements:

- Store configuration in a dedicated QuestBridge config directory.
- Use atomic write-and-rename.
- Restrict file permissions where supported.
- Include a schema version.
- Migrate old versions explicitly.
- Validate on load.
- If validation fails, preserve the original file and report the error rather than overwriting user data.
- Never remove unresolved chapter pins during load or migration.

Suggested location on Linux:

```text
~/.config/questbridge/config.json
```

An override via environment variable is useful for tests and development.

---

## 8. Dashboard behavior

### 8.1 Chapter catalog

Display discovered chapters with:

- Title.
- Subtitle where available.
- Progress.
- Status.
- Search.
- Pin/unpin action.
- Pinned indication.
- Disabled pin action when five slots are occupied.

The catalog must show all discovered chapters, not only currently visible ones. Chapter status and visibility are separate concerns.

### 8.2 Pinned chapters

Display the current ordered list with:

- Position.
- Title or unresolved ID.
- Progress.
- Status.
- Reorder controls.
- Unpin action.

Reordering should update the overlay preview immediately after host confirmation.

### 8.3 Maximum-five behavior

When five chapters are pinned:

- Disable additional pin actions.
- Show a clear explanation.
- Keep unpin and reorder available.

Do not automatically evict an existing pin.

### 8.4 Unresolved display

Use a clear but muted presentation:

```text
Unresolved chapter
3B0302DB5E77C3A2
```

The dashboard should offer unpin, not automatic replacement.

### 8.5 No automatic selection

The dashboard must not:

- Pre-pin chapters.
- Suggest chapters based on progress.
- Auto-fill empty slots.
- Reorder pins automatically.
- Remove pins because they are complete.

---

## 9. Overlay behavior

The major-progression section shows exactly the configured pins in configured order.

Rules:

- Empty configuration produces an empty or hidden progression section.
- No fabricated chapters.
- No chapter catalog dump.
- No automatic filling.
- No dependence on the FTB quest-book selection.
- Completed chapters stay visible.
- Locked chapters display accurately.
- Unresolved chapters display accurately.
- Progress is hidden or shown according to display configuration.
- Progress `null` must not render as `0%`.

### 9.1 Suggested presentation

For each pinned chapter:

```text
Chapter title
[progress bar]
62%
```

Optional secondary text may include completion state.

Unresolved:

```text
Unresolved chapter
```

Keep the overlay minimal and readable over gameplay.

---

## 10. Interoperability with quest pins

Chapter pins and quest pins are intentionally independent.

- Changing chapter pins never changes FTB quest pins.
- Changing FTB quest pins never changes chapter pins.
- Quest pin ordering does not affect chapter ordering.
- Chapter progress does not depend on which quests are pinned.
- The dashboard must not expose a second quest-pinning system.

FTB Quests remains the only place where current objectives are selected.

---

## 11. Validation and errors

Rejected operations should return structured errors:

```text
duplicate_chapter
too_many_pins
unknown_chapter
invalid_position
invalid_reorder_set
invalid_request
unauthorized
unsupported_protocol
```

The dashboard should display actionable messages.

The host must not partially apply an invalid operation.

---

## 12. Concurrency

- The host serializes configuration mutations.
- The dashboard is not assumed to be the only client.
- After a mutation, all connected dashboards receive the authoritative configuration.
- A stale dashboard attempting to reorder based on old data must receive an error and refresh.
- Configuration writes are atomic.

---

## 13. Tests

### Host tests

- Empty configuration loads.
- One through five pins load.
- Six pins are rejected.
- Duplicate pins are rejected.
- Invalid positions are rejected or normalized.
- Pin appends correctly.
- Unpin normalizes positions.
- Reorder preserves the exact set.
- Reorder with added/removed IDs is rejected.
- Unresolved IDs survive unpin/reorder of other entries.
- Unresolved IDs survive host restart.
- Unknown chapter cannot be newly pinned.
- Catalog reload does not delete pins.
- Configuration migration preserves unresolved entries.
- Concurrent mutations remain consistent.

### Frontend tests

- Empty catalog.
- Empty pin list.
- One through five pinned chapters.
- Five-pin limit disables additional pinning.
- Reordering.
- Unpinning.
- Unresolved chapter.
- Completed chapter.
- Locked chapter.
- Missing progress.
- Disconnected state.
- Stale snapshot state.

### Integration tests

- Pins persist across host restart.
- Pins persist across Minecraft restart.
- Pins survive world change.
- Pins survive modpack chapter-ID changes.
- Overlay displays exactly the configured pins.
- Overlay does not populate empty slots.

---

## 14. Non-goals

Chapter pinning does not include:

- Automatic chapter selection.
- Chapter suggestions.
- More than five pins.
- Multiple named pin profiles.
- Per-world pin sets.
- Syncing chapter pins through Minecraft.
- Writing any data into FTB Quests.
- Managing quest pins.
- Replacing the FTB Quests GUI.

These may be considered later without changing the initial architecture.
