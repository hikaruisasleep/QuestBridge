# QuestBridge Protocol v1

**Status:** Protocol v1 is implemented in `@questbridge/protocol` and exercised by `@questbridge/mock-publisher` (Phase 1). The FTB Quests adapter is not yet implemented; runtime compatibility is Phase 4–5 work. The specification is informed by the FTB Quests `v2101.1.30` source. MVP priority is reading FTB’s manually pinned quests from client memory and displaying completion for the selected chapters; auto-pin behavior is explicitly deferred.
**Date:** 2026-11-06
**Applies to:** the Minecraft adapter, the mock publisher, the host, and the Svelte frontend.
**Security note:** Proposal B (token transport authentication) was adopted on 2026-11-06 and simplified to two tokens with no cookies; the normative design is `docs/local-authentication.md`. This document defines the message contract and assumes the host has already authenticated the connection and established its role. Transport authentication, origin checks, and token handling are deliberately out of scope here.

This document is the normative contract between the four components. Where it disagrees with `docs/architecture.md`, this document is more specific; where it disagrees with `AGENTS.md`, `AGENTS.md` wins.

---

## 1. Scope

The protocol carries:

- FTB Quests chapter catalog, chapter progress, and chapter status from Minecraft to the host.
- The manually pinned FTB Quests, resolved against the quest file, from Minecraft to the host. Stock FTB stores these per player; ATM10TTS treats the team as a single progression unit.
- Quest and task progress for those pinned quests.
- Connection and synchronization lifecycle information.
- Host-owned chapter pin configuration and display settings to browsers.
- Dashboard chapter-pin mutations to the host.
- Explicit error responses.

The protocol does **not** carry:

- The full FTB quest book. Only the pinned objectives travel in full. ATM10 TTS 2.3.1 has roughly 3,834 quests, and transmitting all of them is unnecessary and risks message-size limits.
- Quest pin mutations. FTB Quests is the only interface that changes quest pins.
- Chapter pin configuration from Minecraft. Chapter pins belong to QuestBridge.
- Authentication credentials. These are transport concerns, defined in `docs/local-authentication.md`.
- Binary payloads, file paths, or commands.

---

## 2. Transport and roles

| Property | Value |
|---|---|
| Transport | WebSocket, text frames containing UTF-8 JSON |
| Default endpoint | `ws://127.0.0.1:8765/ws` |
| Binding | Loopback only (`127.0.0.1`), never `0.0.0.0` |
| Maximum message size | 256 KiB (262,144 bytes), enforced before parsing |
| Fragmentation | Not used by QuestBridge senders; receivers must still reassemble |
| Compression | Disabled |
| Binary frames | Rejected |

Three roles exist on the same endpoint:

| Role | Peer | Permissions |
|---|---|---|
| `minecraft` | NeoForge mod or mock publisher | Publish Minecraft state and progress. Read host control messages. |
| `overlay` | OBS Browser Source | Read-only. Receives state. May request resync. |
| `control` | Local dashboard | Read state and perform chapter-pin and display mutations. |

The role is established by the first message on the connection:

- `minecraft.hello` establishes the `minecraft` role.
- `browser.hello` with `role: "overlay"` or `role: "control"` establishes a browser role.

Any other first message is a protocol error and the host closes the connection. A connection that does not send a valid first message within 5 seconds is closed.

The host runs with transport authentication; the shipped host refuses an upgrade
without a valid token (`docs/local-authentication.md`). Role claims in the first
message are only trustworthy because the transport is authenticated and the host
enforces the declared role for the connection's lifetime (accepted risk R1 means
either browser role may be declared with the browser token). The standalone
collector runs without authentication, and is a development tool rather than a
release-ready host.

### 2.1 Endpoint discovery

The default port is `8765`. The host may be configured to another port. Browsers and the adapter receive the actual port from the host's startup output or configuration; the protocol itself does not negotiate ports.

The WebSocket path is `/ws`, implemented and stable since Phase 2. Both roles share it; the first message determines the role.

### 2.2 Relationship to FTB’s internal transport

FTB’s own client-server synchronization is **not** this protocol, and QuestBridge must not tunnel or reuse it.

In FTB Quests `v2101.1.30`:

- Payloads implement Minecraft’s `CustomPacketPayload` and are registered through FTB Library’s `NetworkHelper` over Architectury’s `NetworkManager`.
- Payload bodies are binary `FriendlyByteBuf` encoded by `StreamCodec`; they are neither JSON nor SNBT.
- `ftbquests:sync_quests_message` sends the full quest-file object graph. The client replaces its quest file and requests team data.
- `ftbquests:sync_team_data_message` sends team progression, team metadata, and per-player `can_edit` / `auto_pin` / `pinned_quests`.
- Translations arrive separately through `sync_translation_table` and `sync_translation_to_client`.
- Ordinary changes use incremental packets such as `update_task_progress_message`, `object_started_message`, `object_completed_message`, and `toggle_pinned_response_message`.
- Identifiers are binary `long` values on the wire; the Java API renders them as 16-character uppercase hex through `QuestObjectBase.getCodeString(long)`.
- Quest definitions and team data are persisted as SNBT in this release. The upstream `main` branch has moved to JSON5 for a newer Minecraft generation and is not the target reference.

Consequences for this contract:

- The adapter reads FTB’s synchronized **in-memory** client state on the Minecraft thread and projects it into this JSON protocol.
- The adapter must not parse, replay, or forward FTB packet bytes, and the host must not depend on Minecraft, `FriendlyByteBuf`, FTB task/reward registry IDs, or NBT.
- FTB’s transport is internal, version-specific, and confined to the Minecraft client-server connection; it is not an external protocol that a Node host can join.

---

## 3. Envelope

Every message is a JSON object with this shape:

