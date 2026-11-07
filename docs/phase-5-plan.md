# Phase 5 Plan — Real ATM10 TTS Integration

**Status:** In progress. The verification tooling is built and tested. Sessions 1
and 2 (2026-11-07) loaded the adapter in a live client and verified mapper
behaviour from logs — including completion-driven unpin removal — but the network
path was never exercised, because of an adapter configuration defect. See
`docs/testing-logs/2026-11-07-phase5-session-1.md`,
`docs/testing-logs/2026-11-07-phase5-session-2.md`, and
`docs/troubleshooting.md` §2.1. Every item in `AGENTS.md` §18 that requires a real
client remains unchecked, and no defect has been fixed yet.
**Date:** 2026-11-07
**Target:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250, FTB Quests
2101.1.30
**Mod version:** stays `0pre.2`. Phase 5 is testing only; a new version is cut
*after* the results, and only if they demand a source change.
**Normative companions:** `docs/protocol.md` (the contract),
`docs/ftb-quests-integration.md` (what FTB provides), `docs/phase-4-plan.md`
(how the adapter was built), `docs/phase-5-verification-guide.md` (the runbook),
`docs/troubleshooting.md` (failures seen in practice).

---

## 1.1 Session log

| Session | Date | Mode | Outcome |
|---|---|---|---|
| [1](testing-logs/2026-11-07-phase5-session-1.md) | 2026-11-07 | single-player | Adapter loaded and read real data; publishing blocked by defect D1. Two defects recorded, none fixed. |
| [2](testing-logs/2026-11-07-phase5-session-2.md) | 2026-11-07 | single-player | Same process, no restart. Mapper behaviour verified from logs; completion-driven unpin confirmed; chapter fields proved unobservable without a dump. |

A known, unfixed defect that stops a session is **not** a reason to renumber or
restart a sequence: session 2 continued from the first incomplete check.

Per `AGENTS.md` §17.2, every finding from a session goes into
`docs/troubleshooting.md`. The session logs carry the narrative; the
troubleshooting entries carry the durable diagnosis.

---

## 1. What changed, and why

Stage 4F was defined as a blocking preliminary stage: "verify the adapter against
a live client before anything else". That framing was wrong in two ways, and this
document replaces it.

**It was not a stage.** 4F contained no code. It was a list of things to observe,
and "blocked" described a calendar problem, not an engineering one. Treating it
as a gate meant all remaining verification waited on one session.

**It was not preliminary.** It is the first half of Phase 5. Phase 5 is *real
ATM10 TTS integration*, and its work is exactly:

- the adapter's structural correctness under real data (was 4F),
- the behavioural checks: pins, completion, reloads, world and team changes
  (also called out in 4F),
- single-player and multiplayer operation,
- the evidence trail that lets `AGENTS.md` §18 be checked honestly.

4F and Phase 5 asked the same questions of the same system. Splitting them
produced two documents describing one session and a status that read as more
blocked than the project actually was.

**4F is now Phase 5's first sequence, not its gate.** Sequence A in §6 is the
old 4F content; sequences B and C follow in the same run. There is no
"unblock 4F" step and no milestone to close before testing starts.

---

## 2. Where the project stands

| Component | State | Evidence |
|---|---|---|
| `packages/protocol` | v1 complete, unchanged since Phase 1 | 85 tests |
| `packages/mock-publisher` | 11 deterministic scenarios | 30 tests |
| `packages/host` | Loopback transport, two-token auth, chapter pins, persistence | 250 tests |
| `apps/web-app` | `/`, `/overlay`, `/control` in a static build | 169 tests |
| `minecraft-mod` | Stages 4A–4E; builds as `0pre.2` | compiles; live-verified only at 4A |
| **Verification tooling** | `scripts/phase5/*` | exercised against the mock; see §4 |

`npm test` passes: **534 tests**. That total is unchanged by this phase; Phase 5
adds no product code.

**What has never happened:** the adapter built in 4B–4E has never run inside a
real client. Every transport and encoding claim was verified with harnesses
(`EncoderHarness`, `TransportHarness`, `PersistentHarness`) driving the real
classes against the real host, but always outside Minecraft. The gap is
narrow and specific: *the mapper reading FTB objects on a live client thread.*

`packages/protocol/fixtures/atm10-recorded-snapshot.json` does not close it. Its
own README says so: the values were transcribed from the 4A probe log into a
harness, not produced by `FtbSnapshotMapper`. A validation pass there proves the
encoder handles real shapes, not that the mapper extracted them.

---

## 3. The constraint that shaped this plan

The agent cannot drive Minecraft. It is a GUI game behind an account login, and
nothing in this environment can move a player, open a quest book, or click a pin
button.

