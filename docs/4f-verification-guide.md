# Stage 4F — retired, folded into Phase 5

**Status:** Retired 2026-11-07. **Superseded by `docs/phase-5-plan.md` and
`docs/phase-5-verification-guide.md`.** This page is kept only so a reader who
follows an old link learns where the content went and which parts of it were
wrong.

---

## 1. Why it was retired

Stage 4F was defined as a blocking preliminary stage — "verify the adapter
against a live client before anything else". It contained no code. Its content
was a list of observations, and "blocked" described a calendar problem rather
than an engineering one.

It also overlapped almost entirely with Phase 5, whose subject *is* real ATM10
TTS integration. Two documents described one session, and the split made the
project's status read as more blocked than it was.

Stage 4F is now **Sequence A** of the Phase 5 run (`docs/phase-5-plan.md` §6).
Nothing was dropped: every 4F check appears there, with the rest of the run
around it.

---

## 2. Where the content lives now

| Old 4F content | Now |
|---|---|
| Prerequisites (instance, jar, token) | `docs/phase-5-verification-guide.md` §1–2 |
| Step 1 — swap the jar | §2.1 |
| Step 2 — configure the token | §2.2 |
| Step 3 — start the host | §3, via `scripts/phase5/start-session.mjs` |
| Step 4 — launch the client | §4 |
| Step 5 — OBS overlay | §9 |
| Step 6 — verification checklist | `docs/phase-5-plan.md` §6 (Sequences A–D) and §8 |
| Step 7 — mark Phase 4 done | `docs/phase-5-plan.md` §10 |
| Failure table | `docs/phase-5-verification-guide.md` §10 |

---

## 3. Defects in the old guide

These were corrected in the replacement documents. They are recorded here
because anyone who used the old guide may have been misled by them.

1. **Wrong token location.** It said the token was in a `tokens.json` under the
   Prism directory. It is in the *host's* config directory — on Windows
   `%APPDATA%\QuestBridge\tokens.json` (`packages/host/src/paths.ts`). The
   adapter's own config is `config/questbridge-client.toml` in the Minecraft
   instance.

2. **Wrong token shape.** It described the token as UUID-shaped. Tokens are 32
   random bytes as `base64url`, 43 characters (`docs/local-authentication.md`
   §2).

3. **Wrong version.** It was written for `0pre.2` becoming the installed jar, but
   it also asserted the jar must be rebuilt and swapped for a specific path that
   has since moved. Phase 5 keeps `0pre.2` and swaps nothing beyond the stale
   `0pre.1` jar that is actually installed.

4. **Claimed outcomes prematurely.** Its post-completion checklist asked the
   agent to confirm `npm test` "all 534 pass" and to check `AGENTS.md` §18 boxes
   *after* the user confirmed. That is the right order, but the guide's framing
   implied the session would close the phase rather than feed Phase 5.

---

## 4. If you need the raw history

The retired guide is in this repository's history:

```text
git log --oneline -- docs/4f-verification-guide.md
git show <commit>:docs/4f-verification-guide.md
```
