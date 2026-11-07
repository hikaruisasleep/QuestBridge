# Stage 4F Live ATM10 Verification Guide

**Purpose:** Guide a future agent (or the user) through completing the remaining
Phase 4 verification steps. This guide assumes the code base has already been
merged onto `master` with the `0pre.2` version, all 4B–4E adapter work committed,
and the Prism instance still holds the Stage 4A jar.

---

## Prerequisites

1. **Merge `feat/phase-4b-snapshot` onto `master`** — ensure commit `85b26bc`
   is the head of `master`. This brings:
   - The adapter code (`minecraft-mod/adapter`, `minecraft-mod/transport`, etc.)
   - The versioning policy fix (`docs/versioning.md`, `docs/phase-4-plan.md` §3.4)
   - The protocol fixture (`packages/protocol/fixtures/atm10-recorded-snapshot.json`)
   - The `CapturePlan.java` and `DifferHarness.java` test harnesses

2. **Verify the build** — from the workspace root:
   ```bash
   ./gradlew :minecraft-mod:build   # should exit 0
   npm test                          # all 534 tests should pass
   ```

3. **Inspect the Prism instance** — the running instance should be at:
   ```
   D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky\minecraft\mods\
   ```
   It must contain `questbridge-0pre.1.jar`. This file is **not** the correct one.

