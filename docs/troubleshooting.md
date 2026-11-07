# QuestBridge Troubleshooting

**Status:** Created 2026-11-07 from the first live Phase 5 session. Every entry
marked **verified** was observed on a real client with the real host; entries
marked **suspected** are reasoned from code and logs but not confirmed.
**Date:** 2026-11-07 (§2.1, §2.1.2, §4.1, §4.4, and §4.5 updated the same day with
their fixes)
**Applies to:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250, mod
`0pre.2` for the original observations and `0pre.3` for the fixes noted below,
host as of `packages/host` milestone 2G.

> **Five entries below were fixed on 2026-11-07 in `0pre.3`.** Each keeps its
> original text and gains a *Fixed* note, because deleting the entry would lose
> the diagnosis that stops the defect returning (`AGENTS.md` §17.2 rule 5). The
> five are §2.1, §2.1.2, §4.1, §4.4, and §4.5. **The original observations were
> all made on `0pre.2`**, and the fix is verified offline only — see
> `docs/phase-5-plan.md` §12.5 for the exact boundary. Nothing here is a claim
> about a live client.


This document replaces the placeholder that `docs/architecture.md` §1 and
`docs/phase-4-plan.md` listed as planned-but-absent. It records failures as they
are actually encountered, with the evidence that identified them.

---

## 1. How to diagnose, in order

The client publishes to the host. Judge the chain from the **bottom up**: a
failure at any step makes every later step look broken in the same way.

```text
  1. Did the mod load?           client log: "Found mod file questbridge-*.jar"
  2. Did it get a token?         client log: "publishing to ws://..."  (or a warning)
  3. Did the host see hello?     host log: "publisher hello: MC ..."
  4. Did a snapshot arrive?      host log / watch: connection -> ready
  5. Does the overlay show it?   /overlay at 380x650
```

A symptom in step 5 with no evidence in steps 1–4 is a UI problem. A silent
step 2 with step 1 present is a **configuration** problem; step 2's message names
the source it resolved, which is usually enough to see which one is wrong.

**On `0pre.3`, step 2 is expected to succeed without any manual configuration.**
The adapter finds the host's own `tokens.json`, so a warning at step 2 now means
genuinely no token exists anywhere — most often because the host has never been
started, so it has never written one. Start the host; the adapter retries. On
`0pre.2` the same warning meant the documented path was broken (§2.1), which is a
different diagnosis with the same symptom, so check the version before
concluding.

Two log files matter:

| Log | Path |
|---|---|
| Minecraft | `<instance>/minecraft/logs/latest.log` |
| Host | the `host.log` printed by `npm run phase5:session`, under `.questbridge/phase5/<session>/` |

The single most useful client log line is `[QuestBridge] publishing to …`. Its
presence means the adapter resolved a token and started the transport; its
absence means it did not, and the line above it says why.

---

## 2. Connectivity

### 2.1 The adapter never published from `config/questbridge-client.toml` — **fixed in `0pre.3`**

> The heading is past tense deliberately. This was the defect that blocked both
> Phase 5 sessions; it no longer describes current behaviour, and the entry is
> kept for its diagnosis. If you are on `0pre.3` and the adapter is not
> publishing, read §2.1.1 and §2.3 instead — §2.1's cause cannot occur, because
> the code no longer reads the config from the constructor.

**Verified.** Found in the first live Phase 5 session (2026-11-07).

**Symptom.** The client is running and the probe works — the log shows
`[QuestBridge 4B] SNAPSHOT ...` with a full chapter list — but the host receives
nothing, and the browser stays `disconnected`. The client log contains:

```text
[QuestBridge] no minecraftToken configured; not publishing.
```

**Root cause.** A startup-order defect in the mod:

```java
// QuestBridge.java
modContainer.registerConfig(ModConfig.Type.CLIENT, QuestBridgeConfig.SPEC); // queues loading
this.client = new QuestBridgeClient();   // reads config immediately
```

