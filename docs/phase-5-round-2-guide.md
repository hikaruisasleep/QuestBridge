# Phase 5 Round 2 — Preparation and Testing Guide

**Purpose:** hand a fresh session everything it needs to run and judge round 2
without re-deriving it from a conversation.
**Date:** 2026-11-08
**Branch:** `feat/proposal-e-runtime-token`
**Mod:** `0pre.3`, installed in the Prism instance
**Status:** prepared and verified; **a live run has now happened** (2026-11-08,
single-player). Results, per-check verdicts, and their boundaries are in
[docs/testing-logs/2026-11-08-phase5-round2-single-player.md](testing-logs/2026-11-08-phase5-round2-single-player.md).
The guide below is retained unchanged as the procedure; where the run departed from
it, the run log says so and §10 records it.

> **Outcome in one line.** E1, discovery, and the per-attempt token resolution all
> worked in a real client, and the adapter published to the host for the first time.
> 13 plan checks passed; chapter-pin checks (A3, B4) were not exercised because no
> chapter pins were set, by the user's decision (`docs/troubleshooting.md` §4.6); one
> product defect was confirmed (§4.8 — a world-less client stays `ready`, so the
> overlay never fades on the stale timer). No source changed, so `0pre.3` stands.

This is written to be read instead of a transcript. Where it states a fact, the
fact was checked on disk or by running a command; where it states an intention,
it says so.

---

## 1. Why round 2 exists

Rounds 1 and 2 (sessions 1 and 2 on 2026-11-07) never reached the host. The
adapter was fine; it read its configuration before NeoForge loaded it, so it saw
no token and stayed idle. That is `docs/troubleshooting.md` §2.1.

`0pre.3` fixes that and three related things. Round 2 is the **first run that can
produce transport evidence**. Its job is not to re-test what sessions 1 and 2
already established — that is listed as still valid in `docs/phase-5-plan.md`
§12.4 — but to prove the four fixes work in a real client.

---

## 2. What changed in `0pre.3`

From `docs/phase-5-plan.md` §12, verified in source:

| Fix | What it does | Round-2 check |
|---|---|---|
| **E1** config-load ordering | Transport starts from `ModConfigEvent.Loading`/`Reloading`, not the mod constructor | The log shows `publishing to ws://…` instead of `no minecraftToken configured` |
| **E2** token re-resolution | `ConnectionController` takes a token *supplier* and calls it per connect attempt | Regenerating `tokens.json` recovers without a game restart |
| **Discovery** | The adapter reads the host's own `tokens.json` when nothing is configured | A blank config token still publishes |
| **§4.1** chapter logging | `logSnapshot()` prints per-chapter `id`, `order`, `title`, `subtitle`, `progress`, `status` | Chapter values become quotable for the first time |

Token precedence, normative in `docs/ftb-quests-integration.md` §11.1:

```text
1. -Dquestbridge.minecraftToken=<token>
2. QUESTBRIDGE_MINECRAFT_TOKEN=<token>
3. config/questbridge-client.toml  minecraftToken
4. discovered host tokens.json
```

The adapter logs **which source** supplied the token. That line is how each
phase is judged; nothing has to be inferred.

---

## 3. Prepared state, verified on disk

Everything below was confirmed by reading files, not remembered.

| Item | State |
|---|---|
| Instance jar | `questbridge-0pre.3.jar` (only loadable jar; `0pre.1` and `0pre.2` renamed `.disabled`) |
| Built jar | `minecraft-mod/build/libs/questbridge-0pre.3.jar`, 99,579 bytes |
| Version agreement | `gradle.properties`, jar filename, and `META-INF/neoforge.mods.toml` all say `0pre.3` |
| Client config token | **blank** — deliberately, so phase 1 must use discovery |
| Token stash for phase 2 | `.questbridge/phase5/smoke/cfg-token.stash` (43 chars, git-ignored) |
| JVM flags | `-Dquestbridge.dumpSnapshot=D:\projects\dev\QuestBridge\.questbridge\phase5\dump\snapshots.jsonl` and `-Dquestbridge.debug=true`, both in the instance's `JvmArgs` |
| Dump directory | `.questbridge/phase5/dump/`, empty, writable |
| `phase5:check` | **READY**, 0 failures |

The client config deliberately ships blank. If a future session finds a token in
it, that is a change from this preparation and phase 1 has already been run.

---

## 4. Start the utilities

Nothing here needs to run in advance. Start the host when you are ready to test,
not to write documentation.

```powershell
$nodeDir = "$env:APPDATA\fnm\node-versions\v24.22.1\installation"
$env:Path = "$nodeDir;$env:Path"
```

**Host** (leave running):

