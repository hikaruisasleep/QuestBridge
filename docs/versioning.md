# QuestBridge Versioning

**Status:** Active policy  
**Current documented version:** `0pre.3`  
**Date:** 2026-11-07  
**Applies to:** the Minecraft mod version and its artifact name. Private npm workspace packages keep independent SemVer versions; they do not use `0pre.<minor>`.

This project does not use SemVer during pre-Done development. Use the custom
form below exactly; do not normalize it to `0.0.0-pre.N`.

---

## 1. Format

```text
0pre.<minor>
```

| Part | Meaning |
|---|---|
| `0` | Current major line. Pre-Done development is on major line `0`. |
| `pre` | Marks a pre-Done development version. |
| `.<minor>` | Positive integer identifying the conversation that produced the build. |

Examples:

```text
0pre.1
0pre.2
0pre.3
```

There is no patch component. Do not add `.1`, `-dev`, `-SNAPSHOT`, or build
metadata. The jar is named `questbridge-0pre.<minor>.jar`.

---

## 2. Source of truth

The current documented version is:

1. The **Current documented version** at the top of this document.
2. The `mod_version` value in `minecraft-mod/gradle.properties`.
3. The version inside `META-INF/neoforge.mods.toml` in the built jar.
4. The version in the jar filename.

These values must agree. If they do not, stop and reconcile them before building
or committing. Do not guess which one is correct.

The documented version is the version of the **most recently closed
conversation**, or the version currently active if the conversation has not yet
closed.

---

## 3. Conversation workflow

### 3.1 Start of a new conversation

1. Read the **Current documented version** in this document.
2. Increment only the minor component by exactly one.
   - `0pre.1` becomes `0pre.2`.
   - `0pre.2` becomes `0pre.3`.
3. Use the incremented version as the active version for the entire
   conversation.
4. Set `mod_version` and every artifact reference to that version.

### 3.2 During the conversation

- Keep the active version for every commit, fix, rebuild, and artifact produced
  in the conversation.
- Do **not** increment the version for individual changes.
- Do **not** bump to a new version because tests pass, a phase is complete, or
  the Definition of Done is reached.
- Do **not** rewrite or reuse an older version.

### 3.3 Close of the conversation

When the conversation is closed, update the **Current documented version** in
this document to the active version. The next conversation will read that value
and bump it once more.

### 3.4 A phase name is not a development thread

Earlier revisions of this document declared a single "Stage 4 thread" frozen on
`0pre.1`, and told agents continuing Stage 4 work not to increment again. That
rule was wrong and has been removed.

- **The thread is the conversation.** A development thread is one conversation,
  not a phase. Stage 4, Phase 4, and any later stage are areas of work that
  span many conversations.
- **If you have no prior knowledge of ever working on Stage 4, you are a new
  thread.** Your conversation did not write `0pre.1`, so §3.1 applies to you:
  read the documented version and bump the minor component by exactly one.
- **Never infer the active version from a phase name.** "This is still Stage 4"
  is not a reason to keep an earlier thread's version, and it must never be used
  to skip the bump.
- **Confirm the version with the user before starting work.** A one-line
  agreement here prevents a whole session from being built on the wrong version.

Example, which is how `0pre.2` came to be, and then how `0pre.3` did:

```text
0pre.1  written by the Stage 4A conversation
0pre.2  written by the Stage 4B conversation, even though it is still "Stage 4"
0pre.3  written by the Proposal E conversation, in Phase 5 — the "next
        conversation" this example predicted, and a different thread from both
        Phase 5 testing sessions before it
```

### 3.5 A bump requires a source change

**Decided 2026-11-07, by explicit product decision.** The bump in §3.1 is not
unconditional. A conversation that changes **no mod source code** does not earn
a new version, because a version identifies a build and no new build exists.

This applies to testing, verification, documentation, and tooling sessions:

- Phase 5 is entirely testing. It produces measurements, run logs, and possibly
  a defect list — not a new jar.
- A documentation or tooling conversation that leaves `minecraft-mod/src/`
  byte-identical does not bump the version.

The version after such a conversation is therefore the version it started on,
and it moves only when source changes justify a build. Phase 5 was the case that
produced this rule: the policy's unconditional bump would have minted
`0pre.3` for a phase that added no adapter code and shipped no artifact.

**§3.5 is a floor, not a ceiling, and Phase 5 then demonstrated the other half of
it.** After that rule was written, the Proposal E decision
(`docs/proposals.md` §6.1) fixed three adapter defects discovered *by* Phase 5's
testing. Testing produced no build; the fixes derived from it did. `0pre.3` exists
for that reason, and the distinction is the one the last bullet below draws:

- Check whether the conversation changed mod source before applying §3.1.
- If it did, bump once as §3.1 describes.
- If it did not, keep the documented version, and say so in the closing note so
  the next conversation is not surprised.
- A fix discovered *by* testing does change source: fix it, then bump, and
  re-run the affected checks.

**Worked example, 2026-11-07.** Sessions 1 and 2 were pure testing — no source
change, so no bump, and `0pre.2` remained correct through both. The defect they
found was then fixed by a later decision, which did change source, so that work
took `0pre.3`. Same phase, two conversations, one bump between them — which is
exactly what §3.4 means by "a phase name is not a development thread".

---

## 4. Major version bumps

Major versions change only when the user explicitly requests a major bump.
Examples of a user-requested major bump:

```text
0pre.4 -> 1.0.0
0pre.4 -> 1pre.1
```

Agents must not infer a major bump from:

- completing a phase;
- passing the Definition of Done;
- the number of commits or builds;
- a release checklist;
- the project version appearing “ready”.

`1.0.0` is not automatic. It is used only when the user requests a major bump.

---

## 5. Agent checklist

Before changing code or building an artifact:

- [ ] Read the **Current documented version** in this document.
- [ ] Determine whether this conversation will change **mod source code**.
- [ ] If it will, treat it as a new conversation and bump only the minor
      component by one (§3.1, §3.5).
- [ ] If it will not (testing, docs, tooling), keep the current version (§3.5).
- [ ] Do not freeze the version because the work is still "Stage 4" (§3.4).
- [ ] Confirm the active version with the user.
- [ ] Confirm `mod_version` matches the active version.
- [ ] Confirm the artifact name will be `questbridge-<active-version>.jar`.

Before the conversation closes:

- [ ] Confirm no unintended version bump occurred.
- [ ] Update the **Current documented version** in this document to the active
      version.
- [ ] Confirm `mod_version` and this document agree.

---

## 6. Related documents

- `docs/development.md` — build and test workflow.
- `docs/phase-4-plan.md` — Stage 4 implementation status and artifact.
- `docs/phase-5-plan.md` — Phase 5 (live testing), the case behind §3.5.
- `AGENTS.md` — agent-level versioning rule.