`registerConfig` only *schedules* loading. `QuestBridgeClient` is constructed on
the same line sequence and calls `QuestBridgeConfig.resolveMinecraftToken()`,
which catches `IllegalStateException` and returns `""` while the spec is not yet
loaded. The adapter then decides "no token, stay idle" and never looks again.

The ordering is visible in the log, and the gap is not subtle:

```text
17:23:13.096  [QuestBridge] no minecraftToken configured; not publishing.
17:23:29.590  ConfigTracker: Failed to load config questbridge-client.toml ... Attempting to recreate
```

The adapter read the token **sixteen seconds before NeoForge loaded the config
file**. The documented file path can therefore never supply the token on this
version, even when the file is perfectly valid.

**A related trap: the dashboard's chapter catalog is empty while this is broken.**
`/control` shows no chapters because the host has never received a catalog. This
is a *consequence* of the defect, not a separate one, and it is not a UI bug —
the host is faithfully rendering "no data". It also means chapters cannot be
pinned before the first successful connection, which is why the Phase 5 guide's
"pin chapters first" step is not possible until publishing works.

**Workarounds that bypass the config file.** Both are read directly, before or
independently of the config spec:

```text
-Dquestbridge.minecraftToken=<token>      JVM argument
QUESTBRIDGE_MINECRAFT_TOKEN=<token>       environment variable
```

In Prism Launcher these belong in the instance's **Environment Variables**
(preferred) or **JVM arguments**. The full precedence is now four-deep and is
normative in `docs/ftb-quests-integration.md` §11.1: system property, then
environment variable, then the config file, then discovery of the host's own
`tokens.json`. These two workarounds remain at the top of it.

**The design that removes the manual step entirely** was Proposal E in
`docs/proposals.md`. It was **adopted on 2026-11-07** and implemented in
`0pre.3`, which is why the load-order fix below and the discovery path exist.

> **This defect is fixed in `0pre.3` (2026-11-07).** On `0pre.2` it was recorded
> and deliberately not patched, because fixing it changes mod source and so
> requires a new version (§4); that version was then taken by an explicit
> decision. `QuestBridge.java` no longer constructs the client's transport; it
> registers `ModConfigEvent.Loading` and `.Reloading` on the mod event bus and
> starts transport from that callback. `QuestBridgeClient` gained
> `startTransportOnce()`, guarded so the two events cannot start two transports.
> See `docs/proposals.md` §6.1 and `docs/phase-5-plan.md` §12.
>
> **How it will be verified:** the client log must show the adapter *deferring*
> transport startup rather than warning `no minecraftToken configured`, and
> `[QuestBridge] publishing to ws://…` must appear. That is a live-client check
> and has **not** been performed; the offline evidence in
> `docs/phase-5-plan.md` §12.5 cannot cover it, because the defect was that a
> NeoForge callback had not fired yet and only the game fires it.

### 2.1.1 The token does not change between host startups — verified

**Commonly assumed, and wrong.** The token is not regenerated on each host start,
so a stable token can be configured once and relied upon.

**Evidence.** `packages/host/src/auth.ts` `TokenStore.load()` reads
`tokens.json` if it exists and **reuses** it; `createTokens()` is reached only
when the file is missing, unreadable, or fails validation. On the development
machine `tokens.json` was created at 16:55:30 and its modification time has not
moved across at least three host starts (including the 17:19 session).

**When it *does* change**, and these are the cases that matter:

- `tokens.json` is deleted.
- It is corrupt or fails validation — the host backs it up and regenerates it,
  which is deliberate: a damaged token file must not lock the user out
  (`docs/local-authentication.md` §2.2).
- The host runs with a different config directory, so it reads a different file.

**Consequence.** A regenerated token silently invalidates every configured
client. The adapter has no recovery path for this: `ConnectionController` takes
`url` and `bearerToken` as `final` fields and reuses them on every reconnect
attempt, so a new token requires restarting Minecraft. Recorded because it is the
real limitation; token instability across ordinary restarts is not.

This is stated here to stop the misdiagnosis being repeated: if publishing stops
after a host restart, the cause is §2.1, **not** a changed token. Compare the
failure against §2.3 to tell them apart.

