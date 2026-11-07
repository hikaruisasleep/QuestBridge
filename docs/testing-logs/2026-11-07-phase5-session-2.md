# Phase 5 Live Session — 2026-11-07 (session 2: log-only mapper verification)

**Context:** continuation of session 1 in the **same** Minecraft process. The
transport was still blocked by the adapter configuration defect
(`docs/troubleshooting.md` §2.1), so no message ever reached the host.

**Result:** the mapper's *objective* behaviour was verified against real pack
data without a single byte being transmitted. One category of value — per-chapter
fields — proved unobservable by design and is now recorded as such.

**Mode:** single-player (integrated server), world `New World`
**Client:** ATM10 TTS 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250
**Mod:** `questbridge-0pre.2.jar`
**Observer:** the client's own `latest.log`, read by byte offset so each
transition is attributable to one user action.

---

## 1. Why log-only verification was possible

The adapter's capture path does not depend on the transport. Each client tick
captures a `QuestSnapshot`, logs it, and only then hands it to a transport that
is `null`. So with publishing disabled, the mapper still ran at full fidelity and
still logged its output.

That reframed the session: Sequences A and B of `docs/phase-5-plan.md` §6 were
partially reachable with no host at all.

---

## 2. Results

| # | Check | Verdict | Evidence |
|---|---|---|---|
| A2 | Chapter catalog | **PASS** | 55 chapters; 5/5 expected ATM10 IDs |
| A6 | Pin addition captured | **PASS** | `manualPins` 1 → 2 within the 2 s window |
| A7 | Automatic pin excluded | **PASS** | objective list contains only real quests |
| B1 | Chapter progress advances | **PASS (FTB, not mapper)** | see §4 |
| B3 | Completion-driven unpin | **PASS** | completed quest removed, nothing retained |
| — | Cross-chapter ordering | **PASS (partial)** | four candidate rules excluded, two remain |
| — | Client-thread contract | **PASS** | zero violations |

The client is identified as running because the world's `session.lock` was held
exclusively; the log had been quiet for 5 minutes, which is expected — the
adapter logs **on change only**.

---

## 3. The completion test

`Compressed Blocks` (chapter `3B0302DB5E77C3A2`, task `Gravel 1x`) was pinned,
then completed. FTB removed the pin from the player's set.

```text
BEFORE  manualPins=2 resolved=2 unresolved=0
          Easy Ore Duping      (0/2 tasks)
          Compressed Blocks    (0/1 task)

AFTER   manualPins=1 resolved=1 unresolved=0
          Easy Ore Duping      (0/2 tasks)
```

**The objective vanished rather than becoming a completed row.** `Easy Ore Duping`
was byte-identical before and after, so there was no collateral churn. The ledger
changed by exactly one entry.

This is the check the project documentation flags as most likely to expose a
fabricated objective, and the failure mode did not occur: the mapper reports what
FTB holds.

The user independently observed FTB unpinning the quest in-game, so this is
confirmed from both sides.

---

## 4. Correction: chapter progress was reported from the wrong source

An earlier statement in this session attributed a chapter-progress change to
`FtbSnapshotMapper`. **That was wrong.**

`chapter 1` moved `38 → 40` when the quest completed, which is genuine FTB
behaviour — but the line came from the **4A probe**, not the mapper:

| Prefix | Source | Transmitted |
|---|---|---|
| `[QuestBridge 4B] SNAPSHOT` | `FtbSnapshotMapper` | yes |
| `[QuestBridge 4A] READY` / `chapter …` | `FtbQuestProbe` | no |

`logSnapshot()` prints `snapshot.chapters().size()` only; the mapper's per-chapter
`progress`, `status`, `subtitle`, and `order` are never logged. So the mapper's
chapter values are **unobservable** from logs, and the `38 → 40` reading is
evidence about FTB, not about the mapper.

Recorded permanently as `docs/troubleshooting.md` §4.1 and §4.2. The chapter
progress check in §2 is deliberately marked "FTB, not mapper" because of this.

---

## 5. Pin ordering

Four pins across four chapters were observed. The mapper emits objectives in a
sorted order; candidate rules were tested against the observed sequence:

```
OBSERVED: Easy Ore Duping → Copper Chest → RailCraft → Draconic Bow
          (catalog ranks 0, 5, 25, 37)

catalog rank (documented)   MATCHES
quest id ascending          MATCHES
quest id descending         excluded
chapter id ascending        excluded
```

**Not decisive.** Quest-ID ascending coincides with catalog order for this pin
set, so two rules remain. A discriminating pin needs a quest in a *later* chapter
whose ID sorts *below* an earlier pin's ID; `scripts/check-pin-order.mjs` finds
such candidates (300 exist) and prints them.

What *is* established: the mapper is not using chapter-ID order, descending
order, or alphabetical order, so it is not doing the naive thing.

---

## 6. What this session does not prove

- **Nothing reached the host.** No `minecraft.hello`, snapshot, progress, or pins
  message; the host never saw a publisher.
- **No schema validation.** No dump file was written, so no artifact exists to
  run `scripts/validate-snapshot.mjs` against. The mapper is observed producing
  plausible output; it is not proven schema-correct.
- **The mapper's chapter fields** remain unverified (§4).
- **No overlay evidence** of any kind.
- **`AGENTS.md` §18 is unchanged.** No box may be checked.

The adapter's own configuration remains unproven too: the documented config path
was never exercised successfully.

---

## 7. Next actions

1. **Decide on the §2.1 defect.** Either set `QUESTBRIDGE_MINECRAFT_TOKEN` in the
   Prism instance environment as a workaround (no rebuild), or fix the load-order
   bug, which takes the next version.
2. **Add `-Dquestbridge.dumpSnapshot=<path>`** on the next launch. This converts
   every mapper value into a validatable artifact and closes §4.1 permanently.
3. **Add `-Dquestbridge.debug=true`** while diagnosing: without it the adapter
   logs only on change, which makes "no changes" and "not running"
   indistinguishable.
4. **Pin chapters in `/control`** before the next run; none were configured.
5. Re-run Sequences A–C on a client that reaches `publishing to ws://…`.

---

## 8. Tooling produced

| Script | Purpose |
|---|---|
| `scripts/check-pin-order.mjs` | Tests observed pin order against candidate rules; prints discriminating candidates |
| `scripts/find-ordering-probe.mjs` | Finds a quest whose ID rank differs from its catalog rank |
| `scripts/fix-mojibake.mjs` | Repaired a double-encoded `docs/phase-4-plan.md` |

The pin-order script derives its expectation from the pack's SNBT metadata
(chapter-group order plus `order_index`), which approximates FTB's runtime
`getAllChapters()` order rather than reading it. That limitation is stated in the
script and is why §5 says "consistent with" rather than "proven".
