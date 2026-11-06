# Phase 3 Plan — Svelte Overlay and Control Dashboard

**Status:** Planning. No Phase 3 implementation has started.  
**Date:** 2026-11-06  
**Target:** `apps/web-app` served by `packages/host` on loopback, protocol v1
unchanged, ATM10 TTS data supplied by the mock publisher until Stage 4C.  
**Version:** The Minecraft mod remains `0pre.1`. `web-app` stays at its scaffold
version; no artifact is published from this phase.  
**Normative requirements:** `docs/web-frontend.md`. This plan describes *how* to
build what that document specifies; where the two disagree, that document wins.

---

## 1. Goal

Deliver the two browser routes the host has been serving placeholders for:

1. `/overlay` — the non-interactive, continuously updating OBS Browser Source.
2. `/control` — the interactive chapter pin selector and display settings.

Phase 3 ends when a real `adapter-static` build, served by the host with
`--build-dir`, renders correct progression in a plain Chromium window and in
OBS, survives a browser refresh and a host restart with an explicit state in
every case, and passes its test suite.

Phase 3 does **not** touch the protocol. If a change appears to need a protocol
change, that is a signal the design has drifted; stop and re-read
`docs/web-frontend.md` §2.

---

## 2. Scope

### In scope

- `apps/web-app` routes: `/overlay`, `/control`, and `/`.
- A shared protocol client: one authenticated WebSocket, reconnect with backoff,
  sequence and revision tracking, `state.resync` on a gap.
- A normalized client store and the shared selectors (`AGENTS.md` §10.3).
- The overlay's two sections: chapter pins and manual objectives.
- The objectives auto-scroll behaviour (§6.4).
- The control dashboard: chapter catalog with search, pin/unpin, drag-and-drop
  reordering, display settings, and a live overlay preview.
- Failure states: disconnected, reconnecting, unauthorized, synchronizing,
  stale, and empty — per `docs/web-frontend.md` §3.
- A small host change so `/` serves the prerendered landing page (§9).
- Frontend tests, including component tests and a host-served integration test.

### Out of scope

- Protocol v1 changes of any kind. No new fields, message types, or versions.
- Quest pin management. The dashboard selects **chapters** only
  (`docs/web-frontend.md` §1.1).
- Real FTB Quests data. The mock publisher is the data source until Stage 4C.
- OBS API usage, stream-deck integration, or any OBS-specific behaviour.
- Additional themes. `display.theme` remains the literal `"minimal"`.
- Multiple overlay layouts, progress history, or completion notifications
  (`AGENTS.md` §19).
- Changes to `packages/host` beyond the `/` route (§9) and bug fixes the
  integration tests prove necessary.

---

## 3. Decisions settled for this phase

Each of these was an explicit choice; the rationale is recorded so a later
reader does not "fix" them.

### 3.1 One app, two routes

Per `docs/web-frontend.md` §1. `/control` renders the overlay component directly
rather than embedding it, so no second WebSocket connection is opened and no
markup is duplicated.

### 3.2 The root route is a landing page

`/` renders a small prerendered page explaining the two routes and linking to
both, carrying the current token through so a user who opens the bare host URL
can reach a working view in one click.

This requires the host change in §9: the host currently maps only the two
browser routes, so `/` returns 404 even though the build contains `index.html`.

Rejected: redirecting `/` to `/control`. It hides the two-route structure and
makes the token-preservation requirement implicit in a redirect rather than
visible in a link.

### 3.3 Overlay preview uses a scoped wrapper around the shared component

`/control` renders the same overlay component inside a preview container with
its own backdrop and fixed dimensions (the documented 380×650 starting frame).
This gives component reuse with preview fidelity approaching an iframe, without
a second socket or a second overlay-role session.

Rejected: an iframe pointing at `/overlay?token=…`. It is pixel-identical, but
costs a second authenticated connection per dashboard tab and makes the preview
a separate client whose state can diverge from the panel beside it.

### 3.4 Objectives show every task, with an auto-scroll on overflow

`AGENTS.md` §2.2 asks for per-task detail and numeric progress where available,
so tasks are never collapsed into a summary count.

When the objectives content is taller than its container, a back-and-forth
scrolling animation runs automatically. **Scope:** the objectives section as a
whole, not each quest or the full overlay column. One animation keeps the
380×650 frame predictable and keeps every quest title in a stable
relationship to the others.