So every live check needs a human in the loop, and the plan must be built around
what each side can actually do:

| The user can | The agent can |
|---|---|
| Launch Prism and load a world | Read the host's log and state |
| Play, pin quests, complete tasks | Watch browser-visible state change |
| Connect to a server | Read the adapter's capture dump |
| Observe the overlay and OBS | Validate protocol conformance |
| Report what a human sees | Correlate all of the above against expectations |

The result is the collaboration protocol in §5. The entire point of the tooling
is to move as much judgement as possible to the side that can repeat it
mechanically, so the user's attention is spent on things only a human can
observe — and so that "the user said it worked" is backed by a transcript.

---

## 4. Verification tooling

All four scripts live in `scripts/phase5/` and are exposed as npm scripts. They
are development instruments, not product code: nothing in the host, frontend, or
mod imports them.

| Script | npm | Side | What it does |
|---|---|---|---|
| `check-environment.mjs` | `phase5:check` | agent | Read-only readiness: toolchain, builds, tokens, installed jar, client config, saved-world baseline. Never mutates. |
| `start-session.mjs` | `phase5:session` | either | Starts the real host with the built frontend, loads tokens through the host's own loader, prints the tokenized URLs, writes `session.json`. |
| `watch.mjs` | `phase5:watch` | agent | Connects as `control`, applies revisions like the frontend, logs every observable change, evaluates named assertions. |
| `read-capture.mjs` | `phase5:capture` | agent | Reads the adapter's `-Dquestbridge.dumpSnapshot` file — the only direct evidence `FtbSnapshotMapper` produced the values. |
| `check-pin-order.mjs` | — | agent | Tests observed pin order against candidate ordering rules and prints discriminating candidates. |
| `find-ordering-probe.mjs` | — | agent | Finds a quest whose ID rank differs from its catalog rank. |

Two existing scripts complete the set: `scripts/validate-snapshot.mjs`
(`phase5:validate`) validates captured messages through the same `parseFrame`
path the host uses, and `scripts/inspect-state.mjs` prints a single state
snapshot for a quick check.

