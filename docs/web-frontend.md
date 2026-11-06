# QuestBridge Web Frontend

**Status:** Normative for Phase 3, and **implemented**. Both routes exist as
real SvelteKit pages in a static build the host serves: `/overlay` (chroma-keyed,
two sections, auto-scrolling objectives), `/control` (catalog with search,
pin/unpin, pointer and touch drag reordering, display settings, live preview),
and `/` (landing page carrying the token through). The static build target and
the host's static serving path were already in place; milestone 3E added the
host-served integration test and recorded the OBS-facing verification in
`docs/testing-logs/2026-11-07-phase3-overlay.md`. See
`docs/phase-3-plan.md` §14 for results and known limitations.
**Date:** 2026-11-07  
**Applies to:** `apps/web-app/`, the host's static serving, and the OBS Browser
Source configuration.

This document is the normative description of the web frontend. Where it
disagrees with `docs/architecture.md` §10, this document wins on the points it
covers; the message contract remains `docs/protocol.md` and the transport
security remains `docs/local-authentication.md`.

---

## 1. The two deliverables

The frontend is **one application with two routes**, not two applications.

| Route | Purpose | Interaction |
|---|---|---|
| `/overlay` | Non-interactive, continuously updating progression display for OBS. | None. Renders only. |
| `/control` | Interactive **chapter** pin selector and display settings. | Full read/write over the authenticated socket. |

They are one app because:

- `/control` must show a **live preview of the resulting overlay**
  (`AGENTS.md` §10.2). In one app that is a component import; in two apps it is
  duplicated markup or a third shared package.
