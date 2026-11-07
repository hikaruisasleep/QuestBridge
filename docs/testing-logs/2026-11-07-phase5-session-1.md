# Phase 5 Live Session — 2026-11-07 (single-player, first attempt)

**Result:** the adapter loaded and read real FTB data in a live client, but the
**network path was never exercised**. No overlay data reached the host. The
session found two defects and confirmed one thing that had only ever been
claimed by a harness.

**Mode:** single-player (integrated server), world `New World`
**Client:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250, JDK 25.0.2
**Mod:** `questbridge-0pre.2.jar` (correctly installed and loaded)
**Host:** `127.0.0.1:8765`, serving the built frontend
**Observer:** `scripts/phase5/watch.mjs`, 13 assertions, entire session

---

## 1. Outcome by step

| Step | Expected | Observed | Evidence |
|---|---|---|---|
| Mod loads | `Found mod file questbridge-0pre.2.jar` | ✅ | client log 17:22:49 |
| Adapter initializes | `client adapter initialized` | ✅ | client log 17:23:13 |
| Reads its config | token from `questbridge-client.toml` | ❌ **defect** | `no minecraftToken configured; not publishing` |
| Publishes hello | host logs `publisher hello` | ❌ not reached | host log has no minecraft entry |
| Snapshot reaches host | `connection -> ready` | ❌ not reached | watch ledger: `disconnected` only |
| Overlay renders data | chapters + objectives | ❌ not reached | no host state to render |
| Reads FTB data in-game | 55 chapters, 5 IDs, 1 pin | ✅ | `[QuestBridge 4B] SNAPSHOT` @ 17:25:56 |

The last row is the important partial result and is discussed in §3.

---

## 2. Defects found

### D1 — the adapter reads its config before NeoForge loads it (verified)

The documented configuration path cannot work in `0pre.2`.

```java
// QuestBridge.java
modContainer.registerConfig(ModConfig.Type.CLIENT, QuestBridgeConfig.SPEC); // queues
this.client = new QuestBridgeClient();  // reads immediately
```

The log ordering proves the gap:

```text
17:23:13.096  [QuestBridge] no minecraftToken configured; not publishing.
17:23:29.590  ConfigTracker: Failed to load config questbridge-client.toml ... Attempting to recreate
```

`resolveMinecraftToken()` catches `IllegalStateException` and returns `""` when
the spec is not loaded, so the adapter concludes there is no token and stays idle
permanently. The config file is loaded 16 s later.

**Impact:** publishing is impossible through `config/questbridge-client.toml` on
this version. System property and environment variable still work.

**Not fixed.** Repairing it changes mod source and requires a new version
(`docs/versioning.md` §3.5).

### D2 — a BOM made NeoForge silently truncate the client config (verified)

The client config was first written by `Set-Content -Encoding UTF8` (PowerShell
5.1), which emits a UTF-8 BOM. NightConfig rejected it and NeoForge recreated the
file with defaults, blanking `minecraftToken`:

```text
17:23:29.590  ParsingException: Invalid bare key: '﻿hostUrl'. Attempting to recreate
```

**Attributes to the session, not the product.** The mod's default-writing
behaviour is reasonable; the fault was in how the operator wrote the file. It is
documented because the same trap will catch the next person copying a snippet
from a guide.

**Fixed during the session:** the file was rewritten without a BOM
(first bytes `35,87,101`).

---

## 3. What the session did establish

The in-game probe produced a full read of real pack data at 17:25:56 —
`[QuestBridge 4B] SNAPSHOT world="New World" dim=minecraft:overworld
integrated=true team=5d4e32e9-… chapters=55 manualPins=1 resolved=1
unresolved=0` — with the five expected ATM10 chapters and one manual pin
(`Easy Ore Duping`, two `ftbquests:item` tasks, `0/1`).

**This is `FtbSnapshotMapper` output, not the 4A probe.** The `4B` prefix is
distinct from `4A`, and the two lines that follow it are the mapper's own field
set. For the first time, the mapper is observed running on a live client thread
and producing a plausible snapshot. That was the specific gap
`packages/protocol/fixtures/README.md` said only a live run could close.

**But it does not close it, because nothing was validated.** The values were
logged, not published, and no `-Dquestbridge.dumpSnapshot` file was written, so
there is no artifact to run `scripts/validate-snapshot.mjs` against. The mapper
is observed producing output; it is not proven schema-correct.

Conspicuously absent from the log: **no `[QuestBridge] publishing to …` line.**
That line, or its absence, is the fastest way to tell a configured adapter from
an idle one.

---

## 4. What may not be claimed

Nothing in `AGENTS.md` §18 changes. Specifically, this session does **not**
establish: the overlay rendering anything, a host snapshot being accepted,
`minecraft.hello`, the transport, chroma keying against live data, reconnect,
multiplayer, or any progression behaviour. The host never received a single
message from Minecraft.

The adapter's own configuration is not yet proven either — D1 means the
documented path was never actually exercised.

---

## 5. Next actions

1. **Decide on D1.** Either work around it for the next run (set
   `QUESTBRIDGE_MINECRAFT_TOKEN` in the Prism instance environment, no rebuild),
   or fix it properly, which takes the next version.
2. **Add a dump path to the next run.** Launch with
   `-Dquestbridge.dumpSnapshot=<path>` so the mapper's output becomes a
   validatable artifact rather than a log line.
3. **Set `-Dquestbridge.debug=true` while diagnosing.** The adapter logs on
   change only; debug forces every capture to log, which distinguishes "no
   changes" from "not running".
4. **Pin chapters in `/control` before the next run.** None were configured, so
   the chapter-pin half of the data path is still untested even in the probe.
5. Re-run Sequences A–C from `docs/phase-5-plan.md` §6 on a client that reaches
   `publishing to ws://…`.

---

## 6. Environment notes

- The Prism instance already contained `questbridge-0pre.2.jar` with
  `questbridge-0pre.1.jar.disabled` alongside it; the swap in the runbook was
  not needed.
- `npm run phase5:check` reported **READY** before launch, and the client token
  matched the host's. Neither check could detect D1: both inspect the file,
  which was correct, and the file is simply never read in time.
- The overlay and dashboard connected successfully as browsers, so the host,
  static serving, and authentication are all working; only the publisher side
  failed.
