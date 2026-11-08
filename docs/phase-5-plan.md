# Phase 5 Plan — Real ATM10 TTS Integration

**Status:** In progress. **Round 2 ran on 2026-11-08 and produced the first transport
evidence the project has had**: `0pre.3` published to the real host, E1 and runtime
token discovery were confirmed in a live client, and thirteen plan checks passed. The
results are in
[docs/testing-logs/2026-11-08-phase5-round2-single-player.md](testing-logs/2026-11-08-phase5-round2-single-player.md),
and §8's tables now carry their verdicts.

Before Round 2, sessions 1 and 2 (2026-11-07) loaded the adapter in a live client and
verified mapper behaviour from logs — including completion-driven unpin removal — but
the network path was never exercised, because of an adapter configuration defect.
**That defect is fixed.** Proposal E was adopted on 2026-11-07 and implemented in
`0pre.3`, which also closes the §4.1 observability gap and the two `phase5:watch`
defects. See §12 and `docs/troubleshooting.md` §2.1.

**Still not verified after Round 2:** the chapter-pin half of the data path (no pins
were set — `docs/troubleshooting.md` §4.6), the **remote-server** case (`AGENTS.md` §7;
Round 2 was single-player only), the heartbeat-stale timer, and a regenerated token in
the client. One product defect was confirmed: a world-less client keeps the host at
`ready`, so the overlay never fades (§4.8).

> **Round 3 is prepared.** `docs/phase-5-round-3-guide.md` carries the obligations Round
> 2 could not close, the pre-flight that Round 2 learned to do the hard way, the
> re-verification matrix for work landing in between, and the evidence rules. No Round 3
> live run has happened.

**Decision taken (2026-11-07).** Publishing required a token the adapter could
not read from its own config, so `/control` had no chapter catalog and chapters
could not be pinned before a run. The fix was recorded as Proposal E in
`docs/proposals.md` — the config-load ordering defect (E1), the frozen token
(E2), and runtime token discovery — and was **adopted and implemented** the same
day in `0pre.3`. This plan's §12 records what was built and what it obliges
Phase 5 to re-run. It is **no longer necessary** to set
`QUESTBRIDGE_MINECRAFT_TOKEN` by hand, though the variable still works and still
takes precedence.
**Date:** 2026-11-07
**Target:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250, FTB Quests
2101.1.30
**Mod version:** **`0pre.3`.** Phase 5 was testing-only until the Proposal E
decision; that decision changes mod source, so under `docs/versioning.md` §3.5 it
carries a build. Sessions 1 and 2 are `0pre.2` observations; §12.4 states
precisely what carries over.
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
| [Round 2](testing-logs/2026-11-08-phase5-round2-single-player.md) | 2026-11-08 | single-player | **First run that reached the host.** `0pre.3` published; E1 and discovery confirmed live; 13 checks passed; world change, host-restart reconnect, crash disconnect and four cold-start orderings verified. Chapter pins not exercised (§4.6). One product defect confirmed (§4.8). |
| Round 3 | — | — | **Prepared, not run.** `docs/phase-5-round-3-guide.md`. Obligations: chapter pins end to end, team change, quest reload, the heartbeat-stale timer, a regenerated token in the client, and the remote-server case required by `AGENTS.md` §7. |

**A live run has now used `0pre.3`.** The `0pre.3` build's offline verification record
([2026-11-07-phase5-build-0pre3.md](testing-logs/2026-11-07-phase5-build-0pre3.md)) is
still **not** listed as a session above, because it contains no client observation; the
Round 2 entry is the client observation that supersedes its boundaries.
Prior sessions that were attempted and abandoned remain in `.questbridge/` rather than
being renumbered — `.questbridge/phase5/live-a/` was identified on 2026-11-08 as the
first attempt of session 1 (see `docs/phase-5-round-2-guide.md` §9).

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
- single-player and remote-server operation (`AGENTS.md` §7: remote servers are in
  scope; "multiplayer" is not a verification target),
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
| `minecraft-mod` | Stages 4A–4E plus the Proposal E fixes; builds as `0pre.3` | compiles; live-verified only at 4A |
| **Verification tooling** | `scripts/phase5/*` | exercised against the mock; see §4 |

`npm test` passes: **534 tests**. Phase 5 adds no product code of its own: the
`0pre.3` change is all inside `minecraft-mod/src/main/java`, and the two tooling
defects in `scripts/phase5/watch.mjs` are covered by that script's own checks
rather than by an npm test project. Both numbers are unaffected.

