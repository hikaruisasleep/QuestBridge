# Re-submitted Proposals

**Status:** Proposal A approved and applied; Proposal C adopted with Phase 0 and Phase 1 applied and Phase 2 planned; Proposal D applied; Proposal B awaiting decision
**Date:** 2026-11-06  
**Context:** These proposals were previously presented during reconnaissance and were deferred or rejected. They are re-submitted here for an explicit decision. Nothing in this document is approved or implemented unless stated.  
**Phase 5 prerequisite:** The target pack is now installed locally as a Prism Launcher instance (ATM10SKY 2.3.1, Minecraft 1.21.1, NeoForge 21.1.250). The Phase 5 exit criterion no longer depends on obtaining a pack installation; it depends on running the adapter against this one. See `docs/ftb-quests-integration.md` sections 1.1-1.3.  

Approved and applied so far:

- NeoForge alignment: `21.1.265` → `21.1.250`.
- Proposal A: the Java project was moved into `minecraft-mod/`.

The remaining proposals are B–D.

---

## 1. Summary of earlier dispositions

| Proposal | Earlier response | Current status |
|---|---|---|
| Move the Java project into `minecraft-mod/` | Rejected; keep the layout as-is | Approved and applied |
| Cookie-after-token-redirect authentication for OBS and dashboard | Deferred; leave other architectural choices as-is | Re-submitted |
| Phased implementation order, protocol/mock/host/dashboard before the adapter | Deferred | Re-submitted |
| Repository hygiene: `.gitignore`, untrack `.gradle/` and `build/`, pin npm, add FTB Maven repositories and exact dependencies | Deferred as part of the broader plan | Applied |
| Align NeoForge to `21.1.250` | Approved | Applied |

The working documents now mark Proposal A as applied, Proposal C as adopted with Phase 0 applied, Proposal D as applied, and Proposal B as pending review rather than settled.

---

## 2. Proposal A — Move the Java project into `minecraft-mod/`

**Status:** Approved and applied.

### Proposal

Move the existing NeoForge project out of the repository root into a dedicated directory:

```text
questbridge/
├── package.json
├── .gitignore
├── packages/
│   ├── protocol/
│   ├── host/
│   └── mock-publisher/
├── apps/
│   └── web/
├── minecraft-mod/
│   ├── build.gradle
│   ├── gradle.properties
│   ├── settings.gradle
│   ├── gradlew
│   └── src/
├── docs/
└── scripts/
```

The Java package name (`xyz.jxcb.ftbquestoverlay`), mod ID (`questbridge`), mod name, and source files remain unchanged. This is a directory move, not a rename.

The diagram shows the planned `apps/web` name. The Svelte scaffold currently lives at `apps/web-app/` (moved there in commit `8807147`); `apps/web` is not the current path.

### Rationale

- `AGENTS.md` defines `minecraft-mod/` as a separate top-level component.
- It creates a hard filesystem boundary between the Java adapter and the TypeScript workspace.
- It prevents Gradle and npm build outputs, lockfiles, and tooling from sharing the repository root.
- It makes the “Java adapter must not know about Svelte/OBS” boundary visible in the layout.
- It allows the Java build to be opened, built, and version-pinned independently.

### What happened earlier

The earlier response was:

> Keep the layout as-is.

At that time `build.gradle`, `gradle.properties`, `gradlew`, and `src/` remained at the repository root. The proposal was later approved and applied; those files now live under `minecraft-mod/`.

### Applied changes

- Moved the Gradle wrapper and Java sources into `minecraft-mod/`.
- Updated repository documentation and build commands.
- `.gitignore` patterns already match nested Gradle output.
- No Java package changes.
- Git history was preserved by using file moves rather than delete-and-recreate.
- `./gradlew compileJava` succeeds from `minecraft-mod/`.

### Impact if not adopted

- The root-level Java project would have remained the accepted exception.
- Root-level Gradle and npm files would coexist, which is workable but less isolated.

### Recommendation

Applied. The separation matches the documented architecture and reduces accidental coupling. The move was mechanical and did not change Java code.

---

## 3. Proposal B — Cookie-after-token-redirect authentication

### Proposal

Keep the host bound exclusively to loopback and use three separate random tokens:

```text
overlayToken    read-only overlay access
controlToken    dashboard read/write access
minecraftToken  Minecraft publisher access
```

Browser flow:

1. OBS or the user opens `/overlay?token=<overlayToken>` or `/control?token=<controlToken>`.
2. The host validates the token.
3. The host sets an `HttpOnly`, `SameSite=Strict` cookie scoped to the relevant role.
4. The host redirects to the clean URL without the token.
5. The page’s WebSocket authenticates using the cookie.

Minecraft flow:

- The adapter connects with a dedicated bearer token or header.
- It does not use browser cookies.
- Native connections without an `Origin` header are allowed only with the Minecraft token.

