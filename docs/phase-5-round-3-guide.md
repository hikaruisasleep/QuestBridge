# Phase 5 Round 3 — Preparation and Testing Guide

**Purpose:** hand a fresh session everything it needs to run and judge Round 3 without
re-deriving it from a conversation.
**Date:** 2026-11-08
**Status:** **prepared; no Round 3 live run has happened.**
**Predecessor:** [Round 2](testing-logs/2026-11-08-phase5-round2-single-player.md) —
the first run that reached the host, and the evidence every claim below rests on.
**Plan:** `docs/phase-5-plan.md` §6 (sequences), §8 (acceptance).
**Mod:** `0pre.3` — **unchanged**. No source changed in Round 2, so nothing has been
written since the build that Round 2 tested.

> **Read this first if you are the fresh agent.** Round 3 is not a re-run of Round 2.
> Round 2 closed thirteen plan checks. Round 3 exists to close the **seven obligations
> Round 2 could not**, plus re-verify the two changes that may land under it. Do not
> repeat the checks listed in §2 as already closed.

---

## 1. Why Round 3 exists

Round 2 (2026-11-08) produced the first transport evidence in the project's history:
`0pre.3` published to the real host, E1 and runtime token discovery were confirmed in a
live client, and the completion-driven unpin — the check most likely to expose a
fabricated objective — was confirmed from three sides including the user's own eyes.

What it did **not** close falls into two groups.

**A. Checks that need a live client and were not exercised.** Chapter pins (no pins were
configured, by decision), a team change, a quest-data reload, the heartbeat-stale timer,
a regenerated token reaching the client, and the remote-server case.

**B. Work that may land between Round 2 and Round 3, which would oblige re-verification.**
Two approved or recorded product changes are outstanding, and both touch what a run
observes. Round 3 must state which jar and which frontend build it ran against, because
`0pre.3` is only the correct version if no mod source changed.

---

## 2. Already closed — do not re-run

These passed in Round 2 with evidence recorded in the run log. They are listed so a
fresh session does not spend the user's time re-proving them.

| Check | Evidence |
|---|---|
| E1: transport starts from the config-load event | `publishing to … (… config loaded trigger)` in **three** launches; `no minecraftToken configured` never appeared |
| Discovery with a blank config token | token source `…\QuestBridge\tokens.json` |
| Adapter connects and publishes | `publisher hello … mod 0pre.3`, watcher `connection -> ready` |
| Catalog: 55 chapters, 5/5 expected IDs | `4B` chapter lines; watcher `expected chapters resolved: 5/5` |
| Manual pins appear and disappear | 4→5, 5→6, 6→5, all within the ~2 s reconciliation window |
| Automatic pin ID `1` excluded | `read-capture`: `automatic pin id 1 seen: false` across 1,178 snapshots |
| Completion removes the objective | client log + host `-[70C2B568FA46337F]` + **user saw the overlay drop 6 → 5 rows** |
| Task `current`/`target` published | `ftbquests:item … current=0 target=1` on four pins |
| World change → fresh snapshot | `New World` → `hi deepseek`, no mixing |
| Host-restart reconnect | new host process, client reconnected ~22 s, no game restart |
| Client-restart reconnect | new `sessionId` (`15762c6e` → `31087457`), fresh catalog |
| Crash disconnect | `code 1006`, `disconnected` within ~5 s, state retained |
| Single-player | `integrated=true` throughout |

**Not re-runnable without cost:** the completion test required arranging FTB state. If the
run needs it again, do it late, and note that repeating it changes nothing already
recorded.

---

## 3. Round 3's obligations

### 3.1 A pre-flight: what is actually installed

**Do this before anything else, and record the answers in the run log.** Round 2's four
cold-start tests were partly invalidated by not checking what was listening; do not repeat
that class of mistake.

| Check | Command | What must be true |
|---|---|---|
| No host running | a real request, **not** a port listing | `http://127.0.0.1:8765/health` refuses. A confined/limited shell cannot see a listener owned by another process — a "port free" reading is not proof |
| No stale watcher | process list outside any confinement | no `watch.mjs` / `start-session.mjs` survivors |
| Installed jar | `Get-ChildItem <instance>\minecraft\mods -Filter "questbridge*"` | **exactly one** loadable `.jar`; note its version |
| Version agreement | `gradle.properties`, jar filename, `neoforge.mods.toml` | all agree (`docs/versioning.md` §2) |
| Client config | `<instance>\minecraft\config\questbridge-client.toml` | record whether `minecraftToken` is blank (→ discovery) or set (→ precedence 3) |
| JVM flags | `<instance>\instance.cfg` `JvmArgs` | `-Dquestbridge.dumpSnapshot=<path>` present |
| Host writable | start the host, then make one persisted mutation | **Run the host from a normal shell.** Inside an agent confinement it cannot write `config.json` and every chapter-pin and display mutation fails (`docs/troubleshooting.md` §8.4) |

**`-Dquestbridge.debug=true`:** leave it **off** for Round 3 unless diagnosing. It logs a
full 55-chapter snapshot every 2 s — ~10 MB of dump and ~430 KB of `latest.log` per half
hour — which buries signal.

