# Re-submitted Proposals

**Status:** Proposal A approved and applied; Proposal C adopted with Phases 0, 1, 2, and 3 applied; Proposal D applied; Proposal B **adopted and simplified to two tokens on 2026-11-06**
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
| Cookie-after-token-redirect authentication for OBS and dashboard | Deferred; leave other architectural choices as-is | Adopted, then simplified to two tokens |
| Phased implementation order, protocol/mock/host/dashboard before the adapter | Deferred | Re-submitted |
| Repository hygiene: `.gitignore`, untrack `.gradle/` and `build/`, pin npm, add FTB Maven repositories and exact dependencies | Deferred as part of the broader plan | Applied |
| Align NeoForge to `21.1.250` | Approved | Applied |

The working documents now mark Proposal A as applied, Proposal C as adopted with Phase 0 applied, Proposal D as applied, and Proposal B as adopted and simplified. The normative design is `docs/local-authentication.md`.

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

**Status:** Adopted on 2026-11-06, then simplified the same day. The normative design is `docs/local-authentication.md`; this section records the proposal as submitted and the decision taken.

> **Superseded in part.** The proposal below describes three tokens and a cookie-after-token-redirect flow. The adopted design uses **two tokens and no cookies**; the browser role split and the cookie layer were dropped. Read the decision section at the end of this proposal for the design that applies.

### Proposal (as submitted)

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
- The overlay and dashboard are distinguished by token and by route.
- The Minecraft publisher is authenticated independently from browsers.
- The strategy works with OBS Browser Source and normal Chromium.

### Decision — 2026-11-06

**Adopted, then simplified the same day.** Loopback binding and the overall token-based approach stand as proposed. The three-token cookie design was replaced on review, because the project's accepted risk R1 makes the two browser tokens interchangeable and therefore redundant.

The adopted design, normative in `docs/local-authentication.md`:

- **Two tokens**, one per real trust boundary: `browserToken` (read state; declare either browser role) and `minecraftToken` (publish progression).
- **No cookies and no login redirect.** The token travels in the query string and is validated once, on the WebSocket upgrade.
- **One authentication checkpoint.** Page requests are ungated; the static application shell is served unconditionally so the real UI can render a legible authorization-failure message instead of a bare `401` body.

Revisions folded in:

1. **Token-file recovery.** `tokens.json` is backed up and regenerated when corrupt, unlike `config.json`, which fails closed and is never overwritten. Tokens are regenerable; chapter pins are not.
2. **Authorization failure states.** The overlay must render a visible, actionable state rather than an empty frame when the socket cannot be established.
3. **Simplification.** The overlay/control token split and the cookie layer were removed.

Simplification rationale, and why the count lands at two rather than one. Note that the **two routes remain** — `/overlay` for OBS and `/control` for the user are a product requirement in `AGENTS.md` §10 and are independent of token count:

| Credential | Implementation cost | Security benefit | Verdict |
|---|---|---|---|
| overlay/control split | Extra token and per-role cookie names; adds a **misleading appearance** of a boundary R1 does not enforce | None — R1 makes the two interchangeable | Dropped |
| `minecraftToken` | None — machine-to-machine, configured once | Real — stops any local process from injecting fabricated quest data | Kept |
| `browserToken` | One value to generate and print | Real — under R2 an unrelated local page passes the origin check | Kept |

The decisive argument against the role split is not inconvenience but honesty: a "read-only overlay token" implies a protection that R1 does not provide, which changes user behaviour without changing risk. See `docs/local-authentication.md` §1.2.

Accepted as intended (single-user, loopback-only product; ease of use prioritised over defence in depth):

1. The browser token does not distinguish roles. It may declare either `overlay` or `control`. The overlay/control split is a UI convention, not a security boundary.
2. Origin allowlisting matches the loopback hostname only and ignores the port.

Both are recorded as accepted risks R1 and R2 in `docs/local-authentication.md` §1 and must not be tightened without an explicit product decision.

### What was deferred

