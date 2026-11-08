# QuestBridge Agent Guide

QuestBridge is a local companion for FTB Quests. It reads progression from the running Minecraft client and presents selected chapters and pinned objectives in an OBS Browser Source.

**Target:** ATM10 To The Sky, Minecraft 1.21.1, NeoForge.  
**Stack:** Java/Gradle mod, Node.js/TypeScript host, Svelte 5/Vite frontend, npm workspaces.  
**Deployment:** Local desktop application.

This file contains project invariants and agent workflow. Detailed specifications and verified findings live in `docs/`. Read the documents relevant to the work; do not load the entire documentation archive by default.

## 1. Product invariants

1. **FTB Quests owns quest data and progression.** QuestBridge observes and presents it; it does not complete quests, claim rewards, or replace the quest book.
2. **Chapter pins belong to QuestBridge.** The dashboard lets the user select, order, and pin up to five discovered chapters. Never auto-select, auto-fill, or silently substitute chapters. Preserve unresolved chapter IDs.
3. **Quest pins belong to FTB Quests.** The objective list uses the player's manually pinned quests only. Do not add a second quest-pinning interface. Exclude automatic pins unless a future, explicitly approved feature changes this rule.
4. **Progress belongs to FTB Quests.** Prefer native progress calculations. Never invent progress; unavailable values are `null`, not zero. Preserve optional-task semantics.
5. **Client-only integration.** Read synchronized in-memory data from the Minecraft client. Support both an integrated (single-player) server and a remote server the player connects to. Remote servers are in scope; *multiplayer as a verification target is not* (see §7). Do not require a server mod, server filesystem access, Pterodactyl, SFTP, cloud services, accounts, or a remote database.
6. **Keep boundaries intact.** The Java adapter reads FTB state and publishes normalized data. The host owns local configuration, protocol validation, and state distribution. Svelte renders the UI. The frontend must not parse FTB data or recalculate progression; the host must not depend on Minecraft libraries.
7. **Keep the overlay minimal and chroma-keyable.** Use the dashboard-selected solid green or blue key background; no UI colour may fall within the active key colour family. No external fonts, textures, or decorative assets.
8. **Local-only host.** Bind to `127.0.0.1`, never `0.0.0.0`. Preserve the accepted authentication risks documented in `docs/local-authentication.md`; changing them requires an explicit product decision.

## 2. Read the right documentation

Read `docs/architecture.md` when changing component boundaries or data ownership. For narrower work, use the owning specification:

| Work area | Read first |
|---|---|
| FTB APIs, synchronization, pins, progress | `docs/ftb-quests-integration.md` |
| Message schemas, sequencing, compatibility | `docs/protocol.md` |
| Host, mock publisher, component boundaries | `docs/architecture.md`, `docs/protocol.md` |
| Overlay, dashboard, UI states | `docs/web-frontend.md` |
| Chapter selection and persistence | `docs/chapter-pinning.md` |
| Authentication, tokens, origins | `docs/local-authentication.md` |
| Build, test, run commands | `docs/development.md` |
| Mod version changes | `docs/versioning.md` |
| Current milestone and acceptance criteria | The active `docs/phase-*-plan.md` |
| Live findings and known workarounds | `docs/troubleshooting.md`, relevant `docs/testing-logs/` entry |
| Proposed product changes | `docs/proposals.md` |
| Features requiring a future protocol version | `docs/protocol-v2-tracker.md` |

If a referenced document is missing, stale, or contradicts another source, report the gap and identify the conflict. Do not silently reconstruct an authoritative specification from memory or from this guide.

## 3. Technical constraints

- Use the exact Minecraft, NeoForge, FTB Quests, and FTB Teams versions in the target ATM10 TTS instance. Never assume the latest standalone FTB release is compatible.
- Never invent FTB API signatures. Inspect the installed JAR/source/bytecode and record what was verified in `docs/ftb-quests-integration.md`.
- Keep IDs as opaque strings. Do not use display names as identifiers.
- Treat team progression and player-specific pin selection as separate data until the installed FTB implementation proves otherwise.
- Distinguish manual pins from automatic tracking using verified source behavior. If they cannot be distinguished reliably, document the limitation rather than guessing.
- Prefer event-driven updates with periodic reconciliation. Do not serialize and transmit a full snapshot every tick. Access Minecraft/FTB state on the correct game thread; perform network I/O without blocking it.
- Validate protocol messages and configuration. Reject unsupported protocol versions and invalid chapter-pin operations.
- Preserve user configuration across game, host, world, and pack restarts. Missing catalog entries remain unresolved; never delete or replace them silently.
- Do not implement future extensions or non-goals without explicit approval. Protocol v2 is not approved merely because an item appears in its tracker.

### Toolchain note

