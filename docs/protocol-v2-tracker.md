# Protocol v2 Candidate Tracker

**Status:** Tracking only. **Protocol v2 is not approved, designed, or scheduled.**
This document records features that have been requested or that protocol v1
provably cannot carry, so they are not lost or re-discovered later.
**Date:** Created 2026-11-07.
**Applies to:** `packages/protocol`, the host, the frontend, the mock publisher,
and the Java adapter.
**Companion documents:** `docs/protocol.md` (the v1 contract, normative),
`docs/versioning.md` §3.5 and §4 (when a version may move),
`AGENTS.md` §19 (future extensions).

---

## 1. What this document is, and is not

**It is** a durable list of things that would need a protocol version change,
each with the evidence that says so. An item can sit here indefinitely.

**It is not** an approval, a design, a roadmap, or a commitment. Nothing here may
be implemented on the strength of its presence in this list. `AGENTS.md` §19 is
explicit: *"Do not implement these until the initial product is reliable."*

Three rules for using this document:

1. **An entry needs evidence.** Every item below cites the document or schema
   that makes it a v2 candidate. Nothing is listed on a hunch.
2. **Do not design v2 piecemeal.** The entries interact — several touch the same
   `DisplayConfig` object — and a version change is coordinated across four
   components (`docs/development.md` §7). Batching is the point of collecting
   them here.
3. **Recording a request is not agreeing to it.** Several entries may never be
   built. A request is recorded because the user asked, and marked as such.

### 1.1 Protocol version is not the mod version

These are independent and must not be conflated:

| | Value | Moved by |
|---|---|---|
| Protocol version | `1` (`packages/protocol/src/version.ts`) | A wire-format change |
| Mod version | `0pre.2` (`docs/versioning.md`) | A mod source change |

Protocol v2 does **not** imply a major mod version bump, and a mod version bump
does not imply protocol v2. `docs/versioning.md` §4 governs the mod version
separately.

### 1.2 Why v1 cannot take these additively

Protocol v1 objects are **strict**: every object rejects unknown fields, and
`docs/protocol.md` §4 states that additive changes are *not* backward compatible
under this policy:

> Additive changes (new optional fields, new message types) are **not**
> backward compatible under this policy because objects are strict. Such changes
> require version `2`.

So "just add an optional field" is not available. That single fact is what turns
every entry below from a small patch into a version change.

---

## 2. Requested by the user

### V2-1 — Background (chroma key) colour synchronised through the host

**Requested:** 2026-11-07, explicitly.

**Current behaviour.** The overlay paints a solid `#00FF00` or `#0000FF` field
for OBS chroma keying. The choice is stored in the browser's `localStorage` under
`questbridge.chromaKey.v1` and **never reaches the host**.

**Why that is a problem in practice**, per `docs/web-frontend.md` §4.1:

- It is **per browser profile.** The OBS source reads whatever was last set in
  the profile OBS uses; a dashboard tab in another browser can show a different
  colour with nothing wrong.
- It is **not in the host's broadcast.** A browser that has never set a value
  falls back to green.
- The streamer must therefore set it twice, in two places, and keep them in step
  by hand. Getting it wrong shows green fringing or a keyed-out overlay on
  stream.

**Why it needs v2.** `DisplayConfig` is a `z.strictObject`
(`packages/protocol/src/schemas.ts`), and the field does not exist in v1.

**Evidence it was always intended for here.**

> "Moving this into `DisplayConfig` is the natural first change for a future
> protocol version." — `docs/web-frontend.md` §4.1

> "Migrating it into `DisplayConfig` is the natural first change for a future
> protocol version." — `docs/phase-3-plan.md` §14.2.1

**Sketch (not a design).** A `chromaKey: "green" | "blue"` field on
`DisplayConfig`, defaulted to `green` so existing configurations migrate
cleanly, with the frontend keeping `localStorage` as a fallback only until the
first snapshot arrives.

**Considerations to settle before designing:**

- Whether `localStorage` should remain a *per-device override* on top of the
  host value. An argument exists for it: a streamer previewing on a second
  monitor might want a different key there. Against it: two sources of truth is
  what caused the problem.
- The palette rule (`docs/web-frontend.md` §4.2) is keyed on channel dominance
  and is already tested for both colours, so a third key colour is not free.