The earlier response was:

> Leave everything else as-is, for now.

No authentication implementation exists yet. `docs/architecture.md` previously recorded this strategy as Proposal B, pending review. It is now adopted, simplified, and specified in `docs/local-authentication.md`.

### Impact of adoption

- Implement token generation and persistence with mode `0600`.
- Implement token validation on the WebSocket upgrade.
- Implement role enforcement on WebSocket connections, and document R1.
- Add tests for missing and invalid tokens, for cross-token rejection, and for overlay mutation rejection.
- Add origin and `Host` header tests, including the accepted any-port loopback rule.
- Add a `--print-urls` command and the token-file recovery path.
- Add distinguishable `401`/`403` responses.

### Impact if not adopted

- An alternative authentication design would be required before the host is implemented.
- The overlay and dashboard would remain unprotected, because any local process could otherwise read or mutate state.

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

**Status:** Implemented (milestones 2A–2G). See `docs/phase-2-plan.md`. The only
final acceptance item — that the host can serve the Svelte routes — is now met;
`/overlay`, `/control`, and `/` are served from the static build.

- Configuration store with atomic persistence and migrations.
- State store and revision tracking.
- Chapter resolver with unresolved entries.
- Pin/unpin/reorder validation.
- WebSocket roles, sequence numbers, resync, heartbeats, and stale detection.
- HTTP static server and local authentication.
- Host tests, including startup with no Minecraft data.

**Exit criterion:** host and mock publisher work end-to-end; configuration survives restart; duplicates and more than five pins are rejected. Met on 2026-11-06.

### Phase 3 — Svelte overlay and dashboard

**Status:** Implemented. The three routes exist in a static build the host
serves, with results and known limitations in `docs/phase-3-plan.md` §14. The
normative requirements are `docs/web-frontend.md`.

- `/overlay` and `/control` as two routes in one statically built app.
- Chapter catalog search, pin/unpin, reordering, and live preview.
- Display settings.
- Shared selectors.
- Explicit disconnected and unauthorized presentations — never a blank frame,
  and never controls that appear usable when they cannot work. A stale state is
  deliberately invisible on the overlay; disconnection fades out
  (`docs/web-frontend.md` §3.4).
- Pin/unpin zoom and reflow transitions on the objective list
  (`docs/web-frontend.md` §3.5).
- Tests for empty state, one through five pins, unresolved chapters,
  completed/locked chapters, stale/disconnected states, and task progress.

**Exit criterion:** OBS Browser Source displays the overlay keyed over gameplay with correct state; refresh restores state.

**Scope note:** the dashboard selects **chapters**. Quest pins belong to FTB
Quests and are read-only to QuestBridge; a quest-pinning UI is a non-goal
(`AGENTS.md` §2.4).

### Phase 4 — Minecraft adapter

**Status:** Stage 4A implemented and verified; Stages 4B–4E implemented and verified against the real host. The former 4F is now Phase 5's first test sequence. Phases 2 and 3 are implemented. See `docs/phase-4-plan.md` and `docs/phase-5-plan.md`.

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

Phase 0 (baseline and repository hygiene) is applied, and Phase 1 (shared protocol and mock publisher) is implemented. Phase 4 was started first by explicit product decision: Stage 4A is implemented and verified in the live client, and Stages 4B–4E are implemented and verified against the real host. Phase 2 (host core) is implemented through milestone 2G in `docs/phase-2-plan.md`, and Phase 3 (Svelte UI) is implemented in `docs/phase-3-plan.md`. Phase 5 has started: its verification tooling and operator runbook are in place, but no live run has been performed (`docs/phase-5-plan.md`). Phase 6 has not started. The three documents are now written.

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

## 6. Proposal E — Runtime token discovery and config-load ordering

**Status:** Proposed 2026-11-07. **Not approved. Not implemented.** The user has
explicitly asked that this be recorded rather than built, so the findings below
are documented and the code is untouched.
**Origin:** The first two live Phase 5 sessions. The adapter never published,
because it read its configuration before NeoForge loaded it
(`docs/troubleshooting.md` §2.1). Diagnosing that produced a second question:
where should the adapter get its token, given the host generates it.