```json
{
  "protocolVersion": 1,
  "type": "minecraft.snapshot",
  "timestamp": "2026-11-06T12:34:56.789Z",
  "sequence": 42,
  "sessionId": "4f6f3f3e-6f1a-4f3e-9f0a-2b6c8d1e5a70",
  "requestId": "0f5e2c1a-8b7d-4f3a-9c2e-1d4b6a8c0e2f",
  "payload": {}
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `protocolVersion` | integer | Always | Must equal `1`. Any other value is rejected with `unsupported_protocol`. |
| `type` | string | Always | One of the message types in section 6. Unknown types are rejected. |
| `timestamp` | string | Always | ISO 8601 instant with a `Z` suffix or explicit offset, millisecond precision recommended. Informational only; not used for ordering or security. |
| `sequence` | integer | See section 7 | Positive integer, monotonic per connection. Required for `minecraft.*` and all host-to-browser messages. Optional for browser-to-host messages. |
| `sessionId` | string | See section 7 | Stable adapter session identifier. Required on all `minecraft.*` messages. Forbidden on browser messages. |
| `requestId` | string | No | Client-generated correlation identifier. Echoed on the matching reply or error. Unique per connection. |
| `payload` | object | Always | Message-specific. May be empty (`{}`), but must be present. |

Envelope rules:

- Objects are strict: every object defined by this document rejects unknown fields. Adding a field requires a protocol version change.
- Missing required fields, wrong JSON types, and unknown fields are rejected with `invalid_message`.
- `null` is only accepted where a field is explicitly nullable. It is never a substitute for an omitted optional field.
- Numbers are IEEE 754 doubles on the wire but must be integers where this document says integer.
- Strings are Unicode; IDs are compared byte-for-byte, case-sensitively.

---

## 4. Versioning

- `PROTOCOL_VERSION = 1` is a single integer major version.
- The Java adapter implements the same wire format manually and declares the version it speaks in `minecraft.hello`.
- Version negotiation is one-shot: a peer either supports version `1` or the connection fails with `unsupported_protocol`.
- Additive changes (new optional fields, new message types) are **not** backward compatible under this policy because objects are strict. Such changes require version `2`.
- The host and frontend must reject messages with an unsupported version before validating the payload.

---

## 5. Connection lifecycle

### 5.1 Minecraft publisher

```text
mod                              host
 |                                |
 |-- minecraft.hello ------------>|
 |<--------------- host.welcome --|
 |-- minecraft.status ----------->|   phase: unavailable | synchronizing
 |-- minecraft.heartbeat -------->|   every 5 s while connected
 |-- minecraft.snapshot --------->|   when FTB data becomes ready
 |-- minecraft.heartbeat -------->|
 |-- minecraft.progress --------->|   ordinary changes
 |-- minecraft.pins ------------->|   manual pin set changes
 |-- minecraft.heartbeat -------->|
```

Rules:

1. The first message must be `minecraft.hello`, with `protocolVersion: 1` and a `sessionId`.
2. The host validates the version and required version strings, then replies with `host.welcome`, or with `host.error` and closes.
3. After welcome, the adapter sends `minecraft.status` reflecting readiness. It must not send a snapshot until FTB data is ready.
4. When FTB data becomes ready, the adapter sends a full `minecraft.snapshot`.
5. Thereafter the adapter sends `minecraft.progress` and `minecraft.pins` for changes, and `minecraft.heartbeat` every 5 seconds.
6. A full snapshot is sent again after a quest reload, world change, server change, team change, error recovery, or host-requested resync.
7. On host restart, the adapter reconnects automatically with exponential backoff (1, 2, 4, 8 seconds, capped at 30 seconds) and sends a fresh full snapshot.
8. The adapter must never send a snapshot captured off the Minecraft client thread. Threading is an adapter concern; the wire format is unchanged.

### 5.2 Browser

```text
browser                          host
 |                                |
 |-- browser.hello -------------->|   role: overlay | control
 |<--------------- state.snapshot |   sequence 1
 |<--------------- connection.status (when it changes)
 |<--------------- state.update / chapter.pins.update / config.update
 |-- state.resync --------------->|   after a sequence or revision gap
 |<--------------- state.snapshot |
```

Rules:

1. The first browser message must be `browser.hello`. The host validates the role, then sends a `state.snapshot` immediately.
2. The snapshot is built from host memory. An OBS refresh must not require a new Minecraft snapshot.
3. If no Minecraft data has ever been received, the snapshot still contains connection status, display configuration, and chapter pins, with empty catalog and objective arrays.
4. The overlay role may not send mutations. If it does, the host replies with `request.error` code `unauthorized` and does not change state.
5. The control role may send `chapter.pin`, `chapter.unpin`, `chapter.reorder`, and `config.update`.
6. A browser may send `state.resync` at any time to request a fresh full snapshot.

### 5.3 Disconnect and staleness

- The host marks Minecraft stale after 20 seconds without a heartbeat and disconnected after the WebSocket closes or 30 seconds without a heartbeat. The loosened thresholds detect a publisher that has genuinely gone away; they are not a latency signal, and a brief stutter or deferred update must not trip them (`docs/web-frontend.md` §3.4).
- Stale or disconnected data is retained internally. The host does not clear the catalog or objectives merely because Minecraft disconnected. The `stale` flag is reported to browsers, but a stale state is deliberately not marked on the overlay; the overlay fades out on `disconnected` instead (`docs/web-frontend.md` §3.4).
- On reconnect, a new full snapshot is required before the state is treated as live again.
- A browser disconnect does not affect host state.

---

## 6. Message catalog

### 6.1 Minecraft → host

| Type | Purpose | Sequence | Session |
|---|---|---|---|
| `minecraft.hello` | Declare versions and session | Required (`1`) | Required |
| `minecraft.status` | Readiness phase | Required | Required |
| `minecraft.snapshot` | Full catalog, pins, objectives | Required | Required |
| `minecraft.progress` | Changed chapter/quest progress | Required | Required |
| `minecraft.pins` | Changed manual pin set | Required | Required |
| `minecraft.heartbeat` | Liveness | Required | Required |

### 6.2 Host → Minecraft

| Type | Purpose |
|---|---|
| `host.welcome` | Accept the hello and declare timings |
| `host.request_snapshot` | Ask for a fresh full snapshot |
| `host.error` | Reject or report a fatal problem |

### 6.3 Browser → host

| Type | Purpose |
|---|---|
| `browser.hello` | Establish role (`overlay` or `control`) |
| `chapter.pin` | Pin a catalog chapter |
| `chapter.unpin` | Unpin a chapter |
| `chapter.reorder` | Replace the pin order |
| `config.update` | Replace display settings |
| `state.resync` | Request a full snapshot |

### 6.4 Host → browser

| Type | Purpose |
|---|---|
| `state.snapshot` | Full normalized state |
| `state.update` | Changed state sections |
| `chapter.pins.update` | Authoritative chapter pin configuration |
| `config.update` | Authoritative display configuration |
| `connection.status` | Connection and staleness state |
| `request.error` | Reject a browser request |

`config.update` appears in both directions. The payload shape is the same; only the sender differs.

---

## 7. Sequence and session semantics

### 7.1 Sequence

- `sequence` starts at `1` on each WebSocket connection.
- Each sender increments it by exactly one for every message it sends on that connection.
- Receivers track the last accepted sequence per connection.
- A message with `sequence <= lastAccepted` is a duplicate or replay and is ignored without changing state.
- A message with `sequence > lastAccepted + 1` is a gap:
  - A browser sends `state.resync` with `reason: "sequence_gap"`.
  - The host sends `host.request_snapshot` with `reason: "sequence_gap"` and marks the state stale.
- A full snapshot is always accepted, because it is self-contained. Accepting a snapshot resets the expected sequence to `snapshot.sequence + 1`.
- Browser-to-host messages may omit `sequence`; when present, the host applies the same duplicate rule but does not request resync from a browser.

The host's own host-to-Minecraft messages do not use sequence numbers; they are control messages and are idempotent.

### 7.2 Session

- The adapter generates `sessionId` once per Minecraft client process and reuses it across WebSocket reconnects.
- Every `minecraft.*` message must carry the same `sessionId` as the connection's `minecraft.hello`.
- A mismatch is fatal: the host replies `host.error` code `session_mismatch` and closes.
- A new Minecraft process uses a new session ID. The host treats it as a new publisher, clears stale data only after receiving its first snapshot, and does not mix old and new session data.
- Sequence numbering resets on every WebSocket connection, even when the session ID is unchanged.

### 7.3 Revision

Host-to-browser state also carries an application revision:

- `revision` is an integer that starts at `0` and increments by one for every host state change.
- `state.snapshot` and `state.update` both carry the revision they produce.
- A browser that receives `revision > localRevision + 1` has missed state and sends `state.resync`.
- A browser that receives `revision <= localRevision` ignores the update, except that a full snapshot is always applied.
- Sequence detects transport loss; revision detects state loss. Both are required.

---

## 8. Shared models

All IDs are opaque strings. A valid ID is 1–128 characters, contains no control characters, and is compared exactly. Chapter IDs must never be parsed as names or assumed numeric. ATM10 TTS IDs happen to be uppercase hexadecimal, but that is a pack property, not a protocol rule.

### 8.1 Chapter

```typescript
type ChapterStatus = "available" | "locked" | "completed" | "unknown";