- `docs/testing-logs/2026-11-07-phase3-overlay.md` §0.1 records the current
  palette audit for both keys; changing the default would invalidate that record.

**Status:** requested; undesigned.

---

## 3. Documented as deferred to a future protocol version

### V2-2 — Objectives auto-scroll configurability

**Current behaviour.** When the objectives content overflows its container, a
back-and-forth scrolling animation runs. It is **unconditional**.

**Why it needs v2.** `docs/phase-3-plan.md` §3.4:

> **Not configurable in this phase.** `DisplayConfig` is a `strictObject` and
> protocol v1 permits no additive fields, so an `autoScroll` setting would
> require a v2 bump across the schema, host, mock publisher, and the Java
> adapter. The behaviour is unconditional for now; configurability can ride
> along with a future v2 bump planned for other reasons.

Note the last clause: this entry was written *expecting* to travel with others,
which is why this tracker exists.

**Considerations.** The animation is treated as content rather than decoration
(`docs/phase-3-plan.md` §11.3, `docs/web-frontend.md` §3.5), and
`prefers-reduced-motion` is deliberately not honoured. A user-facing toggle is a
different thing from an accessibility branch, but the reasoning should be
revisited rather than assumed.

**Status:** deferred by design decision; not requested.

### V2-3 — Chapter visibility on the wire

**Current behaviour.** `Chapter.status` describes **progression availability**
(`available` / `locked` / `completed` / `unknown`), deliberately not visibility.
The 4A probe reads and logs `visible` and `explicitlyHidden`, but they are
probe-only diagnostics and are not published.

**Why it needs v2.** `docs/protocol.md` §8.1:

> Protocol v1 has no chapter visibility field; adding one requires a protocol
> version change.

And `docs/phase-4-plan.md` §5.2:

> **Protocol v1 has no chapter visibility field.** The 4A probe reports `visible`
> and `explicitlyHidden`; they stay a probe-only diagnostic and must not be
> squeezed into `status`. Adding them to the wire requires a version change.

**Why it might matter.** `docs/ftb-quests-integration.md` §5.3 documents that
`Chapter.isVisible(teamData)` is false for `alwaysInvisible` chapters and for
chapters with no visible quests, while such a chapter may still be playable. A
dashboard that could distinguish "hidden" from "locked" would explain a chapter
that is startable but not shown in the book.

**Constraint that must survive any implementation:** visibility must never
become `locked`. The existing separation is the point of the current mapping and
is easy to break.

**Status:** deferred; no user request.

### V2-4 — Custom typography and sizing

**Current behaviour.** Typography is fixed. `docs/phase-3-plan.md` §14.3 records
that sizes from 9 px to 13 px were chosen for a 380 × 650 frame and measured only
as computed values — readability over moving gameplay has never been checked on a
stream.

**Why it needs v2.** `DisplayConfig` is strict, so per-streamer font size,
scale, or density cannot be added in v1. `AGENTS.md` §19 lists "Custom typography
and sizing" as a planned future extension.

**Considerations.** The overlay's no-external-assets rule means size and weight
would be configurable but the typeface family would not. Any sizing change
interacts with the fixed-frame assumption used throughout the 380 × 650
verification.

**Status:** future extension (`AGENTS.md` §19); no user request.

### V2-5 — Additional themes

**Current behaviour.** `theme` is the literal `"minimal"`
(`packages/protocol/src/schemas.ts`), not an enum of options.

**Why it needs v2.** A second theme value cannot be added without widening the
schema, and the field is in the strict `DisplayConfig`.

**Status:** future extension; no user request. Related to V2-1 and V2-4 because a
theme could plausibly subsume both.

---

## 4. Reserved in v1 but unused

### V2-6 — Task progress `unit`

**Current behaviour.** `TaskProgress.unit` is declared and documented as
reserved; v1 adapters do not emit it.

`docs/protocol.md` §8.4 and §14 (open question 5):

> **Task units.** `unit` is reserved; FTB Quests 2101.1.30 does not expose a
> general unit, so v1 adapters omit it.

**What would make it live.** FTB exposing a unit for a task type, or QuestBridge
deriving one per task type (for example `ftbquests:item` → "items"). Deriving it
would be QuestBridge inventing presentation data, which needs an explicit
decision rather than an accident.

**Status:** reserved; blocked on FTB, not on QuestBridge.