Node and npm are managed by fnm. The project pins Node `24.22.1` and npm `11.19.1` through `.nvmrc` and `package.json`. In a fresh PowerShell shell, initialize fnm before use:

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm use 24.22.1
```

If `node` is not on `PATH`, first check shell initialization and the pinned fnm installation. Do not reinstall Node, switch package managers, or silently use another version. See `docs/development.md` for the full environment procedure.

## 4. Session workflow

### Start

1. Read this file and the relevant component/phase documents.
2. Inspect the repository, current branch, `git status`, and recent commits before editing.
3. Preserve all existing uncommitted work. Never discard or overwrite changes you did not make.
4. Start each coding session on a new branch from the current base branch. Do not work directly on `main`/`master` or reuse an old session branch unless the user asks.
5. Check `docs/versioning.md` before changing mod source or version metadata. Follow its conversation-level version policy; do not bump versions for documentation-only or testing-only work.
6. Establish the task's scope and acceptance criteria. Do not expand it with adjacent features or speculative refactors.

### During work

1. Make small, coherent, reviewable changes. Keep protocol definitions centralized and component dependencies one-way.
2. Test each meaningful change with the narrowest relevant test/build, then run broader checks when appropriate.
3. Never claim a build, test, runtime behavior, or visual result that was not actually observed.
4. Distinguish **implemented**, **tested**, and **verified in a real Minecraft client**. Mock success is not proof of FTB compatibility.
5. Record user requests as requests, not approved decisions. Record accepted, declined, and deferred decisions with their status. Assistant-generated suggestions are not requirements unless the user accepts or asks to preserve them.
6. Record durable findings in the owning document in the same session. Include the reason, evidence and how it was obtained, what the evidence does not prove, and remaining questions. Put one-off execution narratives in `docs/testing-logs/`; put reusable symptoms, causes, and workarounds in `docs/troubleshooting.md`.
7. When the user asks only to record or investigate a defect, do not fix it without permission. Correct earlier inaccurate claims openly and in the relevant record.

### Git and commits

- Commit each major, independently reviewable unit when practical. Do not batch unrelated changes.
- Every commit must have an imperative subject **and a body** explaining what changed and why. A subject-only commit is not acceptable.
- Run relevant tests before committing when practical. Never rewrite history or force-push unless explicitly asked.
- Do not commit generated output, dependency caches, secrets, tokens, or local configuration.

### End of session

Ensure a fresh agent can continue from the repository alone. Report:

- What changed and the important decisions.
- Tests/builds actually run and their results.
- What is implemented, tested, and verified, separately.
- Known limitations, unresolved questions, and manual verification still needed.
- Documentation updated and any explicitly tracked documentation debt.

Do not mark acceptance criteria complete without evidence. Leave no unexplained uncommitted work unless the user asks you to stop.

## 5. Live Minecraft verification

Real-client verification is collaborative. The agent may run the host and inspect its output; the user operates the game.

- Give the user one in-game action at a time.
- Treat the user's on-screen observation as evidence. Host state alone cannot prove what appeared in the game or overlay.
- A disagreement between observed UI and reported state is a finding. Record it before proposing a fix.
- Never claim an in-game or visual check was passed unless the user actually performed it.

The detailed procedure belongs in `docs/phase-5-verification-guide.md` and the active phase-5 plan.

## 6. Documentation lifecycle

Documentation is the project's cross-session memory. Keep that memory, but do not make every historical detail an active instruction.

Use the owning document and the lifecycle rules in `docs/documentation-policy.md`:

- **Active:** current requirement, decision, or operational constraint.
- **Superseded:** retained for history, explicitly linked to its replacement.
- **Historical:** evidence from a particular run; useful when investigating, not a default instruction.
- **Obsolete:** no longer applicable; retire only after checking references and preserving any evidence or rationale worth keeping.

Update the canonical entry instead of appending another copy. When changing a requirement, update dependent docs or mark the discrepancy explicitly. Do not delete decision rationale, verification evidence, or rejected requests merely to reduce line count.

## 7. Definition of done

The release is not complete until the monorepo and host work, mock mode works, the dashboard persists up to five chapter pins, the overlay renders chapter and manual quest progress, and the client-only NeoForge integration is built and verified **against the actual ATM10 TTS instance, in single-player and on a remote server**. Automatic pins must be excluded, reconnect behavior must be verified, and OBS chroma keying must work. Keep the detailed checklist and evidence in the active phase plan; mock-only success is not release completion.

> **"Multiplayer" is not in scope; remote servers are. Decided 2026-11-08.**
> This section previously required verification "in both single-player and
> multiplayer". The word carried assumptions the product does not have: it suggests
> multiplayer *features* (other players' progression, team-relative behaviour, a
> server-side component) that QuestBridge deliberately does not build. What the
> product actually must do is work when the player is connected to a **remote
> server** that has the pack installed, exactly as it works on an integrated server —
> reading the same synchronized client state, with **no server-side mod and no server
> filesystem access** (invariant 5).
>
> So the obligation is: the same behaviour on an integrated server and on a remote
> server. It is **not**: multiplayer-specific behaviour, team semantics beyond what
> FTB syncs, or any interoperability with other players' clients.
>
> Verification of the remote-server case is still outstanding — it was not run in
> Round 2 (2026-11-08), which was single-player only. It is a release obligation, not
> a deferred item.

## Product principle

**Chapter pins belong to QuestBridge. Quest pins belong to FTB Quests. Progress belongs to FTB Quests.**