Additional rules:

- Bind only to `127.0.0.1`.
- Validate the HTTP `Host` header against `127.0.0.1` and `localhost`.
- Restrict WebSocket origins.
- Read-only overlay.
- Dashboard-only configuration mutations.
- Validate every message.
- Enforce message-size and rate limits.
- No filesystem, shell, or arbitrary HTTP endpoints.
- No tokens in frontend bundles, rendered HTML, or logs.

### Rationale

- OBS can load a tokenized URL once and then use a clean URL.
- Tokens do not need to be embedded in the Svelte bundle.
- Overlay and dashboard permissions remain separate.
- The Minecraft publisher is authenticated independently from browsers.
- The strategy works with OBS Browser Source and normal Chromium.

### What was deferred

The earlier response was:

> Leave everything else as-is, for now.

No authentication implementation exists yet. `docs/architecture.md` now records this strategy as Proposal B, pending review, rather than as a final design.

### Impact if adopted

- Implement token generation and persistence with mode `0600`.
- Implement the token-to-cookie redirect.
- Implement role checks on WebSocket connections.
- Add tests for missing, invalid, and cross-role tokens.
- Add origin and `Host` header tests.

### Impact if not adopted

- An alternative authentication design must be chosen before the host is implemented.
- The overlay and dashboard still require some local protection, because any local process could otherwise read or mutate state.

### Recommendation

Adopt. It satisfies the local-only security requirements without exposing credentials in the frontend.

---

## 4. Proposal C — Phased implementation order

### Proposal

Implement in this order:

### Phase 0 — Baseline and repository hygiene

- Add `.gitignore`.
- Untrack `.gradle/` and `build/`.
- Pin the npm and Node versions for the workspace.
- Add FTB Maven and Architectury repositories.
- Add exact FTB Quests, FTB Teams, and FTB Library dependencies.
- Keep the three reconnaissance documents.

**Exit criterion:** clean workspace, npm install works, Java compiles against exact pack dependencies.

### Phase 1 — Shared protocol and mock publisher

**Status:** Applied. `packages/protocol` and `packages/mock-publisher` are implemented and tested.

- Create `packages/protocol`.
- Define the versioned envelope, IDs, chapter/quest/task models, snapshots, updates, configuration, and errors.
- Add Zod validation and protocol tests.
- Create synthetic deterministic fixtures.
- Implement mock publisher scenarios for the full FTB lifecycle.

**Exit criterion:** protocol tests pass; mock scenarios reproduce the full lifecycle without Minecraft.

### Phase 2 — Host core

**Status:** Planned, not started. See `docs/phase-2-plan.md`.

- Configuration store with atomic persistence and migrations.
- State store and revision tracking.
- Chapter resolver with unresolved entries.
- Pin/unpin/reorder validation.
- WebSocket roles, sequence numbers, resync, heartbeats, and stale detection.
- HTTP static server and local authentication.
- Host tests, including startup with no Minecraft data.

**Exit criterion:** host and mock publisher work end-to-end; configuration survives restart; duplicates and more than five pins are rejected.

### Phase 3 — Svelte overlay and dashboard

- `/overlay` and `/control`.
- Chapter catalog search, pin/unpin, reordering, and live preview.
- Display settings.
- Shared selectors.
- Tests for empty state, one through five pins, unresolved chapters, completed/locked chapters, stale/disconnected states, and task progress.

**Exit criterion:** OBS Browser Source displays the overlay with transparency and correct state; refresh restores state.

### Phase 4 — Minecraft adapter

**Status:** Stage 4A implemented and verified; Stage 4B–4F planned. Phase 2 is now planned, and Phase 3 remains deferred. See `docs/phase-4-plan.md`.

- Client-only NeoForge mod.
- Isolated FTB adapter interface and exact-version implementation.
- Snapshot capture on the client thread.
- Automatic pin filtering.
- Chapter, quest, and task mapping.
- Background serialization and WebSocket transmission.
- Event hooks plus two-second reconciliation.
- Reconnection with a fresh snapshot.

**Exit criterion:** mod compiles against exact ATM10 TTS dependencies; snapshots validate against the shared protocol; no FTB access occurs off the client thread.

### Phase 5 — Real ATM10 TTS integration

- Single-player verification.
- Multiplayer verification.
- Five initial chapters.
- Manual pins and automatic-pin exclusion.
- Task counts and numeric progress.
- Completion-driven pin removal (FTB unpins a completed quest).
- Team changes, quest reloads, world changes, disconnects, and reconnects.
- Record a sanitized real snapshot fixture.
- Update documentation with runtime results.

**Exit criterion:** the Definition of Done items that require a real client are actually verified.

### Phase 6 — Hardening and release