**Not configurable in this phase.** `DisplayConfig` is a `strictObject` and
protocol v1 permits no additive fields, so an `autoScroll` setting would require
a v2 bump across the schema, host, mock publisher, and the Java adapter. The
behaviour is unconditional for now; configurability can ride along with a future
v2 bump planned for other reasons. See §11 for the reduced-motion question.

### 3.5 Reordering is drag and drop

Pointer drag-and-drop on the pinned-chapter list, matching the interactive
nature of a dashboard. See §11 for the keyboard-accessibility consequence.

### 3.6 Empty sections hide on stream, hint in preview

When no chapters are pinned, or every pin is unresolved, the real `/overlay`
renders nothing for that section. The dashboard preview additionally shows a
muted setup hint. Nothing internal leaks to viewers, and the streamer sees the
cause where they can act on it.

### 3.7 Stale-state presentation is deferred

`docs/web-frontend.md` §3 requires that stale data never be presented as live,
but the overlay is on stream and the visual treatment is a product decision, not
a technical one. This is the one requirement in this plan **without an agreed
design**. It is scheduled as milestone 3E and must be settled before Phase 3 is
called complete. See §11.

### 3.8 The chapter field is `subtitle`

`AGENTS.md` §7.1 and §10.2 called the chapter field `description`. The
implemented protocol v1 uses `subtitle`, deliberately: `docs/protocol.md` §8.1
records that FTB Quests `2101.1.30` exposes chapter subtitles and **no chapter
description accessor**, and says explicitly not to call it a description. The
protocol was correct and `AGENTS.md` was stale.

**Resolved before this plan was committed.** Both `AGENTS.md` lines now say
`subtitle`, and §7.1 records why. No work remains here; it is listed only so a
later reader who sees "subtitle" in the protocol and remembers "description" in
the spec knows which way the decision went.

---

## 4. Frontend structure

`AGENTS.md` §5 sketches `lib/{api,stores,components,types,utils}`. That shape is
kept, with the additions this design needs:

```text
apps/web-app/src/
├── lib/
│   ├── protocol/
│   │   ├── client.ts          # one socket: connect, hello, backoff, resync
│   │   └── endpoint.ts        # token from location.search -> ws URL
│   ├── stores/
│   │   ├── app-state.svelte.ts  # normalized state, revision-aware
│   │   └── connection.svelte.ts # lifecycle state machine
│   ├── selectors/
│   │   └── index.ts           # getPinnedChapters, getChapterProgress, …
│   ├── components/
│   │   ├── overlay/           # OverlayView, ChapterSection, ObjectiveSection
│   │   ├── control/           # CatalogList, PinList, DisplaySettings
│   │   └── common/            # StatusBadge, ProgressBar, EmptyHint
│   ├── types/
│   └── utils/
├── routes/
│   ├── +layout.ts             # prerender = true (exists)
│   ├── +layout.svelte         # shared shell; see §5
│   ├── +page.svelte           # landing page
│   ├── overlay/+page.svelte
│   └── control/+page.svelte
└── app.css
```

Svelte 5 runes throughout. `app.css` is added and imported by the layout;
the existing `routes/layout.css` keeps the Tailwind import. The overlay's
transparent-background rule belongs to the overlay route, **not** the shared
layout, so `/control` is not forced transparent.

`@questbridge/protocol` is a workspace dependency of `web-app` (add to
`package.json`; the symlink already exists via the root workspace). The frontend
consumes the same types, schemas, `SequenceTracker`/`RevisionTracker`, and
`ProtocolError` the host uses — it must not re-implement them
(`docs/development.md` §7).

---

## 5. Connection and state

### 5.1 One client, one socket

A single protocol client owns the socket for the page's lifetime. Both routes
use it; neither opens its own.

Lifecycle:

1. Read the token from `location.search` (`endpoint.ts`).
2. Open `ws://<host>/ws?token=…`, where `<host>` is `location.host` — the page is
   served by the host, so no configuration is needed.
3. Send `browser.hello` with the route's role: `overlay` for `/overlay`,
   `control` for `/control`.
4. Apply `state.snapshot` as the baseline revision.
5. Apply `state.update`, `chapter.pins.update`, `config.update`, and
   `connection.status` idempotently.
6. On a sequence or revision gap, send `state.resync`.
7. On close, reconnect with backoff (1, 2, 4, 8 s, capped at 30 s,
   `docs/architecture.md` §7), re-hello, and expect a fresh snapshot.

The token is read once and never written into the DOM, a log, or a link the user
is expected to copy. `/control`'s landing-page links from `/` carry it forward by
construction from `location.search`.

### 5.2 State shape

The store mirrors `AppState` and holds two additional client-only fields:

