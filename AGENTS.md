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
**Package manager:** npm  
**Deployment:** Local desktop application

---

# 0. DOCUMENTATION IS KING

**Documentation is the oxygen you breathe and the ground you stand on.**

If you read only one section of this document, read this one. Every other rule
here assumes it.

QuestBridge is growing faster than any one person's memory. It is four major
parts, each with its own language, build, and failure modes, and they are
developed by different conversations that do not remember each other:

| #   | Part                                   | Lives in                                                        | Primary document                                  |
| --- | -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| 1   | Minecraft mod (Java adapter)           | `minecraft-mod/`                                                | `docs/ftb-quests-integration.md`                  |
| 2   | Transport layer (protocol, host, mock) | `packages/protocol`, `packages/host`, `packages/mock-publisher` | `docs/protocol.md`                                |
| 3   | Display (the OBS overlay)              | `apps/web-app/src/routes/overlay`                               | `docs/web-frontend.md`                            |
| 4   | Control panel (the dashboard)          | `apps/web-app/src/routes/control`                               | `docs/web-frontend.md`, `docs/chapter-pinning.md` |

Four parts, one protocol contract between them, and no shared memory. The
documents **are** the shared memory. Scope growth does not merely make
documentation useful; it makes it load-bearing. Past a certain size, an
undocumented project is not a project — it is a series of unrelated incidents
that happen to share a directory.

**The failure mode this section exists to prevent development hell:** work
that is redone because nobody recorded it was done, decisions re-litigated
because the reasoning was never written, defects fixed twice because the first
fix was never noted, and features half-built because two conversations each
assumed the other had finished. Every one of those is a documentation failure
before it is an engineering failure.

## 0.1 The rule

> **Every change, every implementation, every suggestion, and every feature
> request MUST be documented, in the session that produces it, in the repository.**

Not "probably". Not "when there is time". Not "the user will remember". Written
down, committed, and findable by a stranger who has never read the conversation
that produced it.

This applies to work that seems too small to record, and it applies most of all
to work that was **not** done:

- A change that ships without a document entry did not happen.
- A decision taken without recording its reasoning will be undone by the next
  conversation, which cannot see the reasoning.
- A suggestion that is not written down is a suggestion that was refused,
  whatever anyone intended at the time.
- A defect found and not recorded will be found again, at the same cost.
- An assumption left implicit becomes a bug report later.

## 0.2 What "documented" means

Documentation is not a summary written after the fact. To count, a record must
let a reader who was not present **act**:

1. **Why**, including the alternatives rejected and the reason. A decision with
   no recorded alternative is not a decision, it is a preference.
2. **What was verified**, and how — the command run, the test passed, the log
   line observed. Against what was merely assumed (`AGENTS.md` §17.2).
3. **What it does not cover** — the boundary of the claim.
4. **What remains open** — the loose ends, named rather than implied.

A record missing any of these is a note, not documentation.

**"What changed" is deliberately not on this list.** A file-by-file account of
every edit is the commit message's job. Duplicating it in prose bloats documents
until nobody reads them, and it duplicates a record Git already keeps exactly.
Documentation carries what a diff cannot: the reasoning, the evidence, the
boundary, and the open ends.

That delegation is only safe because commit messages are required to carry a
body — see §0.5.1. Do not read this section as licence to leave a change
undescribed anywhere.

## 0.3 Suggestions and feature requests

A suggestion is work in a conversation's head until it is written down. The
project has lost track of requests before, and §0 exists because of it.

- **A feature request belongs in a document the moment it is made** — not when
  it is implemented, and not only if it is accepted. Declined and deferred
  requests must be as findable as accepted ones, because the most expensive
  mistake is rebuilding something the user already asked for and was already
  told no about.
- **Where it goes** depends on whether it changes the wire:
  - Needs a protocol version change → `docs/protocol-v2-tracker.md`.
  - Product or architecture decision needing approval → `docs/proposals.md`.
  - Everything else → the owning document (§0.4), or a plan under `docs/`.
- **Record it as a request, not as a decision.** "The user asked for X" is a
  fact. "We will build X" is a different fact and needs its own approval.
- **Record the source and the date.** A request with no origin cannot be
  re-examined later, and a plausible-sounding entry can quietly become policy.
- **Never let an idea live only in a chat.** Conversations end. Documents do not.

## 0.4 Where documentation goes

Choosing the wrong file is how documents rot. Use this table rather than
inventing a location:

