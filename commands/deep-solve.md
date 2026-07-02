---
description: Solve a hard self-contained problem via the deep-solve convergence harness
argument-hint: <problem> [--rounds N] [--reviewers N] [--no-confirm] [--model fable]
---

Follow the deep-solve skill below EXACTLY (do not re-invoke it via the Skill
tool — its full text is inlined here), treating the arguments at the end as the
problem statement plus any overrides (rounds / reviewers / confirm / model).

The skill's "base directory" is `${CLAUDE_PLUGIN_ROOT}/skills/deep-solve/`, so
the Phase 2 script path is
`${CLAUDE_PLUGIN_ROOT}/skills/deep-solve/solve-converge.js`.

@${CLAUDE_PLUGIN_ROOT}/skills/deep-solve/SKILL.md

---

Problem statement and overrides:

$ARGUMENTS