```typescript
interface ClientState {
  connection: ConnectionState;   // from the host
  transport: "connecting" | "open" | "closed";
  aboutToReconnect: boolean;
  // …chapters, quests, chapterPins, display, unresolvedPinnedQuestIds
}
```

`transport` and `aboutToReconnect` are client-side facts the host does not and
should not track. Everything else is host-authoritative and must never be
computed locally. In particular the frontend must not derive chapter completion
from `progress === 100` (`docs/protocol.md` §8.1) and must not recompute task
percentages from counts (`docs/protocol.md` §8.4).

### 5.3 Selectors

`lib/selectors/index.ts` implements the `docs/architecture.md` §6.1 set:

```typescript
getChapterCatalog()
getPinnedChapters()            // resolved + unresolved, in configured order
getChapterProgress(chapterId)
getManuallyPinnedQuests()
getConnectionStatus()
getUnresolvedChapterPins()
getUnresolvedPinnedQuestIds()
```

`getPinnedChapters()` is the single place that joins `chapterPins` against
`chapters` and produces the ordered, unresolved-preserving list the overlay
renders. Components consume it and never re-derive it.

---

## 6. Route behaviour

### 6.1 `/overlay`

Non-interactive. Transparent background, no scrollbars, no external assets.

**Chapter section.** Renders exactly `getPinnedChapters()` in configured order.
Each row shows title, progress bar (`showChapterProgress`), and completion state.
An unresolved pin renders as unresolved in its position. Empty configuration
renders nothing in this section.

**Objective section.** Renders `getManuallyPinnedQuests()`. Each quest shows its
title, completion state, a `completedTasks/totalRequiredTasks` counter
(`showQuestTasks`), and one row per task with numeric progress where the source
provides it. Tasks without numeric progress show status only — never a
fabricated number (`AGENTS.md` §7.5). Optional tasks are marked and never block
a quest's completion.

**Auto-scroll.** When the objectives content exceeds its container, animate
between the top and the bottom and back, with a pause at each end. Implemented
with a CSS transition driven by a measured overflow, not a fixed keyframe
duration, so it stays correct as content changes. `no scrollbars` is a hard
requirement, so overflow is hidden on the scroll axis.

**Completion animation.** When `completionAnimation` is set, a completed row
gets a brief highlight. It must not delay or reshuffle layout, and must not
re-trigger on every state update — only on a genuine status transition.

### 6.2 `/control`

**Chapter catalog.** All discovered chapters, with a search field filtering on
title and subtitle. Each row shows title, subtitle where present, progress,
status, and a pin/unpin action with an already-pinned indication.

**Pinned chapters.** The configured pins in order, with drag-and-drop reorder
and unpin. Unresolved pins appear in place, marked.

**Display settings.** One control per `DisplayConfig` field. Changes send
`config.update` with the **complete** object — the schema is a `strictObject`
and partial objects are rejected (`docs/phase-2-plan.md` §9).

**Preview.** The shared overlay component in a preview container (§3.3).

**Disabled states.** Per `docs/web-frontend.md` §3.3: while disconnected,
unauthenticated, or before the first snapshot, mutation controls are disabled
and explained. Host error codes are surfaced verbatim in context, not collapsed.

### 6.3 `/`

A small prerendered landing page: what QuestBridge is, the two route links with
the token carried through, and a pointer to `--print-urls` as the canonical way
to obtain the URLs. It must not imply that data is available when the host has
none.

---

## 7. Testing

Three layers, per `AGENTS.md` §11.2; mock success never counts as FTB
compatibility.

**Component and unit tests** (`vitest` browser mode, existing config):
- Selectors: empty catalog, five pins, unresolved pins, ordering, completion.
- Store: snapshot baseline, incremental updates, out-of-order and duplicate
  revisions, resync trigger.
- Failure states: disconnected, reconnecting, unauthorized, synchronizing,
  stale, empty — each renders something visible.
- Overlay: empty pin config renders no fabricated rows; unresolved pin renders in
  position; completed quest from FTB's pin removal disappears rather than being
  retained; task rows show numeric progress only when the source provides it.
- Control: search filtering; pin/unpin; reorder; `too_many_pins` and
  `duplicate_chapter` surfaced; controls disabled with a reason pre-snapshot.

**Integration test** (`packages/host` test suite, reusing the mock publisher):
- Build the frontend, serve it with `--build-dir`, connect a real browser client
  over the real socket, play a mock scenario, and assert the served page
  references the assets the host serves. This is the test that would have caught
  the `adapter-node` mismatch, so it belongs in the suite rather than only in
  manual steps.

