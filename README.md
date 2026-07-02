# deep-solve

Automates the hard-problem loop: main agent converges a self-contained BRIEF
(author-in-the-loop), then a deterministic Workflow converges the SOLUTION
(solve → independent review → re-solve, schedule COLD → REPAIR → COLD → SYNTH,
cold confirmation solve, honest non-convergence).

Lineage: `delegating-hard-problems` + `review-to-convergence` skills, glued
into one harness so no human/main-agent intervention is needed mid-loop.

## Install

    claude plugin marketplace add Oppenheimerdinger/deep-solve
    claude plugin install deep-solve@dipark

Or from a local clone:

    claude plugin marketplace add /path/to/deep-solve
    claude plugin install deep-solve@dipark

## License

MIT

## Use

- Auto: the skill triggers when blocked on a hard self-contained sub-problem.
- Manual: `/deep-solve <problem>` — overrides: "6라운드", "리뷰어 3", "확증 생략", "fable로".

## Defaults

opus (max effort), solve budget 4 (incl. confirmation), 1 reviewer, confirm on.

## Requirements

Phase 2 runs on the Claude Code **Workflow tool** (deterministic multi-agent
orchestration). On installs without it, the skill announces the limitation and
falls back to driving the loop manually with the Agent tool.

## Test

    node --test tests/*.test.mjs
