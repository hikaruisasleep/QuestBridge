# Phase 5 Build Record — `0pre.3` (Proposal E) and offline verification

**This is not a live session.** No Minecraft client was launched. It records the
`0pre.3` build, the offline evidence gathered for the Proposal E fixes, and — most
importantly — **what that evidence does not cover**. It is filed under
`testing-logs/` because its job is to carry the tool output a reader would
otherwise have to re-derive (`AGENTS.md` §0.4), not because a session happened.

**Date:** 2026-11-07
**Branch:** `feat/proposal-e-runtime-token`
**Base:** `test/phase-5-environment` at `a1ccfa6` (the Phase 5 branch, per the
user's instruction to base this work on it rather than on `master`)
**Mod:** `0pre.2` → `0pre.3`
**Decision:** `docs/proposals.md` §6.1
**Plan:** `docs/phase-5-plan.md` §12
**Findings:** `docs/troubleshooting.md` §2.1, §2.1.2, §4.1, §4.4, §4.5

---

## 1. Why this file exists

The Proposal E fixes change mod source, so under `docs/versioning.md` §3.5 they
carry a version. That much is mechanical. The hard question is what may be
**claimed** about them, and the answer is narrower than the change is large.

Two of the three fixes are verified below with real tool output. The third — E1,
the config-load ordering — **cannot be**, and saying so plainly is the point of
this record. E1's defect was that a NeoForge callback had not fired yet; the fix
is that the adapter now waits for it. Only the game fires that callback, so only a
live client can confirm it. A record that blurred this would be the exact failure
`AGENTS.md` §17.4 exists to prevent.

---

## 2. What was built

| Part | Change |
|---|---|
| **E1** | `QuestBridge` registers `ModConfigEvent.Loading` / `.Reloading` and starts transport from that callback; `QuestBridgeClient.startTransportOnce()` is guarded against a double start |
| **E2** | `ConnectionController` takes a `TokenSupplier` and calls it inside `connect()`, replacing a `final` token field |
| **Discovery** | New `TokenDiscovery` reads the host's `tokens.json`, mirroring `packages/host/src/paths.ts` |
| §4.1 | `logSnapshot()` prints per-chapter `id`, `order`, `title`, `subtitle`, `progress`, `status` |
| §4.4 / §4.5 | `watch.mjs` assertions are tri-state with preconditions |

Token precedence, normative in `docs/ftb-quests-integration.md` §11.1:

```text
1. -Dquestbridge.minecraftToken=<token>
2. QUESTBRIDGE_MINECRAFT_TOKEN=<token>
3. config/questbridge-client.toml minecraftToken
4. discovered host tokens.json
```

Discovery is **last**, inverting the order Proposal E sketched. The reasoning is
in `docs/proposals.md` §6.1: a configuration value the program may silently ignore
is worse than no configuration value, because the resulting symptom cannot be
diagnosed from the file.

---

## 3. Build

```text
minecraft-mod$ ./gradlew clean build
BUILD SUCCESSFUL

build/libs/questbridge-0pre.3.jar   (99,470 bytes)
```

Version consistency, checked in the artifact rather than in the sources —
`docs/versioning.md` §2 requires all four to agree:

| Source | Value |
|---|---|
| `minecraft-mod/gradle.properties` | `mod_version=0pre.3` |
| Jar filename | `questbridge-0pre.3.jar` |
| `META-INF/neoforge.mods.toml` inside the jar | `version="0pre.3"` |
| `TokenDiscovery.class`, `QuestBridgeConfig.class` present in the jar | yes |

The stale `build/libs/questbridge-0pre.2.jar` was deleted rather than left beside
the new jar, because `check-environment.mjs` fails a run when more than one
QuestBridge jar is loadable and a leftover artifact is easy to copy by mistake.

```text
npm test
85 protocol + 30 mock-publisher + 250 host + 169 web-app = 534 tests, all passing
```

The suite is unaffected, as expected: the change is confined to
`minecraft-mod/src/main/java`, which no npm project imports.

---

## 4. Offline verification

Both harnesses live in `minecraft-mod/src/testVerification/java/`, beside the
Stage 4 harnesses. They are development instruments; nothing in the mod imports
them, and they are not compiled into the jar.

### 4.1 `DiscoveryHarness` — 10/10

Exercises the real `TokenDiscovery` class against temporary token files. It needs
no Minecraft: the class deliberately imports nothing from the game.

| Check | Result |
|---|---|
| Finds the token under `%APPDATA%\QuestBridge` | PASS |
| `QUESTBRIDGE_CONFIG_DIR` overrides the platform default | PASS |
| A missing token file yields no token and a reason | PASS |
| Malformed JSON yields no token and a reason | PASS |
| A file without `minecraftToken` yields no token | PASS |
| An empty `minecraftToken` yields no token | PASS |
| `Result.toString()` does not contain the token | PASS |
| The host's own `tokens.json` shape parses | PASS |
| The browser token is not mistaken for the minecraft token | PASS |

The `toString()` check is not incidental. The `Result` record's default
`toString()` would print the credential into any log line or debugger view that
formatted the object, and that leak would stay invisible until it mattered. The
record overrides it, and the harness asserts the override holds.

The failure cases matter as much as the success case: each yields *no token plus a
reason*, never an exception. Discovery failing is normal — most machines will not
have a host running — and the adapter must fall through to its own config without
an error.

### 4.2 `TokenRefreshHarness` — 7/7

Drives the real `ConnectionController` against a real host (`127.0.0.1:8811`,
temporary config directory) and against a dead port. This is the check §2.1.2 says
was **impossible** on `0pre.2`.

```text
PHASE 1: retries must re-resolve the token (dead port)
  PASS  the dead port produced more than one attempt  (handshakeFailures=3)
  PASS  the supplier was consulted on each attempt  (supplierCalls=3 for 3 attempt(s))
  PASS  supplier calls track attempts, not construction  (supplierCalls=3 >= attempts=3)

PHASE 2: a wrong token must be refused by the host
  PASS  the wrong token is rejected  (handshakeFailures=2)

PHASE 3: the correct token must be accepted
  PASS  the correct token connects
  PASS  the correct token publishes a snapshot

PHASE 4: a throwing supplier must not kill the loop
  PASS  the loop survived a throwing supplier  (supplierCalls=3 (a single call means the loop died))

7/7 checks passed
```

The load-bearing number is **3 supplier calls for 3 attempts**. The property under
test is not "the controller can use a token" — it always could — but "the
controller asks for the token again on each attempt", which is a fact about the
call site rather than the value. A frozen implementation, which is what `0pre.2`
shipped, would report `supplierCalls=1` regardless of how many attempts failed.

Corroborated from the host side. The host log for the same run:

```text
[11:49:22.068] INFO  connection 1 opened (minecraft) from 127.0.0.1
[11:49:22.142] INFO  publisher hello: MC 1.21.1, NeoForge 21.1.250, FTB Quests 2101.1.30, FTB Teams 2101.1.10, mod 0pre.3
[11:49:25.772] WARN  rejected upgrade with a missing or invalid token
[11:49:26.795] WARN  rejected upgrade with a missing or invalid token
[11:50:02.973] INFO  connection 2 opened (minecraft) from 127.0.0.1
[11:50:03.024] INFO  publisher hello: MC 1.21.1, NeoForge 21.1.250, FTB Quests 2101.1.30, FTB Teams 2101.1.10, mod 0pre.3
```

Two independent readers agree: the harness saw the rejections, and the host logged
them. The `mod 0pre.3` in the hello line is separate confirmation that the string
the adapter reports is the version that was built.

Phase 4 exists because the supplier is called on the transport thread. An
exception escaping it would kill the scheduler silently and look exactly like a
host that is down — the same "dies without a diagnosis" failure mode §2.1.2
describes. The controller now catches it, warns, and backs off.

### 4.3 `watch-assertions.test.mjs` — 17/17

```text
npm run phase5:watch:test
17/17 checks passed
```

Replays the **exact empty ledger** from session 2, which is the scenario that
produced the vacuous PASS. It asserts that no assertion passes on it, that the two
previously vacuous assertions report `not_observed`, and that `ready` reports
`fail` rather than `not_observed` — because `ready` is a positive claim that is
simply false, not an untestable one.

It then asserts the inverse: a healthy ledger still passes, and a real auto-pin
sighting still fails. Without those cases the fix could have been "make everything
`not_observed`", which would pass the empty-ledger check while disabling the tool.

The test imports the shipped helpers rather than restating the rule, which
`watch.mjs`'s new entry-point guard makes possible. Previously `evaluate()` could
not be reached without running the whole CLI, which is why this defect had no
regression test.

---

## 5. What this record does **not** establish

Stated as its own section because it is the boundary of every claim above.

- **E1 is unverified.** The adapter now starts transport from
  `ModConfigEvent.Loading`, but no offline harness can fire that callback. The
  defect was an ordering problem inside the game; the confirmation is a client
  log line. **The fix may not be assumed to work.**
- **No client observation of any kind.** No overlay, no chapter progress, no
  pin behaviour, no reconnection, no multiplayer.
- **The mapper's chapter values are still unobserved** (§4.1's fix). The new log
  line is the *instrument*; no `0pre.3` run has printed one, so the instrument is
  unproven too.
