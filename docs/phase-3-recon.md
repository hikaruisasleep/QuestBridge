# Phase 3 Reconnaissance and Work Plan

**Status:** Reconnaissance complete. No Phase 3 implementation has started.
**Date:** 2026-11-07
**Branch:** `docs/phase-3-plan` (implementation starts on a new branch; see §8).
**Scope:** complements `docs/phase-3-plan.md` and the normative
`docs/web-frontend.md`. This document records *what the code actually does*
before Phase 3 begins, and pins down the work plan that follows from it.

Where this document conflicts with `docs/phase-3-plan.md`, this document is
newer and reflects verified behaviour. Where it conflicts with
`docs/web-frontend.md`, that document still wins on requirements.

---

## 1. Why this document exists

`docs/phase-3-plan.md` was written from the specifications. Several of its
assumptions about the host and the build were not checked against the running
system. Checking them produced one genuine defect in the plan (the `/` route
fix as described would not work — §3.1) and one newly discovered host
behaviour that matters for the dashboard (§4.1).

Nothing here is an implementation. Everything below was run and observed on
2026-11-07 in this checkout.

---

## 2. Verified baseline

Before any Phase 3 work, the workspace is green:

| Check | Result |
|---|---|
| `npm run build` | Succeeds for all four workspaces. |
| `npm test` | **349 passing**: 85 protocol, 30 mock-publisher, 232 host, 2 web-app. |
| Node / npm | `24.22.1` / `11.19.1` via fnm (see `AGENTS.md` §3). |
| Playwright Chromium | Installed (`chromium-1254`); the web-app browser project can run. |
| Tool versions | Svelte `5.57.3`, Vite `8.3.0`, Vitest `4.1.12`, `vitest-browser-svelte` `2.2.1`, Playwright `1.65.0`. |

---

## 3. The `/` route: plan defect, found and corrected

### 3.1 What `docs/phase-3-plan.md` §9 proposes

It says `packages/host/src/static.ts` resolves only `BROWSER_ROUTES`
(`/overlay`, `/control`), so `/` falls through to a 404, and proposes treating
`/` as a page request resolving to `index.html`.

**That description does not match the code.** For any non-route path,
`serveStatic` builds `candidates = [requestPath]` — a single candidate equal to
the literal request path. For `/` that is `"/"`, which `resolveWithinRoot`
resolves to the build root **directory**. `isFile()` then fails, so the result
is 404. So `/` currently 404s for a different reason than the plan states (it
resolves to a directory, not to a missing route candidate), but the outcome the
plan describes is real.

**Observed, with `--build-dir apps/web-app/build` and the current scaffold:**

```text
/            -> 404
/overlay     -> 200   4035 bytes (identical shell)
/control     -> 200   4035 bytes (identical shell)
/index.html  -> 200   4035 bytes
/nope        -> 404
/health      -> 200
```

### 3.2 The trap in the proposed fix

The obvious fix — add `index.html` to the candidate list for `/` — is safe.
The tempting-but-wrong fix is to treat `/` like a `BROWSER_ROUTE` and reuse
`[`${routeName}/index.html`, `${routeName}.html`, "index.html"]`. For `/`,
`routeName` is the empty string, which produces the candidates
`"/index.html"`, `".html"`, `"index.html"` — the last of which is a **root
fallback for every path that reaches it**. Implemented carelessly, that is
exactly the SPA fallback §9 forbids, turning every typo into a half-working
page.

**Required behaviour, to be asserted by tests:**

| Path | Expected |
|---|---|
| `/` | `index.html` from the build, `no-store` |
| `/overlay` | `overlay/index.html` → `overlay.html` → `index.html` (route candidates only) |
| `/control` | same as `/overlay` |
| `/nope` | **404**, even though `index.html` exists |
| `/nope/` | **404** |
| No build present | placeholder for `/overlay` and `/control`; `/` remains 404 |

### 3.3 Route filename naming: confirmed from source