4. **Download `questbridge-0pre.2.jar`** — it should be at:
   ```
   D:\QuestBridge\minecraft-mod\build\libs\questbridge-0pre.2.jar
   ```
   (If the build hasn't been run recently, rebuild it first.)

5. **Have a Minecraft account** — Stage 4F requires a live Minecraft login to the
   Prism instance.

6. **Know the minecraftToken** — you'll need this to configure the client. It is
   stored in the Prism instance's secret area (e.g. `tokens.json` or similar). If
   it's not on the machine, ask the user to provide it from their Prism account.

---

## Step 1 — Swap the jar

The Prism instance is still running the Stage 4A probe (`questbridge-0pre.1.jar`),
which contains **no transport code and no configuration hooks**. The Stage 4B–4E
adapter code will publish nothing until `0pre.2` is loaded.

**Do this in a PowerShell session with elevated privileges if needed:**

```powershell
# Change to the Prism instance mods directory
cd "D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky\minecraft\mods\"

# Back up the old jar (optional but recommended)
Move-Item questbridge-0pre.1.jar questbridge-0pre.1.jar.bak

# Copy the new jar in its place
Copy-Item "D:\QuestBridge\minecraft-mod\build\libs\questbridge-0pre.2.jar" .\questbridge-0pre.2.jar

# Verify
Get-ChildItem questbridge-*.jar | Select-Object Name, Length, LastWriteTime
```

If the jar swap fails (permission denied), run PowerShell as Administrator, or
pause and ask the user for assistance.

---

## Step 2 — Configure the token

The host authenticates clients via a `minecraftToken`. Without it, the adapter
logs once and stays idle.

1. **Locate the token file** — in a typical Prism install it is at:
   ```
   D:\Games\Minecraft\PrismLauncher\tokens.json
   ```
   If it's not there, ask the user where they keep their Prism secrets, or have
   them log into the Prism web UI to retrieve it.

2. **Extract the token value** — it should be a string like
   `"01234567-89ab-cdef-0123-456789abcdef"` (a UUID-style token). Note it down.

3. **Write it into the client config** — the client reads from `config/questbridge-client.toml`
   in the working directory, or it can be overridden with `-Dquestbridge.minecraftToken`
   on the command line. The simplest path is:

   ```powershell
   # Change to the QuestBridge workspace
   cd "D:\QuestBridge"

   # Write the config file (create if missing)
   if (-not (Test-Path "config")) { New-Item -ItemType Directory -Path config }
   Set-Content -Path config\questbridge-client.toml -Value "
   [client]
   minecraft_token = \"<TOKEN>\"
   "
   # Replace <TOKEN> with the actual value you extracted
   ```

   If the config already exists, just update the `minecraft_token` line.

   If you prefer the command-line route instead:

   ```bash
   java -Dquestbridge.minecraftToken="<TOKEN>" -jar minecraft-mod\build\libs\questbridge-0pre.2.jar
   ```

   Note: the `-D` flag only works when starting the client manually, not through
   Prism's normal launch flow. For Prism, the `config/questbridge-client.toml`
   approach is preferred.

---

## Step 3 — Start the host

The host is a Node.js process that listens on `ws://127.0.0.1:8765/ws` by default.

**From the QuestBridge workspace:**

```bash
npm run host
```

You should see output similar to:

```
[npm] > questbridge@0.0.1 start:host
[npm] > node packages/host/dist/index.js
[host] listening on ws://127.0.0.1:8765/ws
```

If it fails with `EADDRINUSE`, something else is on port 8765 — kill it and retry.

---

## Step 4 — Launch the client and load an ATM10 world

Now start Minecraft through Prism Launcher with the **All the Mods 10: To the Sky** instance.

1. Open Prism Launcher.
2. Select the instance **All the Mods 10: To the Sky**.
3. Click **Play** (or **Launch**).
4. When the game finishes loading, join a world (single-player or multiplayer).

The client should now connect to the host, publish a `hello` payload, and after a
brief handshake reach `connection=ready`. The host console should show:

```
hello payload accepted
```

followed later by:

```
snapshot accepted (5 chapters, 1 pin)
progress messages (e.g. chapter progress, quest progress)
heartbeat messages
```

If you see `host.error` in the logs, the token may be wrong or the jar version doesn't match.

---

## Step 5 — Verify the overlay appears in OBS

With Minecraft running and the client connected:

1. Open OBS Studio.
2. Add a new **Browser Source**.
3. Set the URL to `http://127.0.0.1:8765/overlay`.
4. Set width to **380** and height to **650** (the suggested defaults; adjust if
   the overlay looks wrong).
5. Enable **Chroma Key** with color `#00FF00` (solid green) — no UI colour should
   be in that family.
6. Disable **Refresh browser when scene becomes active** (to avoid flicker).
7. The overlay should now display:
   - The chapter catalog (5 max, configurable)
   - Chapter progress bars
   - Manual quest pins (FTB Quests objectives)
   - Task progress bars where available
   - A uniform green key colour for chroma keying

If the overlay is blank, check:

- The host console for errors (`host.error` lines).
- The Minecraft log for QuestBridge messages (`[QuestBridge/]:`).
- That the jar swap was successful and the token is correct.
- That the host is still running.

---

## Step 6 — Run the verification checklist

Once the overlay appears, the user (or agent) should confirm each item below.
These map directly to the Definition of Done in `AGENTS.md` §18 and the Phase 4 plan
§8:

| Checklist item | What to verify |
|----------------|----------------|
| Monorepo builds | `./gradlew build` → exit 0; `npm test` → all 534 pass |
| Host runs locally | `npm run host` starts and reports `listening on ws://127.0.0.1:8765/ws` |
| Mock publisher connects | `npm run mock` starts without errors |
| Chapter catalog received | 5 chapters appear in the overlay (ATM10 TTS chapters) |
| Chapter pin configuration persists | Pin selections survive a host restart |
| Up to five chapters can be selected | Pin selections up to 5, verify the 5th disables after 5 |
| Chapters can be reordered | Drag reorder in the dashboard, verify overlay updates |
| Missing chapters are handled safely | If a chapter ID is missing after a modpack update, it stays stored as unresolved |
| Manual FTB Quests pins received | Pinned quests appear in the objective checklist |
| Automatic pins are excluded | Only manually pinned quests appear (not FTB's auto-tracker) |
| Chapter progress is displayed | Chapter progress bars show correct percentages |
| Quest progress is displayed | Quest completion state and progress bars |
| Task progress is displayed where available | Numeric task progress (e.g. `3/8`) appears |
| Overlay paints a uniform key colour | Chroma key `#00FF00` works in OBS with no green UI colours |
| OBS Browser Source works | The source renders without error |
| Disconnects are represented accurately | Kill the host process; overlay should fade to disconnected state |
| Reconnection restores current state | Re-launch the world; overlay should restore the last snapshot |
| Actual NeoForge integration compiles | `./gradlew build` still passes |
| Client-only installation is verified | The jar in the Prism instance is `questbridge-0pre.2.jar` |
| Single-player integration is tested | Load a single-player world, verify overlay works |
| Multiplayer integration is tested | Connect to a multiplayer server, verify overlay works |
| **Actual ATM10 TTS progression is verified** | This is the final item — the overlay reflects real FTB Quests data from the running game |

If every item is checked, **the Phase 4 objective is complete**.

---

## Step 7 — Mark Phase 4 done and update versioning

After all checks pass:

1. **Update the documented version** in `docs/versioning.md` (if it's not already `0pre.2`):
   ```markdown
   Current documented version: `0pre.2`
   ```

2. **Optionally update AGENTS.md** §18 boxes (these are claims; checking them
   requires the live run above).

3. **Commit the final state** (if you're an agent, not the user):
   ```bash
   git add -A
   git commit -q -m "Phase 4 complete: live ATM10 verification passed
   (all §18 items checked, 0pre.2 documented version confirmed)"
   git push origin master
   ```

4. **Clear the blocked goal** (if using the DeepSeek Harness goal system):
   ```python
   update_goal({
       "goal_id": "goal-3ac0bfc8-b990-4509-ad03-d420be9ef7ad",
       "revision": 1,
       "action": "complete"
   })
   ```

---

## What to Do If Something Fails

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Host starts but no hello payload | Wrong jar version; token missing or incorrect | Re-check jar swap; verify token in config |
| Overlay blank, host shows `host.error` | Protocol version mismatch; adapter not loaded | Rebuild the jar; verify `mod_version=0pre.2` in `minecraft-mod/gradle.properties` |
| Chapter catalog empty or wrong | Chapter discovery code not reading FTB data correctly | Check `FtbSnapshotMapper.java` and `QuestSnapshot.java`; inspect FTB Quests version |
| Task progress shows `null` | Tasks without numeric progress, or FTB version difference | Verify task `current`/`target` values in the live game; consult `docs/ftb-quests-integration.md` |
| OBS chroma key not working | UI colour accidentally uses `#00FF00` or similar | Check the overlay CSS; ensure no element uses that exact colour |
| Client disconnects after a few seconds | Host process crashed; network interruption | Restart host; check firewall/port 8765 accessibility |

If the user encounters a failure not covered above, pause and ask for the relevant
log excerpts before proceeding.

---

## Post-Completion Checklist for the Agent

After the user confirms everything works, do the following:

- [ ] Verify `./gradlew build` → exit 0 on the merged master.
- [ ] Verify `npm test` → all 534 tests pass.
- [ ] Confirm the jar in the Prism instance is `questbridge-0pre.2.jar`.
- [ ] Confirm the token is correctly placed in `config/questbridge-client.toml`.
- [ ] Confirm the host started and the overlay appears in OBS.
- [ ] Go through the §18 verification checklist with the user; mark each item.
- [ ] Update `docs/versioning.md` if the documented version needs changing.
- [ ] (Optional) Commit and push the final state to `origin master`.
- [ ] (Optional) Clear the Phase 4 goal as completed in the goal system.

---

**End of guide.** This document is intended for any future agent who needs to
complete Stage 4F live verification. It assumes the code base is already on
`master` with version `0pre.2`, and that the Prism instance currently holds the
Stage 4A jar. All file paths are absolute under `D:\QuestBridge` (the workspace root)
and `D:\Games\Minecraft\PrismLauncher\instances\All the Mods 10- To the Sky` (the
Prism instance).
