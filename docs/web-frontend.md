# QuestBridge Web Frontend

**Status:** Normative for Phase 3. The static build target and the host's static
serving path are implemented; the routes themselves are Phase 3 work.  
**Date:** 2026-11-06  
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

### 3.1 What can actually be rendered

A page cannot report its own absence. These cases are genuinely different, and
conflating them leads to promising behaviour that is impossible to deliver:

| Situation | What the user sees | Notes |
|---|---|---|
| Host never started, or was stopped before the page was ever opened | The browser's own "can't connect" error. | **Nothing of ours renders.** There is no page to render a message into. This is why the URLs come from `--print-urls` and are opened deliberately. |
| Host was running, then stopped or restarted while the page is open | The loaded shell renders a **"lost connection — reconnecting"** state. | The only genuinely renderable offline case. It is why reconnect handling matters. |
| Host running, missing or invalid token | The shell loads, the upgrade is refused, and the page renders **"not authorized"** with the `--print-urls` remedy. | The shell is served unconditionally, which is what makes this possible. |
| Host running, no Minecraft data yet | Normal `disconnected` / `synchronizing` presentation over an empty catalog. | Not an error. Never fabricate progression to fill it. |
| Host running, Minecraft data retained but stale | Stale presentation, explicitly marked. | `docs/phase-2-plan.md` §11: a previous snapshot may be retained, but must not be shown as live. |

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

## 4. Overlay requirements recap

Full detail is in `AGENTS.md` §2.3 and §10.1. The points most often broken:

- Transparent background; no scrollbars; no external assets or fonts.
- Renders **exactly** the configured chapter pins, in dashboard-defined order.
  It must not fill empty slots, must not show every discovered chapter, and must
  not auto-select chapters.
- An empty pin configuration produces an empty or appropriately configured
  section — never fabricated entries.
- Two visually distinct sections: major progression (chapter pins) and current
  objectives (FTB quest pins).
- No quest-selection controls of any kind.
- Works in plain Chromium and in OBS CEF, and needs no OBS-specific APIs.

---

## 5. Testing expectations

Frontend tests are Phase 3 work; `AGENTS.md` §16 lists them. The cases this
document specifically adds:

- The disconnected, unauthorized, and stale presentations each render a visible
  state — never a blank frame.
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