`node_modules/@sveltejs/kit/src/core/postbuild/prerender.js:260-268`:

```js
const file = path.slice(config.paths.base.length + 1) || 'index.html';
if (is_html && !file.endsWith('.html')) {
    return file + (file.endsWith('/') ? 'index.html' : '.html');
}
```

So with the default `trailingSlash`, `/overlay` → `overlay.html` (flat, in the
build root), `/` → `index.html`, and `trailingSlash: 'always'` would give
`overlay/index.html`. This was confirmed empirically with a temporary scratch
route, which emitted **`_recon_probe.html` flat in the build root** (the
probe route was removed and the build regenerated; the tree is clean).

The host's candidate list (`<route>/index.html`, `<route>.html`,
`index.html`) already covers both layouts. No host change is needed for the
routes themselves — only for `/`.

### 3.4 A second, unreported host behaviour

While probing, `/overlay` returned **200 with a 4035-byte shell** even though
no `/overlay` page exists. That is the `index.html` route fallback doing its
job, and it is why the scaffold "works" at both routes today. It also means
**the host cannot distinguish a built route from a missing one** — a route
never built silently renders the root page. Not a blocker, and not something
to change, but Phase 3's integration test should assert that the real
`/overlay` output contains overlay markup, not merely `200`.

---

## 4. Host capability verification for `/control`

### 4.1 Error responses carry no `requestId` — a real gap for the dashboard

`docs/phase-3-plan.md` §6.2 requires host error codes to be "surfaced verbatim
in context". The frontend therefore needs to correlate a `request.error` with
the mutation that caused it.

`packages/host/src/browser-session.ts` **does** echo `requestId` in
`#reject(...)` (`…(message.requestId === undefined ? {} : { requestId })`).
But the dashboard's own outgoing browser messages may omit `sequence` and are
not required to carry `requestId` — and `createMessage` only sets it when
passed. So **if the frontend does not send a `requestId`, errors arrive
unattributed.**

**Decision:** the web-app's mutation senders always set a `requestId` (a
monotonic per-connection counter is sufficient; the schema only requires a
non-empty string ≤ 128 chars). Tests must assert that a rejected mutation
surfaces the returned `code` against the right row.

This is a frontend obligation, not a host change. No protocol change is
needed: `requestId` already exists in the envelope.

### 4.2 `config.update` is bidirectional with identical payloads

`packages/protocol/src/schemas.ts` registers `config.update` in **both**
`browser_to_host` and `host_to_browser` with the same
`configUpdatePayloadSchema`. The outgoing envelope rules differ (browser: no
`sessionId`, sequence optional; host: sequence required), and the incoming
one differs the other way.

**Consequence:** the frontend must serialize the outgoing message as
`browser_to_host` and parse incoming as `host_to_browser`. Using
`serializeMessage(msg, "host_to_browser")` for a dashboard mutation will throw.
This deserves a dedicated test, because the mistake is invisible until runtime.

### 4.3 Message amplification on a state change

`packages/host/src/host.ts` `broadcast()` sends, for a single change that
touches `chapterPins`:

1. `state.update` (with the `chapterPins` section), **and**
2. `chapter.pins.update`.

That is two messages, one revision. A connection that includes `display` and
`connection` sends four. Per `docs/protocol.md` §9.12 browsers must treat all
of them idempotently — applying the same revision twice is harmless and the
highest revision wins.

**Consequence for the store:** dedupe by revision, not by message arrival. If
the store applies `state.update` and then `chapter.pins.update` with the same
revision as two separate commits, a `RevisionTracker` will report `stale` on
the second and may trigger an unnecessary "gap" path if written naively. The
client must treat a repeated revision as a benign re-application.

### 4.4 Stale flag semantics confirmed

`state-store.ts` sets `stale: status !== "ready"`. Therefore `stale` is `true`
during `synchronizing`, and the overlay must key any fade on
`status === "disconnected"` only — exactly as `docs/phase-3-plan.md` §3.7
warns. Confirmed in code, and it is the single easiest thing to get wrong.