| Kind of information                                     | Document                             |
| ------------------------------------------------------- | ------------------------------------ |
| Project mission, requirements, rules for agents         | `AGENTS.md` (this file)              |
| Component boundaries, data ownership, system shape      | `docs/architecture.md`               |
| The wire contract between parts                         | `docs/protocol.md`                   |
| What FTB Quests actually exposes, and its limits        | `docs/ftb-quests-integration.md`     |
| Chapter pin rules and the dashboard's selection model   | `docs/chapter-pinning.md`            |
| Local tokens, origins, and the security boundary        | `docs/local-authentication.md`       |
| The frontend's routes, failure states, and motion rules | `docs/web-frontend.md`               |
| Build, test, and run commands                           | `docs/development.md`                |
| Version policy                                          | `docs/versioning.md`                 |
| Features v1 cannot carry                                | `docs/protocol-v2-tracker.md`        |
| Defects, traps, symptoms, workarounds                   | `docs/troubleshooting.md`            |
| Phase scope, milestones, acceptance criteria            | `docs/phase-N-plan.md`               |
| How to run a live verification                          | `docs/phase-5-verification-guide.md` |
| What a specific run actually did                        | `docs/testing-logs/<date>-<name>.md` |
| A proposal awaiting a decision                          | `docs/proposals.md`                  |

**Session narrative and durable knowledge are different documents.** A run log
records what happened once; a troubleshooting entry records what is true from
then on. A finding belongs in the latter, linked from the former
(`AGENTS.md` §17.2).

## 0.5 What does not count

- A commit message alone. It is history, not documentation: it cannot be found
  by reading the docs, and it does not say what remains open.
- A code comment alone. It explains a line, not a decision or a boundary.
- A summary that only describes the happy path.
- A plan written after the work, describing what was done rather than what was
  decided.
- Anything that exists only in a conversation, a terminal scrollback, or an
  agent's context window.
- A document that contradicts another and leaves the reader to guess which wins.

### 0.5.1 Commit messages must carry a body

Because §0.2 delegates "what changed" to the commit history, that history has to
be worth delegating to. **Every commit message must include body text. A subject
line on its own is not acceptable.**

The subject is a label. The body is the record. A reader running
`git log` or `git blame` six months from now sees only the message; if it is one
line, they learn that something happened and nothing about what or why.

A commit body must say:

- **What changed**, in concrete terms — behaviour, wire format, version, or the
  files that matter. Not a restatement of the subject.
- **Why**, including the alternative rejected and the reason, when a decision was
  taken. This is the part that cannot be recovered from a diff.
- **What was verified**, and by what command, when the change was tested. Say
  so plainly when it was not.
- **What remains open**, if anything does.

Rules:

- A one-line commit is a defect, not a style choice.
- `git commit -m "fix: thing"` with no body violates this section.
- A body that only repeats the subject violates it too.
- Do not rewrite history to repair an old message; write the next one properly
  and record the correction in the relevant document if it mattered.

This is the one place where a commit message **is** documentation. It does not
replace the document entry — a commit body cannot be found by reading the docs —
but the document entry no longer has to restate the diff, because this does.

## 0.6 The test

Before ending any session, answer this honestly:

> **Could a competent agent who has never seen this conversation continue the
> work from the repository alone — knowing what was done, what was decided, what
> was verified, what was rejected, and what is next?**

If the answer is no, the session is not finished. The missing documentation is
not a follow-up task; it is the unfinished part of the work.

## 0.7 Documentation debt is real debt

When documentation must be deferred, it is deferred **explicitly**, in writing:

- name what is missing;
- name where it should go;
- name what depends on it;
- record it where the next session will see it.

Never leave an undocumented change in place and hope it is obvious. Silent
documentation debt compounds exactly like the development hell it causes, and it
is the one kind of debt this project cannot afford, because the four parts are
held together by nothing else.

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

- Solid key background for OBS chroma keying: `#00FF00` or `#0000FF`,
  switchable from the dashboard. No UI colour may fall in the active key's
  colour family.
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

Use npm workspaces.

Keep the Java project separate from the TypeScript workspace.

Share TypeScript protocol definitions between the host and frontend.

## Toolchain availability

Node.js and npm are installed through **fnm**, not as a system-wide install.

`node` and `npm` are frequently **not** on `PATH` in a fresh non-interactive
shell (agent tool calls, CI-style runners, some terminals). A command that fails
with `The term 'node' is not recognized` is a `PATH` problem, not a missing
dependency. Do not install Node, do not switch package managers, and do not
report the build as broken.

The version required by this project is pinned in `.nvmrc` and matched to
`engines` in the root `package.json` (Node `24.22.1`, npm `11.19.1`). fnm keeps
each version under:

```text
%APPDATA%\fnm\node-versions\v<version>\installation
```