### V2-7 — `stale_revision` and optimistic concurrency

**Current behaviour.** The `stale_revision` error code is reserved and never
emitted. Mutations apply against current host state; the host does not require a
client-supplied revision.

`docs/protocol.md` §10.4 and §14 (open question 4):

> `stale_revision` is reserved for Phase 2 if optimistic concurrency is added.
> The initial host applies mutations against current state and returns the
> resulting configuration; it does not require a client-supplied revision.

**Why it might matter.** `docs/chapter-pinning.md` §12 requires that "a stale
dashboard attempting to reorder based on old data must receive an error and
refresh". Today that is satisfied by the reorder set check
(`invalid_reorder_set`) rather than by a revision check. Two dashboards open at
once is the scenario that would distinguish them.

**Note:** this may be implementable **without** a protocol version change if it
only uses the already-defined envelope `requestId` and the existing
`revision` in state. It is listed because `docs/protocol.md` calls the code
reserved, and confirming whether it needs v2 is itself work.

**Status:** reserved; needs a scoping decision before it is known to be a v2 item.

---

## 5. Divergences and open questions

### V2-8 — `chapter.catalog` is documented but does not exist

**The divergence.** `AGENTS.md` §9 lists `chapter.catalog` as a host-to-browser
message type. Protocol v1 does not have it:

```
HOST_TO_BROWSER_TYPES = [
  "state.snapshot", "state.update", "chapter.pins.update",
  "config.update", "connection.status", "request.error",
]
```

— `packages/protocol/src/schemas.ts`

The catalog travels inside `state.snapshot` and `state.update` instead, which
works because the catalog is small (55 chapters for ATM10 TTS).

**Why it is listed here rather than fixed silently.** Two resolutions exist and
they are not equivalent:

- **Correct `AGENTS.md`.** The catalog is part of the state object and a separate
  message was never needed. This is a documentation fix, not a v2 item.
- **Add the message in v2.** Justified only if the catalog ever becomes large
  enough to want independent delivery — for example a pack with thousands of
  chapters, where re-sending the catalog inside every `state.update` would be
  wasteful.

**Recommendation:** resolve the documentation first. Do not carry an unused
message type into v2 to satisfy a stale line in `AGENTS.md`.

**Status:** unresolved divergence; probably a docs fix.

### V2-9 — `state.update` duplication

`docs/protocol.md` §14 (open question 3): the host may send section-specific
messages *in addition to* `state.update` for the same change, and browsers must
treat all of them idempotently. `docs/phase-3-recon.md` §4.3 measured this: one
pin change produces two messages, four if display and connection are involved.

**Why it is listed.** A later cleanup may choose one form. If that cleanup
removes message types, it is a version change; if it only stops *sending* them, it
is not. Worth deciding deliberately rather than by drift.

**Status:** open question; no user request.

### V2-10 — Timestamp skew

`docs/protocol.md` §14 (open question 6): timestamps are informational and no
skew rejection is specified.

**Why it is listed.** Any move to use timestamps for ordering or staleness would
be a semantic change to the envelope. Listed so it is not done implicitly.

**Status:** open question; no user request.

---

## 6. Not v2 candidates

Recorded so they are not mistakenly pulled in.

### 6.1 Cross-reference: every `AGENTS.md` §19 future extension

§19 lists eight extensions. This table says where each one lives, so none is
silently unaccounted for:

| §19 extension | Where it belongs |
|---|---|
| Additional modpacks | Not a protocol concern — see below |
| Additional chapter pin profiles | Not a protocol concern — see below |
| Multiple OBS layouts | Not a protocol concern — see below |
| Quest completion notifications | Not a v2 candidate yet — see below |
| Chapter completion notifications | Not a v2 candidate yet — see below |
| Session progression history | Not a protocol concern — see below |
| Custom typography and sizing | **V2-4** |
| Additional task progress renderers | Not a protocol concern — see below |

Seven of the eight are host- or frontend-side work that does not change the wire
shape. Only typography (V2-4) is a wire change today.

### 6.2 Why each is not a v2 candidate

