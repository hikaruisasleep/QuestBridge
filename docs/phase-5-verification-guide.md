# Phase 5 Verification Guide — Live ATM10 TTS Run

**Purpose:** the operator's side of a Phase 5 live run. It tells the user what
to do, in order, and what the agent will be checking while they play.
**Audience:** the user driving Minecraft, working with an agent that runs the
host and reads the results.
**Companions:** `docs/phase-5-plan.md` (why the run is structured this way),
`docs/development.md` (build and test commands).

> Stage 4F is not a separate prerequisite any more. It is Sequence A of this
> guide (`docs/phase-5-plan.md` §1, §6).

> **This guide was rewritten for `0pre.3`.** The mod version moved because the
> Proposal E fixes change mod source (`docs/proposals.md` §6.1,
> `docs/phase-5-plan.md` §12). Two things the previous version told you are now
> **wrong**, and both are corrected below:
>
> - **You no longer need to set a token by hand.** The adapter finds the host's
>   own `tokens.json`. `config/questbridge-client.toml` now works as documented,
>   and discovery covers the case where you never wrote one.
> - **`questbridge-0pre.1.jar` may still be in your instance.** Check before
>   launching; §2.1 now swaps the artifact rather than assuming it is current.

> **Add `-Dquestbridge.dumpSnapshot=<path>` on every run.** It is still the only
> way to produce a **validatable** artifact. `0pre.3` added per-chapter log lines,
> which makes chapter values *visible*; it did not make them *validatable*
> (`docs/troubleshooting.md` §4.1).

---

## 0. Ground rules

- The mod version for this run is **`0pre.3`**. It exists because the Proposal E
  fixes change mod source, so unlike the previous guide this one **does** expect a
  build. The artifact is `minecraft-mod/build/libs/questbridge-0pre.3.jar`.
- **Never paste a token into chat.** The agent reads what it needs from the
  session file the tooling writes. With discovery in place you may never need to
  look at the token at all.
- If something looks wrong, say so immediately and in your own words. A
  discrepancy between what you see and what the agent reports is the most
  valuable thing this run can find.
- A check you did not perform is recorded as *not observed*, never as passed.
  As of the `phase5:watch` fix, the tooling reports that third state itself.

---

## 1. What the agent does first

The agent runs:

```powershell
node scripts/phase5/check-environment.mjs --instance "D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky"
```

Run from the repository root with the pinned Node on `PATH`:

```powershell
$nodeDir = "$env:APPDATA\fnm\node-versions\v24.22.1\installation"
$env:Path = "$nodeDir;$env:Path"
```

The check reports `READY`, `READY (with warnings)`, or `NOT READY` and never
changes anything. The agent resolves anything blocking before involving you.

> **`check-environment` now expects `0pre.3`.** If it warns that the installed jar
> is an older version, that is a real signal rather than noise — a stale jar
> cannot show any of the fixes this run is meant to verify.

---

## 2. One-time setup

These steps write outside the repository. They are done once, and the agent
should confirm each before you launch.

### 2.1 Install the adapter jar

The instance may hold an older jar — `questbridge-0pre.1.jar` (the Stage 4A
probe, with no transport and no configuration), or `questbridge-0pre.2.jar`
(transport, but the config-load defect). Either one will fail this run for a
reason that has nothing to do with what is being tested.

```powershell
$mods = "D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky\minecraft\mods"
Get-ChildItem $mods -Filter "questbridge*" | ForEach-Object {
    Rename-Item $_.FullName "$($_.FullName).disabled" -ErrorAction SilentlyContinue
}
Copy-Item ".\minecraft-mod\build\libs\questbridge-0pre.3.jar" $mods
Get-ChildItem $mods -Filter "questbridge*"
```

Exactly one file should end in `.jar`. Two loadable copies of the same mod stop
the game from starting, which is why this disables everything first.

If `questbridge-0pre.3.jar` does not exist, the agent builds it:

```powershell
cd minecraft-mod
./gradlew clean build
```

### 2.2 Give the client the Minecraft token — **only if discovery fails**

**`0pre.3` should not need this step.** The adapter reads the host's own
`tokens.json` at the host's documented config directory, so a machine that has
run the host once is already configured. Try a run without this section first:
if discovery works, that is itself a result worth recording, and setting the
variable would hide it.

If the agent reports that the client log shows no token found, the cause is
almost always that the host has never been started and has therefore never
written `tokens.json`. Start the host; the adapter retries and finds it. Only if
that does not resolve it, use one of the following.

#### 2.2a Preferred manual override: instance environment variable

In Prism Launcher: select the instance → **Edit** → **Environment Variables** →
add

```text
QUESTBRIDGE_MINECRAFT_TOKEN = <the minecraftToken value>
```