**The lack of expiry is intended, not an oversight.** A token has no TTL and no
scheduled rotation; it lives until the token file is regenerated. This is
recorded as accepted risk **R3** in `docs/local-authentication.md` §1: expiry
would bound nothing here (loopback, single user) while an expiring token in the
overlay's URL would eventually strand a live OBS source mid-stream. The current
behaviour is correct and **not planned for change**; see that document's §2.0 for
the lifetime and the deliberate-rotation procedure.

Do not read §2.1.2 as a request to add expiry. It records why a *regenerated*
token needs a game restart, which is a consequence of R3 rather than a defect in
it.

### 2.1.2 The adapter reuses a frozen token on every reconnect — verified

`ConnectionController` resolves the token once, in the client constructor, and
stores it as a `final` field:

```java
opened = WebSocketConnection.open(url, bearerToken, listener);  // inside #connect()
```

Every reconnect attempt — including the 1→30 s backoff path that is otherwise
correct and was verified in 4C/4D — reuses the value captured at startup.

**Symptom.** The token is regenerated; the adapter retries forever with the old
value and the host answers `401`. Only restarting Minecraft clears it.

**Related to** §2.1 but distinct: §2.1 is *when* the token is read (too early);
this is *how often* (once, ever). Fixing §2.1 alone would not fix this.

Recorded as `docs/proposals.md` Proposal E2; not implemented.

> **Fixed in `0pre.3` (2026-11-07).** `ConnectionController` now takes a
> `TokenSupplier` and calls it inside `connect()`, instead of holding
> `bearerToken` as a `final` field. Each attempt re-resolves, so a regenerated
> token is picked up on the next reconnect rather than needing a restart. The
> supplier is wrapped so a throw becomes a warning plus "no token" rather than
> killing the reconnect loop.
>
> **Verified offline.** `TokenRefreshHarness` drives the real controller against
> a dead port and counts supplier invocations: **3 calls for 3 attempts**, where
> the old implementation would have called it once for the lifetime of the
> process. It also confirms a wrong token is refused by a real host (two
> `rejected upgrade with a missing or invalid token` lines in the host log) and
> that the correct token still connects and publishes. 7/7 checks pass; the
> harness and its output are recorded in `docs/testing-logs/2026-11-07-phase5-build-0pre3.md`.
>
> **Boundary:** this proves the controller re-resolves and the transport
> survives a throwing supplier. It does not prove the in-game adapter passes a
> supplier — that is verified by reading `startTransportOnce()` — and it is not a
> client observation.

### 2.2 `Invalid bare key: 'hostUrl'` after hand-editing the config

**Verified.** Caused by a UTF-8 **byte-order mark** at the start of
`config/questbridge-client.toml`.

**Symptom.**

```text
WARN ConfigTracker: Failed to load config questbridge-client.toml:
     ParsingException: Invalid bare key: 'hostUrl'. Attempting to recreate
```

and, immediately afterwards, the file on disk has `minecraftToken = ""`.

**Cause.** NightConfig's TOML parser rejects a key preceded by a BOM. NeoForge
then **recreates the file with defaults**, silently discarding the token that had
just been written into it. On Windows, `Set-Content -Encoding UTF8` in PowerShell
5.1 writes a BOM by default, so this is easy to trigger by copying a snippet from
a guide.

**Fix.** Rewrite the file without a BOM:

```powershell
$path = "<instance>\minecraft\config\questbridge-client.toml"
$text = [System.IO.File]::ReadAllText($path)
[System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
```

Verify the first three bytes are `35,87,101` (`#We`, the first comment) and not
`239,187,191`. Note that this removes the load failure but does **not** make the
token work in this version — see §2.1.

### 2.3 `HTTP 401 (missing or invalid minecraftToken)`

The adapter reached the host and was refused. The client's token does not match
the host's `tokens.json`. Common causes:

- The host regenerated its tokens because `tokens.json` was corrupt or deleted.
  A regenerated token invalidates every previously issued URL and every
  configured client token.
- The token was copied from a different config directory. `--config-dir` and
  `QUESTBRIDGE_CONFIG_DIR` produce different token files.