### 4.5 Browser role and `clientName`

`browser.hello` accepts an optional `clientName` (≤ 64 chars), logged as
`browser hello: role=… name="…"`. It is **display text in a log line and
nothing more** — it is not on the `AppState`, not used for authorization, and
not echoed to the browser. The plan did not mention it.

**Decision:** send a useful, non-sensitive constant per route (`"QuestBridge
overlay"`, `"QuestBridge dashboard"`), plus a `#recon`-style suffix only in
tests. Never derive it from `location` or include tokens. It is genuinely
useful in the host log when diagnosing "which window is that connection".

### 4.6 Origin rules and the dev server

`validation.ts` `isAllowedOrigin` matches loopback **hostname only, ignoring
port** (accepted risk R2). So `npm run dev -w web-app` on, say,
`localhost:5173` can open a WebSocket to the host on `8765`. This is what
makes the Vite dev-server workflow viable for Phase 3, and it must not be
tightened.

**Caveat:** the dev server's page is not the host's page, so the WebSocket URL
must be derived from something other than `location.host` in dev mode. §5.1
addresses this.

---

## 5. Frontend design decisions this reconnaissance confirms

### 5.1 Endpoint derivation

`docs/phase-3-plan.md` §5.1 says to open `ws://<location.host>/ws?token=…`
because "the page is served by the host, so no configuration is needed". True
in production; false under `vite dev`, where `location.host` is the Vite
server and there is no `/ws` there (without a proxy).

**Decision:** `endpoint.ts` resolves in this order:

1. `VITE_QUESTBRIDGE_WS` (or a `?ws=` query parameter) when explicitly set — dev
   and tests only.
2. Otherwise `ws(s)://${location.host}/ws`.

A token is read from `?token=` exactly once and **never** written to the DOM,
a URL the user copies, or a log. The dev path must be obvious in code, not
implicit, because a silent fallback would make the dev server appear broken.

### 5.2 Animation: `animate:flip` is available and is the right tool

Svelte `5.57.3` exports `flip`, `scale`, `fade`, and `fly`
(`svelte/transition`, `svelte/animate`). `flip` is explicitly documented as
First-Last-Invert-Play and is the correct primitive for "surviving objectives
transition rather than snap" (`docs/web-frontend.md` §3.5).

**Decision, reconciled with §11.3 of the plan:** no
`@media (prefers-reduced-motion)` branch anywhere in the overlay. This is a
deliberate product decision, not an oversight, and a test should grep for its
absence so nobody "improves" it back in.

### 5.3 Auto-scroll must be measured, not timed

The objectives section scrolls back and forth when its content overflows.
Implementing this with a fixed CSS keyframe duration breaks as content
changes. It must be driven by a measured overflow
(`scrollHeight > clientHeight`) and must hide overflow on the scroll axis
(`no scrollbars` is hard requirement from `docs/web-frontend.md` §3.5 and
`AGENTS.md` §2.3).

A `<script>`-free approach using CSS `translateY` transitions driven by a
runes-based measurement is the target; the animation must be paused/restarted
when content changes so it cannot jitter mid-scroll.

### 5.4 Test rendering strategy

The existing web-app test setup has two Vitest projects:

- **client** — `src/**/*.svelte.{test,spec}.ts`, real Chromium via Playwright,
  `vitest-browser-svelte` `render()`. This is where component tests go.
- **server** — `src/**/*.{test,spec}.ts` in Node. This is where selectors,
  store logic, endpoint derivation, and message serialization go, because they
  need no DOM.

`@questbridge/protocol` is not yet a `web-app` dependency; the root workspace
already symlinks it, but `apps/web-app/package.json` must declare it explicitly.

---

## 6. Test fixtures: what already exists

`packages/mock-publisher/src/fixtures.ts` already provides everything the
frontend tests need; **no new synthetic fixtures are required for Phase 3**,
which is a meaningful risk reduction:

