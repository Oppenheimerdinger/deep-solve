---
description: Solve a hard self-contained problem via the deep-solve convergence harness
argument-hint: <problem> [--mode isolated|grounded] [--rounds N] [--reviewers N] [--no-confirm] [--model fable]
---

Follow the deep-solve skill below EXACTLY (do not re-invoke it via the Skill
tool — its full text is inlined here), treating the arguments at the end as the
problem statement plus any overrides
(mode / rounds / reviewers / confirm / model).

(The inline exists because the command and skill share the launcher id
`deep-solve:deep-solve` — re-invoking by name resolves back to this command
and loops. Do not "simplify" this file to a Skill-tool call.)

The skill's "base directory" is `${CLAUDE_PLUGIN_ROOT}/skills/deep-solve/`, so
the isolated-mode Phase 2 script path is
`${CLAUDE_PLUGIN_ROOT}/skills/deep-solve/solve-converge.js`.

@${CLAUDE_PLUGIN_ROOT}/skills/deep-solve/SKILL.md

---

Problem statement and overrides:

$ARGUMENTS
