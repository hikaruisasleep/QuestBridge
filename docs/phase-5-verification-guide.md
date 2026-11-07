# Phase 5 Verification Guide — Live ATM10 TTS Run

**Purpose:** the operator's side of a Phase 5 live run. It tells the user what
to do, in order, and what the agent will be checking while they play.
**Audience:** the user driving Minecraft, working with an agent that runs the
host and reads the results.
**Companions:** `docs/phase-5-plan.md` (why the run is structured this way),
`docs/development.md` (build and test commands).

> Stage 4F is not a separate prerequisite any more. It is Sequence A of this
> guide (`docs/phase-5-plan.md` §1, §6).

---

## 0. Ground rules

- The mod version for this run is **`0pre.2`**. No rebuild is expected; if a
  build is needed it is the same version.
- **Never paste a token into chat.** The agent reads what it needs from the
  session file the tooling writes.
- If something looks wrong, say so immediately and in your own words. A
  discrepancy between what you see and what the agent reports is the most
  valuable thing this run can find.
- A check you did not perform is recorded as *not observed*, never as passed.

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

---

## 2. One-time setup

These steps write outside the repository. They are done once, and the agent
should confirm each before you launch.

### 2.1 Install the adapter jar

The instance currently holds `questbridge-0pre.1.jar`, which is the Stage 4A
probe: it has **no transport and no configuration**, so it will connect to
nothing and prove nothing.

```powershell
$mods = "D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky\minecraft\mods"
Move-Item "$mods\questbridge-0pre.1.jar" "$mods\questbridge-0pre.1.jar.disabled" -ErrorAction SilentlyContinue
Copy-Item ".\minecraft-mod\build\libs\questbridge-0pre.2.jar" $mods
Get-ChildItem $mods -Filter "questbridge*"
```

Exactly one file should end in `.jar`. Two loadable copies of the same mod stop
the game from starting.

### 2.2 Give the client the Minecraft token

The client reads `config/questbridge-client.toml` from its game directory. The
token is in the host's token file, which on Windows is:

```text
%APPDATA%\QuestBridge\tokens.json
```

Take the `minecraftToken` value (a 43-character base64url string — **not** a
UUID, and **not** in the Prism directory) and write:

```text
D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky\minecraft\config\questbridge-client.toml
```

```toml
hostUrl = "ws://127.0.0.1:8765/ws"
minecraftToken = "<the minecraftToken value>"
enabled = true
```

`enabled` defaults to true; `hostUrl` defaults to `ws://127.0.0.1:8765/ws`. Keep
`hostUrl` in step with the port the host is started on.

> An earlier version of this guide incorrectly pointed at a `tokens.json` inside
> the Prism directory and described the token as UUID-shaped. Both were wrong;
> the host's config directory is the only source.

`check-environment` verifies that this file exists, is enabled, and that its token
matches the host's, so this step is self-checking.

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

---

## 4. Launch Minecraft

1. Start the ATM10 TTS instance from Prism.
2. Load the world (`New World` is the one with saved progression).
3. Tell the agent: **"launched"**, and say whether it is single-player or a
   server.

The agent starts observing at that point. Board entry, mod loading, and world
generation take a few minutes in this pack; that is normal.

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

---

## 7. Sequence C — lifecycle

| Step | You do | Expected |
|---|---|---|
| C1 | Leave the world to the main menu | Overlay fades out; no stale progression presented as live |
| C2 | Load the world again | Overlay returns with the current catalog |
| C3 | Switch to another world | Overlay shows that world's progress only |
| C4 | Ask the agent to restart the host, while you stay in-world | The client reconnects by itself; Minecraft does not need a restart |
| C5 | Quit Minecraft | The agent records a clean disconnect |

For C4 the agent stops and restarts `phase5:session`. You should not have to do
anything; the adapter retries with a 1, 2, 4… second backoff.

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

---

## 11. What gets recorded

The agent writes `docs/testing-logs/<date>-phase5-<mode>.md` with one line per
check: what the tool output showed, what you observed, and a verdict. At the end
of the run, only checks with evidence are marked as passing in
`docs/phase-5-plan.md` §8.

Nothing is committed from the run except documentation and, if the capture is
good, a sanitised fixture. Raw dumps contain world and team identifiers and stay
in the ignored `.questbridge/` directory.