```powershell
node scripts/phase5/start-session.mjs --port 8765 --artifacts .questbridge/phase5/round2
```

It prints the overlay and dashboard URLs. Those URLs carry the browser token.

**Watcher** (second terminal or background job):

```powershell
node scripts/phase5/watch.mjs --session .questbridge/phase5/round2 `
  --expect ready,chapter-mapping,no-auto-pin,objectives-partition,numeric-task,`
null-or-complete,after-pin-addition,pin-change,progress-change,after-completion,`
reconnect,world-change,team-change,single-player `
  --until 10800 --json-out .questbridge/phase5/round2/watch.json
```

**Before launching Minecraft, run the readiness check:**

```powershell
node scripts/phase5/check-environment.mjs --instance "D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky"
```

Expect `READY` with two warnings: no chapter pins configured (normal, and a
*consequence* of not yet having a catalog), and the disabled jars present.

### Known startup trap — verified 2026-11-08

A host process from an earlier attempt stayed alive in `Closed` state and held
port 8765, so a new host failed with `EADDRINUSE` while nothing appeared to be
listening. If that happens:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'start-session\.mjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

A `Get-NetTCPConnection -State Listen` count of 0 does **not** prove the port is
free. Check for a `Closed`-state entry as well.

---

## 5. Testing

One in-game action at a time. Report what you see; the agent reads the logs and
the watcher. A disagreement between the two is a finding, not an inconvenience.

### Phase 1 — discovery (config token blank)

**Goal: prove E1 and discovery together.**

1. Launch Minecraft and load `New World`. Say **"launched"**.
2. The first check is the client log, not the overlay:

   | Line | Meaning |
   |---|---|
   | `client adapter initialized … waiting for the config load` | E1's deferral happened |
   | `publishing to ws://127.0.0.1:8765/ws (token from …)` | **E1 PASS**; the source names the mechanism |
   | `no minecraftToken configured; not publishing` | **E1 FAIL** — the `0pre.2` defect survives |

   With the config token blank, a successful run must credit
   **discovery**, not the config file. If it names
   `config/questbridge-client.toml`, the file was not actually blank.

3. Once `publishing to` appears, the watcher should move to `ready` and report a
   non-zero chapter count. Confirm in the host log that `publisher hello` and a
   snapshot arrived.

### Phase 2 — configured token (restore precedence 3)

**Goal: prove precedence and config reload.**

