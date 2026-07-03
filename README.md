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

Explicit invocation only (no auto-trigger): `/deep-solve <problem>` or ask for
"deep solve" — overrides: `--rounds N`, `--reviewers N`, `--no-confirm`,
`--model fable` (natural-language forms like "6라운드", "패널로" also work).

After the brief converges, the skill shows you the exact brief + run parameters
and waits for your approval before launching the workflow.

## Defaults

opus (max effort), solve budget 4 (incl. confirmation), 1 reviewer, confirm on.

## Requirements

Phase 2 runs on the Claude Code **Workflow tool** (deterministic multi-agent
orchestration). On installs without it, the skill announces the limitation and
falls back to driving the loop manually with the Agent tool.

## Test

    node --test tests/*.test.mjs
