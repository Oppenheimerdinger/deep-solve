# deep-solve

Automates the hard-problem loop: main agent converges a self-contained BRIEF
(author-in-the-loop), then a deterministic Workflow converges the SOLUTION
(solve → independent review → re-solve, schedule COLD → REPAIR → COLD → SYNTH,
cold confirmation solve, honest non-convergence).

Lineage: `delegating-hard-problems` + `review-to-convergence` skills, glued
into one harness so no human/main-agent intervention is needed mid-loop.

## Install (local)

    claude plugin marketplace add /fsx/dipark/projects/deep-solve
    claude plugin install deep-solve@dipark-local

## Use

- Auto: the skill triggers when blocked on a hard self-contained sub-problem.
- Manual: `/deep-solve <problem>` — overrides: "6라운드", "리뷰어 3", "확증 생략", "fable로".

## Defaults

opus (max effort), solve budget 4 (incl. confirmation), 1 reviewer, confirm on.

## Test

    node --test tests/
