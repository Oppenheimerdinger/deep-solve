> **MOVED (2026-07-14):** deep-solve is now part of the
> [oppenheimerdinger](https://github.com/Oppenheimerdinger/oppenheimerdinger)
> plugin (bundled verbatim as of v0.2.2). Migrate with:
>
>     claude plugin uninstall deep-solve@dipark
>     claude plugin marketplace remove dipark
>     claude plugin marketplace add Oppenheimerdinger/oppenheimerdinger
>     claude plugin install oppenheimerdinger@dipark
>
> This repo is archived; history and old tags remain readable.

# deep-solve

Automates the hard-problem loop: main agent converges a self-contained BRIEF
(author-in-the-loop), the user approves it at a gate, then the SOLUTION is
converged in one of two modes:

- **isolated** — deterministic Workflow, unattended, closed-book fresh solvers
  sealed off from the live system (schedule COLD → REPAIR → COLD → SYNTH, cold
  confirmation solve, honest non-convergence). For problems fully closable on
  paper.
- **grounded** — one fresh tool-having solver + one verifying reviewer,
  attended. For problems whose load-bearing facts must be established against
  the live system (the solver grounds them itself; the reviewer re-verifies
  every cited fact).

Mode is recommended during brief-writing and decided by the user at the gate.

Lineage: `delegating-hard-problems` + `review-to-convergence` skills, glued
into one harness so no human/main-agent intervention is needed mid-loop.

## Evidence grades (two axes, no total order)

Grades combine **grounding** (were the facts checked against the live system?)
and **agreement** (did independent derivations concur?):

- isolated: `independent-agreement` > `reviewer-silence` (closed-book axis)
- grounded: `grounded-single-solver, reviewer-verified` /
  `grounded-single-solver, partially-verified` / `unconverged-grounded`
  (grounded axis)

The two axes are **incomparable**: for derivation-heavy problems agreement is
the stronger signal; for fact-heavy problems grounding is (two closed-book
solvers can agree in hallucination). Want both? Run grounded mode to establish
the facts, close the brief with them, then run isolated mode.

## Accepted residual risks (deliberate)

This is instruction text executed by LLM agents — the mode routing is a
heuristic and the procedures are not code-enforced. The design accepts small
literal-executor corner cases (e.g. stale brief facts between gate and run,
routing misjudgment on boundary problems) because every run passes a mandatory
user gate showing the full brief, mode rationale, and — in grounded mode — the
reviewer's raw verification table verbatim. The attended user is the backstop.
Grounded mode never runs under an autonomous-run waiver. Roadmap: a future
"grounded loop" (read-only tools for isolated-mode solvers) would absorb
grounded mode.

한국어 안내: [docs/USAGE-ko.md](docs/USAGE-ko.md)

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
`--model fable`, `--mode isolated|grounded` (natural-language forms like
"6라운드", "패널로" also work; rounds/reviewers/confirm apply to isolated mode
only).

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