### 3.2 The unobserved checks

Run these against one client session, in this order. Every one needs the **user**.

| # | Obligation | What the user does | What the agent records |
|---|---|---|---|
| R1 | **Chapter pins end to end** (A3, B4, B5) | Pin up to five chapters in `/control` **after** the client publishes | Re-resolved pins now show FTB titles, not `Unresolved chapter`; chapter progress in the overlay matches the quest book the user reads out |
| R2 | Chapter completion uses `TeamData.isCompleted`, not `progress == 100` | Complete one pinned chapter's required quests | `status: completed` from the adapter; and if any chapter shows 100 without completing, **record it as correct**, do not "fix" it (`docs/ftb-quests-integration.md` §5.2) |
| R3 | Optional quests do not distort chapter progress | — | Compare a chapter's percentage with and without a known optional quest pinned; Round 2 saw an optional pin but never isolated it |
| R4 | Quest-data reload → fresh snapshot | Reload quest data if the pack exposes it | A fresh catalog, no stale titles |
| R5 | Team change → fresh snapshot | Create or join a different FTB team | New `teamId`, fresh snapshot; note that pins are per player and may reset |
| R6 | The heartbeat-stale timer | Nothing — needs a **socket that stays open with heartbeats stopped**, which a kill cannot produce | `stale: true` at ~20 s, `disconnected` at ~30 s. Round 2 never exercised this path; a kill closes the socket and short-circuits it |
| R7 | A regenerated token reaches the client | Stop the host; delete `%APPDATA%\QuestBridge\tokens.json`; restart the host | New token, new URLs, and the client recovers on its next reconnect **without restarting Minecraft**. This is the live half of E2 that Round 2 did not run |

**R6 is the hardest and may be skipped.** It cannot be produced by normal play. If it is
not run, record it as not observed rather than implying coverage.

### 3.3 The remote-server case — required by `AGENTS.md` §7

**Vocabulary, decided 2026-11-08:** "multiplayer" is **not** a verification target.
A **remote server** is. The obligation is that behaviour is the same on an integrated
server and on a server the player connects to, reading the same synchronized client state,
with **no server-side mod and no server filesystem access**.

| # | Obligation | Detail |
|---|---|---|
| D1 | Connects to a remote server with the pack | `watch --expect multiplayer` uses `multiplayer` as `watch.mjs`'s literal identifier; it means "reported a remote server" |
| D2 | Repeat the pin add/remove of §2 and a progress change | Identical behaviour to single-player |
| D3 | No server-side anything | Confirm nothing was installed on the server |

The client must be connected to a server that has FTB Quests and FTB Teams (any ATM10 TTS
server does) — the same client-only jar, no extra steps.

### 3.4 Re-verification if source changes

**If any of these landed between Round 2 and Round 3, the run log must say so and the
affected checks must be re-taken.** Check `git log` since `8acbfab`.

| Change | Status at Round 3 preparation | What it obliges |
|---|---|---|
| `docs/troubleshooting.md` §4.8 — a world-less client stays `ready`, so the overlay never fades | **Recorded, not fixed.** The user has stated the requirement | If fixed: re-run the **C1** menu test and watch for the fade on the stale timer. If not fixed: re-confirm the defect still reproduces, and record it as still open |
| `docs/troubleshooting.md` §7.1 — a persistence failure reports `invalid_request` | Recorded, not fixed | If fixed: a rejected mutation should carry a new code; verify a forced failure names it |
| Proposal G — drag-and-drop feedback (approved, undesigned) | Not started | Frontend-only. If it lands, verify the lifted row and neighbour reflow on `/control` |
| Proposal F — ephemeral quest reordering | **Requested, not decided, not designed** | Do not build or test it. It may not be implemented on the strength of its presence in the tracker |
| Tooling: `read-capture` duplicate counting, `watch` across a restart | Recorded, not fixed | If fixed, `phase5:capture` should pass cleanly on a multi-snapshot dump, and one watcher should survive a host restart |

**The version question.** If mod source changed, the version moves (`docs/versioning.md`
§3.5) and the jar must be rebuilt, swapped into the instance, and named in the run log.
If only host or frontend source changed, the mod stays `0pre.3` but the run log must still
name the frontend build it tested.

---

## 4. Start the session

```powershell
$nodeDir = "$env:APPDATA\fnm\node-versions\v24.22.1\installation"
$env:Path = "$nodeDir;$env:Path"
Set-Location "D:\projects\dev\QuestBridge"
```

**Host** — from a normal shell, never from an agent confinement (§3.1):

```powershell
node scripts/phase5/start-session.mjs --port 8765 --artifacts .questbridge/phase5/round3
```

It prints the overlay and dashboard URLs. The token does not change between ordinary host
restarts — `tokens.json` is reused — so if the URLs look familiar that is correct.

**Watcher** — **one per host lifetime** (`docs/troubleshooting.md` §8.2; its ledger does
not survive a host restart):