On Windows, prepend the matching installation directory to `Path` for the
lifetime of the command:

```powershell
$nodeDir = "$env:APPDATA\fnm\node-versions\v24.22.1\installation"
$env:Path = "$nodeDir;$env:Path"
node --version   # v24.22.1
npm --version    # 11.19.1
```

### Using `fnm use`

`fnm` itself may be on `PATH` while no Node version is active. `fnm use` then
fails with `We can't find the necessary environment variables`, because fnm
needs its shell hook evaluated first. The hook must be evaluated in the same
shell as the command:

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm use 24.22.1
node --version   # v24.22.1
```

Do **not** trust a bare `fnm use` without the hook. Verified on 2026-11-07 in
this environment: without `fnm env` evaluated it fails, and with the hook but no
version argument it selects the machine's fnm `default` (`v24.14.0` here), not
`.nvmrc`. If the shell is already configured interactively, `fnm use` picks up
`.nvmrc` from the repository root.

Rules:

- Prefer the `.nvmrc` version. If it is not installed under fnm, say so rather
  than silently running a different Node version.
- A different existing fnm version is not a substitute: the workspace `engines`
  field and the browser test setup are pinned against `24.22.1`.
- Do not add Node binaries or fnm shims to the repository, and do not commit
  environment-specific absolute paths.

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
│   ├── versioning.md
│   ├── phase-2-plan.md
│   ├── phase-4-plan.md
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
  subtitle?: string;
  order: number;
  progress: number | null;
  status: "available" | "locked" | "completed" | "unknown";
}
```

The field is `subtitle`, not `description`: FTB Quests `2101.1.30` exposes
chapter subtitles and no chapter description accessor (`docs/protocol.md` §8.1,
`docs/ftb-quests-integration.md` §4.3). Do not call a subtitle a description in
code, UI labels, or documentation. Quest descriptions are separate and are
genuinely available (§7.3).

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
type QuestStatus = "locked" | "available" | "in_progress" | "completed" | "unknown";

interface QuestProgress {
  status: QuestStatus;
  completedTasks: number;
  totalRequiredTasks: number;
  percentage: number | null;
}