This is read directly by the adapter and takes precedence over both the config
file and discovery. It keeps the credential out of `instance.cfg`, so it does not
travel with an exported instance.

#### 2.2b The client config — **now functional**

The documented path is
`D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky\minecraft\config\questbridge-client.toml`:

```toml
hostUrl = "ws://127.0.0.1:8765/ws"
minecraftToken = "<the minecraftToken value>"
enabled = true
discoverToken = true
```

On `0pre.2` this file could not work at all: the adapter read it before NeoForge
loaded it (`docs/troubleshooting.md` §2.1). **`0pre.3` fixes that**, so this is
now a supported path.

- **Write it without a UTF-8 BOM.** A BOM makes NeoForge reject the file and
  recreate it with the token blanked. PowerShell 5.1's
  `Set-Content -Encoding UTF8` writes one — see `docs/troubleshooting.md` §2.2.
  This trap is unchanged by `0pre.3`; it is in NightConfig, not the adapter.
- `minecraftToken` here outranks discovery but is outranked by both the system
  property and the environment variable (`docs/ftb-quests-integration.md` §11.1).

`enabled` defaults to true; `hostUrl` defaults to `ws://127.0.0.1:8765/ws`.
`discoverToken` defaults to true; set it false to require an explicit token.

`check-environment` verifies the token **in the file** and that it matches the
host's. It cannot detect E1 — that was a load-order problem, and the file was
always correct. Confirm the adapter actually publishing by looking for
`[QuestBridge] publishing to ws://…` in the client log; its absence is the fastest
signal that the adapter is idle, and the line above it now names the reason.

---

## 3. Start a session

The agent runs:

```powershell
node scripts/phase5/start-session.mjs
```

It prints something like:

```text
Overlay:   http://127.0.0.1:8765/overlay?token=…
Dashboard: http://127.0.0.1:8765/control?token=…
```

You then:

1. Open the **Dashboard** URL.
2. Pin up to five chapters — for ATM10 TTS, the recommended starting set is
   Starting Out, The Cool Parts, AllTheModium, The ATM Star, and Creative Items.
3. Confirm the dashboard shows the chapters and the pin order you expect.

At this point nothing is connected yet. An empty catalog and a disconnected
state are correct: the host never fabricates progression.

> **Pin chapters here, before launching.** This was impossible on `0pre.2`,
> because the host had never received a catalog. With the adapter able to publish,
> the catalog arrives and pinning works. Sessions 1 and 2 both ran with no pins
> configured, which is why the chapter-pin half of the data path is still
> untested even in the probe.

---

## 4. Launch Minecraft

1. Start the ATM10 TTS instance from Prism.
2. Load the world (`New World` is the one with saved progression).
3. Tell the agent: **"launched"**, and say whether it is single-player or a
   server.

The agent starts observing at that point. Board entry, mod loading, and world
generation take a few minutes in this pack; that is normal.

**The first thing the agent will check is one log line:**
`[QuestBridge] publishing to ws://…`. Its presence means the token resolved and
the transport started. Its absence means it did not, and the warning above it
names the source that failed — which is the check that both previous sessions
could not perform.

---

## 5. Sequence A — adapter correctness

You need: the world loaded, the agent watching.

| Step | You do | What it proves |
|---|---|---|
| A1 | Wait until the quest book opens normally | FTB data synchronized and the adapter published a catalog |
| A2 | Open the quest book and note the five pinned chapters' percentages | Chapter progress matches FTB |
| A3 | Pin one quest in the quest book (bookmark button) | A new pin appears as a current objective |
| A4 | Watch the overlay while pinning | The overlay updates on its own |

The agent reports each of these as it lands. **If the overlay does not change
within a few seconds of pinning, say so** — pins are found by a 2-second
reconciliation rather than an event, so this is a real timing question.

### 5.1 The three checks only `0pre.3` can perform

These are new, and they are the reason this run exists. The agent runs them; you
do not have to do anything extra for the first two.

| Check | What the agent looks for | Why it is new |
|---|---|---|
| Transport started at all | `[QuestBridge] publishing to ws://…` in the client log | On `0pre.2` this line never appeared, because of the config-load defect |
| The token's source | `token from <source>` on the same line | Names which of the four precedence rules won. Expect the config file or discovery, never the property or the variable on a clean run |
| Chapter values are now logged | `[QuestBridge 4B] chapter id=… progress=… status=…` lines | New in `0pre.3`; these values were previously unobservable from logs |

**One check needs you**, at the end of the session:

> **C-recovery (E2).** The agent deletes or renames the host's `tokens.json` and
> restarts the host, which generates a new token. On `0pre.2` this required
> restarting Minecraft: the adapter kept presenting the old value and the host
> answered `401` forever. On `0pre.3` the adapter should recover on its own next
> reconnect. The agent asks you to say whether the overlay comes back without a
> game restart — and if it does not, that is a finding worth stopping for.
>
> This is the only check in the run that tests the E2 fix in the way that
> mattered, so it is worth the extra minute.