- The value was copied with surrounding quotes or whitespace.

Resolve the correct value from the host's own file, then confirm with:

```text
npm run phase5:check -- --instance "<prism instance path>"
```

which compares the client token against the host's and fails loudly on a
mismatch.

### 2.4 `HTTP 409 (another publisher is already connected)`

Only one publisher may connect. Usual causes: an earlier client process is still
running (check for a second `java` game process), or a mock publisher is pointed
at the same host (`npm run mock -- --url=...`). Stop the stray process; the mod
retries with backoff and connects on its own.

### 2.5 Nothing happens and the host is not running

**Symptom.** No host log lines at all; the client logs `host unavailable
(...); retrying in N ms` once per backoff stage.

This is expected and harmless: the adapter backs off 1, 2, 4, 8, 16, 30 s and
**logs once per stage**, not once per attempt. Start the host; the client
reconnects within ~30 s without restarting Minecraft.

### 2.6 `java.lang.UnsupportedClassVersionError` or the mod fails to load

The mod is compiled for Java 21 bytecode. The ATM10 instance runs Oracle JDK
25.0.2 with `IgnoreJavaCompatibility=true`; that combination is verified working.
A failure here means the runtime is older than Java 21, not newer.

---

## 3. Data and overlay

### 3.1 The overlay shows "Unresolved chapter" for a chapter that exists

The chapter ID was pinned in an earlier catalog and no longer appears in the
current one — a pack update renamed or removed it.

This is intentional, not a bug: the host never deletes a configured chapter pin
and never substitutes a different one (`docs/chapter-pinning.md` §6.2). Repair
it from `/control` by unpinning the unresolved entry and pinning the current
chapter, which is the only repair operation offered.

### 3.2 Chapter progress reads 100 % but the chapter is not marked complete

Correct behaviour. FTB returns 100 for empty chapters, `alwaysInvisible`
chapters, and chapters whose quests are all optional, without ever recording a
completion. Completion comes from `TeamData.isCompleted(chapter)` and is never
derived from the percentage (`docs/ftb-quests-integration.md` §5.2–5.3).

### 3.3 A pinned quest disappeared from the objectives

Correct behaviour. FTB removes a quest from the player's pin set when it
completes, so the objective is gone rather than retained as a completed row.
QuestBridge must not fabricate a retained pin (`docs/protocol.md` §8.8).

### 3.4 Pin changes take a second or two to appear

Correct behaviour. FTB exposes no event for pin changes, so they are found by
periodic reconciliation (every 2 s). This is the documented floor, not a defect.

### 3.5 The overlay no longer shows the chapter titles seen before

Before translation data arrives, FTB titles resolve to placeholders. The adapter
reconciles and refreshes them, so the corrected titles appear shortly after
synchronization without any action.

---

## 4. Verification and observability

Findings about what the system can and cannot show you. These cost real time in
session 2 and are recorded so the next run does not repeat the mistake.

### 4.1 The mapper's chapter values are not logged — verified

**Symptom.** You want to check that `FtbSnapshotMapper` reports chapter
`progress`, `status`, `subtitle`, and `order` correctly, from logs alone. You
cannot. The mapper computes them and they never appear.

**Cause.** `QuestBridgeClient.logSnapshot()` prints
`snapshot.chapters().size()` — a **count only**. The per-chapter values are
carried in the `QuestSnapshot` and would go on the wire, but no log line prints
them. Only the quest/task objects are logged in full.

**Consequence.** A log-only run can verify chapter *count* and chapter *IDs*
(from the 4A probe) but **not** the mapper's per-chapter values. Chapter progress
in particular is unobservable without the dump (§4.2).

**Workaround.** Launch with
`-Dquestbridge.dumpSnapshot=<path>`, then read the file with
`npm run phase5:capture`. The dump contains the full encoded snapshot.

**Status:** not fixed. Adding a chapter log line changes mod source and so
requires a version bump.

