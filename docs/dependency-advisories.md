# Dependency Advisory Status — do not "fix"

**Status:** Active prohibition, not a work item.
**Decided:** 2026-11-09, on the user's instruction, after a previously attempted fix.
**Applies to:** every session, every agent. Read this before touching any dependency.

> **Do not attempt to resolve the Dependabot advisories, and do not run
> `npm audit fix`, `npm audit fix --force`, or a manual version downgrade to clear them.**
>
> The current dependency state is the **best available** state. The advisories are
> tolerated by an explicit decision. A fix attempt has already been made and it made
> things worse — see §3. This prohibition exists because that attempt had to be undone,
> and because the same mistake is easy to repeat: a Dependabot banner on every push
> reads like a to-do.
>
> If the advisories are raised again — by Dependabot, by a reviewer, or by your own audit
> output — the answer is **this document**, not a fix.

---

## 1. What the advisories are

`npm audit` and GitHub Dependabot report **2 outstanding advisories** on the default
branch as of 2026-11-09 (1 moderate, 1 low). They are in **`devDependencies` of the
`apps/web-app` workspace** — build tooling, not shipped code. Nothing in them is bundled
into the frontend the host serves, and nothing in them executes in the browser or in the
Minecraft client at runtime.

The root cause is a single transitive dependency: `deepmerge@4.3.1`, pulled in by the
SvelteKit toolchain. It has **no patched release in the range the current toolchain
requires**.

## 2. Why the current state is correct

- **The current versions are current.** `@sveltejs/kit` 3.1.1, `@sveltejs/vite-plugin-svelte`
  7.3.1, `svelte` 5.57.3, `@tailwindcss/typography` 0.5.20, `postcss-selector-parser`
  7.1.7 — each is the latest in its line, not a pinned-old leftovers.
- **They are verified working.** The full workspace suite passes (**534 tests**: 85
  protocol + 30 mock-publisher + 250 host + 169 web-app, including 74 browser-mode
  component tests in real Chromium), and `npm run build` produces a working static
  frontend.
- **The advisories are dev-only.** They affect the build pipeline, not the artifact.
- **The user has confirmed this is the intended state**, and it is consistent with the
  Svelte maintainers' own position that these transitive advisories are not actionable in
  the current toolchain.

## 3. What a "fix" actually does — measured, not guessed

**`npm audit fix` proposes downgrades that break the project.** The offers are not
patches; they are *downgrades* of the entire SvelteKit toolchain to satisfy a transitive
range:

> `npm audit fix --dry-run` suggests downgrading to very old versions (`0.0.x`), which
> would break functionality.
> — commit `3a7530e` (2026-11-07)

**An attempted fix already made the situation worse.** Commit **`8eaf4dc`**
("fix(deps): resolve Dependabot vulnerabilities in web-app workspace",
2026-11-07 13:08) downgraded `@tailwindcss/typography` from `0.5.20` to `0.5.4` and added
`postcss-selector-parser` as an explicit root `devDependency` to satisfy the resulting
range. The outcome, in the user's words:

> A previous attempt of "fixing" it created **even more vulnerability warnings**, and
> `npm audit fix --force` **broke a package so hard it reverted to an ancient `0.0.x`
> version.**

So the measured results of a fix attempt are: **more advisories than before**, and a
**transitive package at `0.0.x`** that the toolchain cannot use. The `0.0.x` symptom is
the useful tell — if a package resolution ever lands there, an audit fix has run and the
tree is damaged.

**The current tree is clean of that symptom.** Verified 2026-11-09: no package at
`0.0.x`; `@tailwindcss/typography` at `0.5.20` in `web-app` with the root override at
`0.5.4` as a deliberate range-satisfier, both intentional.

## 4. What to do instead

| Situation | Action |
|---|---|
| Dependabot reports the advisories | **Nothing.** Point at this document. |
| A reviewer asks why they are unresolved | Point at this document. |
| A security tool flags them in CI | Tolerate, or suppress at the tool level with this document as the rationale. Do not change versions. |
| A genuine, non-dev advisory appears in a **runtime** dependency | **That is a different case.** Raise it with the user. This document covers the known dev-only advisories, not every future one. |
| The toolchain is upgraded wholesale, on purpose | Re-run `npm test` and `npm run build`. The advisories may clear on their own. Never upgrade *in order to* clear them. |

**The distinction that matters:** this prohibition is about the **known dev-only
advisories** and the reflex to "fix" them. It is not a blanket instruction to ignore all
security findings forever. A new advisory in shipped code is a real finding and should be
raised.

## 5. If you believe the advisories must be resolved

Do **not** attempt it directly. Instead:

1. Record the reasoning in `docs/proposals.md` as a request.
2. State what the fix would downgrade or break, with the output of
   `npm audit fix --dry-run` quoted.
3. Get an explicit decision.

The version policy still applies: a dependency change is a source change, and under
`docs/versioning.md` §3.5 a mod-source change takes a version bump. A `package-lock.json`
change alone does not, but it must still be tested — do not assume `npm test` will pass
after a downgrade, because `8eaf4dc` shows it can break resolution entirely.

## 6. History, so this is not re-litigated

| Commit | Date | What it did |
|---|---|---|
| `3a7530e` | 2026-11-07 | Recorded the advisory status and the `0.0.x` downgrade risk in prose (the retired `4f-verification-guide.md`) |
| `8eaf4dc` | 2026-11-07 | The attempted fix: downgraded `@tailwindcss/typography` `0.5.20` → `0.5.4`, added a root `postcss-selector-parser` override. **Made the advisory count worse** |
| — | 2026-11-09 | User instruction: this state is the best possible, verified by the Svelte developers. Recorded here as a standing prohibition |

The earlier prose recorded the *risk*; this document records the **decision**, and adds
the part the earlier record lacked: what actually happened when it was attempted.

## 7. Related documents

- `docs/development.md` §2 — install steps. This prohibition is referenced there.
- `docs/phase-5-postround2-worklist.md` §8 — the advisories are listed there as
  repository hygiene; **this document supersedes that framing**. They are not work.
- `docs/versioning.md` §3.5 — what a source change costs.