```powershell
node scripts/phase5/watch.mjs --session .questbridge/phase5/round3 `
  --expect ready,chapter-mapping,no-auto-pin,objectives-partition,numeric-task,`
null-or-complete,after-pin-addition,pin-change,progress-change,after-completion,`
reconnect,world-change,team-change,single-player,multiplayer `
  --until 14400 --json-out .questbridge/phase5/round3/watch.json
```

---

## 5. Order of testing

One in-game action at a time (`AGENTS.md` §5). The order minimises restarts.

1. **Pre-flight** (§3.1). Record jar version, config token state, host writability.
2. **Start the host, launch the client, load a world.** Expect `publishing to …`, then
   `connection -> ready`. This is a smoke test, not a new check.
3. **Configure chapter pins** (R1) — pin up to five in `/control`, from the catalog that
   now exists. Read the titles back against the quest book.
4. **Progress a pinned chapter's quests** (R2, R3), completing one chapter if practical.
5. **Quest-data reload** (R4), if the pack offers it.
6. **Team change** (R5).
7. **Token regeneration** (R7) — stop the host, delete `tokens.json`, restart, and watch
   the client recover on its own. **This one kills the watcher's ledger**; start a fresh
   watcher afterwards.
8. **Remote server** (§3.3) — reconnect the client to a server with the pack.
9. **R6 (heartbeat timer)** only if feasible; otherwise record not observed.

---

## 6. Evidence rules — unchanged, and worth re-reading

| Evidence | Where | Trustworthy for |
|---|---|---|
| `[QuestBridge 4B]` lines | client `latest.log` | the **published snapshot** — chapter and quest values as sent |
| `[QuestBridge 4A]` lines | client `latest.log` | FTB's state only — **not** transmitted |
| `dumpSnapshot` file | `.questbridge/phase5/dump/` | schema validity; `npm run phase5:capture` |
| watcher report | `.questbridge/phase5/round3/watch.json` | host-visible state, tri-state verdicts |
| host log | `.questbridge/phase5/round3/host.log` | what the host received |

Five rules that cost time in Round 2:

1. **A socket in the host log is not a recovered page.** Round 2 first reported the
   frontend test as passing on a log line while the user's `/control` still said
   *"Not connected"*. Ask the user to confirm the screen; a visual check is theirs.
2. **`not_observed` is never a pass.** Neither is "the watcher didn't flag it".
3. **The watcher's verdict covers only its last segment** (§8.2 of troubleshooting).
4. **A dashboard that looks dead may still be retrying.** It gives no indication; reload
   to distinguish "still retrying" from "failed" (run log §6.2).
5. **`read-capture`'s `unique-chapter-ids` check false-fails** on any dump with more than
   one snapshot (troubleshooting §8.1). Verify a real duplicate within a single snapshot
   before suspecting the mapper.

---

## 7. What may and may not be claimed afterwards

**Claimable with evidence:**
- Chapter progress matching the quest book — user observation **plus** a `4B` line.
- Chapter completion from `status`, not from `progress == 100`.
- The heartbeat timer — only if the socket stayed open and heartbeats actually stopped.
- Remote-server operation — `watch --expect multiplayer` **and** a completed sequence.
- E2's live half — a reconnect after regeneration, seen in both logs.

**Not claimable from Round 3 alone:**
- That the overlay *looks* right. Only the user can say.
- Proposal F or the §4.8 fix working, unless they were built, and named, before the run.
- Anything about multiplayer as a feature. It is not in scope.

**`AGENTS.md` §7 is met only when the remote-server run is done.** Round 2 closed most
Release items; §3.3 is the one still open, and it is an obligation, not a deferral.

---

## 8. If Round 3 finds a defect

Record it before fixing it (`AGENTS.md` §4 during-work rule 7,
`docs/documentation-policy.md`). Likely failure modes, in order:

| Symptom | Look at |
|---|---|
| Chapter pins still show `Unresolved chapter` after the catalog arrived | The pin was set with no catalog; unpin and re-pin. If it persists with a catalog present, that is a real defect |
| `chapter.pin` rejected with `invalid_request` | The host cannot write `config.json` — check it was started from a normal shell (§3.1) |
| Client retries forever after `tokens.json` deletion | E2. Expect `401` in the host log if it is failing |
| No `stale` after 20 s with the client frozen | R6's timer — this is exactly the path Round 2 never exercised |
| Remote server shows no data | The server must have FTB Quests and FTB Teams; the client needs no extra module |

---

## 9. Housekeeping

- Artifacts go to `.questbridge/phase5/round3/` — git-ignored. Round 2's remain at
  `.questbridge/phase5/round2/` and are preserved as evidence.
- **`.questbridge/` is git-ignored.** Dumps contain real world and team identifiers. A
  sanitised fixture would go in `packages/protocol/fixtures/` with provenance in its
  README; Round 2's dump was **not** sanitised or committed (`docs/phase-5-plan.md` §10
  item 3).
- **Do not delete Round 2's artifacts** while Round 3 is in progress: the run log cites
  them, and `.questbridge/phase5/live-a/` is identified evidence for session 1
  (`docs/phase-5-round-2-guide.md` §9).