> **Fixed in `0pre.3` (2026-11-07).** `QuestBridgeClient.logSnapshot()` now
> prints one `[QuestBridge 4B] chapter` line per chapter, carrying `id`, `order`,
> `title`, `subtitle`, `progress`, and `status`. The mapper's per-chapter output
> is therefore observable from logs without a `dumpSnapshot` file.
>
> These are `4B` lines, so §4.2's rule applies: they are evidence about the
> published snapshot, unlike the `4A` probe's chapter lines, which report FTB's
> own values. The two now look similar, which is a real risk of confusion; the
> prefix is still the only thing distinguishing them, and §4.2 still governs.
>
> **How it will be verified:** the next live run reads chapter `progress`,
> `status`, and `subtitle` from the `4B` lines and compares them against the
> quest book. **No value has been observed yet on `0pre.3`**, so this entry's own
> subject — the mapper's chapter values — remains unverified. The gap that is
> closed is the *instrument*, not the measurement.
>
> **The `dumpSnapshot` workaround stays in the runbook.** This fix makes a value
> visible; it does not make it validatable, which is what the dump does.

### 4.2 Two log prefixes, two different sources — verified

**Symptom.** You report a chapter value as a mapper result and it is not one.

`latest.log` carries two distinct diagnostic channels, and they are not the same
data:

| Prefix | Source | On the wire? |
|---|---|---|
| `[QuestBridge 4B] SNAPSHOT` | `FtbSnapshotMapper` via `logSnapshot()` | **Yes** — this is the transmitted snapshot |
| `[QuestBridge 4A] READY` / `chapter ...` | `FtbQuestProbe` | **No** — a debug read only |

The 4A probe reports per-chapter `progress`, `status`, `visible`, and
`explicitlyHidden`, which is why it is tempting to read chapter progress from it.
Doing so proves FTB's value, **not** the mapper's.

**Rule:** treat only `4B` lines as evidence about the published snapshot. `4A`
lines are evidence about FTB's own state.

This mistake was made in session 2 and corrected mid-run; the corrected
attribution is in `docs/testing-logs/2026-11-07-phase5-session-1.md` §3. It is
recorded here because the prefix difference is a single character.

### 4.3 The adapter reports 55 chapters; the pack has 54 chapter files — suspected

**Observed.** `chapter_groups.snbt` plus 55 files under
`config/ftbquests/quests/chapters/`. A parser that reads group, `order_index`,
and chapter `id` from each file resolves **54** of them; `welcome.snbt` does not
carry the expected top-level fields.

Meanwhile the adapter reports `chapters=55`, matching the file count.

**Not yet explained.** Two possibilities, neither confirmed:

- `welcome.snbt` is a chapter with an unexpected shape that FTB parses and the
  ad-hoc parser does not;
- FTB synthesises or retains a chapter that has no corresponding file.

**Why it matters:** a chapter-count mismatch is a plausible early symptom of a
catalog-discovery defect. It is recorded rather than dismissed.

**How to settle it:** compare the 55 chapter IDs in a `dumpSnapshot` output
against the 54 ids parsed from the files. The dump makes the comparison exact.

### 4.4 `phase5:watch` reports vacuous PASS results — verified, tool defect

**Symptom.** A watch run against a host that received **no publisher at all**
still reports some checks as passed:

```json
"assertions": [
  { "name": "ready",               "passed": false },
  { "name": "no-auto-pin",         "passed": true  },
  { "name": "objectives-partition","passed": true  },
  ...
],
"observations": { "ready": false, "sawAutoPin": false, ... },
"maxChapters": 0,
"statusHistory": [ { "status": "disconnected" } ]
```

**Cause.** Two assertions are stated as the absence of a bad thing:

```
"no-auto-pin":        (ledger) => !ledger.reported.sawAutoPin
"objectives-partition": (ledger) => !ledger.reported.sawPartitionViolation
```

With no data, neither bad thing was observed, so both are trivially true. The
check passes because **nothing was checked**.

**Why this is serious.** These assertions exist to detect a fabricated objective
and a broken objective partition — precisely the defects the mapper checks in
this phase care about. A vacuous PASS on a dead connection is indistinguishable,
in the JSON report, from a real PASS on a healthy one. If it were recorded as
evidence it would be a false claim of the kind `AGENTS.md` §18 forbids.