| Needed by the frontend | Available |
|---|---|
| ≥ 6 chapters | 7 (`mock-chapter-*`), including `locked`, `completed`, and `progress: null` |
| `progress: 100` with **non-completed** status | `mock-chapter-bonus` — proves completion ≠ progress |
| Numeric task progress | `mock-task-frame` `current: 3, target: 10` |
| Task without numeric progress | `mock-task-optional-check` (completed, percentage only) |
| Empty / 1 / 5 / unresolved pin configs | `EMPTY_PIN_CONFIG`, `ONE_PIN_CONFIG`, `FIVE_PIN_CONFIG`, `UNRESOLVED_PIN_CONFIG` |
| Unresolved quest pin | `UNRESOLVED_PIN_ID` |
| Completion-driven pin removal | `snapshotWithoutCompletedPin()` |
| Deterministic clock | `MOCK_NOW`, `timestampAt()` |

**Caveat that matters:** these are *protocol-level* fixtures. `AGENTS.md`
§11.2 requires three distinct layers (UI fixtures, protocol mock, real
integration). Reusing the protocol fixtures as UI fixtures is acceptable and
desirable — it is what keeps the layers honest — but the frontend test must not
be described as validating FTB compatibility. It validates the UI against the
mock contract.

`packages/host/vitest.config.ts` aliases `@questbridge/protocol` and the
mock-publisher **sources**, so the host integration test builds nothing. The
web-app has no equivalent alias; it must either add one or depend on built
`dist`. §7 settles this: the web-app depends on the built package, matching
production, because Vite has no reason to compile protocol sources twice.

---

## 7. Work plan

Milestones follow `docs/phase-3-plan.md` §8, with corrections and concrete
exit criteria. Each is independently committable and testable.

### 3A — Client foundation (no UI)

**Files:** `src/lib/protocol/{endpoint,client}.ts`,
`src/lib/stores/{app-state,connection}.svelte.ts`,
`src/lib/selectors/index.ts`, plus declarations in `apps/web-app/package.json`.

- Add `@questbridge/protocol` as an explicit dependency.
- `endpoint.ts`: token from `location.search`; WS URL per §5.1. Pure function
  taking a `location`-like object so it is testable in the Node project.
- `client.ts`: one socket per page; `browser.hello` with role and
  `clientName`; `SequenceTracker` + `RevisionTracker` from the protocol
  package (do not reimplement); `state.resync` on gap; exponential backoff
  (1, 2, 4, 8 s, cap 30 s); fresh snapshot expected after reconnect.
- `app-state` store: revision-deduplicated application (§4.3).
- `selectors`: the seven from `docs/architecture.md` §6.1.
- **Every mutation sender sets a `requestId`** (§4.1).

**Exit:** with no route yet — store applies a snapshot, applies updates,
dedupes a repeated revision, recovers from a forced close, and emits
`state.resync` on an injected gap. All proven by `server`-project tests.

### 3B — Overlay route

**Files:** `src/routes/overlay/+page.svelte`,
`src/lib/components/overlay/*`, `src/lib/components/common/*`,
`src/lib/motion.ts` (single motion-token file, per plan §11.4).

- The key background scoped to the route, **not** the shared layout.
- Chapter section: exactly `getPinnedChapters()`, in configured order; empty
  config renders nothing.
- Objective section: manual pins; counter `completed/totalRequired`;
  per-task numeric progress only when the source provides it.
- `animate:flip` reflow + `scale` in/out for pin changes (§5.2).
- Auto-scroll per §5.3.
- Completion highlight that fires on a genuine transition only.

**Exit:** renders correctly in Chromium against a running host driven by the
mock publisher; keyable; no scrollbars; objectives scroll on overflow.

### 3C — Control route: catalog and pins

**Files:** `src/routes/control/+page.svelte`,
`src/lib/components/control/*`.