### Proposal (as requested)

Have the mod **connect to the transport backend at runtime**, resolving the
token when it needs it rather than once at startup. The stated motivation is
resilience: a token that can differ between runs, and restarts of either the
host or the game mid-session, should not require reconfiguring anything by hand.

### Correction to the motivating premise

**The token does not change between startups.** Verified in
`packages/host/src/auth.ts` `TokenStore.load()`: the host reads `tokens.json` and
**reuses** it. Regeneration happens only when the file is missing, unreadable, or
fails validation.

Verified on the development machine: `tokens.json` was created at 16:55:30 and
its modification time has not moved since, across at least three host starts
(including the 17:19 session). The token has been constant.

So the "different every time" problem does not exist. What exists is narrower:

| Scenario | Behaviour today |
|---|---|
| Host restarts | Token unchanged; adapter reconnects with 1→30 s backoff (verified in 4C/4D) |
| Game restarts | Token unchanged; a new adapter connects normally |
| `tokens.json` deleted, corrupt, or invalid | **Regenerated, silently invalidating every configured client** |

The real defect is the load-order bug, not token instability. The proposal is
still worth considering, but for a different reason than the one that prompted
it, and the record should say so.

### Two independent problems

**E1 — the adapter reads its config before NeoForge loads it (the actual bug).**

```java
// QuestBridge.java
modContainer.registerConfig(ModConfig.Type.CLIENT, QuestBridgeConfig.SPEC); // queues loading
this.client = new QuestBridgeClient();  // reads it immediately
```

`registerConfig` only *schedules* loading. `QuestBridgeClient` is constructed on
the next line and calls `QuestBridgeConfig.resolveMinecraftToken()`, which
catches `IllegalStateException` and returns `""` while the spec is unloaded. The
adapter then concludes "no token, stay idle" permanently.

Evidence from the client log, 2026-11-07:

```text
17:23:13.096  [QuestBridge] no minecraftToken configured; not publishing.
17:23:29.590  ConfigTracker: Failed to load config questbridge-client.toml ... Attempting to recreate
```

Sixteen seconds apart. The documented configuration path cannot work on
`0pre.2`, even with a perfectly valid file.

**E2 — the token is resolved once and frozen.**

`ConnectionController` takes `url` and `bearerToken` as `final` constructor
fields, and `#connect()` uses those fields:

```java
opened = WebSocketConnection.open(url, bearerToken, listener);
```

Every reconnect reuses the value captured at construction. A regenerated token
therefore requires a full Minecraft restart, even though the reconnect path
itself is already robust.

### The API hook, verified

`net.neoforged.fml.event.config.ModConfigEvent` exists in FancyModLoader
`loader-4.0.44.jar` (shipped with NeoForge 21.1.250), with three subclasses:

```text
ModConfigEvent.Loading
ModConfigEvent.Reloading
ModConfigEvent.Unloading
```

`javap` confirms `ModConfigEvent extends Event implements IModBusEvent`, so it
registers on the **mod** event bus — the `IEventBus` the mod constructor already
receives. No new dependency, no reflection, no mixin.

`ModConfigEvent.Loading` is the correct trigger: it fires when the spec becomes
readable, which is exactly the moment the current code fails to wait for.

### Sketch (not a design)

1. Construct the client without starting transport.
2. Register `ModConfigEvent.Loading` and `ModConfigEvent.Reloading` on the mod
   event bus.
3. Start transport from that callback, not from the constructor.
4. Give `ConnectionController` a token *supplier* rather than a token value, and
   call it inside `#connect()`, so each attempt re-resolves.

Token precedence would remain: system property, then environment variable, then
discovered file, then the configured value.