| Item | Why not |
|---|---|
| Transport authentication | Settled: `docs/local-authentication.md`. Not a payload concern. |
| WebSocket paths | `/ws` with a role hello is implemented and stable. Separate per-role paths would not change payloads. |
| Chapter pin maximum (5) | A product constant, not a wire-shape constraint. Changing it is a product decision. |
| Quest pinning | FTB owns it. A non-goal (`AGENTS.md` §2.4). |
| Auto-pin tracker reconstruction | Deferred product scope; the *filter* is v1 behaviour and works. |
| Full quest-book transmission | Explicitly refused for size reasons (`docs/protocol.md` §1). |
| **Additional modpacks** | The protocol already treats IDs as opaque strings and imposes no pack-specific rule (`docs/protocol.md` §8). A second pack needs no wire change. |
| **Additional chapter pin profiles** | Host configuration. Would not change the wire unless profiles became selectable from Minecraft, which is out of scope. |
| **Multiple OBS layouts** | Frontend presentation. The overlay renders from `AppState`; a second layout reads the same state. Would only become a v2 item if a layout needed data v1 does not carry — at which point it is really the field that is a candidate, not the layout. |
| **Session progression history** | Host-side storage. Would need a *new* question answered (where history comes from, how long it is kept) before it needs a message. |
| **Quest / chapter completion notifications** | Likely v2 — a notification is a new event with no v1 representation — but unimplemented and undesigned anywhere, and not requested. Listed here as "would need a request and a design" rather than as a candidate, because promoting it without either would be inventing a feature in a tracker. |
| **Additional task progress renderers** | Presentation. Renderers consume `TaskProgress`, which already carries `status`, `current`, `target`, `percentage`. A new renderer needs no new field. |

---

## 7. The cost of a v2 change

Every item above is coordinated across four components, because v1's strictness
is enforced independently in each:

| Component | Change required |
|---|---|
| `packages/protocol` | Schema, types, message catalogue, tests |
| `packages/host` | Ingest, validate, broadcast, persist if configured |
| `packages/mock-publisher` | Fixtures and every scenario that touches the changed shape |
| `apps/web-app` | Consume the new field; keep v1 tolerance only if v2 is negotiated |
| `minecraft-mod` | Hand-written encoder in `protocol/` and the mapper |

**Negotiation is one-shot**, not per-message: a peer either speaks the version or
the connection fails with `unsupported_protocol` (`docs/protocol.md` §4). There is
no downgrade path, so a v2 release means both sides move together, and a user who
updates only the jar or only the host gets a refused connection. That failure mode
needs deciding on before v2 ships.

**Consequence:** the entries that touch `DisplayConfig` (V2-1, V2-2, V2-4, V2-5)
should be settled **together**, in one version bump, rather than four separate
ones.

---

## 8. Backlog

| ID | Item | Origin | Needs v2? | Requested |
|---|---|---|---|---|
| V2-1 | Background/chroma key colour sync | User request, 2026-11-07 | Yes | **Yes** |
| V2-2 | Auto-scroll configurability | `docs/phase-3-plan.md` §3.4 | Yes | No |
| V2-3 | Chapter visibility on the wire | `docs/protocol.md` §8.1 | Yes | No |
| V2-4 | Custom typography and sizing | `AGENTS.md` §19 | Yes | No |
| V2-5 | Additional themes | `theme` is a literal | Yes | No |
| V2-6 | Task progress `unit` | `docs/protocol.md` §8.4 | Yes | No |
| V2-7 | `stale_revision` / optimistic concurrency | `docs/protocol.md` §10.4 | Probably | No |
| V2-8 | `chapter.catalog` divergence | `AGENTS.md` §9 | Docs fix first | No |
| V2-9 | `state.update` duplication | `docs/protocol.md` §14 | Maybe | No |
| V2-10 | Timestamp skew | `docs/protocol.md` §14 | Maybe | No |

**One item has been requested: V2-1.** The rest are deferrals recorded by earlier
work or reserved placeholders. No item is approved, and none may be implemented
before the initial product is reliable (`AGENTS.md` §19).

---

## 9. How to add an entry

1. Cite the document, schema, or request that makes it a v2 candidate. An entry
   without evidence is a wish, not a candidate.
2. Say whether the **user** requested it or earlier work deferred it. These have
   different standing.
3. State what would have to be true for it to be needed — many entries here are
   blocked on something other than QuestBridge.
4. Note what it interacts with. Nearly everything touches `DisplayConfig`.
5. Do not design it. Design belongs in a v2 plan, written when v2 is approved.
6. Update the backlog table in §8.