- Token, origin, `Host`, and message-limit tests.
- Logging and redaction review.
- Error states and recovery.
- README, troubleshooting, and OBS setup documentation.
- Full build and test pass.

**Exit criterion:** installation, known limitations, and manual verification instructions are documented.

### Rationale

- The protocol is the contract between all components.
- The mock publisher proves the lifecycle before Minecraft is involved.
- The host and dashboard can be completed and tested without a live client.
- The adapter is the highest-risk component and is isolated behind a stable protocol.
- Real integration is verified before release rather than assumed from mock success.

### What was deferred

The earlier response was:

> Leave everything else as-is, for now. Prioritize writing the documents.

Phase 0 (baseline and repository hygiene) is applied, and Phase 1 (shared protocol and mock publisher) is implemented. Phase 4 was started first by explicit product decision: Stage 4A is implemented and verified in the live client, and Stage 4B–4F remain planned. Phase 2 (host core) is now planned in `docs/phase-2-plan.md`; Phase 3 (Svelte UI) remains deferred. Phases 5–6 have not started. The three documents are now written.

### Impact if adopted

- Implementation begins with Phase 0 and Phase 1.
- The mock publisher is built before the Minecraft adapter.
- The Java adapter is not required to test the host or frontend.

### Impact if not adopted

- Implementation order remains undecided.
- Starting with the Minecraft adapter would increase risk because the protocol and presentation layers would be unproven.

### Recommendation

Adopt. The order matches `AGENTS.md` and keeps the highest-risk integration behind a tested protocol.

---

## 5. Proposal D — Repository hygiene and build dependencies

**Status:** Applied; npm and Node are pinned and the exact FTB build dependencies are declared and verified.

This was part of the deferred Phase 0 proposal.

### Proposal

1. Add a root `.gitignore` covering at least:
   - Gradle build outputs.
   - IDE files.
   - Node modules.
   - npm cache and debug logs.
   - Vite build output.
   - Local QuestBridge configuration and tokens.
   - Recorded snapshots containing server-specific data, until sanitized.
2. Untrack `.gradle/` and `build/`.
3. Pin the npm and Node versions for the workspace.
4. Add the FTB Maven and Architectury repositories.
5. Declare exact compile dependencies:
   - FTB Quests `2101.1.30`
   - FTB Teams `2101.1.10`
   - FTB Library `2101.1.35`

### Verified current state

- The root `.gitignore` exists.
- `minecraft-mod/.gradle/` and `minecraft-mod/build/` are ignored and no longer tracked.
- npm is the package manager; pnpm is not used.
- The Java project is in `minecraft-mod/`, compiles against NeoForge `21.1.250`, and declares the exact FTB dependencies; `./gradlew dependencies --configuration compileClasspath` resolves them.
- The root `package.json` declares npm workspaces (`packages/*`, `apps/*`) and pins Node `24.22.1` and npm `11.19.1` via `engines` and `.nvmrc`.
- The Svelte scaffold is at `apps/web-app/`; `AGENTS.md` section 5 and `docs/architecture.md` now use that path.

### Rationale

- Tracked build outputs create noisy diffs and accidental commits.
- A missing `.gitignore` risks committing local tokens or generated configuration.
- Pinning the package manager keeps installs reproducible.
- Exact FTB dependencies are required before adapter code can compile.
- The adapter must compile against the same versions installed in ATM10 TTS 2.3.1, not the latest standalone releases.

### What was deferred

This was folded into the earlier “leave everything else as-is” response. No cleanup or FTB dependency declarations have been applied.

### Impact if adopted

- A repository cleanup commit is required.
- Java compile dependencies are pinned to the target pack.
- Future build outputs stop appearing in Git status.

### Impact if not adopted

- Build artifacts and local configuration remain at risk of being committed.
- Adapter implementation cannot compile against FTB APIs without adding dependencies later.

### Recommendation

Adopt. This is low-risk prerequisite work for any implementation phase.

---

## 6. Decisions requested

| ID | Proposal | Recommendation | Decision |
|---|---|---|---|
| A | Move Java project to `minecraft-mod/` | Adopt | Approved and applied |
| B | Cookie-after-token-redirect authentication with three roles | Adopt | Pending |
| C | Phased implementation order | Adopt | Adopted; Phase 0 applied |
| D | Repository hygiene and exact FTB build dependencies | Adopt | Applied |

A decision can be:

- **Adopt** — apply as proposed.
- **Adopt with changes** — specify changes.
- **Keep deferred** — leave the current state and revisit later.
- **Reject** — do not apply.

Proposal A has already been applied and `docs/architecture.md` reflects the new layout. Proposal C is adopted and Phase 0 is applied. Proposal D is applied: npm and Node are pinned and the exact FTB build dependencies are declared. Proposal B remains pending; if adopted, its security section becomes the implemented design rather than a recommendation.