`check-pin-order.mjs` derives its expectation from the pack's SNBT metadata
(chapter-group order plus each chapter's `order_index`), which **approximates**
FTB's runtime `getAllChapters()` order rather than reading it. Results from it
are therefore reported as "consistent with" a rule, never as proof of it.

### 4.1 How the pieces fit

```text
                    USER                          AGENT
                     │                              │
  Minecraft client ──┤ FTB in memory                │
        │            │                              │
        │ QuestBridge mod (client thread capture)   │
        ├────────────┴──► host (/ws, minecraftToken)
        │                              │            │
        │                     browser state ◄───────┤ watch.mjs (control role)
        │                              │            │
        │                     /overlay ◄─ OBS / browser
        │                                           │
        └── dumpSnapshot file ──────────────────────► read-capture.mjs
```

The user's Minecraft and the agent's observer are **two independent readers of the
same host**. A check passes only when both agree: the user sees it on screen, the
agent sees it in state.

### 4.2 Assertions `watch.mjs` can evaluate

Passed as `--expect ready,no-auto-pin,...`:

| Name | Passes when |
|---|---|
| `ready` | a publisher reached `ready` with a catalog |
| `no-auto-pin` | automatic pin ID `1` never appeared in objectives |
| `objectives-partition` | no duplicate objectives and no resolved/unresolved overlap |
| `chapter-mapping` | all five ATM10 chapter IDs resolved |
| `numeric-task` | at least one task exposed `current`/`target` |
| `null-or-complete` | a completed chapter, a `null`-progress chapter, or a zero-progress chapter was seen |
| `pin-change` | the manual pin set changed |
| `progress-change` | chapter or quest progress changed |
| `reconnect` | the publisher went away and came back |
| `world-change` | world identity changed |
| `team-change` | team identity changed |
| `after-pin-addition` | a pin added during the run became an objective |
| `after-completion` | an objective disappeared (FTB unpins completed quests) |
| `single-player` | the publisher reported an integrated server |
| `multiplayer` | the publisher reported a remote server |

The ledger **accumulates**: a change that happens between two received states is
still recorded. A live run is not a script, and the host coalesces updates, so
adjacent-state comparison would silently miss short-lived events.

### 4.3 Tooling limits, stated plainly

- `watch.mjs` observes the host's normalised state. It cannot tell you what the
  overlay *looks* like; that is the user's half of each check.
- It cannot prove the adapter read FTB correctly. Only `read-capture.mjs` against
  a live dump, compared with what the user sees in the quest book, does that.
- None of it runs the Minecraft integration. A green `watch` run with the mock
  publisher proves the observer works, not FTB compatibility (`AGENTS.md` §11.2).

---

## 5. The collaboration protocol

The rule that makes this work: **one side asks, the other answers, and the answer
is evidence.**

### 5.1 Roles

| Role | Owns | Never does |
|---|---|---|
| **User** | Minecraft, OBS, and the physical actions of play | Edit `config.json` or tokens by hand; paste tokens into chat |
| **Agent** | Host, observation, validation, correlation, documentation | Claim a check passed without observing it |

### 5.2 The loop

```text
  1. Agent runs phase5:check and states the session's goal checks.
  2. Agent starts phase5:session; the user opens the printed Dashboard URL
     and pins up to five chapters there.
  3. User launches the client and loads a world.
  4. User says "launched" and names the world (single-player or server).
  5. Agent runs phase5:watch with the checks for this sequence.
  6. User plays, performing the named action for each check.
  7. Agent reads the watch output live and reports each check as it lands.
  8. Either side flags a discrepancy. Agent correlates host log, watch ledger,
     and capture dump before concluding anything.
  9. Agent records the result in the run log; the user confirms the visual
     half for anything shown on screen.
```

### 5.3 Disagreement rule

If the user sees something the agent's state does not show, or the reverse, that
is **a finding, not an inconvenience**. Do not "try again and see if it works".
Record:

- what the user saw, verbatim;
- the last state the agent observed;
- the relevant host-log lines;
- whether the capture dump contains the expected values.

The three viewers — user, host state, capture — are independent. A disagreement
between two of them localises the defect to the third component's boundary. This
is precisely the class of bug no harness could find, and the reason a live run is
still necessary after 4B–4E.

### 5.4 What counts as evidence

| Claim | Sufficient evidence |
|---|---|
| A message is protocol-valid | `phase5:validate` exit 0 / `phase5:capture` pass |
| The overlay renders X | A user observation in the run log, or a stored screenshot |
| Pins update reactively | `watch` reports the pin change **and** user confirms the overlay changed |
| The mapper extracted FTB values correctly | Capture dump value **and** user confirms it in the quest book |
| Single/multiplayer works | `watch --expect single-player\|multiplayer` **and** a completed sequence in that mode |

"I ran it and it seemed fine" is not evidence and is not recorded as a pass.

### 5.5 Session hygiene

- Tokens never enter chat, the run log, or a committed file. The agent reads them
  from `session.json`; the user never needs to copy them.
- The dump file contains real world and team identifiers. It is written under
  `.questbridge/`, which is ignored. A fixture is committed only after
  sanitisation (`AGENTS.md` §11.1) and carries its provenance in
  `packages/protocol/fixtures/README.md`.
- Every claim in the final run log names the tool output it came from.

---

## 6. Sequences

Sequences A–C use one client session. Sequence D is a second, separate session in
a different mode. Each sequence lists what the user does and what the agent
expects to observe.

### Sequence A — Adapter correctness under real data

The old 4F content, now the opening of Phase 5.

| # | User does | Agent expects |
|---|---|---|
| A1 | Loads the ATM10 world | `watch`: `connection -> synchronizing`, then `ready`; exactly one catalog |
| A2 | — | Catalog has 55 chapters and 5/5 expected ATM10 IDs resolve (`chapter-mapping`) |
| A3 | Opens the quest book, reads the five pinned chapters' percentages | `watch` and `/overlay` agree with the quest book |
| A4 | — | At least one chapter `progress: null` or `status: completed` exists (`null-or-complete`) |
| A5 | — | At least one task exposes `current`/`target` once a pin is active (`numeric-task`) |
| A6 | Pins one quest in the quest book | Within ~2 s: `watch` `pins changed +[<id>]`, overlay shows it (`after-pin-addition`) |
| A7 | — | No objective titled from FTB's auto tracker; ID `1` never appears (`no-auto-pin`) |
| A8 | — | Capture dump validates; values match A3 and A5 (`phase5:capture`) |

**Why A6 needs the user:** pins have no FTB event. They are found only by the
2-second reconciliation, so "how fast did it appear" is a real question the agent
can time and the user can confirm visually.

### Sequence B — Progression and completion

| # | User does | Agent expects |
|---|---|---|
| B1 | Advances a task on a pinned quest | `progress-change`; earlier task counts increase |
| B2 | Re pins a second quest, then unpins one | `pins changed` both ways; overlay drops the row without a re-render artifact |
| B3 | Completes a pinned quest | FTB removes the pin: objective disappears (`after-completion`); nothing fabricates a completed objective |
| B4 | Completes a chapter's required quests | `progress-change` with `status: completed`; overlay shows completion from status, not from 100 % |
| B5 | — | If any chapter reports 100 without completion, that is correct and expected; note it rather than "fixing" it |

**B3 is the check most likely to reveal a defect**, and the one most easily faked
by a mock. FTB removes the pin on completion (`docs/ftb-quests-integration.md`
§7.4), so the row must disappear — a retained completed row would mean the adapter
is synthesising state.

### Sequence C — Lifecycle

| # | User does | Agent expects |
|---|---|---|
| C1 | Leaves the world to the main menu | `connection -> disconnected`; overlay fades, then shows the lost-connection state |
| C2 | Reloads the same world | `reconnect`; fresh full snapshot; catalog intact |
| C3 | Reloads the quest data if the pack offers it | A fresh catalog, no stale titles |
| C4 | Switches to a second world | `world-change`; progress from the new world only |
| C5 | Stops and restarts the host while in-world | Client reconnects with backoff; overlay recovers without restarting Minecraft |
| C6 | Quits the client entirely | `connection -> disconnected`; no stale progression presented as live |

### Sequence D — Single-player and multiplayer

Run twice: once in the integrated server, once on a remote server with the pack
installed.

| # | User does | Agent expects |
|---|---|---|
| D1 | Connects in the given mode | `single-player` or `multiplayer` respectively |
| D2 | Repeats A6 and B1 | Identical behaviour in both modes |
| D3 | — | No server-side mod was installed; the client state alone sufficed |

---

## 7. Results recording

One log per session: `docs/testing-logs/<date>-phase5-<mode>.md`.

Each entry records the check, the tool output it rests on, the user's
observation, and a verdict from {pass, fail, not observed}. A check that was not
exercised is **not observed** — never pass.

At session end the agent runs `phase5:check` again, collects `watch` JSON
reports, the host log, and the capture dump, and updates §8's table. Only checks
with recorded evidence may change.

---

## 8. Acceptance

| Check | §18 item | Status |
|---|---|---|
| Adapter connects and publishes | Actual NeoForge integration compiles | not observed |
| Chapter catalog and 5 IDs | Chapter catalog is received | not observed |
| Chapter progress | Chapter progress is displayed | not observed |
| Objectives from manual pins | Manual FTB Quests pins are received | not observed |
| Auto pin excluded | Automatic pins are excluded | not observed |
| Task counts and numeric progress | Task progress is displayed where available | not observed |
| Completion removes the objective | Quest progress is displayed | not observed |
| Lifecycle recovery | Reconnection restores current state | not observed |
| Disconnect | Disconnects are represented accurately | not observed |
| Single-player | Single-player integration is tested | not observed |
| Multiplayer | Multiplayer integration is tested | not observed |
| End to end | Actual ATM10 TTS progression is verified | not observed |
| Jar installed | Client-only installation is verified | not observed |

Items already proven without a client (build, host, mock, chapter pinning,
chroma keying) are recorded in `docs/phase-2-plan.md` §17 and
`docs/phase-3-plan.md` §14 and are **not** re-claimed here.

`AGENTS.md` §18 stays unchecked until these rows hold evidence. Passing every
sequence, with no defects, checks them. Any defect becomes a source change, a new
mod version after the fact (§10), and a re-run of the affected sequence.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Agent claims a visual check from state alone | Overlay bugs recorded as passes | User observation required in the run log (§5.4) |
| Title placeholders before translation sync | Wrong chapter names snapshotted | Reconciliation refreshes; A3 waits for the quest book to look right |
| Pin changes missed between states | False "pin unchanged" | Ledger accumulates (§4.2); 2 s reconciliation is the floor |
| Dump contains player/server data | Leak on commit | Dumps stay in ignored `.questbridge/`; fixtures sanitised |
| Long session drifts from the checklist | Untested areas reported as covered | Checks named per sequence, recorded per check |
| Host and client disagree on port | Silent "no publisher" | `check-environment` compares client `hostUrl` with the session port |

---

## 10. After Phase 5

Phase 5 adds no version. When the results are in:

1. **No defects** — no new version. `0pre.2` is the version the project has been
   developing against, and testing does not create a build. The documented
   version in `docs/versioning.md` is updated only when the conversation closes,
   per that document's own rule.
2. **Defects found** — fix them, then cut the next version as a separate,
   justified build, and re-run only the affected sequences.
3. **Recorded fixture** — the first sanitised live capture replaces the
   transcribed one, with updated provenance in
   `packages/protocol/fixtures/README.md`.

`AGENTS.md` §18 may then be checked only for items with recorded evidence.

---

## 11. Out of scope

- Any source change to the mod, host, protocol, or frontend.
- Auto-pin tracker reconstruction.
- Quest pin mutation; FTB remains the only pinning interface.
- New features of any kind (`AGENTS.md` §2.4, §19).
- Protocol v1 changes.