**Observed in:** session 2, `docs/troubleshooting.md` §5.2. No run has yet read
those two results as evidence; the session was reported from the client log.

**Fix direction** (not yet applied): each assertion must require its own
precondition. Positive assertions already do this implicitly — `ready` cannot be
true without data — but absence assertions need an explicit guard, for example
requiring `ledger.reported.ready` and a non-zero chapter count before
`no-auto-pin` or `objectives-partition` may pass. A run that never reached
`ready` should report those checks as **not observed**, which is a distinct third
state the current report does not express.

**Status:** recorded, not fixed. Fixing it changes `scripts/phase5/watch.mjs`,
which is tooling rather than mod source, so it does not require a version bump
(`docs/versioning.md` §3.5).

> **Fixed 2026-11-07** (tooling only; no version impact). Each assertion now
> declares a `precondition` alongside its `check`, and `not_observed` is a real
> third state. The two absence assertions require `ledger.reported.ready` with a
> non-zero chapter count before they can pass, so the empty-ledger run from
> session 2 now reports both as **not observed** rather than PASS.
>
> **Verified by** `scripts/phase5/watch-assertions.test.mjs` (`npm run
> phase5:watch:test`), which replays the **exact empty ledger** from session 2
> and asserts that no assertion passes on it, then asserts that a healthy ledger
> still passes and a genuine auto-pin sighting still fails. 17/17 checks pass.
> The healthy-ledger and real-violation cases matter as much as the empty one:
> they prove the fix did not simply disable the checks it guards.
>
> The test imports the shipped helpers rather than restating the rule, which
> `watch.mjs`'s new entry-point guard makes possible — previously `evaluate()`
> could not be reached without running the whole CLI, which is why this defect
> had no regression test.

### 4.5 `phase5:watch` cannot express "not observed" — suspected, tool defect

Related to §4.4. The report has only `passed: true|false`. There is no way to say
"this check was never exercised", which `docs/phase-5-plan.md` §7 requires: *"A
check that was not exercised is **not observed** — never pass."*

Because the report cannot express the third state, an unexercised check lands in
one of the two wrong buckets. `AGENTS.md` §17.3 says the same for user-driven
checks.

**Fix direction:** give each assertion a tri-state result and have `evaluate()`
distinguish "condition proven" from "condition never testable". Until then, read
`observations` and `maxChapters` alongside the assertion list, and treat a PASS
with `maxChapters: 0` as not observed.

**Status:** recorded, not fixed.

> **Fixed 2026-11-07** (tooling only; no version impact). Assertions now report
> `pass`, `fail`, or `not_observed`, each with a `reason` when not observed, and
> the JSON report carries an explicit `conclusions` block with per-state counts
> and the exit code. `watch.mjs` exits `1` on a failure and `2` when a requested
> check never became testable, so a run whose checks were never exercised cannot
> exit `0`.
>
> **The interim guidance above is no longer needed.** Reading
> `observations`/`maxChapters` by hand, and treating a PASS with `maxChapters: 0`
> as not observed, is now performed by the tool. Do not reintroduce it as a
> habit; it was a workaround for a defect that no longer exists.
>
> Verified by the same 17-check regression test as §4.4, which asserts the
> tri-state and the exit-code precedence directly.

---

## 5. What the sessions established

### 5.1 Session 1 — 2026-11-07, single-player

Verified from the client's own log that the adapter loads, reaches FTB readiness,
and reads real pack data: 55 chapters, the five expected ATM10 chapter IDs and
titles, one manual pin (`Easy Ore Duping`) with two `ftbquests:item` tasks at
`0/1`. The `[QuestBridge 4B] SNAPSHOT` line proves `FtbSnapshotMapper` ran on a
live client thread for the first time.

It did **not** verify the network path, because §2.1 prevented publishing. No
overlay data, no host snapshot, and no `AGENTS.md` §18 item may be claimed from
this session.