interface Chapter {
  id: string;
  title: string;
  subtitle?: string;
  order: number;          // global discovery order, unique, 0-based
  progress: number | null; // integer 0-100, or null when unavailable
  status: ChapterStatus;
}
```

- `subtitle` exists because FTB Quests 2101.1.30 exposes chapter subtitles and no chapter description accessor. Do not call it a description.
- `progress` is FTB's authoritative relative progress. `null` means unavailable, never zero.
- `status === "completed"` comes from FTB completion state, not from `progress === 100`.
- `status` describes progression availability, not visibility. A hidden chapter must not be reported as `locked` merely because it is hidden. Protocol v1 has no chapter visibility field; adding one requires a protocol version change.
- `order` is derived from the complete chapter catalog, not from visibility.

### 8.2 Chapter pins

```typescript
interface ChapterPin {
  chapterId: string;
  position: number; // 0-based, contiguous after every mutation
}

interface ChapterPinConfig {
  maxPins: 5; // literal 5
  pinnedChapters: ChapterPin[];
}
```

Invariants, enforced whenever the host emits a config:

1. `maxPins` is exactly `5`.
2. `pinnedChapters` has 0–5 entries.
3. `chapterId` values are unique.
4. Positions are unique and contiguous from `0` to `n - 1`.
5. A pinned ID may be absent from the current catalog; it remains configured and is reported as unresolved.

### 8.3 Display configuration

```typescript
interface DisplayConfig {
  showChapterProgress: boolean;
  showQuestTasks: boolean;
  showCompletedQuests: boolean;
  completionAnimation: boolean;
  theme: "minimal";
  compactMode: boolean;
}
```

Defaults:

```json
{
  "showChapterProgress": true,
  "showQuestTasks": true,
  "showCompletedQuests": true,
  "completionAnimation": true,
  "theme": "minimal",
  "compactMode": true
}
```

The object is always complete; partial display objects are rejected.

### 8.4 Quest and task

```typescript
type QuestStatus = "locked" | "available" | "in_progress" | "completed" | "unknown";

interface QuestProgress {
  status: QuestStatus;
  completedTasks: number;      // required tasks completed, >= 0
  totalRequiredTasks: number;  // optional tasks excluded, >= completedTasks
  percentage: number | null;   // integer 0-100, or null
}

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

type TaskStatus = "incomplete" | "in_progress" | "completed" | "unknown";

interface TaskProgress {
  status: TaskStatus;
  current?: number;     // integer >= 0, only when the source exposes it
  target?: number;      // integer >= 0, only when the source exposes it
  percentage: number | null; // integer 0-100, or null
  unit?: string;        // reserved; v1 adapters do not emit it
}

interface Task {
  id: string;
  type: string;         // namespaced task type, e.g. "ftbquests:item"
  title?: string;
  optional: boolean;
  progress: TaskProgress;
}
```

Rules:

- `hidden` reflects FTB visibility. It conflates explicitly hidden quests with dependency-hidden quests; that limitation is documented and accepted.
- `optional` on a quest is FTB's optional flag. `optional` on a task is FTB's "optional for progression" flag.
- `completedTasks` counts only non-optional tasks. Optional tasks never prevent a quest from being completed.
- `percentage` may be present even when the task counts are not a clean division; the host must not recompute it from counts.
- `current` and `target` are omitted when FTB does not expose numeric progress. Do not synthesize `0`/`1`.
- `dependencies` may reference quests not present in the transmitted objective set. That is expected.

### 8.5 Connection and identity

```typescript
type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "synchronizing"
  | "ready"
  | "error";

interface ConnectionState {
  status: ConnectionStatus;
  stale: boolean;
  lastSnapshotAt: string | null; // ISO 8601
  lastHeartbeatAt: string | null; // ISO 8601
  error?: string;
}

