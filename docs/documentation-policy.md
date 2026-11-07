# QuestBridge Documentation Policy

This policy preserves project continuity across independent agent sessions without turning every historical note into a permanent instruction.

## What belongs in the repository

Record durable information that a future contributor needs to make a correct decision or continue work:

- User feature requests, including whether they are accepted, declined, or deferred. A request is not an implementation decision.
- Product and architecture decisions, including the reason and important alternatives considered.
- Verified technical findings, with the command, source, log, or observation that supports them.
- Defects, workarounds, compatibility traps, and unresolved assumptions.
- Phase scope, acceptance criteria, and what remains incomplete.

Do not turn an assistant suggestion into a requirement without user acceptance. Do not record every trivial code edit in prose; the diff and commit history already describe implementation changes.

## Minimum quality for a durable record

A useful decision or finding should let someone who was not present act on it. Include:

1. **Status:** requested, proposed, accepted, declined, deferred, verified, suspected, fixed, or superseded, as applicable.
2. **Reason:** why the decision was made or why the finding matters.
3. **Evidence:** how it was established. Separate observed facts from inference.
4. **Boundary:** what the evidence does not establish.
5. **Open work:** unresolved questions, dependencies, or next verification.
6. **Origin:** source and date for user requests or session-specific findings.

A conclusion without its evidence is not a verified finding. A run log should link to durable troubleshooting knowledge rather than duplicating it.

## Canonical locations

| Information | Canonical location |
|---|---|
| Project invariants and agent workflow | `AGENTS.md` |
| Architecture and ownership | `docs/architecture.md` |
| Protocol contract | `docs/protocol.md` |
| FTB API behavior and limitations | `docs/ftb-quests-integration.md` |
| Chapter pin behavior | `docs/chapter-pinning.md` |
| Authentication and local security | `docs/local-authentication.md` |
| Frontend behavior | `docs/web-frontend.md` |
| Build, test, and run procedures | `docs/development.md` |
| Version policy | `docs/versioning.md` |
| Current phase and acceptance criteria | Relevant `docs/phase-*-plan.md` |
| Durable defects and workarounds | `docs/troubleshooting.md` |
| Individual verification session | `docs/testing-logs/` |
| Awaiting product/architecture decision | `docs/proposals.md` |
| Future protocol requirements | `docs/protocol-v2-tracker.md` |

If a canonical document does not exist, confirm the repository's current structure before creating it. Do not create parallel documents for the same subject.

## Documentation garbage collection

Review documentation when editing it, during phase transitions, or when multiple agents report conflicting instructions. Do not run a disruptive cleanup merely to reduce a line count.

1. **Consolidate duplicates.** Keep one authoritative statement. Replace copies elsewhere with a short pointer.
2. **Supersede explicitly.** Retain material that explains a meaningful past decision, but mark it superseded and link to the current rule.
3. **Separate evidence from instructions.** Move one-off command output and session narratives to testing logs. Keep reusable causes, constraints, and workarounds in the owning technical document.
4. **Demote stale operational detail.** Machine-specific observations and temporary workarounds should not remain global agent instructions unless they still affect routine work.
5. **Retire carefully.** Before archiving or removing material, search references, preserve unique rationale/evidence, and leave a pointer to the replacement where useful.
6. **Resolve conflicts.** Do not leave two active documents contradicting each other. Identify the owner, verify the current behavior, and update the superseded source.

The goal is not the fewest possible lines. The goal is a small active working set with a complete, navigable history.

## Commit history

Every commit must include an imperative subject and a body. The body should state the concrete change and why it was made, including the rejected alternative when a decision was involved. Do not use commit messages as a substitute for updating the canonical document.