- **No protocol-schema validation.** No `dumpSnapshot` file was produced, so
  there is nothing to run `validate-snapshot.mjs` against.
- **The harnesses run the transport classes directly.** They say nothing about
  the in-game adapter's own wiring. That `QuestBridgeClient` passes a supplier was
  read in the source, not observed at runtime.
- **`AGENTS.md` §18 is unchanged.** Not one box moves on this record.

---

## 6. Next actions

The next live run is the first that can produce transport evidence. In order:

1. **Re-run Sequence A from the top** (`docs/phase-5-plan.md` §6), on a client
   that reaches `[QuestBridge] publishing to ws://…`. That line's presence is the
   first check; its absence was the signal of the old defect.
2. **Do not set `QUESTBRIDGE_MINECRAFT_TOKEN` on the first attempt.** The point of
   the fix is that the documented path and discovery work. A run that pre-sets the
   variable cannot distinguish a fixed adapter from a working workaround. Set it
   only while diagnosing discovery itself.
3. **Confirm the token source in the log.** The new line names it
   (`token from <source>`), so it is visible which of the four rules won. Expect
   the config file or discovery, never the property or the variable on a clean
   run.
4. **Verify E2 in-game** by regenerating `tokens.json` mid-session and confirming
   the adapter recovers on its next reconnect rather than needing a restart
   (`docs/phase-5-plan.md` §12.6 item 5).
5. **Read the `4B` chapter lines** and compare `progress`, `status`, and
   `subtitle` against the quest book. Per `docs/troubleshooting.md` §4.2, only
   `4B` lines are evidence about the published snapshot.
6. **Add `-Dquestbridge.dumpSnapshot=<path>`** as before — the fix makes a value
   visible, it does not make it validatable.
