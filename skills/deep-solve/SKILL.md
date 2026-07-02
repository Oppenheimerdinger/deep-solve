---
name: deep-solve
description: Use when blocked, stuck, or low-confidence on a hard SELF-CONTAINED sub-problem with a definite right answer — a derivation, proof, design/architecture decision, algorithm choice, root-cause, or tradeoff analysis — and the full delegate → independent-review → re-solve loop should run to convergence WITHOUT further intervention. Subsumes delegating-hard-problems for this case (that skill and review-to-convergence remain for manual/partial use). Keywords - deep solve, converge, delegate and verify, fresh eyes loop, solve to convergence.
---

# Deep Solve

Two phases. Phase 1 (brief convergence) is YOURS — author-in-the-loop, needs your
session context. Phase 2 (solution convergence) is a deterministic Workflow — once
launched, no intervention until it returns.

## Phase 1 — converge the brief (main loop, you)

1. Write a SELF-CONTAINED problem brief (delegating-hard-problems checklist):
   - Every symbol / term / variable defined.
   - Every number, measured value, and fact the solver needs is INLINE.
   - Faithful to the REAL system: cite actual `file:line` and real values, not an
     idealized sketch.
   - Established constraints / what NOT to re-litigate stated.
   - What a valid answer looks like and how it will be validated stated.
   - No "see the session"; no references a fresh agent cannot open.
   - WITHHOLD your own tentative conclusion — the solvers must derive cold.
2. Brief review loop (review-to-convergence, executed here — NOT in the Workflow,
   because only you can fix the brief):
   - Dispatch a fresh independent reviewer (Agent tool, model = resolved model
     below) checking three axes: self-contained? faithful? solvable?
   - Fix findings → re-dispatch → repeat until a pass with ZERO findings.
   - If a read-only reviewer idles without reporting, grep its transcript JSONL
     for the final assistant message instead of re-prompting.

## Resolve overrides (user request → args)

| User said | args |
|---|---|
| "N라운드", "N rounds", "--rounds N" | `maxRounds: N` |
| "리뷰어 N", "패널로", "--reviewers N" | `reviewers: N` |
| "확증 생략", "--no-confirm" | `confirm: false` |
| "fable로", "--model fable" | `model: "fable"` |

Defaults: `maxRounds: 4`, `reviewers: 1`, `confirm: true`, `model: "opus"`.
**fable ONLY on explicit user request — never by default.**

## Kickoff banner (print BEFORE launching — informational, not an approval gate)

```
▶ deep-solve 시작
  모델   : {model} (max effort)        ← fable 원하면 "fable로" 지시   [이 화살표 줄은 model이 opus일 때만]
  예산   : solve 최대 {maxRounds}회 (확증 포함)
  스케줄 : {expanded}  (조기종료 가능; 잘 된 brief는 2회로 끝남)
  리뷰어 : {reviewers}명 / 확증 solve: {on|off}
```

`{expanded}` = the schedule written out in full: last slot SYNTH, odd COLD, even
REPAIR — e.g. maxRounds 4 → `COLD → REPAIR → COLD → SYNTH`; maxRounds 6 →
`COLD → REPAIR → COLD → REPAIR → COLD → SYNTH`. NEVER show the odd/even rule to
the user; always print the expanded sequence.

## Phase 2 — launch the Workflow

Invoke the Workflow tool with the script that ships next to this skill:

```
Workflow({
  scriptPath: "<this skill's base directory>/solve-converge.js",
  args: { brief, maxRounds, confirm, reviewers, model }
})
```

The base directory is announced when this skill loads. Do not copy the script
elsewhere; do not register it as a named workflow.

## Post-processing (MANDATORY — the return is not user-visible by itself)

Report: `converged` / `evidence` / `roundsUsed` / findings summary. Then:

- `converged: true, evidence: "independent-agreement"` → adopt the answer.
- `converged: true, evidence: "reviewer-silence"` → adopt, but tell the user the
  evidence grade was downgraded (budget ran out before the confirmation solve;
  they may rerun with a larger budget).
- `converged: false` → do NOT adopt silently and do NOT auto-rerun. Either return
  to Phase 1 (suspect the brief — the most common root cause) or escalate to the
  user with the remaining findings.