If discovery is adopted, the file is the host's own
`%APPDATA%\QuestBridge\tokens.json` (or `$XDG_CONFIG_HOME/questbridge/…`, or the
`QUESTBRIDGE_CONFIG_DIR` override), mirroring `packages/host/src/paths.ts`. This
is preferable to an ad-hoc env var because it survives regeneration, needs no
manual copying, and keeps the credential out of process listings.

### Security consideration

Discovery means the adapter reads the host's token file directly, rather than
being handed the value. Both are local, single-user, same-machine reads. It is
**not** a new trust boundary: the host's token file was already readable by any
process running as this user, which is the same set of processes that could read
an environment variable. The `minecraftToken` boundary — publisher vs. reader —
is unchanged (`docs/local-authentication.md` §1.1).

Worth stating because it will otherwise be raised: this does not weaken
authentication, but it does make the credential discoverable without
configuration, which is the point.

### Alternatives considered

| Alternative | Assessment |
|---|---|
| Environment variable only | Works today, no source change. Still requires configured setup once, does not fix E1, and does not survive a token change without a restart. Does not satisfy the stated request. |
| Fix E1 only, keep configured token | Fixes the documented path and is the minimum correct change, but leaves E2 and still requires the token to be configured on the client. |
| Read the token file once, at startup | Fixes configuration tedium but not E2; a regenerated token would still need a game restart. |
| An unauthenticated localhost publisher endpoint | Rejected: the `minecraftToken` boundary exists precisely so a stray local process cannot inject fabricated quest progression. |
| A handshake that exchanges a fresh token per connection | Over-engineering for a single-user loopback application, and it needs protocol v2 (objects are strict). |

### Version impact

Adopting E1, E2, or discovery changes mod source, so under
`docs/versioning.md` §3.5 the version becomes **`0pre.3`**. The user has
confirmed the version question is to be settled when implementation is
authorised; this proposal does not change it.

### Impact if adopted

- The documented `config/questbridge-client.toml` path works.
- No manual token configuration is required on the client.
- A token change, or a host restart, is picked up on the next reconnect without
  restarting Minecraft.
- Mod source changes; a rebuild and jar swap are required.
- Phase 5 Sequence A must be re-run against the new jar, and the current
  session-1/2 observations remain valid only for the `0pre.2` build.

### Impact if not adopted

- The documented configuration path stays broken; only `-D` and the environment
  variable work.
- Every token regeneration continues to require a Minecraft restart.
- Phase 5 can still proceed using the environment-variable workaround.

### Recommendation

Adopt **E1 first** — it is a genuine defect, it is small, and it is the reason
Phase 5 has produced no transport evidence. Adopt **E2 and discovery together**
second, since E2 alone has little value without a reason for the token to change,
and discovery is the reason.

The user has asked to hold implementation and record findings only. This proposal
therefore remains a proposal.

---

## 7. Decisions requested

| ID | Proposal | Recommendation | Decision |
|---|---|---|---|
| A | Move Java project to `minecraft-mod/` | Adopt | Approved and applied |
| B | Cookie-after-token-redirect authentication with three roles | Adopt | Adopted, then simplified to two tokens (2026-11-06) |
| C | Phased implementation order | Adopt | Adopted; Phase 0 applied |
| D | Repository hygiene and exact FTB build dependencies | Adopt | Applied |
| E | Runtime token discovery and config-load ordering | Adopt E1, then E2 + discovery | **Proposed; not decided** |

A decision can be:

- **Adopt** — apply as proposed.
- **Adopt with changes** — specify changes.
- **Keep deferred** — leave the current state and revisit later.
- **Reject** — do not apply.

Proposal A has already been applied and `docs/architecture.md` reflects the new layout. Proposal C is adopted and Phase 0 is applied. Proposal D is applied: npm and Node are pinned and the exact FTB build dependencies are declared. Proposal B was adopted on 2026-11-06 and simplified to two tokens with no cookies; its normative design is `docs/local-authentication.md`, and its security section is now the implemented design rather than a recommendation. Proposal E is recorded but not decided; it awaits authorisation, and the user has asked that findings be documented before any fix.
