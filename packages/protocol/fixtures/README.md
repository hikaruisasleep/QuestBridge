# ATM10 recorded snapshot — provenance and limits

`atm10-recorded-snapshot.json` is a `minecraft.snapshot` envelope containing
values observed in a **real ATM10 TTS 2.3.1 client** on 2026-11-06, recorded in
`docs/testing-logs/2026-11-06-1.log` by the Stage 4A probe.

## What it proves

That the protocol v1 encoder produces a schema-valid message from real ATM10
data shapes: 16-character uppercase hex ids, a chapter title containing `:`,
`ftbquests:item` tasks with `target: 1`, a non-zero chapter percentage, and a
resolved manual pin with two tasks.

## What it does not prove

**It does not prove the FTB→snapshot mapper.** The values were transcribed from
the 4A probe log into `minecraft-mod/src/testVerification/java/RecordedFixtureHarness.java`,
not produced by `FtbSnapshotMapper` reading FTB objects. A passing validation
here says the wire format survives real values; it says nothing about whether the
mapper extracts them correctly. Only a live run can establish that: Phase 5's
Sequence A (`docs/phase-5-plan.md` §6), read with `npm run phase5:capture`.

## Sanitisation applied

- `teamName` was `crystxllize_#5d4e32e9` in the live run. It contained a player
  name, so it is `null` here (`AGENTS.md` §11.1).
- `teamId` was a real team UUID; it is replaced with
  `00000000-0000-4000-8000-000000000000`.
- `worldName` was unavailable in the 4A probe and is `null`.
- No server address, token, or player identifier remains. Verified by searching
  the file for each of those values before it was committed.

Chapter and quest identifiers are pack data, not personal data, and are kept
because they are what makes the fixture useful.

## Contents

| Field | Value |
|---|---|
| Chapters | 5 (the ATM10 TTS chapter 1–5 range) |
| `Starting out` progress | 38 |
| Manual pins | 1 — `Easy Ore Duping` |
| Tasks on that pin | `Squeezer`, `Copper Ore Hammer`, both `ftbquests:item`, `0/1` |
| `unresolvedPinnedQuestIds` | empty |

The live run reported 55 chapters in total; only the five the 4A probe logged are
included, because those are the only chapter values that were recorded.