---

## 6. Sequence B — progression and completion

| Step | You do | What it proves |
|---|---|---|
| B1 | Progress a task on a pinned quest (put items in your inventory) | Task counts and numeric progress update |
| B2 | Pin a second quest, then unpin the first | The objective list follows FTB both ways |
| B3 | **Complete** a pinned quest | FTB unpins it; the objective must disappear, not become a "done" row |
| B4 | Complete a chapter's required quests | Chapter completion is shown from FTB's completion state |

B3 is the most important check in the run. QuestBridge must never invent a
retained completed objective; if you see one, that is a defect worth stopping for.

**If the overlay is slow to react**, say so rather than assuming it will catch
up. The `phase5:watch` tooling now reports an unexercised check as *not observed*
rather than as a pass, so a check that never landed is recorded honestly instead
of looking green.

---

## 7. Sequence C — lifecycle

| Step | You do | Expected |
|---|---|---|
| C1 | Leave the world to the main menu | Overlay fades out; no stale progression presented as live |
| C2 | Load the world again | Overlay returns with the current catalog |
| C3 | Switch to another world | Overlay shows that world's progress only |
| C4 | Ask the agent to restart the host, while you stay in-world | The client reconnects by itself; Minecraft does not need a restart |
| C5 | Quit Minecraft | The agent records a clean disconnect |
| C6 | The E2 recovery check from §5.1 | A regenerated host token is picked up without restarting Minecraft |

For C4 the agent stops and restarts `phase5:session`. You should not have to do
anything; the adapter retries with a 1, 2, 4… second backoff.

**C4 and C6 are now genuinely different checks.** Both involve a host restart, but
C4 reuses the same token while C6 regenerates it. On `0pre.2` C4 passed and C6 was
impossible; on `0pre.3` both should pass. Running only C4 would prove nothing
about E2, which is why the guide now lists both.

---

## 8. Sequence D — single-player and multiplayer

Repeat Sequences A and B in the other mode. For multiplayer, the server needs
FTB Quests and FTB Teams (the pack has them); **no server-side QuestBridge mod**
and no server filesystem access are needed.

Tell the agent which mode you are in; it expects `single-player` or
`multiplayer` to be reported accordingly.

---

## 9. OBS (optional, for the visual check)

1. Add a **Browser** source, 380 × 650, FPS 30.
2. URL: the printed **Overlay** URL.
3. Filters → **Chroma Key** → key colour `#00FF00` (green) or `#0000FF` (blue),
   matching the **Background** choice in `/control`.
4. Disable *Refresh browser when scene becomes active*.

The overlay must key cleanly, show no scrollbars, and survive a source refresh.

---

## 10. When something fails

Tell the agent **what you saw**, not what you think went wrong, and include the
moment (for example, "right after pinning the quest, the overlay still showed
three objectives").

The agent will then:

1. check the host log for the last message it received;
2. check the watch ledger for the last state it observed;
3. check the capture dump for what the adapter actually encoded;
4. report which of the three disagrees.

Common symptoms and where the fault usually is:

| Symptom | Look at |
|---|---|
| Nothing ever reaches the host | Client config (token, URL), jar installed and enabled |
| Host says another publisher is connected | A second client or a stray mock publisher is running |
| Overlay shows an unresolved chapter | The chapter ID changed in the pack, or pins were set before data arrived |
| Objectives never change | Pin changes are reconciled every 2 s; check the client is still connected |
| Overlay blank but host state is fine | The browser source or token, not the adapter |
| `no minecraftToken found yet` in the client log | The host has probably never run, so there is no `tokens.json`. Start the host; the adapter retries. On `0pre.3` this is no longer a hard stop |
| The old jar is still installed | Check `questbridge-0pre.3.jar` is the only loadable QuestBridge jar; a stale one cannot show any of these fixes |

The two rows below the old table are new, and both describe a failure that was
*normal and permanent* on `0pre.2` and is now either recoverable or a real
misconfiguration.

---

## 11. What gets recorded

The agent writes `docs/testing-logs/<date>-phase5-<mode>.md` with one line per
check: what the tool output showed, what you observed, and a verdict from
{pass, fail, **not observed**}. A check you did not perform is not observed,
never passed.

At the end of the run, only checks with evidence are marked as passing in
`docs/phase-5-plan.md` §8. That table also carries the four `0pre.3`-specific
checks added by `docs/phase-5-plan.md` §12, none of which can be claimed from the
offline build record.

Nothing is committed from the run except documentation and, if the capture is
good, a sanitised fixture. Raw dumps contain world and team identifiers and stay
in the ignored `.questbridge/` directory.
