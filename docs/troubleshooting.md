# QuestBridge Troubleshooting

**Status:** Created 2026-11-07 from the first live Phase 5 session. Every entry
marked **verified** was observed on a real client with the real host; entries
marked **suspected** are reasoned from code and logs but not confirmed.
**Date:** 2026-11-07
**Applies to:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250, mod
`0pre.2`, host as of `packages/host` milestone 2G.

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
step 2 with step 1 present is a **configuration** problem, and this version has
a defect that makes the documented configuration path unreliable — see §2.1.

Two log files matter:

| Log | Path |
|---|---|
| Minecraft | `<instance>/minecraft/logs/latest.log` |
| Host | the `host.log` printed by `npm run phase5:session`, under `.questbridge/phase5/<session>/` |

---

## 2. Connectivity

### 2.1 The adapter never publishes from `config/questbridge-client.toml`

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

**Workarounds that bypass the config file.** Both are read directly, before or
independently of the config spec:

```text
-Dquestbridge.minecraftToken=<token>      JVM argument
QUESTBRIDGE_MINECRAFT_TOKEN=<token>       environment variable
```

In Prism Launcher these belong in the instance's **Environment Variables**
(preferred) or **JVM arguments**. The system property takes precedence over the
environment variable, which takes precedence over the file.

**Not fixed** as of this writing: the defect is recorded, not patched. Fixing it
changes mod source and therefore requires a new version (§4).

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

## 4. What this session established

The first live Phase 5 session on 2026-11-07 verified, from the client's own
log, that the adapter loads, reaches FTB readiness, and reads real pack data: 55
chapters, the five expected ATM10 chapter IDs and titles, one manual pin
(`Easy Ore Duping`) with two `ftbquests:item` tasks showing `0/1`.

It did **not** verify the network path, because §2.1 prevented publishing. No
overlay data, no host snapshot, and no `AGENTS.md` §18 item may be claimed on the
strength of this session.

The two defects found (§2.1 and §2.2) are recorded here and **not fixed**. Both
touch the reason the run stopped; repairing the adapter defect changes mod source
and therefore takes the next version under `docs/versioning.md` §3.5. That
decision belongs to the user.

---

## 5. Reporting a new failure

Record it here when it is understood, with:

1. the symptom, as a person would describe it;
2. the log lines that identify it (client and/or host);
3. whether it is verified or suspected;
4. the workaround, if one exists;
5. whether fixing it changes source (and so requires a version bump).

A screenshot of the overlay is worth keeping when the symptom is visual and no
log line demonstrates it.