**Manual OBS verification** (recorded in `docs/testing-logs/`):
- Transparent background, no scrollbars, correct 380×650 framing, refresh
  recovery, and a host restart while the source is live.

`docs/web-frontend.md` §5 lists the cases this plan must not lose.

---

## 8. Milestones

Each milestone is independently testable and committed.

### 3A — Client foundation

- Add `@questbridge/protocol` as a `web-app` dependency.
- `protocol/endpoint.ts` and `protocol/client.ts`: connect, hello, backoff,
  resync, gap detection.
- `stores/app-state.svelte.ts`, `stores/connection.svelte.ts`.
- `selectors/index.ts`.
- Unit tests for the client, store, and selectors.

The `AGENTS.md` `description` → `subtitle` correction (§3.8) is already applied
and does not belong to this milestone.

**Exit:** the client connects to a running host, applies a snapshot and updates,
recovers from a forced close, and triggers resync on an injected gap — proven by
tests, with no route yet.

### 3B — Overlay route

- `routes/overlay/+page.svelte` plus `components/overlay/*`.
- Transparent background scoped to the route.
- Chapter section, objective section, per-task rows, counter, progress bars.
- Completion animation.
- Empty/unresolved handling per §3.6.
- Objectives auto-scroll per §6.1.

**Exit:** with the mock publisher driving a running host, the overlay renders
the configured pins and manual objectives correctly in Chromium, is transparent,
has no scrollbars, and scrolls its objectives when content overflows.

### 3C — Control route: catalog and pins

- `routes/control/+page.svelte` plus `components/control/*`.
- Catalog list with search.
- Pin/unpin with cap, duplicate, and unknown-chapter surfacing.
- Drag-and-drop reorder.
- Unresolved pin handling.
- Disabled-with-reason states.

**Exit:** pins can be added, removed, and reordered from the browser; the
resulting `config.json` matches; refusals display their codes; controls are
unavailable with a stated reason before a snapshot arrives.

### 3D — Display settings, preview, and landing page

- Display settings panel; complete-object `config.update`.
- Live preview via the shared component in a scoped container.
- `routes/+page.svelte` landing page.
- Host change so `/` serves `index.html` (§9).

**Exit:** toggling each display setting changes the overlay and preview and
persists; `/` links to both routes with the token preserved; a refresh keeps
state without a new Minecraft snapshot.

### 3E — Stale presentation, hardening, and OBS verification

- **Settle and implement the stale/disconnected presentation (§3.7).**
- Reconnect and resync edge cases; repeated host restart.
- Log redaction review; no token in the DOM, console, or error text.
- OBS verification recorded in `docs/testing-logs/`.
- Update `docs/web-frontend.md` status, `docs/development.md`, and
  `docs/phase-2-plan.md`'s final acceptance item.

**Exit:** full workspace suite passes; the OBS source survives refresh and host
restart; the plan's §11 open questions are resolved or explicitly deferred with
a reason.

---

## 9. Host change: serve the landing page at `/`

`packages/host/src/static.ts` currently resolves only `BROWSER_ROUTES`
(`/overlay`, `/control`) to HTML; for `/` it resolves to the build directory
itself, `isFile` fails, and the response is 404.

Required change: treat `/` as a page request that resolves to `index.html`
directly, without the route candidates. This is a small, additive change to the
candidate list in `serveStatic`, plus tests.

Constraints:

- An unknown path must still be 404 (`docs/phase-2-plan.md` §13.3).
- The placeholder behaviour without a build is unchanged.
- No SPA fallback is introduced: `/` maps to `index.html` specifically, and
  arbitrary unknown paths remain 404. A catch-all fallback would turn typos into
  confusing half-working pages (`docs/web-frontend.md` §2.1).

This is the only host change Phase 3 requires. If another is needed, it is a
signal to re-examine the design rather than to widen the host's surface.

---

## 10. Documentation deliverables

- `docs/phase-3-plan.md` (this document), status updated as milestones land.
- `docs/web-frontend.md` status and any refinement the implementation reveals.
- `docs/development.md` frontend build/run/test instructions.
- `docs/phase-2-plan.md` §17 final acceptance item, once the routes exist.
- `docs/testing-logs/` OBS verification record.

Already done: the `AGENTS.md` `description` → `subtitle` correction (§3.8).

---

## 11. Open questions

These need a decision. The first is a blocker for completing 3E; the other two
are smaller and can be settled during implementation.

### 11.1 Stale/disconnected visual treatment (blocking 3E)