### 5.2 Session 2 — 2026-11-07, single-player, log-only

Continued in the same client without a restart, because §2.1 still blocked the
transport. The adapter's capture path is independent of the transport, so
mapper behaviour was still observable. Established:

- Pin addition captured within the reconciliation window (`manualPins` 1 → 2).
- **Completion-driven unpin works**: completing a pinned quest removed it from
  the pin set, with no retained completed entry — the check most likely to
  expose a fabricated objective.
- Automatic pin ID `1` excluded throughout.
- Cross-chapter pin ordering is **not** chapter-ID order, not descending, and
  not alphabetical; two candidate rules remain indistinguishable (see
  `scripts/check-pin-order.mjs`).
- Zero client-thread violations in `latest.log` and `stderr_stream.log`.

Not established: the mapper's chapter values (§4.1), protocol-schema validity,
and anything reaching the host or overlay.

Session narratives: `docs/testing-logs/2026-11-07-phase5-session-1.md` and
`docs/testing-logs/2026-11-07-phase5-session-2.md`.

### 5.3 Defects recorded and not fixed

Every entry below was recorded and **not fixed** at the time, by explicit user
instruction to document findings before changing anything. Five have since been
fixed in `0pre.3`, by a later explicit decision: see §2.1, §2.1.2, §4.1, §4.4,
and §4.5. The table states which is which, so a reader does not have to
cross-reference five entries to find out what still applies.

| Entry | Kind | Fix cost | Status |
|---|---|---|---|
| §2.1 adapter reads config before it loads | Mod defect | Source change → version bump | **Fixed in `0pre.3`** |
| §2.1.2 token frozen at startup, reused on every reconnect | Mod defect | Source change → version bump | **Fixed in `0pre.3`** |
| §2.2 BOM truncates the client config | Configuration trap | Operator fix (already applied) | Still applies; the trap is in NightConfig, not our code |
| §4.1 mapper chapter values not logged | Observability gap | Source change → version bump | **Fixed in `0pre.3`** |
| §4.3 55 chapters vs 54 files | Suspected, unexplained | Unknown; needs a dump to settle | **Still open** |
| §4.4 `phase5:watch` vacuous PASS | Tool defect | Tooling only, no version bump | **Fixed** |
| §4.5 watch cannot express "not observed" | Tool defect | Tooling only, no version bump | **Fixed** |

§4.3 is the only entry in this table that is both unresolved and unexplained. It
has not been re-examined since it was recorded, and the `0pre.3` change does not
touch catalog discovery, so its status is unchanged.

The mod defects were collected as Proposal E in `docs/proposals.md`, which was
**adopted on 2026-11-07** and implemented in `0pre.3`
(`docs/phase-5-plan.md` §12). The fix is verified offline only; the entries above
state the boundary for each.

The two tooling defects (§4.4, §4.5) were the cheapest and the most consequential
to leave, because they affected the *evidence* rather than the product: a run
reported through them could show a PASS that was never earned. Both are fixed and
now have a regression test — 17 checks, including the empty-ledger case that
originally produced the false pass.

**Not in this table, deliberately.** Token expiry and token rotation are settled
design, not defects. See `docs/local-authentication.md` §1 (R3) and §2.0: tokens
have no lifetime by intent, deliberate rotation is a documented file-deletion
procedure, and a `--rotate-tokens` flag is not planned. §2.1.1 and §2.1.2 are
recorded as behaviour to understand, not as work to schedule — with the note that
§2.1.2's *symptom* is now fixed while §2.1.1's *cause* remains by design: a token
still does not change between ordinary restarts, and that is correct.

---

## 6. Reporting a new failure

Record it here when it is understood, with:

1. the symptom, as a person would describe it;
2. the log lines that identify it (client and/or host);
3. whether it is verified or suspected;
4. the workaround, if one exists;
5. whether fixing it changes source (and so requires a version bump).

A screenshot of the overlay is worth keeping when the symptom is visual and no
log line demonstrates it.

This is required, not optional: `AGENTS.md` §17.2 makes recording a finding part
of the session that found it.
