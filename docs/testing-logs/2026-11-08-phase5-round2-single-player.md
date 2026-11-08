# Phase 5 Round 2 — Live Session (single-player, `0pre.3`)

**This is the first session that reached the host.** Sessions 1 and 2 (2026-11-07)
loaded the adapter but never published, because of the config-load defect
(`docs/troubleshooting.md` §2.1). Every transport, mapper, and overlay claim below
is a **live-client observation**, unless the row says otherwise.

**Date:** 2026-11-08
**Branch:** `feat/proposal-e-runtime-token`
**Mode:** single-player (integrated server)
**Worlds:** `New World`, `hi deepseek` (created during the run for the world-change test)
**Client:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250, JDK 25.0.2
**Mod:** `questbridge-0pre.3.jar` (verified in the jar's `neoforge.mods.toml`)
**Host:** `questbridge-host` on `127.0.0.1:8765`, serving the built frontend
**Artifacts:** `.questbridge/phase5/round2/` (host log, session, capture report) and
`.questbridge/phase5/dump/snapshots.jsonl` — all git-ignored
**Guide:** `docs/phase-5-round-2-guide.md`; **plan:** `docs/phase-5-plan.md` §6, §8

---

## 1. Outcome

The `0pre.3` fixes are **verified in a real client**. E1 (config-load ordering), E2's
prerequisite (per-attempt token resolution), and runtime token discovery all worked,
and for the first time the adapter published `minecraft.hello`, snapshots, progress,
and pin changes to the real host.

Thirteen plan checks passed. Three could not be exercised (chapter pins — the §4.6
decision; team change — not attempted; the heartbeat-timer path). One defect was
confirmed (the world-less client stays `ready`, §4.8) and several tooling and
environment issues were found. **No source was changed** during this session, so
`0pre.3` stands per `docs/versioning.md` §3.5.

---

## 2. The three `0pre.3` checks — all pass

### 2.1 E1 — transport starts from the config-load event, not the constructor

Counter-evidence first: the failure line that defined `0pre.2` is **absent** in every
launch of this session:

```text
[QuestBridge] no minecraftToken configured; not publishing     ← never appeared
```

What appeared instead, on every one of the three client launches:

```text
[08Nov2026 18:23:27.915] [modloading-worker-0/INFO]  [QuestBridge] client adapter initialized (questbridge);
    waiting for the config load before starting transport
[08Nov2026 18:23:41.176] [modloading-sync-worker/INFO] [QuestBridge] publishing to ws://127.0.0.1:8765/ws
    (token from %APPDATA%\QuestBridge: C:\Users\LENOVO\AppData\Roaming\QuestBridge\tokens.json; config loaded trigger)
```

The deferral line is emitted from the constructor; the publish line comes from the
`ModConfigEvent` callback and names it (`config loaded trigger`). On `0pre.2` the
equivalent read happened **16 s before** NeoForge loaded the file; here the transport
starts **in the same callback** that loads it. In the first launch the gap between the
two lines is 12 s, which is NeoForge's own config-loading window, not a defect.

**Verdict: pass.** Verified in a live client on three separate launches.

### 2.2 Discovery — a blank config token still publishes

The client config carries `minecraftToken = ""` (verified on disk before the run, and
`check-environment` warns about it). The token source in the log names the host's own
file, not the config:

```text
token from %APPDATA%\QuestBridge: …\tokens.json
```

**Verdict: pass.** The credential came from discovery, as intended.

### 2.3 E2 — a regenerated token is picked up without a Minecraft restart

`ConnectionController` resolves the token on every connect attempt. The live evidence
is indirect but strong: across **six** host stop/start cycles — including one where the
host was replaced by a different process serving the same `tokens.json` — the client
reconnected to every new host without a game restart, and never once retried with a
credential the host rejected (`docs/troubleshooting.md` §2.3's `401` never appeared in
any host log of this session).

**Boundary:** this run did **not** regenerate `tokens.json` (Round 2 phase 3 of
`docs/phase-5-round-2-guide.md` §5). A host restart reuses the same token, so the
"changed token" case was not exercised in the client; it remains harness-verified only
(`docs/testing-logs/2026-11-07-phase5-build-0pre3.md` §4.2). The live half of E2 that
*was* observed is the per-attempt resolution surviving repeated failures.

---

## 3. Sequence A — adapter correctness

| # | Check | Verdict | Evidence |
|---|---|---|---|
| A1 | Connects and publishes; exactly one catalog | **pass** | `publisher hello: … mod 0pre.3`; watcher `connection -> ready` |
| A2 | 55 chapters, 5/5 expected ATM10 IDs | **pass** | `4B` chapter lines ×55; watcher `expected chapters resolved: 5/5` |
| A3 | Chapter progress matches the quest book | **not observed** | No chapter pins — `docs/troubleshooting.md` §4.6 |
| A4 | A `null`-progress or completed chapter exists | **partial** | Chapter lines show 0/3/42 values; no `null` and no `completed` status was captured. The adapter has no reason to emit `null` while FTB is ready; not proven either way |
| A5 | A task exposes `current`/`target` | **pass** | `ftbquests:item … current=0 target=1` on four pinned quests; `real-progress` check passed |
| A6 | A pin added in the quest book becomes an objective | **pass** | 4→5 at 10:13:54, 5→6 at 10:15:28 and 10:18:26 — each within the 2 s window |
| A7 | Automatic pin ID `1` never appears | **pass** | `read-capture`: `automatic pin id 1 seen: false` across 1,178 snapshots; watcher `no-auto-pin` passed on a ready, non-empty catalog |
| A8 | Capture dump validates | **pass, with one tool false-negative** | See §7 |

The mapper's chapter values are **quotable for the first time** — this is the §4.1 gap
finally measured:

```text
[QuestBridge 4B] chapter id=1D42B373285DEF81 order=53 title="Silent Gear"
    subtitle="And Productive Metalworks" progress=0 status=available
[QuestBridge 4B] chapter id=5B00676D79306EA2 order=0  title="Welcome" progress=33 status=available
```

`subtitle`, `progress`, `status`, and `order` are all populated and are `4B` lines, so
they are evidence about the published snapshot rather than FTB's own values
(`docs/troubleshooting.md` §4.2).

**Incidental:** `Welcome` (the `welcome.snbt` chapter from
`docs/troubleshooting.md` §4.3) resolves as a normal chapter at `order=0` with real
progress. That is consistent with "the ad-hoc file parser missed an odd shape" and
inconsistent with "FTB synthesises a chapter"; it does not settle §4.3.

---

## 4. Sequence B — progression and completion

| # | Check | Verdict | Evidence |
|---|---|---|---|
| B1 | Task progress advances on a pinned quest | **partial** | The chapter moved 40→42 (a `4B` line), but the task counter at `1/1` was never captured — FTB removed the pin in the same instant the task completed, so the state existed for less than one 2 s reconciliation |
| B2 | Pin then unpin both register | **pass** | `+[091F1D752FA3BAAC]` then `-[3E75AFE3482834C5]`; the overlay followed both |
| B3 | Completing a pinned quest removes the objective | **pass** | `Crushing Compressed Blocks` completed → `-[70C2B568FA46337F]`, **and the user watched the overlay go 6 rows → 5.** Nothing was retained |
| B4 | A chapter completes | **not observed** | No chapter pins; the §4.6 decision |
| B5 | A chapter reporting 100 without completion | **not observed** | None seen |

**B3 is the check the project called most likely to expose a fabricated objective, and
the failure mode did not occur.** It is confirmed from three sides: the client log (the
quest leaves the pin set), the host (`-[70C2B568FA46337F]`), and the user's eyes on the
overlay.

**Also observed:** completing an **unpinned** quest (`Basic Power` chapter, 3→7) was
picked up by reconciliation even though the quest never appeared in the objective list —
chapter progress is team-wide and covers unpinned quests. This is correct
(`docs/protocol.md` §8.8) and worth recording, because "the mod can see unpinned quests"
is a question users will ask.

---

## 5. Sequence C — lifecycle

| # | Check | Verdict | Evidence |
|---|---|---|---|
| C1 | Leaving the world for the main menu disconnects | **FAIL (product)** | Host stayed `ready` for **11 minutes** while the client had no world. `docs/troubleshooting.md` §4.8 |
| C2 | Reloading the same world reconnects with a fresh snapshot | **pass** | `connection -> ready` at 10:29:19; 55 chapters, 5 objectives restored |
| C3 | Quest-data reload gives a fresh catalog | **not attempted** | |
| C4 | Switching worlds gives a world-change snapshot | **pass** | `New World` (598 captures) → `hi deepseek` (68+) at 17:40:03; no mixing, and `manualPins` correctly fell to 0 (pins are per-world) |
| C5 | Host restart mid-session, client reconnects | **pass** | New host process; publisher reconnected ~22 s after start; no game restart |
| C6 | Quitting the client disconnects cleanly | **pass** | `status: disconnected`, `stale: true`; retained 55 chapters / 4 quests; overlay faded (user observation) |

### 5.1 The crash path

A hard kill (Prism's Kill; the user confirmed the kill was ungraceful by CrashAssistant
firing) produced:

```text
10:51:43.795Z  last heartbeat
10:51:48.715   connection 8 closed (minecraft, code 1006)
               → disconnected, stale: true, 55 chapters and 4 objectives retained
```

The host reacted **~5 s** after the last heartbeat, because the OS tore the socket down;
`1006` is the abnormal-closure code, which is what a crash looks like from the host's
side. **Boundary:** the heartbeat-timer path (20 s stale / 30 s disconnected with the
socket still open) was **not** exercised — a kill cannot produce it. That path remains
unverified.

### 5.2 The three disconnect behaviours are different, and only one is wrong

| Trigger | Host state | Overlay | Correct? |
|---|---|---|---|
| Leave world → main menu | `ready` (11 min) | rows stay | **No** — §4.8 |
| Quit Minecraft | `disconnected` | fades | Yes |
| Hard kill | `disconnected` (~5 s) | fades | Yes |

The fade itself is implemented correctly. The defect is that **only a socket close can
reach it**.

---

## 6. Sequence D — the four cold-start ordering tests

Run at the user's request, all expected to behave like C5.

| Test | Setup | Verdict | Evidence |
|---|---|---|---|
| 1 | Minecraft at the main menu, **no host**, then host started | **pass** | `publishing to …tokens.json` with nothing listening; then `host unavailable (ConnectException); retrying in 1000/2000/4000/8000/16000/30000 ms` — **once per stage, not per attempt**; host appeared at 11:24:52, client connected 11:25:12 (~20 s, on the pending 30 s tick) |
| 2 | Minecraft **in-world**, then host started | **pass** | Connected **3 ms** after the host opened; straight to `ready`; first snapshot carried all 55 chapters and 4 objectives |
| 3 | Browser tabs open, host restarted under them | **pass, after a correction** | Both tabs reconnected **without a reload** ~14 s after the host returned, with their real `clientName`s |
| 4 | Utilities running, **client restarted** | **pass** | Disconnect observed; overlay faded; relaunch produced a **new** session (`15762c6e` → `31087457`), new `publisher hello`, fresh catalog |

### 6.1 A correction to the record

Test 3 was **first reported as a pass on the strength of a host log line**, and the user
then reported `/control` still showing `Not connected to the QuestBridge host`. The host
log proved a socket was established; it did not prove the page recovered, and the two
are different claims. The pass above reflects the **retested** sequence, where the user
confirmed the tab reached `connected!` after the host returned.

The lesson is the one `docs/phase-5-plan.md` §5.4 already states: a state-side
observation is not a visual observation, and a check the user has not confirmed is not
finished.

### 6.2 Finding — a dashboard can sit visibly dead for a long time

The user's own words, during the retest: *"we havent tested reconnection"*, with
`/control` showing `Not connected to the QuestBridge host. Controls are disabled until
then.` The tab did recover — but only when its next scheduled retry came around, which
after a long outage can be a wide interval. The dashboard gives **no indication that it
is still retrying**: it looks permanently disconnected rather than patiently
reconnecting. Recorded here; not yet a troubleshooting entry.

### 6.3 Finding — the five pins showed as "Unresolved chapter" before the first snapshot

With no catalog yet received, the dashboard rendered all five configured chapters as
`Unresolved chapter <id>`, including the five real ATM10 chapters. This is **correct**
(`docs/protocol.md` §5.2 rule 3: a browser gets a full snapshot before any Minecraft
data; `docs/chapter-pinning.md` §6.3: before the first snapshot, all pins are
unresolved), but it reads as breakage. The persisted config was intact:

```json
chapterPins.pinnedChapters = [
  { position: 0, chapterId: "3B0302DB5E77C3A2" },  // Starting Out
  { position: 1, chapterId: "28BCA5042050B140" },  // The Cool Parts
  { position: 2, chapterId: "67E7552FDA3245F5" },  // AllTheModium
  { position: 3, chapterId: "634794CB36D61302" },  // The ATM Star
  { position: 4, chapterId: "571D32BADC77CDD0" }   // Creative Items
]
```

Recorded as a presentation observation, not a defect: the same transient as §4.8's
family — the host reporting honestly what it knows, without a catalog to resolve against.

---

## 7. The capture dump

`-Dquestbridge.dumpSnapshot` produced 10.1 MB / **1,178** snapshot envelopes.
`npm run phase5:capture` reports:

```text
snapshot messages: 1178 (of 1178 lines)
latest snapshot: 55 chapters, 4 manual pin(s), 4 resolved
world: New World (minecraft:overworld), integrated=true
expected chapters resolved: 5/5
chapter order contiguous 0..n: true
features seen — null progress: false, completed chapter: false, subtitle: true, numeric task: true
task types: ftbquests:item
automatic pin id 1 seen: false

  PASS  capture-written
  PASS  expected-chapters — 5/5
  FAIL  unique-chapter-ids — 64735 duplicate id(s)
  PASS  contiguous-order
  PASS  no-auto-pin
  PASS  real-progress
```

**The FAIL is a tooling defect, not a mapper defect.** Independently measured:

| Measure | Value |
|---|---|
| Distinct chapter IDs across the whole dump | **55** — exactly the catalog |
| Duplicates **within any single snapshot** | **0** (worst case 0 of 55) |
| 64,735 | exactly `1178 × 55 − 55`, i.e. every ID counted again on each repeat |

`read-capture.mjs` accumulates chapter IDs into one `Set` across **all** snapshots in the
file, so a run that repeats the same 55 chapters reports them as duplicates. The
uniqueness invariant the host enforces (`docs/protocol.md` §10.3) is per snapshot. See
`docs/troubleshooting.md` §8.

The dump is the artifact `docs/phase-5-plan.md` §5.4 asks for, and it is the first one
produced from a live client. It is **not** committed: it contains real world and team
identifiers and stays in the git-ignored `.questbridge/`. Producing a sanitised fixture
is `docs/phase-5-plan.md` §10 item 3 and has not been done.

---

## 8. What this session did not establish

- **Chapter pins end to end.** No pins were set for the run (§4.6), so A3 and B4 are
  not observed. The chapter half of the data path is still untested.
- **Team change.** Not attempted.
- **The heartbeat-stale timer.** A kill closes the socket; the 20 s / 30 s path never ran.
- **A regenerated token in the client.** Only harness evidence exists.
- **The remote-server case.** `AGENTS.md` §7 requires the integration to be verified
  "in single-player and on a remote server" (decided 2026-11-08; the earlier wording said
  "multiplayer", which is not a verification target). This run was single-player
  throughout, so a remote server with the pack installed was not exercised.
- **OBS.** No chroma key was applied to this run's overlay.
- **`AGENTS.md` §18 items that need the above** stay unchecked, one at a time.

---

## 9. Tooling and environment findings from this run

1. **`read-capture.mjs` counts duplicates across snapshots** (§7, above).
2. **`watch.mjs` cannot span a host restart.** Its ledger lives in the watcher's memory
   and resets when the host closes the socket; after the C5 restart it reported
   `FAIL reconnect, world-change, single-player` for events that had demonstrably
   happened. The JSON must not be read as a verdict over a run that outlived one host.
   See `docs/troubleshooting.md` §8.
3. **A host started from the agent's confined session cannot write `config.json`.**
   Chapter pins and all five display settings failed with
   `rejected browser … invalid_request Could not persist the configuration`, which is my
   environment, **not** a product defect. The host's refusal (not applying a change it
   could not persist) was correct. Once the host ran outside that confinement, the same
   mutations were accepted and the five pins persisted.
4. **`-Dquestbridge.debug=true` floods the client log.** It logs a full 55-chapter
   snapshot plus every pinned quest and task every 2 s, producing ~10 MB of dump and
   ~430 KB of `latest.log` per half hour. Useful when diagnosing, harmful during a long
   run; the runbook's "add it while diagnosing" advice should be read as temporary.
5. **`check-environment` exits 1 while printing `READY — 0 failure(s)`** when it has only
   warnings. The exit code means "ready with warnings", but it reads as failure.

---

## 10. Next actions

1. **Decide the two product findings**: §4.8 (world-less client stays `ready`; the user
   has stated the overlay should fade on the stale timer) and the error-code gap
   (`invalid_request` for a persistence failure).
2. **Fix the two tooling defects** (`read-capture` duplicate counting, `watch` ledger
   across a restart) — tooling only, no version impact (`docs/versioning.md` §3.5).
3. **Run the unobserved checks**: chapter pins (A3, B4, and B5), team change, the
   heartbeat timer, a regenerated token in the client, and **the remote-server case**
   (`AGENTS.md` §7).
4. **Produce a sanitised fixture** from this dump, with provenance in
   `packages/protocol/fixtures/README.md`.
5. **No version bump.** No source changed in this session.