Deferred for deeper discussion at the user's request. The options considered:

| Option | Effect | Trade-off |
|---|---|---|
| Subtle badge, only when not ready | Invisible during normal streaming; never silently shows stale data as live | Easy to miss mid-stream if the streamer is not looking at the overlay corner |
| Dim/desaturate the whole overlay plus a badge | Unmistakable | Visibly degraded on stream during a brief blip |
| Hide progression entirely when stale | Never shows wrong data | The corner empties mid-stream during a transient disconnect |

The constraint that makes this a real decision: during a brief Minecraft
hiccup, a dimmed or emptied overlay is itself a visible on-stream artifact.
`docs/web-frontend.md` §3 forbids presenting stale as live; it does not mandate
which of these achieves that.

### 11.2 Keyboard access for drag-and-drop reordering

Drag and drop was chosen for §3.5, but native HTML5 drag-and-drop is not
keyboard-operable, so reordering is currently mouse-only. `AGENTS.md` does not
require keyboard access, and the cap is five items. Options: accept mouse-only,
or add a minimal keyboard affordance on the focused row.

### 11.3 `prefers-reduced-motion` and the auto-scroll

The objectives auto-scroll was specified as unconditional. Continuous motion
respecting `prefers-reduced-motion` is a common accessibility expectation, and
OBS users may not have that set. Options: keep it unconditional as decided;
respect the media query and fall back to a static clamped list; or clamp to a
fixed maximum height with no motion.

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Overlay preview diverges from real overlay | Streamer approves a layout OBS renders differently | Shared component; validate in real OBS in 3E, not only in Chromium |
| Auto-scroll jitters as content updates | Visible on stream | Drive from measured overflow, not fixed timing; pause on change |
| Drag-and-drop unreliable in OBS CEF | Cannot reorder | Reordering is a dashboard-only concern; OBS only renders `/overlay` |
| Reconnect loop shows stale as live | Incorrect on stream | Explicit states per §3.7; resync on gap; revision tracked |
| Token leaked into DOM or logs | Local credential exposure | Read once from `location.search`; never rendered; redaction review in 3E |
| Silent scope creep into quest pinning | Violates a core non-goal | `docs/web-frontend.md` §1.1; catalog is chapters only |
| Frontend re-derives progression | Diverges from FTB truth | Selectors own all derivation; components consume only |
| `index.html` fallback becomes an SPA fallback | Typos render a half-working page | `/` maps to `index.html` specifically; unknown paths stay 404 |
| Mock success read as FTB compatibility | False confidence | Three testing layers kept distinct; real data is Stage 4C+ |

---

## 13. Acceptance criteria

Phase 3 is complete when:

- [ ] `npm run build` produces a static build served correctly by the host.
- [ ] `/overlay` renders exactly the configured chapter pins, in order, with
      progress and completion state, and empty configuration fabricates nothing.
- [ ] `/overlay` renders the manual FTB quest pins with task counters and
      numeric task progress where available.
- [ ] Objectives auto-scroll when they overflow, with no scrollbars.
- [ ] `/control` lists the catalog, searches it, and pins/unpins up to five
      chapters, surfacing `too_many_pins` and `duplicate_chapter`.
- [ ] `/control` reorders pinned chapters and the order persists.
- [ ] Unresolved chapter pins render as unresolved in position, and are never
      auto-removed.
- [ ] Display settings persist, broadcast, and match the overlay.
- [ ] `/` links to both routes with the token preserved.
- [ ] Disconnected, reconnecting, unauthorized, synchronizing, stale, and empty
      states each render visibly — never a blank frame.
- [ ] Mutation controls are disabled with a stated reason before a snapshot.
- [ ] No token appears in the DOM, console, served HTML, or logs.
- [ ] OBS shows a transparent, correctly framed overlay that survives a refresh
      and a host restart.
- [ ] The full workspace test suite passes.
- [ ] Protocol v1 is unchanged.

Passing Phase 3 does not complete the real FTB adapter or the project Definition
of Done. Mock mode alone does not establish FTB compatibility (`AGENTS.md` §18).

---

## 14. First implementation action

Start with 3A only, and do not begin 3B until 3A passes:

1. Add the `@questbridge/protocol` dependency and the endpoint/client modules.
2. Add the store, the connection state machine, and the selectors.
3. Correct the `AGENTS.md` `description` → `subtitle` lines.
4. Add unit tests for all of the above, including the reconnect and resync paths.

This keeps the first increment verifiable without any UI, which is where the
connection lifecycle mistakes are cheapest to catch.