- Both consume the same normalized state, the same protocol client, the same
  connection lifecycle, and the same selectors (`AGENTS.md` §10.3: "Selectors
  must be shared where practical, not duplicated across components").
- SvelteKit already code-splits per route, so `/overlay` does not load
  dashboard code. A single app costs the overlay nothing at runtime.

"The overlay must work independently of the control dashboard" (`AGENTS.md`
§2.3) is a **runtime** requirement: the dashboard need not be open. It is not a
reason to build two applications.

### 1.1 Chapters, not quests — read this before touching `/control`

This is the most likely place for a Phase 3 implementer to build the wrong
thing, so it is stated as a hard rule.

> **The `/control` selector selects chapters. It never selects quests.**

- **Chapter pins belong to QuestBridge.** The user picks up to five chapters
  from the discovered catalog, orders them, and pins or unpins them. That is the
  entire purpose of `/control`.
- **Quest pins belong to FTB Quests.** The objective checklist is sourced from
  the player's own manual pins, created and removed inside the Minecraft quest
  book. QuestBridge only *reads* them.

The dashboard must not offer a quest-selection or quest-pinning interface.
`AGENTS.md` §2.4 lists "A second quest pinning mechanism" as a non-goal, and
§10.2 says plainly: "Do not implement quest pin management in the dashboard.
FTB Quests already provides that interface."

Consequences for implementation:

- All `chapter.pin`, `chapter.unpin`, and `chapter.reorder` traffic originates
  from `/control`.
- Objective rows on `/overlay` are **not** interactive and have no pinning
  affordance.
- A completed quest disappears from the objective list because **FTB** removed
  it from its pin set. The UI must not offer to restore, retain, or re-pin it.

---

## 2. The dependency direction

> **The host never depends on the frontend. The frontend depends on the host.**

This is enforced structurally, not by convention:

- The host serves the frontend as **opaque static files**. It knows two route
  names, `index.html`, and a directory. It does not import Svelte, parse a
  manifest, or call into application code.
- The host builds and runs with the frontend directory **absent**. It returns
  the documented placeholder instead (`packages/host/src/static.ts`).
- The host's tests pass with no frontend build present.
- Nothing in `packages/host` may import from `apps/web-app`.

The frontend, by contrast, is useless without the host: it renders a shell and
then either connects to the host's WebSocket or displays why it cannot.

The rejected alternative is worth recording so it is not reintroduced. Importing
a SvelteKit server handler into the host would satisfy the functional need while
inverting this dependency and coupling the host to the frontend framework.

### 2.1 Build output contract

The frontend must produce **real HTML files on disk**, because the host is a
plain static file server that stats a path and streams it. It cannot execute a
Node server.

`apps/web-app` therefore uses `@sveltejs/adapter-static` and **must not** use
`adapter-node`. `adapter-node` emits `build/index.js`, `build/handler.js`,
`build/client/`, and `build/server/`, and generates every page's HTML per
request; it emits no `.html` file at all. Pointing `--build-dir` at such a build
serves the placeholder for both routes.

The build writes to `apps/web-app/build`, which is the directory
`questbridge-host --build-dir` expects:

```text
apps/web-app/build/
├── index.html            # prerendered shell
├── _app/immutable/…      # content-hashed JS, CSS, assets
└── robots.txt
```

Requirements on the build configuration:

- `export const prerender = true` in the root `+layout.ts`. `adapter-static`
  fails the build when a route is dynamic (`strict` defaults to `true`), so
  prerendering is required rather than an optimisation.
- **No `fallback`.** A SPA fallback would make the host answer unknown paths
  with the shell, converting a clean 404 into a confusing half-working page. The
  app has a fixed route set and no client-side routing.
- Both `pages` and `assets` resolve to `build/`.

### 2.2 Route filename resolution

Which filename SvelteKit's prerenderer emits depends on the route's
`trailingSlash` setting:

| `trailingSlash` | Output for `/overlay` |
|---|---|
| `'never'` (default) | `overlay.html` |
| `'always'` | `overlay/index.html` |

The host tries `<route>/index.html`, then `<route>.html`, then `index.html`, so
the trailing-slash choice stays a **frontend** concern and does not have to be
coordinated with the host. Do not "simplify" the host to a single candidate.

### 2.3 Caching

The host sets `Cache-Control` per file class, and the frontend depends on it:

| File class | Header | Why |
|---|---|---|
| `_app/immutable/…` | `public, max-age=31536000, immutable` | Content-hashed: the name changes when the content does. |
| `*.html` | `no-store` | Names current asset hashes; a stale copy can reference files a newer build no longer ships. |
| Everything else | `no-cache` | Revalidate rather than guess. |

Do not serve build output that is not content-hashed from under
`_app/immutable/`, and do not move HTML into that directory.

---

## 3. Failure states

The overriding rule from `docs/local-authentication.md` §6: an authorization or
connection failure must be **distinguishable from "no data yet"**, and the
overlay must **never** render as a blank frame. A silently blank overlay during
a stream is the worst failure mode this component has.

The frontend must render a visible, instructive state naming the remedy
(`questbridge-host --print-urls`) rather than an empty frame or a set of
controls that appear functional but do nothing.

One case is a deliberate exception, settled 2026-11-07: a **stale** state shows
no visible change at all (§3.4). The overlay is on stream, where reacting to a
slow update is a worse failure than the slow update. Disconnection is still
visually distinct — it fades out.

### 3.1 What can actually be rendered

A page cannot report its own absence. These cases are genuinely different, and
conflating them leads to promising behaviour that is impossible to deliver:

| Situation | What the user sees | Notes |
|---|---|---|
| Host never started, or was stopped before the page was ever opened | The browser's own "can't connect" error. | **Nothing of ours renders.** There is no page to render a message into. This is why the URLs come from `--print-urls` and are opened deliberately. |
| Host was running, then stopped or restarted while the page is open | The loaded shell renders a **"lost connection — reconnecting"** state. | The only genuinely renderable offline case. It is why reconnect handling matters. |
| Host running, missing or invalid token | The shell loads, the upgrade is refused, and the page renders **"not authorized"** with the `--print-urls` remedy. | The shell is served unconditionally, which is what makes this possible. |
| Host running, no Minecraft data yet | Normal `disconnected` / `synchronizing` presentation over an empty catalog. | Not an error. Never fabricate progression to fill it. |
| Host running, Minecraft data retained but stale | **No visible change.** The overlay renders identically to a live one. | Amended 2026-11-07; see §3.4. |
| Host running, Minecraft disconnected | The overlay **fades out** rather than going blank at once. | See §3.4. |

The second row is the one to design for. During Phase 2 verification, stopping
and restarting the host left the browser session open, and the client observed a
socket close — so the state is reachable and must be handled.

### 3.2 A rejected WebSocket handshake is opaque

A refused upgrade does not expose its HTTP status to JavaScript. The page
observes only a generic close event, so it **cannot** distinguish `401` from
`403` from "host went away". `docs/local-authentication.md` §6 records this and
accepts the weaker, sufficient behaviour: on any failure to establish the
socket, render one visible, instructive message. No diagnostic probe endpoint is
required, and the frontend must not pretend to a precision it does not have.

### 3.3 No dysfunctional controls

The `/control` route must not present interactive affordances that cannot work.

- While disconnected, unauthenticated, or before the first snapshot, mutation
  controls are **disabled and explained**, not silently inert. A user clicking a
  pin button that does nothing is worse than a button that is visibly
  unavailable with a stated reason.
- If no chapter catalog has been received, the catalog area states that it is
  waiting for Minecraft rather than rendering an empty list that looks like "no
  chapters exist".
- A mutation rejected by the host surfaces the returned error code. The host
  distinguishes `too_many_pins`, `duplicate_chapter`, `unknown_chapter`,
  `not_pinned`, `invalid_reorder_set`, `unauthorized`, and `rate_limited`;
  collapsing these into one generic failure discards the only actionable
  information the user gets.
- Unresolved chapter pins are shown **as unresolved, in their configured
  position**. They are never hidden, substituted, or silently removed
  (`AGENTS.md` §8: "Do not silently delete user configuration").

---

### 3.4 Stale is invisible; disconnection fades out

**Amended 2026-11-07.** This section supersedes the earlier requirement that a
stale state be "explicitly marked". It was changed by product decision, and the
reasoning is recorded so it is not reverted as an oversight.

The overlay shows **no visible difference** in the stale state. A stale overlay
is identical to a live one.

The thresholds exist to make that safe: `staleAfterMs` is 20 s and
`disconnectAfterMs` is 30 s against a 5 s heartbeat
(`packages/protocol/src/version.ts`). They are sized to detect a publisher that
has genuinely gone away — a crash, or a switch of game, world, or server — not a
deferred update. A viewer cannot be helped by a dimmed corner when the game has
crashed, but an overlay that flickers whenever an update is merely slow is a
problem of our own making.

On **disconnection** the overlay fades out instead of disappearing at once. A
fade reads as "no longer live"; a hard cut reads as a glitch.

Implementation rules:

- Key the fade on `status === "disconnected"`, **not** on `stale`. The host sets
  `stale: status !== "ready"`, so `stale` is also true during `synchronizing`; a
  fade keyed on `stale` would pulse the overlay during every normal startup.
- A stale state must render **identically** to a live one. Assert this in a
  test, so nobody later "restores" the missing badge.

### 3.5 Motion

Motion is part of the design, not decoration.

- A quest that is pinned or unpinned **zooms in or out**; it does not appear or
  vanish instantly.
- The other pinned quests **transition to their new positions**; they do not
  snap. This requires a keyed list with a flip-style transition — a plain
  re-render reorders DOM nodes and no animation plays.
- Disconnection fades the overlay out (§3.4).

Precedence when these overlap: the overlay-wide fade is not interrupted by item
animation; item animation runs only while live. `completionAnimation: false`
disables the completion highlight only — not the zoom or reflow, which are
structural and whose absence would reintroduce the snapping these rules exist to
prevent.

**`prefers-reduced-motion` is not honoured.** Settled 2026-11-07. The motion is
content: this is a stream overlay rendered over a video game on a broadcast, not
a public website a stranger could visit. Suppressing it would degrade the product
for an audience that chose to watch. Do not add a reduced-motion branch as an
accessibility improvement.

`/control` is pointer-only: no keyboard reorder controls are planned for it.
That is accepted scope, not an omission.

## 4. Overlay requirements recap

Full detail is in `AGENTS.md` §2.3 and §10.1. The points most often broken:

- Solid key background (`#00FF00` or `#0000FF`) for OBS chroma keying, with
  no UI colour in the active key's family; no scrollbars; no external assets or
  fonts.
- Renders **exactly** the configured chapter pins, in dashboard-defined order.
  It must not fill empty slots, must not show every discovered chapter, and must
  not auto-select chapters.
- An empty pin configuration produces an empty or appropriately configured
  section — never fabricated entries.
- Two visually distinct sections: major progression (chapter pins) and current
  objectives (FTB quest pins).
- No quest-selection controls of any kind.
- Works in plain Chromium and in OBS CEF, and needs no OBS-specific APIs.

### 4.1 The key colour is a browser-local setting

The overlay paints a solid `#00FF00` or `#0000FF` field; OBS removes it with a
Chroma Key filter on the source. Which of the two is used is chosen under
**Background** in `/control`.

`DisplayConfig` has no field for it, and protocol v1 was left unchanged, so the
choice is stored in this browser's `localStorage` under
`questbridge.chromaKey.v1` and never reaches the host. Two consequences follow,
and both are real rather than theoretical:

- **It is per browser profile.** An OBS source reads whatever was last set in
  the profile OBS uses. A dashboard tab in a different browser can show a
  different colour without anything being wrong.
- **It is not part of the host's broadcast.** A browser that has never set the
  value uses green.

Moving this into `DisplayConfig` is the natural first change for a future
protocol version.

### 4.2 UI colours must survive both keys

No component may use a colour in the active key's family. The rule is channel
dominance, not exact match: a keyer removes everything within its similarity
tolerance, so `#00E000` is removed with a green background. All overlay colours
are tokens in `src/lib/theme.ts`, and `src/lib/chroma.test.ts` checks every token
against both keys.

---

## 5. Testing expectations

Frontend tests are implemented; `AGENTS.md` §16 lists them. The cases this
document specifically adds:

- The disconnected and unauthorized presentations each render a visible state —
  never a blank frame.
- **A stale state renders identically to a live one** (§3.4). This is the
  inverse of the original expectation and is deliberate: it guards against
  someone reintroducing a stale badge as a "fix".
- The overlay fades on `disconnected` and does **not** fade during
  `synchronizing` or `ready` (§3.4).
- Pinning or unpinning a quest zooms its box and the surviving rows transition
  rather than snapping (§3.5); the reflow is asserted, not merely eyeballed.
- Mutation controls are unavailable, with a stated reason, before a snapshot
  arrives.
- An empty catalog and a catalog that has never been received are visually
  distinguishable.
- Five pinned chapters render in configured order; a sixth pin attempt surfaces
  `too_many_pins`.
- An unresolved chapter pin renders as unresolved in its configured position.
- Empty pin configuration renders no fabricated chapter entries.

Mock success does not establish real FTB Quests compatibility. UI fixtures,
the protocol-level mock publisher, and the real Minecraft integration remain
three distinct testing layers (`AGENTS.md` §11.2).

---

## 6. Related documents

- `docs/local-authentication.md` — tokens, origin policy, failure states.
- `docs/protocol.md` — the message contract the frontend consumes.
- `docs/phase-2-plan.md` — the host the frontend talks to.
- `docs/development.md` — build and run instructions.
- `AGENTS.md` §2.3, §10, §14 — overlay, dashboard, and OBS requirements.
