# Post-Round-2 Worklist

**Status:** An **index**, not a source of truth.
**Created:** 2026-11-09, after the Round 2 commit series (`108d6d9`).
**Purpose:** one place to see everything outstanding after Round 2, so items cannot be
lost between the five documents that own them.
**Predecessor:** [2026-11-08-phase5-round2-single-player.md](testing-logs/2026-11-08-phase5-round2-single-player.md)
**Next run:** [phase-5-round-3-guide.md](phase-5-round-3-guide.md)

> **How to use this file.** Every row points at the document that owns the item. That
> document is authoritative; **if the two disagree, the owner wins and this file is
> wrong.** Do not record a finding, decision, or status here first — record it in the
> owning document, then update the pointer. Nothing here may be implemented on the
> strength of its presence in this list.

---

## 1. Waiting on a product decision

These change source if accepted, so under `docs/versioning.md` §3.5 each takes a version.

| Item | Owner | Cost | Note |
|---|---|---|---|
| A world-less client stays `ready`, so the overlay never fades | [troubleshooting §4.8](troubleshooting.md) | Mod/host source → version bump | User has stated the requirement: the overlay **should** fade on the stale timer. Confirmed over 11 minutes in Round 2 |
| A persistence failure reports `invalid_request` | [troubleshooting §7.1](troubleshooting.md) | Source → version bump; a new code may need protocol v2 | The code means "semantically invalid request". The host refused correctly; only the attribution is wrong. Found via an environment incident, not normal use |
| Proposal F — ephemeral reordering of pinned quests | [proposals §6.2.1](proposals.md) | Needs a design decision first | **Requested, not decided.** Blocked on: where does an order live that outlives the host but not the game? |

## 2. Deferred by explicit user decision

| Item | Owner | Note |
|---|---|---|
| The dashboard preview never fades while `/overlay` does | [troubleshooting §4.7](troubleshooting.md) | You asked to ponder this in depth later. **Fix not requested.** Both options are recorded; they are not equally balanced |
| No chapter pins configured, and they cannot be set before a client connects | [troubleshooting §4.6](troubleshooting.md) | Expected behaviour, not a defect. Left alone for Round 2 by decision. It is the reason A3 and B4 are not observed |

## 3. Approved, not designed

| Item | Owner | Note |
|---|---|---|
| Proposal G — drag-and-drop feedback in the dashboard | [proposals §6.2.2](proposals.md) | **Approved 2026-11-08 as planned work.** No design, no slot, no owner. Two open questions: drag-ghost mechanics; whether `/control` reuses the overlay's motion tokens. Frontend only — no mod version impact |

## 4. Tooling defects, unfixed

All tooling-only: no version impact (`docs/versioning.md` §3.5). Each one makes a
**report** wrong, which is why they matter more than their size suggests.

| Item | Owner | Effect |
|---|---|---|
| `read-capture` counts chapter-ID duplicates across snapshots | [troubleshooting §8.1](troubleshooting.md) | A clean 1,178-snapshot dump fails `unique-chapter-ids` with 64,735 false duplicates. A real mapper defect would be masked |
| `watch` cannot span a host restart | [troubleshooting §8.2](troubleshooting.md) | The final report claimed four failures for events that had demonstrably happened. Read one watcher per host lifetime |
| `check-environment` exits 1 while printing `READY` | [troubleshooting §8.3](troubleshooting.md) | "Ready with warnings" reads as failure to any caller checking for non-zero |

## 5. Unexplained

| Item | Owner | Note |
|---|---|---|
| The adapter reports 55 chapters; the pack has 54 parsable chapter files | [troubleshooting §4.3](troubleshooting.md) | Open since 2026-11-07. Round 2 showed `welcome.snbt` resolving as a normal chapter at `order=0` with real progress, which favours "the ad-hoc parser missed a shape" over "FTB synthesises a chapter" — it does not settle it. A dump comparison does |

## 6. Verification obligations — Round 3

Full procedure, pre-flight and evidence rules: [phase-5-round-3-guide.md](phase-5-round-3-guide.md).

| Obligation | Guide ref | Blocking `AGENTS.md` §7? |
|---|---|---|
| Chapter pins end to end (A3) | §3.2 R1 | — |
| Chapter completion from `status`, not `progress == 100` (B4) | §3.2 R2 | — |
| Optional quests do not distort chapter progress | §3.2 R3 | — |
| Quest-data reload → fresh snapshot (C3) | §3.2 R4 | — |
| Team change → fresh snapshot | §3.2 R5 | — |
| The heartbeat-stale timer (socket open, heartbeats stopped) | §3.2 R6 | — |
| A regenerated token reaches the client (E2's live half) | §3.2 R7 | — |
| **The remote-server case** | §3.3 | **Yes** — the only §7 item still open |

**Already closed by Round 2 — do not re-run:** see
[round 3 guide §2](phase-5-round-3-guide.md), which lists the thirteen checks and their
evidence.

## 7. Documentation debt

| Item | Note |
|---|---|
| Align `ftb-quests-integration.md` §10 and `phase-5-verification-guide.md` §8 to "remote server" | Both still say "multiplayer" in headings. `AGENTS.md` §7, the plan and the round 2/3 guides are already aligned. Historical records (`phase-4-plan.md`'s old test matrix, `architecture.md`'s descriptive prose) are deliberately **not** rewritten |
| Sanitise a fixture from Round 2's dump | `docs/phase-5-plan.md` §10 item 3. Round 2 produced the first live capture (1,178 snapshots, 10.1 MB) and it was never sanitised or committed. Dumps contain real world and team identifiers and stay in the git-ignored `.questbridge/` |
| The round 2 guide's §5 "pin chapters after the client connects" vs the verification guide's §3 "pin before launching" | Only the former is achievable. Recorded in the round 3 guide's §3.1 rather than fixed, because the older guide is superseded by practice |

## 8. Repository hygiene

| Item | Note |
|---|---|
| 2 Dependabot vulnerabilities on `master` (1 moderate, 1 low) | Surfaced by the push of `108d6d9`. Not investigated. A dependency change is a source change with a version consequence, so it needs a decision rather than a drive-by fix |

## 9. Not on this list, deliberately

Recorded so their absence is a decision rather than an oversight:

- **Multiplayer as a feature.** Out of scope. Remote servers are in scope —
  `AGENTS.md` §5 and §7, decided 2026-11-08.
- **Auto-pin tracker reconstruction.** Deferred product scope; only the ID `1` filter is
  required (`docs/protocol.md` §8.8).
- **Protocol v2 items.** Tracked in [protocol-v2-tracker.md](protocol-v2-tracker.md). v2 is
  not approved; nothing there may be built on the strength of its presence.
- **Token expiry or rotation.** Settled design, not defects
  (`docs/local-authentication.md` §1 R3, §2.0).
- **§8.4 the confined-host environment trap.** Not a product defect and no code change
  implies one; the remedy is operational (start the host from a normal shell).
