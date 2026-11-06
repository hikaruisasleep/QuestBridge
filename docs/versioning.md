# QuestBridge Versioning

**Status:** Active policy  
**Current documented version:** `0pre.1`  
**Date:** 2026-11-06  
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
| `.<minor>` | Positive integer identifying the development thread. |

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

### 3.4 Current Stage 4 thread

The Stage 4 thread is already on `0pre.1`. It has already had its single minor
bump for this thread. Do not increment it again, even when the Stage 4 work
continues across several builds or fixes.

- Active version for this thread: `0pre.1`
- On close of this thread: document `0pre.1`
- Next thread: read `0pre.1`, bump once to `0pre.2`, and stay on `0pre.2`

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
- [ ] If this is a new conversation, bump only the minor component by one.
- [ ] If this is the current Stage 4 thread, keep `0pre.1`.
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
- `docs/phase-4-plan.md` — current Stage 4 implementation status and artifact.
- `AGENTS.md` — agent-level versioning rule.