**What has never happened:** the adapter built in 4B–4E has never run inside a
real client. Every transport and encoding claim was verified with harnesses
(`EncoderHarness`, `TransportHarness`, `PersistentHarness`) driving the real
classes against the real host, but always outside Minecraft. The gap is
narrow and specific: *the mapper reading FTB objects on a live client thread.*
The `0pre.3` fixes were also verified outside Minecraft (§12.5); they change
*when* the transport starts and *where* the token comes from, neither of which a
harness can exercise, so §12.5 states what the offline evidence does and does not
cover.

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
| `multiplayer` | the publisher reported a remote server (the assertion name is `watch.mjs`'s identifier; `AGENTS.md` §7 calls this case a **remote server**, not multiplayer) |

The ledger **accumulates**: a change that happens between two received states is
still recorded. A live run is not a script, and the host coalesces updates, so
adjacent-state comparison would silently miss short-lived events.

**Every assertion is tri-state.** A check reports `pass`, `fail`, or
`not_observed`, and `not_observed` is what an unexercised check gets — never a
pass. This is the fix for `docs/troubleshooting.md` §4.4 and §4.5, which recorded
that `no-auto-pin` and `objectives-partition` used to pass vacuously on a dead
connection because neither bad thing had been seen. Those two assertions in
particular now require a `ready` connection with a non-zero chapter count before
they can pass; below that precondition they are not observed, not true.

`watch.mjs` exits `0` only when every requested check genuinely passed, `1` when
one failed, and non-zero without a pass when a check never became testable.

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
| Single-player and remote-server operation | `watch --expect single-player\|multiplayer` **and** a completed sequence in that mode (the `multiplayer` name denotes a remote server — `AGENTS.md` §7) |

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

### Sequence D — Integrated server and remote server

Run twice: once on an **integrated (single-player) server**, once on a **remote server**
with the pack installed.

> **Vocabulary aligned with `AGENTS.md` §7 on 2026-11-08.** This sequence was called
> "Single-player and multiplayer". "Multiplayer" is not in scope as a verification
> target; remote servers are. What is being verified is that the same client-side
> behaviour holds when the pack is hosted remotely, **not** multiplayer-specific
> behaviour. The `multiplayer` assertion name in §4.2's table is retained as
> `watch.mjs`'s literal identifier; it means "the publisher reported a remote server".

| # | User does | Agent expects |
|---|---|---|
| D1 | Connects in the given mode | `single-player` for an integrated server, `multiplayer` for a remote one (`watch.mjs`'s identifier) |
| D2 | Repeats A6 and B1 | Identical behaviour in both modes |
| D3 | — | No server-side mod was installed; the client state alone sufficed |

---

## 7. Results recording

One log per session: `docs/testing-logs/<date>-phase5-<mode>.md`.

Each entry records the check, the tool output it rests on, the user's
observation, and a verdict from {pass, fail, not observed}. A check that was not
exercised is **not observed** — never pass. Since the §4.4/§4.5 fix, `watch.mjs`
reports that third state itself rather than forcing it into one of two buckets, so
the tool and this rule now agree.

At session end the agent runs `phase5:check` again, collects `watch` JSON
reports, the host log, and the capture dump, and updates §8's table. Only checks
with recorded evidence may change.

---

## 8. Acceptance

| Check | §18 item | Status |
|---|---|---|
| Adapter connects and publishes | Actual NeoForge integration compiles | **pass** — first publisher ever received by a host |
| Chapter catalog and 5 IDs | Chapter catalog is received | **pass** — 55 chapters, 5/5 expected IDs |
| Chapter progress | Chapter progress is displayed | **not observed** — no chapter pins (§4.6) |
| Objectives from manual pins | Manual FTB Quests pins are received | **pass** — additions and removals followed |
| Auto pin excluded | Automatic pins are excluded | **pass** — ID `1` never seen in 1,178 snapshots |
| Task counts and numeric progress | Task progress is displayed where available | **pass** — `current`/`target` on four pins |
| Completion removes the objective | Quest progress is displayed | **pass** — and the user watched the row disappear |
| Lifecycle recovery | Reconnection restores current state | **pass** — reconnect after host restart, world change, client restart |
| Disconnect | Disconnects are represented accurately | **partial** — quit and crash correct; leaving the world does not disconnect at all (§4.8) |
| Single-player | Single-player integration is tested | **pass** — `integrated=true` throughout |
| Remote server | Remote-server (multiplayer) integration is tested | not observed |
| End to end | Actual ATM10 TTS progression is verified | **partial** — quest/objective path verified; chapter path untested (§4.6) |
| Jar installed | Client-only installation is verified | **pass** — `questbridge-0pre.3.jar` loaded; no server-side mod |

**Added 2026-11-07 by §12**, because the Proposal E fixes create checks the
previous runs could not perform. These are adapter-internal behaviours rather than
`AGENTS.md` §18 items, so the §18 column names the closest item and none of them
is a substitute for the rows above.

| Check | §18 item | Status |
|---|---|---|
| Transport starts from the config-load event, not the constructor | (none — §12.6 item 3) | **pass** — `publishing to … (… config loaded trigger)` in three launches |
| The documented config path supplies the token (E1) | (none — §12.6 item 2) | **supplanted** — the config token was blank, so discovery supplied it; the documented path was never exercised as the *source* |
| A regenerated token is picked up on reconnect (E2) | (none — §12.6 item 5) | **not observed in a client** — six host restarts reconnected, but `tokens.json` was not regenerated; harness evidence only |
| Mapper chapter values appear in `4B` logs (§4.1 fix) | Chapter progress is displayed | **pass** — `title`, `subtitle`, `order`, `progress`, `status` all populated |

Items already proven without a client (build, host, mock, chapter pinning,
chroma keying) are recorded in `docs/phase-2-plan.md` §17 and
`docs/phase-3-plan.md` §14 and are **not** re-claimed here.

`AGENTS.md` §18 stays unchecked until these rows hold evidence. Passing every
sequence, with no defects, checks them. Any defect becomes a source change, a new
mod version after the fact (§10), and a re-run of the affected sequence.

**§12's offline results move none of the rows above.** They are recorded in
§12.5 with their boundary, and nothing in them is a client observation.

> **Amended 2026-11-08 — Round 2 was run.** The rows above now carry their Round 2
> verdicts. Full evidence, and the boundary of every claim, is in
> [2026-11-08-phase5-round2-single-player.md](testing-logs/2026-11-08-phase5-round2-single-player.md).
> Three rows are deliberately **not** `pass`: chapter progress and end-to-end (no
> chapter pins — `docs/troubleshooting.md` §4.6), and disconnection (a world-less
> client never disconnects — §4.8). **The remote-server row was not attempted**; Round 2
> was single-player only. No source changed during the run, so `0pre.3` stands.
>
> **Vocabulary aligned with `AGENTS.md` §7 the same day.** "Multiplayer" is not in scope
> as a verification target; a **remote server** is. The row above and Sequence D were
> renamed accordingly. The `multiplayer` assertion name in §4.2 is unchanged because it
> is `watch.mjs`'s literal identifier.

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

When the results are in:

1. **No defects** — no new version. `0pre.3` is the version the project has been
   developing against since the Proposal E decision, and testing does not create a
   build. The documented version in `docs/versioning.md` is updated only when the
   conversation closes, per that document's own rule.
2. **Defects found** — fix them, then cut the next version as a separate,
   justified build, and re-run only the affected sequences.
3. **Recorded fixture** — the first sanitised live capture replaces the
   transcribed one, with updated provenance in
   `packages/protocol/fixtures/README.md`.

`AGENTS.md` §18 may then be checked only for items with recorded evidence.

**Amended 2026-11-07.** This section previously said Phase 5 "adds no version" and
named `0pre.2`, which was true while Phase 5 was testing only. The Proposal E
decision changed mod source, so §12 applies and `0pre.3` exists. The principle
this section states is unchanged — *testing produces measurements, not builds* —
but it now has to be read alongside the separate rule that a fix discovered *by*
testing does change source and takes a version (`docs/versioning.md` §3.5).

---

## 11. Out of scope

- Auto-pin tracker reconstruction.
- Quest pin mutation; FTB remains the only pinning interface.
- New features of any kind (`AGENTS.md` §2.4, §19).
- Protocol v1 changes.

**Amended 2026-11-07.** "Any source change to the mod, host, protocol, or
frontend" was the first item here and has been removed. It was correct while
Phase 5 was testing only; the Proposal E decision turned three defects into mod
source changes, which §12 records. The remaining four items still hold without
qualification, and protocol v1 in particular is untouched by §12.

---

## 12. Proposal E — what was built, and what it obliges next

**Status:** Implemented in `0pre.3` on 2026-11-07. Verified offline (§12.5);
**not** verified in a live client, because that requires the user to launch
Minecraft. The decision is recorded in `docs/proposals.md` §6.1.

This section exists because Phase 5's plan is the document that says what to test,
and §12 changes the preconditions of every sequence in §6. It records the change,
the reasoning, the evidence boundary, and the re-runs the change requires.

### 12.1 What changed, and why

Four recorded defects were fixed. Three come from Proposal E; the fourth is the
observability gap that made the mapper's chapter values unverifiable.

| Defect | Fix | Why it could not wait |
|---|---|---|
| `docs/troubleshooting.md` §2.1 — the adapter reads its config before NeoForge loads it | Transport now starts from `ModConfigEvent.Loading` / `Reloading`, not from the mod constructor | Phase 5 has produced no transport evidence at all because of it |
| `docs/troubleshooting.md` §2.1.2 — the token is resolved once and frozen | `ConnectionController` takes a token **supplier** and calls it on every connect attempt | Without it, a regenerated token still needs a Minecraft restart |
| Proposal E discovery — no token can be found automatically | The adapter reads the host's own `tokens.json`, at the host's documented paths | This is the reason E2 has any value: a token that can change is worth re-reading |
| `docs/troubleshooting.md` §4.1 — mapper chapter values are never logged | `logSnapshot()` now prints per-chapter `id`, `title`, `order`, `progress`, `status`, `subtitle` | The mapper's chapter output was unverifiable from logs, which is why session 2's chapter finding had to be retracted |

The reasoning for doing all four together rather than in the proposed two steps is
in `docs/proposals.md` §6.1: they share one rebuild, one jar swap, and one re-run.
Splitting them would have produced an intermediate jar that fixes nothing
observable.

### 12.2 Token precedence — the one place implementation tightened the sketch

The proposal listed precedence as system property, environment variable,
discovered file, then the configured value. **Implementation puts the configured
`minecraftToken` ahead of discovery.** Full precedence, with reasons:

```text
1. -Dquestbridge.minecraftToken=<token>            explicit, per-launch override
2. QUESTBRIDGE_MINECRAFT_TOKEN=<token>             explicit, per-instance override
3. config/questbridge-client.toml minecraftToken   the user's stated intent
4. discovered host tokens.json                     the fallback that unblocks a run
```

**Rejected alternative:** discovery before the config file, as sketched. It is
defensible — a just-discovered token is likelier to be current than a stale
hand-copied one — but it would make the config file's `minecraftToken` field
un-honourable. A configuration value that the program may silently ignore is worse
than no configuration value, because it produces a symptom ("I set it and nothing
changed") that cannot be diagnosed from the file. Discovery exists for the case
where *nothing* is configured, which is exactly where sessions 1 and 2 were.

The normative statement of this order is `docs/ftb-quests-integration.md` §11.1.

### 12.3 Security consequences, restated

Stated here as well as in `docs/local-authentication.md` §2.3, because §12 is
where a reader will look for "what did adopting this cost".

- **No new trust boundary.** Discovery reads a file that every process running as
  this user could already read. It does not widen `minecraftToken`'s meaning:
  publisher-versus-reader is unchanged, and a browser still cannot publish.
- **The credential becomes discoverable without configuration.** That is the
  point of the feature, and it is a real change in posture rather than a
  no-op: previously an attacker needed the token value, now they need only read a
  file at a known path. On a single-user loopback machine those are the same
  attacker, which is why the change is acceptable — but it is a change.
- **The token is still never logged.** Discovery logs the *path* it read and
  whether a token was found, never the value. This is asserted by the
  adapter's own log lines and by the redaction rule in `docs/phase-4-plan.md` §4.
- **`--print-urls` remains the only way to display a token**, and it still prints
  browser URLs only.

### 12.4 What carries over from sessions 1 and 2, and what does not

Neither session reached the host, so neither produced transport evidence. What
they established divides cleanly:

**Still valid, because the fix does not touch the code that produced it:**

- The mapper's objective behaviour: pin addition within the reconciliation
  window, completion-driven unpin removal with nothing retained, and automatic pin
  ID `1` excluded. `FtbSnapshotMapper` and `FtbQuestProgressProvider` were not
  modified by §12.1.
- The 55-chapter catalog and the five expected ATM10 chapter IDs resolving.
- Zero client-thread violations.

**Superseded, and must be re-taken:**

- Everything about the adapter's configuration path. §2.1 and §2.2 of
  `docs/troubleshooting.md` describe `0pre.2` behaviour; the config file is now
  read in time, and the documented path is the one that works.
- Any claim about whether the adapter publishes. It did not on `0pre.2`; the
  `0pre.3` behaviour is unverified until a live run.
- The mapper's chapter values, now that §4.1 is fixed: they were never observed,
  and the new log line is the instrument that will observe them. **No value may be
  quoted until a run prints one.**

**Unchanged either way:** `AGENTS.md` §18. Not one box moves on the strength of
§12, because §12 was verified offline.

### 12.5 Verification: what was actually run, and its boundary

Recorded in full in
[2026-11-07-phase5-build-0pre3.md](testing-logs/2026-11-07-phase5-build-0pre3.md).
In summary:

| Claim | Evidence | Boundary |
|---|---|---|
| The mod compiles as `0pre.3` | `./gradlew build`, jar named `questbridge-0pre.3.jar` | Compilation only |
| The version is consistent across sources | `gradle.properties`, the jar filename, `META-INF/neoforge.mods.toml` | — |
| Token precedence resolves as §12.2 describes | Harness driving the real resolver with each source set and unset | The resolver only; not the in-game config event |
| Discovery finds and parses a real `tokens.json` | Harness against a temporary host config directory | The file-reading path only |
| **The transport now starts at the right time in a real client** | **Not verified** | Needs a live launch |
| **Publishing actually works end to end** | **Not verified** | Needs a live launch |

The two "not verified" rows are the reason this section is not called a
verification of Proposal E. The fix is in the interaction between NeoForge's
config lifecycle and the mod constructor, which no out-of-game harness can
reproduce: the defect was that a *callback did not exist yet*, and only the game
fires it.

### 12.6 What §12 obliges Phase 5 to do next

The next live run is the first that can produce transport evidence, and it has one
extra check the previous runs could not perform:

> **Round 2 has been run (2026-11-08).** `docs/phase-5-round-2-guide.md` served as the
> procedure and its §10 now records what the run changed about it. Items 1–6 below were
> each exercised: the client reached `publishing to ws://…` (items 1 and 3), no token
> was pre-set (item 2), chapter values were read from `4B` lines (item 4), the
> `dumpSnapshot` file was produced and validated (item 6). **Item 5 — regenerating
> `tokens.json` mid-session — was not performed**, so the live half of E2 remains
> unverified; see the run log §2.3 and §8.

1. **Re-run Sequence A from the top** (§6), on a client that reaches
   `[QuestBridge] publishing to ws://…`. The absence of that line was the fastest
   signal of the old defect; its presence is the first check.
2. **Do not set `QUESTBRIDGE_MINECRAFT_TOKEN` for the first attempt.** The point
   of the fix is that the documented path works; a run that pre-sets the variable
   cannot distinguish a fixed adapter from a working workaround. Set it only if
   discovery is the thing being diagnosed.
3. **Verify E1 directly**: the client log must show the adapter *deferring*
   transport startup to the config-load event rather than warning "no
   minecraftToken configured". Both lines exist and are distinguishable.
4. **Verify the §4.1 fix** by reading chapter `progress`, `status`, and `subtitle`
   from the `4B` lines, per `docs/troubleshooting.md` §4.2's rule that only `4B`
   is evidence about the published snapshot.
5. **Verify E2** by regenerating `tokens.json` mid-session and confirming the
   adapter recovers on its next reconnect rather than needing a restart. This is
   the check §2.1.2 says was impossible before, and it is the one that most
   directly tests the change.
6. **Add `-Dquestbridge.dumpSnapshot=<path>`** on every run, as before
   (`docs/troubleshooting.md` §4.1's workaround, still the only validatable
   artifact).

Items 3, 4, and 5 are new to the sequence list and are added to §8's acceptance
table below.

### 12.7 The two tooling defects, fixed alongside

`docs/troubleshooting.md` §4.4 and §4.5 recorded that `phase5:watch` reported
vacuous PASS results and could not express "not observed". Both are fixed in
`scripts/phase5/watch.mjs`:

- **Every assertion now has a precondition.** The absence assertions
  (`no-auto-pin`, `objectives-partition`) require a `ready` connection with a
  non-zero chapter count before they can pass. With no data they return
  **not observed**, not pass.
- **The report expresses three states.** Each assertion is `pass`, `fail`, or
  `not_observed`, and the exit code distinguishes them: `0` only when every
  requested check genuinely passed, `1` on a failure, and a non-zero code when a
  check was requested but never became testable.

Fixing this has no version impact — `docs/versioning.md` §3.5 — but it does change
what a `watch` report means, so §4.2 of this plan (which lists the checks) and
§7 (which requires a verdict per check) both now describe the tri-state form. Both
are updated.

---
