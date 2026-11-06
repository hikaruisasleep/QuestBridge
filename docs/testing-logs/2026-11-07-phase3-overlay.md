# Phase 3 Overlay Verification — OBS-Facing Behaviour

**Date:** 2026-11-07
**Scope:** Phase 3 milestone 3E, plus the chroma-key correction of the same date.
**Build:** `apps/web-app/build` from `npm run build -w web-app`.
**Host:** `questbridge-host --port 8970 --build-dir apps/web-app/build`, fresh
temporary config directory.
**Browser:** Playwright Chromium 1.65.0, headless, viewport 380 × 650 — the
documented OBS starting frame (`AGENTS.md` §14).

---

## 0. Correction: keyed, not transparent

An earlier revision of this log treated the overlay as **transparent** and
verified an alpha channel. That was wrong, and it was wrong because nothing in
the documentation said which it should be. The intended behaviour is:

- the overlay paints a **solid key colour**, `#00FF00` or `#0000FF`;
- OBS removes that colour with a **Chroma Key** filter;
- the colour is switchable from `/control`;
- while a key is active, **no UI component may use that colour family**.

Everything below verifies the corrected behaviour.

### 0.1 Why the colour rule is stricter than "don't use #00FF00"

A chroma key is not an exact-match operation. OBS removes every pixel within its
similarity and smoothness tolerances of the key. A component drawn in `#00E000`
is therefore removed along with the background even though its hex is not the
key. The rule enforced in code is channel dominance:

> A rendered colour is unsafe if the keyed channel exceeds the greater of the
> other two by more than `DOMINANCE_TOLERANCE` × 255 (0.35).

This is applied to **both** key colours by one implementation, so green mode and
blue mode cannot drift apart.

---

## 1. The palette

All overlay colours live in `src/lib/theme.ts` as tokens consumed through CSS
custom properties. Components carry no colour literals, which is what makes the
guarantee checkable rather than a matter of review.

| Token | Value | Role |
|---|---|---|
| `textPrimary` | `#e8e6e2` | quest and chapter titles |
| `textStrong` | `#d6d4d0` | progress fill, code spans |
| `textBody` | `#b9b7b3` | body text, counters |
| `textMuted` | `#92908d` | section headings |
| `textFaint` | `#6e6c69` | secondary labels |
| `accentComplete` | `#a9b4a5` | completion |
| `accentWarn` | `#b8986a` | warnings |
| `accentError` | `#b07a72` | rejections |
| `track` | `#4a4f5a` | progress tracks |
| `plate` | `#14161b` | status notice plate, **opaque** |
| `rowFill` | `#1a1d23` | objective boxes |
| `rowComplete` | `#243029` | completed objective box |

The previous palette used a mint green (`#7ecfa3`, `rgba(126,217,160,…)`) for
completion and translucent white for plates. Both were wrong for keying: the
green family is removed in green mode, and a translucent plate over a saturated
key field composites **into** that field and is removed with it. Plates are now
opaque.

Removing the green accent and the translucent plates was a deliberate visual
trade: saturation is the price of being keyable.

---

## 2. Measurements

### 2.1 Frame and background

| Property | Green mode | Blue mode |
|---|---|---|
| `.stage` background | `rgb(0, 255, 0)` | `rgb(0, 0, 255)` |
| Document size | 380 × 650 | 380 × 650 |
| Vertical scrollbar | none | none |
| Horizontal scrollbar | none | none |
| All non-transparent pixels opaque | yes | yes |

### 2.2 Colour audit of the live page

Every computed colour on every rendered element was sampled and checked against
the active key, excluding only the `.stage` element that *is* the key field:

```text
green mode:  distinct colours 10, failures 0, conclusion SAFE
blue  mode:  distinct colours 10, failures 0, conclusion SAFE
```

An initial run that classified whole-frame screenshot pixels reported a green
family. Those pixels were the key field itself and its antialiased edges — the
key blended toward a UI colour, where the UI channel is no longer dominant.
Attributing them to components was the error; the computed-colour audit is the
sound measurement because each colour is traceable to an element.

### 2.3 Switching

Driven through the dashboard: selecting blue updated the preview to
`rgb(0, 0, 255)` immediately, persisted `blue` to `localStorage`, and survived a
reload. Selecting green restored `rgb(0, 255, 0)`.

### 2.4 Auto-scroll

Seven objectives of three tasks each in a 380 × 650 frame produced a measured
466 px overflow and cycled offsets `30, 265, 457, 466, 411, 155, 2, 0, 84, 348,
466, 466` — top to bottom and back, with a pause at each end. The document stayed
exactly 380 × 650 and the scroll container stayed `overflow: hidden`.

### 2.5 Refresh and host restart

| Step | Result |
|---|---|
| Reload with the mock stopped | Same chapter count, background preserved, opacity back to 1 |
| Host stopped under an open page | "Lost connection to QuestBridge host…" visible; frame never blank |
| Fresh host on the same port | Reconnected and rebuilt all chapters without a Minecraft restart |

---

## 3. What the audio/video operator has to do in OBS

Chromakey is a **filter on the source**, not a property of the page:

1. Add a **Browser** source at 380 × 650, FPS 30.
2. Right-click the source → **Filters** → **+** → **Chroma Key**.
3. Set **Key Colour** to exactly `#00FF00` (green mode) or `#0000FF` (blue mode).
4. Leave **Similarity** near its default; the palette is built to tolerate a
   reasonably wide key without losing UI.
5. Pick whichever key colour contrasts less with the game being played, using
   the selector in `/control`.

---

## 4. Not verified here

- **The OBS application itself was not driven.** Frame size, uniformity, colour
  safety, switching, refresh recovery, and host-restart recovery were measured in
  Chromium at the documented frame size. That OBS composites and keys the source
  as intended is inferred from these measurements, not observed.
- **No keying was performed.** The audit proves no UI colour *would* be keyed; it
  does not run an actual chroma key filter and inspect the result.
- **Real FTB Quests data.** Every run used the mock publisher or a scripted v1
  publisher.
- **Long-session stability.** No soak test was run.

---

## 5. How to repeat by hand

1. `npm run build -w web-app`
2. `npm run host -- --print-urls`; note the overlay and dashboard URLs.
3. `npm run mock -- --scenario=progress --speed=2 --token=<minecraftToken>`
   from the host's `tokens.json`.
4. Open the dashboard URL, choose green or blue under **Background**.
5. Open the overlay URL in OBS as a Browser source at 380 × 650.
6. Add the Chroma Key filter with the matching key colour.
7. Expected: the key field disappears, two labelled sections remain, nothing in
   the UI is eaten by the key, and no scrollbar appears.
8. Refresh the source: progression returns without a Minecraft restart.
9. Stop the host: the overlay fades out and shows "Lost connection…". Start it
   again; the overlay returns within ~10 s.