interface TaskProgress {
  status: "incomplete" | "in_progress" | "completed" | "unknown";

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
- Chapter subtitle.
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
getChapterCatalog();
getPinnedChapters();
getChapterProgress(chapterId);
getManuallyPinnedQuests();
getConnectionStatus();
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

- Support chroma keying: a uniform key field and no UI colour in that key's
  family.
- Avoid scrollbars.
- Avoid requiring OBS-specific APIs.
- Work in a normal Chromium browser.
- Recover after browser refresh.
- Display a disconnected state accurately.

---

# 15. CONNECTION LIFECYCLE

Use explicit connection states:

```typescript
type ConnectionStatus = "disconnected" | "connecting" | "connected" | "synchronizing" | "ready" | "error";
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

A previous snapshot may be retained internally. The overlay must not show a visible
stale indicator: on stream, reacting to a merely slow update is a worse failure than the
delay itself. The stale and disconnect thresholds are set generously so that only a
publisher that has genuinely gone away is affected, and a disconnection fades the overlay
out rather than cutting it. See `docs/web-frontend.md` §3.4.

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
22. Record verification findings in `docs/troubleshooting.md` (§17.2).
23. Do not fix what the user has asked you only to record.
24. Document every change, decision, suggestion, and feature request (§0).

> **§0 governs all of the above.** If a rule here and §0 ever appear to conflict,
> §0 wins: an undocumented change is not a completed change, however good the
> code is.

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

- Use an imperative commit subject and **always include a body** explaining what
  and why. A subject alone is a defect, not a style choice (`AGENTS.md` §0.5.1).
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

### Versioning

Follow `docs/versioning.md`.

- Read the last documented version before changing the mod version.
- At the start of a new conversation, bump only the minor component by exactly one and keep that version for the entire conversation.
- Do not bump the version for individual commits, fixes, or rebuilds.
- Update the documented version when the conversation closes.
- Major version bumps require an explicit user request. Never infer a major bump from completing a phase or the Definition of Done.
- Do not let a shared phase name freeze the version. A new conversation that merely inherits a phase name from documentation — Stage 4, Phase 4, or any later stage — is a new thread and gets its single bump. A rule such as "the Stage 4 conversation stays on `0pre.1`" does not apply to it, and must never be used to skip the bump. Before starting work, confirm the active version with the user.

---

## 17.2 Recording findings, defects, and fixes

**Every finding from a live verification run goes in `docs/troubleshooting.md`,
in the same session that found it.** Findings that live only in a conversation
or a chat transcript are lost, and the next agent re-discovers them.

This applies to, at minimum:

- Any defect in the adapter, host, protocol, or frontend.
- Any environment or configuration trap that cost time to diagnose.
- Any observed behaviour that contradicts a document.
- Any workaround the user had to apply to make progress.
- Anything suspected but not confirmed, clearly labelled as suspected.

Rules:

1. **Write the finding before proposing a fix.** The record is valuable even
   when the fix is obvious, and it is the only thing that survives if the fix
   is deferred.
2. **Do not fix a defect the user has asked you only to document.** Record it,
   state the workaround, and wait. This is the user's standing preference:
   understand first, change later, in a deliberate step.
3. **A finding is not a claim.** Mark it _verified_ (observed on a real client
   or in real tool output, with the command or log line that shows it) or
   _suspected_ (reasoned from code). Never blur the two.
4. **Record the scope of what a finding does _not_ prove.** A mapper-level
   observation does not prove the transport, the host, or the overlay. State
   the boundary explicitly.
5. **When a defect is fixed, update its entry rather than deleting it** — note
   the fix, the version that carries it, and how it was verified. The history
   is what stops a defect being reintroduced.
6. **Correct your own earlier claims in writing.** If a later check shows an
   earlier statement was wrong, say so in the entry. An uncorrected wrong claim
   is worse than the original mistake.
7. **Cite the evidence, not the conclusion.** "The client log shows
   `no minecraftToken configured` at 17:23:13, 16 s before NeoForge loaded the
   config" is worth more than "the config path is broken".

`docs/testing-logs/` holds the session narrative — what was run, in what order,
and what each check showed. `docs/troubleshooting.md` holds the durable
diagnostic knowledge — symptom, cause, workaround, status. A session log links
to the troubleshooting entries it produced; it does not duplicate them.

## 17.3 Collaborative verification

Verification that needs a real Minecraft client is done collaboratively: the
agent runs the host and reads results, and the user launches the game and
performs the in-game actions. The agent cannot drive a GUI game.

The protocol is specified in `docs/phase-5-plan.md` §5 and the operator's steps
are in `docs/phase-5-verification-guide.md`. Rules that follow from it:

- **Name one action at a time.** The user performs a single in-game action and
  reports it, so any surprise is attributable to one cause.
- **The user's observation is evidence.** A check that renders on screen is not
  passed by host state alone.
- **A disagreement between the user's observation and the agent's reading is a
  finding**, not an inconvenience. Record it per §17.2 before explaining it.
- **Never claim a visual result from state data**, and never claim a check the
  user did not actually exercise — that is _not observed_, not _pass_.

## 17.4 General behavioural preferences

Standing preferences the user has stated. They apply to every session unless
the user overrides them.

1. **Record before fixing.** When something is found, document it and report.
   Do not repair it in the same breath. The user decides when a fix happens.
2. **Do not create a build for testing-only work.** A version bump requires a
   mod source change (`docs/versioning.md` §3.5). Testing, documentation, and
   tooling sessions keep the current version.
3. **Distinguish verified from unverified, always.** State what was actually
   observed and what was inferred. The user relies on this distinction and
   has repeatedly asked for it explicitly.
4. **Correct your own mistakes openly.** If an earlier claim was wrong, retract
   it plainly and say what the evidence actually supports.
5. **Do not overstate a result to look useful.** A partial result reported
   accurately is worth more than a complete one that is not true.
6. **Prefer the user's judgement on scope.** When work is diminishing returns,
   say so rather than continuing because it was requested earlier.

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
- [ ] Overlay paints a uniform key colour for OBS chroma keying, with no UI
      colour in the active key's family.
- [ ] OBS Browser Source works.
- [ ] Disconnects are represented accurately.
- [ ] Reconnection restores current state.
- [ ] Actual NeoForge integration compiles.
- [ ] Client-only installation is verified.
- [ ] Single-player integration is tested.
- [ ] Multiplayer integration is tested.
- [ ] Actual ATM10 TTS progression is verified.

**These boxes stay unchecked until they are proven against a real Minecraft
client.** §11.2 states that a successful mock test does not establish real FTB
Quests compatibility, and the closing rule below forbids marking the release
complete while only mock mode works. A checked box is a claim, so checking one on
mock evidence would contradict both.

What _is_ implemented and verified against the mock publisher and a scripted
protocol-v1 publisher — the monorepo build, host, frontend routes, chapter pinning,
and chroma keying — is recorded in `docs/phase-2-plan.md` §17 and
`docs/phase-3-plan.md` §14, which carry the precise evidence and its scope. Those
records are separate from this checklist on purpose.

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