1. Restore the token into the client config from the stash:

   ```powershell
   $cfg = "D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky\minecraft\config\questbridge-client.toml"
   $tok = Get-Content .questbridge\phase5\smoke\cfg-token.stash -Raw
   $text = (Get-Content $cfg -Raw) -replace 'minecraftToken = "[^"]*"', "minecraftToken = `"$tok`""
   [System.IO.File]::WriteAllText($cfg, $text, [System.Text.UTF8Encoding]::new($false))
   ```

   Write **without a BOM** — `docs/troubleshooting.md` §2.2: a BOM makes
   NeoForge reject the file and recreate it with the token blanked.

2. Reload the client config (or restart the client if no reload command exists)
   and confirm the adapter still publishes, now naming the config file as source.

### Phase 3 — E2, token regeneration

**Goal: prove the adapter survives a changed token without a game restart.**

1. Stop the host. Delete `tokens.json` from `%APPDATA%\QuestBridge`.
2. Start the host again — it generates new tokens, and **every previously issued
   URL changes**. Re-read the new dashboard URL.
3. Leave Minecraft running. Within the reconnect backoff (1, 2, 4, 8, 16, 30 s)
   the adapter should reconnect using the new token.

   | Result | Meaning |
   |---|---|
   | Recovers without restarting Minecraft | **E2 PASS** |
   | Retries forever, host answers 401 | **E2 FAIL** — the frozen-token defect survives |

   `docs/troubleshooting.md` §2.1.2 is the behaviour being tested; §2.1.1
   explains why the token is otherwise stable.

### Then the Phase 5 sequences

Once publishing is proven, run Sequences A–C from `docs/phase-5-plan.md` §6.
Chapters still cannot be pinned until the catalog has arrived (the dashboard
shows an empty library until the first snapshot — that is correct, not a bug),
so pin them **after** the client connects.

---

## 6. Reading the evidence

| Evidence | Where | Trustworthy for |
|---|---|---|
| `[QuestBridge 4B]` lines | client `latest.log` | **the published snapshot.** Chapter and quest values, as sent |
| `[QuestBridge 4A]` lines | client `latest.log` | FTB's state only — **not** transmitted (`docs/troubleshooting.md` §4.2) |
| dump file | `.questbridge/phase5/dump/snapshots.jsonl` | schema validation via `npm run phase5:capture` and `phase5:validate` |
| watcher report | `.questbridge/phase5/round2/watch.json` | host-visible state, with tri-state verdicts |
| host log | `.questbridge/phase5/round2/host.log` | what the host actually received |

The watcher reports `pass`, `fail`, or **`not_observed`**. `not_observed` is not
a pass — it means the precondition for the check never held. Do not record it as
one.

---

## 7. What may and may not be claimed afterwards

**May be claimed only with the stated evidence:**

- E1 — a client log line naming the token source.
- E2 — a reconnect after regeneration, seen in both logs.
- Discovery — a token source of `tokens.json` with a blank config.
- Chapter values — a `4B` line, or a validated dump. **No chapter value has ever
  been observed from the mapper**; §4.1 was the gap that made it impossible.

**May not be claimed on round 2 alone:**

- Anything in `AGENTS.md` §18 that needs multiplayer — round 2 is single-player.
- That the overlay looks right. The user must say so; host state cannot prove it.
- Schema validity of the mapper output unless the dump was actually validated.

`AGENTS.md` §18 boxes move only on evidence, one at a time.

---

## 8. If round 2 fails

Record it before fixing it (`AGENTS.md` §17.2 and the repository's
`docs/documentation-policy.md`). The likely failure modes, in order:

| Symptom | Look at |
|---|---|
| `no minecraftToken configured` still logged | E1 not actually fixed; check that `ModConfigEvent.Loading` fires and that `getSpec()` matches |
| Publishes, then drops repeatedly | Token or origin; `docs/troubleshooting.md` §2.3 |
| `publishing to` but the host logs nothing | Origin check; compare against §2.4 |
| Token regeneration does not recover | E2; expect `401` in the host log |
| Chapter values absent from `4B` | §4.1 fix not in the installed jar — confirm the jar is `0pre.3` |

---

## 9. Housekeeping

Artifacts from earlier attempts are preserved, not deleted:

- `.questbridge/phase5/round2-overnight/` — an attempted start on 2026-11-07 that
  never reached a live run.
- `.questbridge/phase5/live-a/` — the **first Phase 5 session** (2026-11-07
  17:19–17:51), identified on 2026-11-08 from its `latest.log` baseline
  (1,546,199 bytes, matching session 1) and its host log opening 3 minutes before the
  client launched. Its `watch-a.json` is the pre-fix report showing the vacuous
  `"passed": true` on `no-auto-pin` and `objectives-partition` with
  `maxChapters: 0` — the live instance of `docs/troubleshooting.md` §4.4. Kept as
  evidence.
- `.questbridge/phase5/smoke/` — tooling smoke tests and message drafts.
- `.questbridge/phase5/round2/` — **the 2026-11-08 run.** Its contents were cleared
  before the run (the directory was kept), so `host.log`, `session.json` and
  `capture.json` describe that run only. Note that a host restart inside the run
  truncated the earlier part of `host.log`; the full timeline lives in the client
  `latest.log` and in the run log.
- `.questbridge/phase5/dump/snapshots.jsonl` — 10.1 MB, 1,178 snapshots from the run.
  Not committed: it contains real world and team identifiers.

All of `.questbridge/` is git-ignored. Nothing there is committed.

---

## 10. What the live run changed about this guide

The procedure worked. These are the places it was wrong or incomplete, recorded so
the next run does not repeat them.

1. **§5's "pin chapters after the client connects" is right; `docs/phase-5-verification-guide.md`
   §3's "pin before launching" is impossible.** The catalog does not exist until the
   client publishes. With no pins set, all five configured pins render as
   `Unresolved chapter <id>` before the first snapshot — correct
   (`docs/protocol.md` §5.2 rule 3) but alarming (run log §6.3).
2. **§4's readiness check is not a reliable statement about the environment.** It
   reported 8765 free while a host was listening, because the checking shell could not
   see that process. Confirm with a real request against `/health`.
3. **A host must be started from a normal shell.** Started from a confined session, it
   cannot write `config.json`, so chapter pins and every display setting are rejected
   (`docs/troubleshooting.md` §8.4).
4. **`-Dquestbridge.debug=true` produces ~430 KB of `latest.log` per half hour** and a
   10 MB dump, because it logs a full 55-chapter snapshot every 2 s. Useful while
   diagnosing; turn it off for a long run.
5. **One watcher per host lifetime.** The watcher's ledger does not survive a host
   restart, so its final report only describes the last segment
   (`docs/troubleshooting.md` §8.2).
6. **The dashboard can look permanently disconnected while it is still retrying.** It
   reconnects on its own, but gives no indication that it is still trying; a "Not
   connected" page is not proof of failure. Reload to distinguish the two (run log §6.2).