- Catalog with search over title and subtitle.
- Pin/unpin; surface `too_many_pins`, `duplicate_chapter`, `unknown_chapter`
  by code, attached to the row that caused them (§4.1).
- Drag-and-drop reorder (pointer only, per plan §11.2).
- Unresolved pins shown in position, with unpin available.
- Disabled-with-reason before the first snapshot.

**Exit:** pins can be added, removed, reordered from the browser; `config.json`
matches; refusals display codes; controls are disabled with a stated reason
pre-snapshot.

### 3D — Display settings, preview, landing page, host `/` fix

- Display settings panel sending a **complete** `DisplayConfig`.
- Live preview = the shared overlay component in a scoped 380×650 container.
- `src/routes/+page.svelte` landing page carrying the token through.
- **Host fix for `/`** with the exact behaviour table in §3.2, including the
  negative tests for `/nope`, `/nope/`, and unknown paths.
- Keep `packages/host/tests/static.test.ts` passing — it asserts the existing
  placeholder and 404 behaviour, and the new code must not change it.

**Exit:** every display toggle changes overlay and preview and persists; `/`
links to both routes with the token; `/nope` is still 404 with a build present.

### 3E — Failure states, hardening, OBS verification

- Disconnected / reconnecting / unauthorized / synchronizing / empty states,
  each visible and naming `questbridge-host --print-urls` as the remedy.
- **Stale renders identically to live** — assert it, per `docs/web-frontend.md`
  §3.4.
- Fade only on `disconnected`.
- Token-leak review: no token in DOM, console, served HTML, logs, or bundles.
- Host-served integration test (host test suite): serve the real build, assert
  `/overlay` output contains overlay markup, `/` returns the landing page,
  `/nope` is 404.
- OBS verification recorded in `docs/testing-logs/`.
- Doc updates: `docs/web-frontend.md` status, `docs/development.md`,
  `docs/phase-2-plan.md` §17 final acceptance item.

**Exit:** full workspace suite green; OBS source survives refresh and host
restart.

---

## 8. Branch and commit plan

`AGENTS.md` §17.1 requires a new branch per session and a commit per major
action. The current branch `docs/phase-3-plan` carries the Phase 3 planning
commits and the toolchain documentation.

**Recommended:** cut `feat/phase-3-web-app` from the current base, then commit
per milestone (3A, 3B, 3C, 3D, 3E), each with its tests, and commit this
`phase-3-recon.md` first on that branch or as a follow-up on the current one.

Do not begin 3B until 3A's tests pass; do not begin 3C until 3B renders.

---

## 9. Residual risks specific to Phase 3

| Risk | Impact | Mitigation |
|---|---|---|
| `/` fix implemented as an SPA fallback | Typos render a half-working page | Behaviour table in §3.2 as tests; unknown paths asserted 404 with a build present |
| `config.update` serialized in the wrong direction | Runtime throw on every settings change | Dedicated round-trip test (§4.2) |
| Mutation errors unattributed | User cannot tell which row failed | Inbound `requestId` correlation (§4.1) |
| Store double-applies a revision from the paired section message | Spurious resyncs / flicker | Revision dedupe (§4.3) |
| Fade keyed on `stale` | Overlay pulses on every startup handshake | Key on `disconnected` only; asserted |
| Preview diverges from real overlay | Approved layout differs in OBS | Shared component; OBS check in 3E, not Chromium only |
| Mock fixtures mistaken for FTB validation | False confidence | Fixtures are protocol-level; README/docs state the limit |

---

## 10. What this reconnaissance did **not** establish

- Real FTB Quests data rendering. The mock publisher is the only source until
  Stage 4C. Mock success is not FTB compatibility (`AGENTS.md` §11.2).
- OBS CEF rendering. Not yet run; scheduled for 3E.
- Whether `/control` drag-and-drop is usable inside OBS CEF. Not required —
  OBS only ever renders `/overlay` — but noted so it is not assumed.
- Anything about the Java adapter. Untouched by Phase 3.
