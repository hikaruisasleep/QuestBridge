# Phase 3 Overlay Verification — OBS-Facing Behaviour

**Date:** 2026-11-07
**Scope:** Phase 3 milestone 3E. Verifies the behaviours OBS depends on.
**Build:** `apps/web-app/build` from `npm run build -w web-app` at commit
`feat/phase-3-web-app` (post-3D).
**Host:** `questbridge-host --port 8960 --build-dir apps/web-app/build`,
config directory a fresh temporary directory per run.
**Browser:** Playwright Chromium 1.65.0, headless, viewport 380 × 650 — the
documented OBS starting frame (`AGENTS.md` §14).

---

## 1. What was verified, and how

OBS itself was **not** driven for these checks. Everything below was measured in
plain Chromium against the URL an OBS Browser Source uses. The distinction
matters and is recorded honestly in §5.

| Property | Method | Result |
|---|---|---|
| Frame size | `scrollWidth/scrollHeight` of the document | `380 × 650` exactly |
| No scrollbars | document scroll extent vs client extent | Equal on both axes |
| Transparent background | computed `background-color` on `html`, `body`, `.overlay` | `rgba(0, 0, 0, 0)` on all three |
| Alpha in output | PNG colour-type byte of an `omitBackground` screenshot | Type 6 (RGBA), i.e. alpha present |
| Chapter pins rendered | count of pinned rows | 5, in configured order |
| Objectives rendered | count of objective articles | 2 |
| Refresh recovery | reload with the mock stopped | Same 5 chapters, opacity back to 1, no error |
| Host restart — notice | stop host under an open page | "Lost connection to QuestBridge host…" |
| Host restart — no blank frame | `body.innerText` length | Non-zero at every step |
| Host restart — recovery | start a fresh host on the same port | Reconnected, 5 chapters restored |

### 1.1 Auto-scroll

Verified separately with seven objectives of three tasks each in a 380 × 650
frame:

```text
measured overflow: 466px
offsets sampled:   30, 265, 457, 466, 411, 155, 2, 0, 84, 348, 466, 466
```

The list travels between the two ends and back with a pause at each, which is
the documented behaviour. The document stayed exactly `380 × 650` throughout
and the scroll container's `overflow` computed to `hidden` on both axes.

### 1.2 Full configuration used

Five chapters with distinct states, so the presentation is exercised rather
than just populated:

| Position | Title | Progress | Status |
|---:|---|---:|---|
| 0 | Starting Out | 62 | available |
| 1 | The Cool Parts | 45 | available |
| 2 | AllTheModium | `null` | available |
| 3 | The ATM Star | 0 | locked |
| 4 | Creative Items | 100 | completed |

Position 2 rendered an em dash rather than `0%`, and position 4 rendered as
complete because its status says so, not because its progress is 100.

---

## 2. Transparency detail

The overlay sets no background on any ancestor. `app.css` leaves `html` and
`body` transparent by default, and `/control` and `/` opt into a dark backdrop
through `body[data-route=…]`, which `/overlay` never sets. The route's own
`.stage` is explicitly `background: transparent`.

This matters because a single opaque ancestor would show as a black rectangle
in OBS. It was checked on all three elements rather than only the overlay root
for that reason.

---

## 3. Disconnection presentation

On `status === "disconnected"` the content stack fades to `opacity: 0` and the
status notice remains visible outside the fading stack, so the frame is never
blank. The notice names the remedy (`questbridge-host`).

Two related rules were verified by component test rather than by eye:

- a **stale** state renders byte-identically to a live one;
- `synchronizing` does **not** fade, even though the host reports `stale: true`
  during it.

---

## 4. Commands used

```text
npm run build -w web-app
node packages/host/dist/index.js --port 8960 --build-dir apps/web-app/build --config-dir <tmp>
node packages/mock-publisher/dist/index.js --scenario=progress --token=<minecraftToken>
```

State for §1.1 and §1.2 was supplied by a small scripted publisher speaking
protocol v1, because the existing mock scenarios do not produce an
overflow-length objective list.

---

## 5. Not verified here

- **The OBS application itself.** These checks establish that the served page
  is transparent, correctly sized, scrollbar-free, and recovers from refreshes
  and host restarts. Confirming that OBS composites the source as intended —
  and that its CEF build renders identically — requires opening OBS and was not
  done in this session.
- **Real FTB Quests data.** Every run used the mock publisher or a scripted v1
  publisher. Mock success does not establish FTB compatibility (`AGENTS.md`
  §11.2); that is Stage 4C and Phase 5.
- **Long-session stability.** No soak test was run.

---

## 6. How to repeat the OBS check by hand

1. `npm run build -w web-app`
2. `npm run host -- --print-urls` and note the overlay URL.
3. `npm run mock -- --scenario=progress --speed=2 --token=<minecraftToken>`
   from the host's `tokens.json`.
4. OBS → Sources → **+** → **Browser**:
   - Width `380`, Height `650`, FPS `30`
   - **Shutdown source when not visible:** disabled
   - **Refresh browser when scene becomes active:** disabled
   - Paste the overlay URL from step 2.
5. Expected: transparent background over the scene, two labelled sections, no
   scrollbar, no border or panel.
6. Refresh the source (right-click → Refresh). Progression returns without a
   Minecraft restart.
7. Stop the host. The overlay fades out and shows "Lost connection…". Start it
   again; the overlay returns within ~10 s.