interface MinecraftIdentity {
  sessionId: string | null;
  worldName?: string;
  dimension?: string;
  teamId?: string;
  teamName?: string;
}
```

`stale` is `true` whenever displayed progression is not live: disconnected, synchronizing after a gap, or past the heartbeat threshold. A previous snapshot may be retained while stale.

### 8.6 Application state

```typescript
interface AppState {
  revision: number;
  connection: ConnectionState;
  minecraft: MinecraftIdentity;
  chapters: Chapter[];
  quests: Quest[];                    // resolved manual pins only
  unresolvedPinnedQuestIds: string[];
  chapterPins: ChapterPinConfig;
  display: DisplayConfig;
}
```

`quests` contains exactly the resolved manual pins, ordered by the deterministic fallback order defined below. It never contains the full quest book.

### 8.7 Manual pin ordering and unresolved IDs

FTB does not expose manual pin order; its pinned collection is an unordered set. The adapter must:

1. Read the pinned IDs from the team’s player data. Stock FTB stores them per player; ATM10TTS is treated as team-uniform, so a UUID-specific lookup is not required for the target pack.
2. Remove the automatic tracker ID `1`.
3. Resolve each remaining ID against the quest file.
4. Order resolved quests by chapter catalog order, then by quest order within the chapter. This is a deterministic QuestBridge fallback, not FTB ordering.
5. Sort unresolved IDs ascending for stable output.

The adapter transmits `manualPinIds` in that same fallback order. The host preserves the received array order for display and never reorders objectives on its own.

### 8.8 Pin domains and chapter completion authority

Two different “pinned” concepts exist, and they must never be conflated:

| Concept | Owner | Used for | Never used for |
|---|---|---|---|
| Chapter pins | QuestBridge host configuration | Major progression section; up to five selected chapters | Current objectives; any FTB state |
| Quest pins | FTB Quests manual pins | Current objectives checklist | Chapter pins; chapter completion |
| Auto-pin | FTB Quests | FTB’s own automatic tracker | Chapter pins; manual objective list |

Rules:

- Chapter pins are host configuration. They are not read from `pinned_quests`, `player_data`, or any FTB chapter-pinning feature.
- Quest pins are read from FTB and are never written by QuestBridge.
- FTB’s special automatic ID `1` is not a quest and must be filtered out of `manualPinIds`. Auto-pin mode is out of MVP scope; a manual pin set that coexists with ID `1` is still reported as the manual set, with `1` removed.
- Chapter completion is `status: "completed"` sourced from FTB’s `TeamData.isCompleted(chapter)`. It is **not** derived from `progress === 100`. Empty, `alwaysInvisible`, and all-optional chapters can report 100 without a completion record.
- FTB removes a quest from its pin set when the quest completes. The adapter reports the resulting pin set; the host does not fabricate a retained completed objective.

---

## 9. Payloads

### 9.1 `minecraft.hello`

```json
{
  "protocolVersion": 1,
  "type": "minecraft.hello",
  "timestamp": "2026-11-06T12:00:00.000Z",
  "sequence": 1,
  "sessionId": "4f6f3f3e-6f1a-4f3e-9f0a-2b6c8d1e5a70",
  "payload": {
    "modVersion": "0.1.0",
    "minecraftVersion": "1.21.1",
    "neoForgeVersion": "21.1.250",
    "ftbQuestsVersion": "2101.1.30",
    "ftbTeamsVersion": "2101.1.10"
  }
}
```

All payload fields are required non-empty strings except that version strings may be `"unknown"` if detection fails. The host logs version mismatches but does not reject them; the adapter is responsible for reporting incompatible FTB versions through `minecraft.status`.

### 9.2 `host.welcome`

```json
{
  "protocolVersion": 1,
  "type": "host.welcome",
  "timestamp": "2026-11-06T12:00:00.050Z",
  "payload": {
    "hostVersion": "0.1.0",
    "heartbeatIntervalMs": 5000,
    "staleAfterMs": 20000,
    "disconnectAfterMs": 30000,
    "reconcileIntervalMs": 2000
  }
}
```

All numeric fields are positive integers. These are the host's declared timings; the adapter uses `heartbeatIntervalMs` and `reconcileIntervalMs`.

### 9.3 `minecraft.status`

```json
{
  "protocolVersion": 1,
  "type": "minecraft.status",
  "timestamp": "2026-11-06T12:00:01.000Z",
  "sequence": 2,
  "sessionId": "4f6f3f3e-6f1a-4f3e-9f0a-2b6c8d1e5a70",
  "payload": {
    "phase": "synchronizing",
    "detail": "Waiting for quest data from server"
  }
}
```

`phase` is one of `unavailable`, `synchronizing`, `ready`, `error`. `detail` is optional and must not contain server addresses, player names, or tokens.

Status mapping:

| Phase | Host connection status |
|---|---|
| `unavailable` | `connected` |
| `synchronizing` | `synchronizing` |
| `ready` | `ready` (after a snapshot) |
| `error` | `error` |

### 9.4 `minecraft.snapshot`

```json
{
  "protocolVersion": 1,
  "type": "minecraft.snapshot",
  "timestamp": "2026-11-06T12:00:02.000Z",
  "sequence": 3,
  "sessionId": "4f6f3f3e-6f1a-4f3e-9f0a-2b6c8d1e5a70",
  "payload": {
    "worldName": "ATM10 Skyblock",
    "dimension": "minecraft:overworld",
    "integratedServer": false,
    "teamId": "3b16b5a6-2a1e-4a0b-8d6d-2f4d3a2b1c0e",
    "teamName": "Team QuestBridge",
    "chapters": [],
    "manualPinIds": [],
    "quests": [],
    "unresolvedPinnedQuestIds": [],
    "capturedAt": "2026-11-06T12:00:02.000Z"
  }
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `worldName` | string or null | Yes | Display only. May be `null` if unavailable. |
| `dimension` | string or null | Yes | Resource location string, e.g. `minecraft:overworld`. |
| `integratedServer` | boolean | Yes | True for single-player. |
| `teamId` | string or null | Yes | Team UUID from FTB TeamData, or `null`. |
| `teamName` | string or null | Yes | Display only. |
| `chapters` | `Chapter[]` | Yes | Complete catalog, stable order. May be empty. |
| `manualPinIds` | `string[]` | Yes | Automatic ID `1` excluded. Unique. Ordered fallback. |
| `quests` | `Quest[]` | Yes | Resolved pins only, same order as resolved subset of `manualPinIds`. |
| `unresolvedPinnedQuestIds` | `string[]` | Yes | Sorted ascending. Disjoint from `quests` IDs. |
| `capturedAt` | string | Yes | ISO 8601 instant when captured on the client thread. |

Invariants for the objective set:

```text
set(manualPinIds)        = set(quests.id) ∪ set(unresolvedPinnedQuestIds)
set(quests.id)           ∩ set(unresolvedPinnedQuestIds) = ∅
"1" ∉ manualPinIds
quests order             = manualPinIds with unresolved entries removed, in order
```

Violations are `invalid_message` and the snapshot is rejected. The host keeps its previous state and marks it stale.

World identity guidance:

- `worldName`, `dimension`, and `integratedServer` come from Minecraft client state.
- The host does not use them as security identifiers.
- A change in the adapter's own world identity triggers a new snapshot; the host also accepts a snapshot without an explicit change signal.

### 9.5 `minecraft.progress`

```json
{
  "protocolVersion": 1,
  "type": "minecraft.progress",
  "timestamp": "2026-11-06T12:00:07.000Z",
  "sequence": 4,
  "sessionId": "4f6f3f3e-6f1a-4f3e-9f0a-2b6c8d1e5a70",
  "payload": {
    "capturedAt": "2026-11-06T12:00:07.000Z",
    "chapters": [
      { "chapterId": "3B0302DB5E77C3A2", "progress": 42, "status": "available" }
    ],
    "quests": []
  }
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `capturedAt` | string | Yes | ISO 8601. |
| `chapters` | `ChapterProgressUpdate[]` | No | Only changed chapters. |
| `quests` | `Quest[]` | No | Only changed pinned quests; full quest objects. |

`ChapterProgressUpdate`:

```typescript
interface ChapterProgressUpdate {
  chapterId: string;
  progress: number | null;
  status: ChapterStatus;
}
```

Rules:

- At least one of `chapters` and `quests` must be present.
- Chapter entries must reference chapters existing in the last snapshot's catalog; unknown IDs are ignored with a warning, not fatal.
- Quest entries must reference quests in the current manual pin set; unknown IDs are ignored with a warning.
- Removal of a pinned quest is signalled by `minecraft.pins`, never by omission from `minecraft.progress`.
- The adapter sends this message only when something changed since its previous transmission. It must not send unchanged data every reconciliation tick.

### 9.6 `minecraft.pins`

```json
{
  "protocolVersion": 1,
  "type": "minecraft.pins",
  "timestamp": "2026-11-06T12:00:09.000Z",
  "sequence": 5,
  "sessionId": "4f6f3f3e-6f1a-4f3e-9f0a-2b6c8d1e5a70",
  "payload": {
    "capturedAt": "2026-11-06T12:00:09.000Z",
    "manualPinIds": ["67E7552FDA3245F5"],
    "quests": [],
    "unresolvedPinnedQuestIds": []
  }
}
```

Same objective-set invariants as `minecraft.snapshot`. The host replaces its objective set atomically and never removes an objective on its own. FTB itself removes a quest from the player’s pin set when the quest completes (`v2101.1.30`), so the adapter normally reports that removal through `minecraft.pins` and the overlay drops the objective. QuestBridge must not fabricate a retained completed pin. If a newly pinned quest ID cannot be resolved, it appears in `unresolvedPinnedQuestIds` and is preserved.

### 9.7 `minecraft.heartbeat`

```json
{
  "protocolVersion": 1,
  "type": "minecraft.heartbeat",
  "timestamp": "2026-11-06T12:00:12.000Z",
  "sequence": 6,
  "sessionId": "4f6f3f3e-6f1a-4f3e-9f0a-2b6c8d1e5a70",
  "payload": {
    "ready": true
  }
}
```

Sent every 5 seconds. `ready` is `false` while FTB data is unavailable or synchronizing.

### 9.8 `host.request_snapshot`

```json
{
  "protocolVersion": 1,
  "type": "host.request_snapshot",
  "timestamp": "2026-11-06T12:00:20.000Z",
  "payload": {
    "reason": "sequence_gap"
  }
}
```

`reason` is one of `sequence_gap`, `reconnect`, `recovery`, `stale`, `manual`. The adapter responds with a fresh `minecraft.snapshot` as soon as it can capture on the client thread. It does not reply with a partial update.

### 9.9 `host.error`

```json
{
  "protocolVersion": 1,
  "type": "host.error",
  "timestamp": "2026-11-06T12:00:00.100Z",
  "payload": {
    "code": "unsupported_protocol",
    "message": "QuestBridge protocol version 2 is not supported",
    "fatal": true
  }
}
```

`fatal: true` means the host closes the connection after sending. `fatal: false` reports a non-fatal problem and the connection remains usable.

### 9.10 `browser.hello`

```json
{
  "protocolVersion": 1,
  "type": "browser.hello",
  "timestamp": "2026-11-06T12:00:00.000Z",
  "payload": {
    "role": "control",
    "clientName": "QuestBridge dashboard"
  }
}
```

`role` is `overlay` or `control`. `clientName` is optional display text, maximum 64 characters. The host replies with `state.snapshot`, or closes with `host.error` if the role is invalid or the version is unsupported.

Transport authentication is applied before the host trusts this role; see `docs/local-authentication.md`.

### 9.11 `state.snapshot`

Payload is a complete `AppState` (section 8.6):

```json
{
  "protocolVersion": 1,
  "type": "state.snapshot",
  "timestamp": "2026-11-06T12:00:03.000Z",
  "sequence": 1,
  "payload": {
    "revision": 7,
    "connection": {
      "status": "ready",
      "stale": false,
      "lastSnapshotAt": "2026-11-06T12:00:02.000Z",
      "lastHeartbeatAt": "2026-11-06T12:00:02.500Z"
    },
    "minecraft": {
      "sessionId": "4f6f3f3e-6f1a-4f3e-9f0a-2b6c8d1e5a70",
      "worldName": "ATM10 Skyblock",
      "dimension": "minecraft:overworld",
      "teamId": "3b16b5a6-2a1e-4a0b-8d6d-2f4d3a2b1c0e",
      "teamName": "Team QuestBridge"
    },
    "chapters": [],
    "quests": [],
    "unresolvedPinnedQuestIds": [],
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
}
```

`revision` is an integer `>= 0`. The host increments it for any state change. `state.snapshot` is always self-contained and may be sent in response to a resync without any Minecraft event.

### 9.12 `state.update`

```json
{
  "protocolVersion": 1,
  "type": "state.update",
  "timestamp": "2026-11-06T12:00:08.000Z",
  "sequence": 42,
  "payload": {
    "revision": 8,
    "connection": {
      "status": "ready",
      "stale": false,
      "lastSnapshotAt": "2026-11-06T12:00:02.000Z",
      "lastHeartbeatAt": "2026-11-06T12:00:07.000Z"
    }
  }
}
```

Payload contains `revision` plus any of `connection`, `minecraft`, `chapters`, `quests`, `unresolvedPinnedQuestIds`, `chapterPins`, `display`. Every present section **replaces** the corresponding section wholesale; it is not a patch. At least one section besides `revision` must be present.

The host may send section-specific messages (`chapter.pins.update`, `config.update`, `connection.status`) instead of, or in addition to, `state.update` for the same change. Browsers must treat all of them idempotently: applying the same revision twice is harmless, and the highest revision wins.

### 9.13 `chapter.pins.update`

```json
{
  "protocolVersion": 1,
  "type": "chapter.pins.update",
  "timestamp": "2026-11-06T12:00:10.000Z",
  "sequence": 43,
  "payload": {
    "chapterPins": {
      "maxPins": 5,
      "pinnedChapters": [
        { "chapterId": "28BCA5042050B140", "position": 0 },
        { "chapterId": "3B0302DB5E77C3A2", "position": 1 }
      ]
    }
  }
}
```

Sent after a successful mutation and in state snapshots. The payload is authoritative for chapter pins; no partial pin deltas exist.

### 9.14 `config.update`

```json
{
  "protocolVersion": 1,
  "type": "config.update",
  "timestamp": "2026-11-06T12:00:11.000Z",
  "sequence": 44,
  "payload": {
    "display": {
      "showChapterProgress": true,
      "showQuestTasks": true,
      "showCompletedQuests": false,
      "completionAnimation": false,
      "theme": "minimal",
      "compactMode": true
    }
  }
}
```

Browser → host version of this message has the same payload. The host validates the complete object, persists it, and broadcasts the authoritative result.

### 9.15 `connection.status`

```json
{
  "protocolVersion": 1,
  "type": "connection.status",
  "timestamp": "2026-11-06T12:00:13.000Z",
  "sequence": 45,
  "payload": {
    "status": "ready",
    "stale": false,
    "lastSnapshotAt": "2026-11-06T12:00:02.000Z",
    "lastHeartbeatAt": "2026-11-06T12:00:12.000Z"
  }
}
```

Sent when connection status or staleness changes. Payload is exactly `ConnectionState`.

### 9.16 `request.error`

```json
{
  "protocolVersion": 1,
  "type": "request.error",
  "timestamp": "2026-11-06T12:00:10.000Z",
  "sequence": 46,
  "requestId": "0f5e2c1a-8b7d-4f3a-9c2e-1d4b6a8c0e2f",
  "payload": {
    "code": "too_many_pins",
    "message": "Five chapters are already pinned"
  }
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `code` | `ErrorCode` | Yes | Section 10.4. |
| `message` | string | Yes | Human-readable, no secrets, maximum 512 characters. |
| `details` | object | No | Small machine-readable context; never credentials or file paths. |

The envelope's optional `requestId` echoes the rejected request's `requestId` when it had one.

A `request.error` never changes state and never partially applies a mutation.

### 9.17 Browser mutations

`chapter.pin`:

```json
{
  "protocolVersion": 1,
  "type": "chapter.pin",
  "timestamp": "2026-11-06T12:00:14.000Z",
  "requestId": "a1",
  "payload": { "chapterId": "67E7552FDA3245F5" }
}
```

`chapter.unpin`:

```json
{
  "protocolVersion": 1,
  "type": "chapter.unpin",
  "timestamp": "2026-11-06T12:00:15.000Z",
  "requestId": "a2",
  "payload": { "chapterId": "67E7552FDA3245F5" }
}
```

`chapter.reorder`:

```json
{
  "protocolVersion": 1,
  "type": "chapter.reorder",
  "timestamp": "2026-11-06T12:00:16.000Z",
  "requestId": "a3",
  "payload": {
    "chapterIds": ["28BCA5042050B140", "3B0302DB5E77C3A2"]
  }
}
```

`config.update`:

```json
{
  "protocolVersion": 1,
  "type": "config.update",
  "timestamp": "2026-11-06T12:00:17.000Z",
  "requestId": "a4",
  "payload": {
    "display": {
      "showChapterProgress": true,
      "showQuestTasks": true,
      "showCompletedQuests": true,
      "completionAnimation": true,
      "theme": "minimal",
      "compactMode": false
    }
  }
}
```

`state.resync`:

```json
{
  "protocolVersion": 1,
  "type": "state.resync",
  "timestamp": "2026-11-06T12:00:18.000Z",
  "requestId": "a5",
  "payload": { "reason": "sequence_gap" }
}
```

`reason` is optional: `sequence_gap`, `revision_gap`, `reconnect`, `manual`, `stale`.

Mutation rules:

- Only the `control` role may send `chapter.pin`, `chapter.unpin`, `chapter.reorder`, and `config.update`.
- `chapter.pin` rejects an ID already pinned (`duplicate_chapter`), a full pin set (`too_many_pins`), and an ID absent from the live catalog (`unknown_chapter`).
- `chapter.unpin` rejects an ID that is not pinned (`not_pinned`). Unpinning an unresolved ID is allowed.
- `chapter.reorder` requires exactly the current pinned ID set: no additions, removals, duplicates, or more than five IDs. Violations are `invalid_reorder_set`. The array order becomes the new positions.
- `config.update` requires a complete `DisplayConfig`. Unknown fields are `invalid_message`.
- Every successful mutation is persisted atomically before the host acknowledges or broadcasts it.
- After success the host broadcasts the authoritative configuration and state to all connected browsers. The requesting dashboard learns the result from that broadcast; it may also use the new revision/sequence.

---

## 10. Validation and errors

### 10.1 Validation order

The host validates in this order and stops at the first failure:

1. Frame size ≤ 256 KiB.
2. JSON parses.
3. Envelope schema (version, type, timestamp, sequence, session, payload object).
4. Direction and role permission.
5. Message-type payload schema.
6. Cross-field invariants for that message.
7. Domain rules (pin limits, catalog membership, reorder set).
8. Persistence, then state update and broadcast.

### 10.2 Fatal versus non-fatal

Fatal errors close the WebSocket after sending the error:

- `unsupported_protocol`
- `invalid_message` on the first message
- `role_mismatch`
- `session_mismatch`
- `message_too_large`
- `rate_limited`

Non-fatal errors keep the connection open:

- `invalid_request`
- Domain pin errors
- `invalid_snapshot` (the previous state is retained and marked stale)

A version failure is always fatal and reported as `unsupported_protocol`; there is no separate `unsupported_version` code.

### 10.3 Cross-field invariants

Enforced on every snapshot, pins message, and state snapshot:

- Chapter IDs are unique; chapter `order` values are unique non-negative integers.
- Quest IDs are unique; task IDs are unique within a quest.
- Every resolved quest's `chapterId` exists in `chapters`.
- `completedTasks <= totalRequiredTasks`.
- `progress`, `percentage`, `current`, and `target` are within their stated ranges.
- `manualPinIds` contains no duplicates and never `"1"`.
- Objective-set invariants from section 9.4 hold.
- `unresolvedPinnedQuestIds` is sorted and disjoint from resolved quest IDs.
- `chapterPins` satisfies all invariants in section 8.2.
- `display` is complete and valid.

### 10.4 Error codes

| Code | Meaning | Fatal |
|---|---|---|
| `unsupported_protocol` | Envelope version is not `1` | Yes |
| `invalid_message` | Malformed envelope or payload | First message: yes; later: no |
| `invalid_request` | Semantically invalid request | No |
| `invalid_snapshot` | Snapshot violates cross-field invariants | No |
| `unauthorized` | Role may not perform this operation | No |
| `role_mismatch` | Role claim conflicts with connection | Yes |
| `session_mismatch` | `sessionId` changed mid-connection | Yes |
| `message_too_large` | Frame exceeds 256 KiB | Yes |
| `rate_limited` | Mutation rate limit exceeded | Yes |
| `duplicate_chapter` | Chapter is already pinned | No |
| `too_many_pins` | Five chapters already pinned | No |
| `unknown_chapter` | Chapter ID is not in the live catalog | No |
| `invalid_position` | Position is not contiguous or unique | No |
| `invalid_reorder_set` | Reorder list differs from the pinned set | No |
| `not_pinned` | Chapter is not currently pinned | No |
| `stale_revision` | Request was based on an outdated configuration revision | No |

`stale_revision` is reserved for Phase 2 if optimistic concurrency is added. The initial host applies mutations against current state and returns the resulting configuration; it does not require a client-supplied revision.

### 10.5 Rate limits

Suggested initial limits, enforced by the host:

- Browser mutations: 10 per second per connection.
- New browser connections: 20 per minute.
- New Minecraft connections: 5 per minute.

Exceeding a limit is `rate_limited`. The limits are configuration, not protocol constants.

---

## 11. Unresolved data

Unresolved chapter pins and unresolved quest pins are configuration and observation results, not protocol errors.

- A pinned chapter ID absent from the catalog stays in `chapterPins` and renders as unresolved.
- An unresolved pinned quest stays in `unresolvedPinnedQuestIds` and renders as unresolved.
- The host never deletes either automatically.
- The dashboard may unpin an unresolved chapter. That is the only repair operation.
- Before the first Minecraft snapshot, all chapter pins are unresolved and the UI shows the disconnected/synchronizing state rather than implying deletion.

---

## 12. Security boundary

This document defines no credentials. The host must enforce, independently of the message payload:

- Loopback binding.
- `Host` header validation.
- WebSocket origin restrictions.
- Transport authentication and role separation, per `docs/local-authentication.md`.
- Per-role permissions as described in section 5.2.
- Message-size limits.
- Mutation rate limits.
- No filesystem, shell, or arbitrary HTTP surface.

The `role` in `browser.hello` is a permission claim, not proof of identity. It is only meaningful after transport authentication.

---

## 13. Phase 1 implementation

This section records the Phase 1 work. The protocol package, the mock publisher,
and the Phase 2 host are implemented; the Svelte routes and the FTB adapter
remain later phases. The host implements this contract without protocol changes,
which is the evidence that v1 was stable across the transport work; the Phase 2
results are in `docs/phase-2-plan.md` §15.

Scope priority for the MVP:

- **P0:** read FTB’s manually pinned quests from client memory and display completion for the QuestBridge-selected chapters.
- **P1:** chapter progress, task counts, and numeric progress details.
- **P2:** auto-pin mode reconstruction and special handling beyond filtering ID `1`. This must not block Phase 1.

### 13.1 Packages

```text
packages/
├── protocol/
│   ├── package.json          # @questbridge/protocol
│   ├── tsconfig.json
│   ├── src/
│   │   ├── version.ts        # PROTOCOL_VERSION, MAX_MESSAGE_BYTES, MAX_CHAPTER_PINS
│   │   ├── types.ts          # section 8 models and message payload types
│   │   ├── schemas.ts        # Zod schemas and cross-field refinements
│   │   ├── messages.ts       # envelope factory, encode, parse, per-role dispatch
│   │   └── index.ts          # public exports
│   └── tests/                # protocol tests
└── mock-publisher/
    ├── package.json          # @questbridge/mock-publisher
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts          # CLI entry
    │   ├── client.ts         # WebSocket publisher using @questbridge/protocol
    │   ├── collector.ts      # standalone host-side collector CLI
    │   ├── collector-model.ts# normalized observation state for the collector
    │   ├── fixtures.ts       # synthetic deterministic fixture data
    │   └── scenarios.ts      # scripted lifecycle scenarios
    └── tests/                # mock lifecycle and collector tests
```

Dependency choices:

- `zod` `^4.6.7` for runtime validation.
- `ws` `^8.22.1` for the mock publisher and the host.
- `vitest` and `typescript` from the existing workspace toolchain.
- No `tsx`, no build framework, no other runtime dependencies. Packages compile with `tsc` and run from `dist/`.

The root build and test scripts run `@questbridge/protocol` before `@questbridge/mock-publisher`, because npm's `--workspaces` order is not guaranteed to be dependency order. The mock package also uses a TypeScript project reference to the protocol package, so `tsc -b` builds the dependency first.

Package output is ESM (`"type": "module"`), consumed by Vite, Node 24, and the host. `@questbridge/protocol` publishes both runtime schemas and types from one entry point.

### 13.2 Fixtures

Synthetic IDs only. No real ATM10 TTS IDs in mock fixtures, so mock success is never mistaken for pack compatibility.

Required fixture content:

- At least 6 chapters with distinct orders, including available, locked, and completed chapters, and one chapter with `progress: null`.
- At least 10 quests with unique IDs across chapters.
- Multiple task types, including at least one non-numeric task (`current`/`target` omitted).
- Optional quests and optional tasks.
- Locked quests and completed quests.
- Numeric task progress on some tasks.
- At least 3 manually pinned quests, including a completed quest for the transient completed state that FTB removes from the pin set in a later pins message.
- A chapter with `status: "completed"` and a chapter with `progress: 100` but a non-completed status, to prove completion is not derived from progress.
- Chapter progress values derived deterministically from the fixture.
- One unresolved pinned quest ID in at least one scenario.
- Chapter pin fixtures: empty, one pin, five pins, and an unresolved pin.
- An auto-pin ID `1` value only for the filter test; do not construct an auto-generated objective list.

Fixtures must be frozen data with a fixed timestamp so tests are reproducible.

### 13.3 Mock scenarios

Each scenario is a deterministic script of protocol messages with injected timing. The CLI plays them against a host; tests replay the same scripts with an immediate sleep function and validate the emitted events without a clock or network. The WebSocket collector test exercises the real transport.

| Scenario | Behavior |
|---|---|
| `unavailable` | Connect, hello, status `unavailable`, heartbeats, no snapshot |
| `ready` | Hello, synchronizing, full snapshot, heartbeats |
| `progress` | Ready, then chapter progress changes, a chapter completion, and then quest completion with the resulting pin removal |
| `chapter-completion` | Ready, then a selected chapter’s `status` changes to `completed` without any quest-pin change |
| `pins` | Ready, then add and remove manual pins, including an unresolved ID and a completed quest that FTB unpins |
| `reload` | Ready, then a new catalog and snapshot after a simulated quest reload |
| `world-change` | Ready, then a snapshot with a new world name/dimension and reset progress |
| `team-change` | Ready, then a snapshot with a new team ID and different progress |
| `disconnect` | Ready, close the socket, wait, reconnect, hello, fresh snapshot |
| `stale` | Ready, stop heartbeats while holding the socket open |
| `full` | Deterministic sequence combining all of the above |

The mock must also support `--scenario=<name>` and a fixed seed. It must not require Minecraft, the host source, or network access beyond loopback.

P0 scenarios are `ready`, `progress`, `chapter-completion`, and `pins`. Auto-pin mode reconstruction is not a Phase 1 scenario; only the ID `1` filter is tested.

### 13.4 Protocol tests

At minimum:

- Valid envelope and every message type parse.
- Invalid JSON, missing fields, unknown fields, wrong types rejected.
- Unsupported `protocolVersion` rejected.
- Unknown message type rejected.
- Direction and role mismatches rejected.
- Duplicate chapter IDs, quest IDs, and task IDs rejected.
- `completedTasks > totalRequiredTasks` rejected.
- Out-of-range `progress` and `percentage` rejected.
- `progress: null` accepted and preserved.
- Auto pin ID `"1"` rejected in `manualPinIds`.
- Chapter completion is independent of progress: `progress: 100` with a non-completed status is valid, and `status: "completed"` is accepted as authoritative.
- A completed quest disappearing from `manualPinIds` is a valid pin update; there is no retained-completed field to fabricate.
- Objective-set invariants: resolved/unresolved partition, disjointness, ordering.
- Chapter pin config: empty, 1–5 pins, 6 rejected, duplicates rejected, non-contiguous positions rejected, unresolved IDs accepted.
- Display config: complete accepted, partial rejected.
- Sequence: in-order accepted, duplicate ignored, gap produces resync/gap signal (helper-level tests).
- Revision: stale update ignored, gap detected.
- Snapshot and pins payloads round-trip without data loss.
- The sequence helper produces monotonic sequences and detects gaps.

### 13.5 Mock tests

- Every scenario emits only valid v1 messages.
- Scenario order is deterministic.
- `unavailable` never emits a snapshot.
- `ready` emits exactly one initial snapshot.
- `progress` emits only changed sections.
- `chapter-completion` changes a selected chapter’s completion status without changing quest pins.
- `pins` replaces the objective set atomically, including removal of a completed quest’s pin.
- `reload`, `world-change`, and `team-change` emit fresh full snapshots.
- `disconnect` reconnects with a new connection sequence and a fresh snapshot.
- `stale` stops heartbeats without closing the socket.
- The mock's fixture data satisfies the section 13.2 requirements.
- The mock's output can be replayed into a local collector (a test-only WebSocket server) without a host.
- The standalone collector builds normalized observation state from every scenario and replays the full lifecycle over a real WebSocket, including reconnect and stale retention.

### 13.6 Exit criteria

Phase 1 is complete when:

1. [x] `@questbridge/protocol` builds and its tests pass (85 tests).
2. [x] `@questbridge/mock-publisher` builds and its tests pass (30 tests).
3. [x] Every mock scenario is deterministic and emits only valid v1 messages.
4. [x] A test-only collector can consume the mock lifecycle end to end.
5. [x] `npm run build --workspaces --if-present` and `npm test --workspaces --if-present` pass.
6. [x] No real ATM10 TTS identifiers appear in mock fixtures.
7. [x] The P0 scenarios `ready`, `progress`, `chapter-completion`, and `pins` pass; auto-pin mode remains out of scope.

Verified on 2026-11-06. Passing Phase 1 does not establish FTB Quests compatibility. That requires Phase 5.

---

## 14. Open questions

These are intentionally unresolved and must not be silently decided during implementation:

1. **Transport authentication.** Token set, endpoint paths, and origin rules are specified in `docs/local-authentication.md`. The browser token is validated on the WebSocket upgrade, and the role it declares is enforced but not bound to the token (accepted risk R1); origin matching ignores the port (accepted risk R2). The protocol assumes an authenticated role.
2. **WebSocket paths.** One `/ws` endpoint with a role hello is assumed; separate per-role paths are possible without changing payloads.
3. **`state.update` duplication.** The host may send section-specific messages in addition to `state.update`. Browsers must remain idempotent; a later cleanup may choose one form.
4. **Optimistic concurrency.** `stale_revision` is reserved but unused; reorders currently apply to current state.
5. **Task units.** `unit` is reserved; FTB Quests 2101.1.30 does not expose a general unit, so v1 adapters omit it.
6. **Timestamp skew.** Timestamps are informational; no skew rejection is specified.
7. **Port and launch configuration.** `8765` is the documented default; configuration is a host concern.

---

## 15. Relationship to other documents

- `docs/architecture.md` describes components, data ownership, and lifecycle at a higher level.
- `docs/ftb-quests-integration.md` describes how the adapter reads FTB Quests and why progress values mean what they mean.
- `docs/chapter-pinning.md` specifies chapter pin configuration, validation, persistence, and dashboard behavior.
- `docs/proposals.md` holds the pending authentication decision.
- `AGENTS.md` is the product contract; this document does not override it.
