---
name: deep-solve
description: This skill should be used ONLY on explicit request — the user invokes /deep-solve or says "deep solve" / "deep-solve" / "딥솔브" / "solve to convergence" / "delegate and verify". Never auto-trigger for merely hard problems or stuck sessions; without an explicit request, at most briefly mention that /deep-solve is available and continue normally. Once invoked, fits hard self-contained problems with a definite right answer (derivation, proof, algorithm choice, root-cause, design tradeoff).
---

# Deep Solve

Two phases plus a user gate. Phase 1 (brief convergence) is YOURS —
author-in-the-loop, needs your session context. Then the USER approves the
converged brief. Phase 2 (solution convergence) is a deterministic Workflow —
once launched, no intervention until it returns.

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
   - ★EMPIRICAL-PREMISE PROVENANCE: classify every MEASURED claim the problem rests
     on — especially LABELS/attributions connecting a measurement to an entity
     ("kernel X is call Y", "the slow phase is Z") — as (a) directly verified by a
     described experiment, or (b) inherited/inferred. A load-bearing (b) with a
     cheap decisive test (≲30 min) is an UNCLOSED PREMISE: run that test and fold
     the result in BEFORE Phase 2. **A brief with an unclosed cheap-verifiable
     load-bearing premise is NOT converged** — this includes anything you were
     tempted to file under an "honest gap / experiment #0" section: if it is cheap
     and could invalidate the problem statement, it runs NOW, not in the solver's
     ladder. (2026-07-04 lesson: a name-plausibility kernel attribution inherited
     unverified cost a full 5-round run + an implementation campaign — one grid
     query would have killed the premise first.)
2. Brief review loop (review-to-convergence, executed here — NOT in the Workflow,
   because only you can fix the brief):
   - Dispatch a fresh independent reviewer: a general-purpose read-only agent
     (Agent tool, model = resolved model below). Its prompt must include the full
     brief verbatim and instruct it to check FOUR axes — self-contained?
     faithful? solvable? premise-audited? — where "faithful" REQUIRES opening every
     cited `file:line` in the repo and verifying the brief's claims against the
     actual code/values, and "premise-audited" REQUIRES listing each load-bearing
     MEASURED claim with its provenance class ((a) directly verified / (b)
     inherited-unverified) and flagging any (b) that has a cheap decisive test as
     a BLOCKING finding. It returns a findings list (empty list = pass).
   - Fix findings → re-dispatch → repeat until a pass with ZERO findings.
   - If not converged after 4 review iterations, stop and escalate to the user
     instead of looping further.
   - If a read-only reviewer idles without reporting, grep its transcript JSONL
     (under `~/.claude/projects/<project-slug>/`) for the final assistant
     message instead of re-prompting.

## Resolve overrides (user request → args)

| User said | args |
|---|---|
| "N라운드", "N rounds", "--rounds N" | `maxRounds: N` |
| "리뷰어 N", "N reviewers", "--reviewers N" | `reviewers: N` |
| "패널로", "as a panel" (no number given) | `reviewers: 3` |
| "확증 생략", "skip confirmation", "--no-confirm" | `confirm: false` |
| "fable로", "use fable", "--model fable" | `model: "fable"` |

Defaults: `maxRounds: 4`, `reviewers: 1`, `confirm: true`, `model: "opus"`.
**fable ONLY on explicit user request — never by default.**

## User gate — approve the brief (MANDATORY, blocks Phase 2)

After the brief review loop converges, present to the user in ONE message:

1. **The converged brief, full text** (quoted block) — the user must be able to
   inspect exactly what the solvers will receive.
2. **The kickoff banner** with the resolved run parameters:

```
▶ deep-solve
  model    : {model} (max effort)
  budget   : up to {maxRounds} solves (incl. confirmation)
  schedule : {expanded}  (may exit early; a good brief finishes in 2)
  reviewers: {reviewers} / confirmation solve: {on|off}
```

3. **An explicit question**: launch as-is / edit the brief / adjust parameters /
   cancel. Do NOT start Phase 2 — Workflow or manual fallback — until the user
   approves. If the user edits the brief substantively, fold the edits in,
   re-run one brief review pass, and re-present the gate. If the user adjusts
   parameters or makes non-substantive edits, apply them and re-present the
   gate with the updated banner; launch only on an explicit go.

**Pre-approval path**: if the user has explicitly authorized autonomous
execution for this run ("자율적으로 진행", "run autonomously", "승인 생략" /
"skip approval", "게이트 스킵"), do not wait at the gate — but STILL print the
full brief and the banner (the record stands even when the wait is waived),
then launch immediately. Vague delegation ("알아서 해줘" without reference to
this run's approval) does NOT qualify — present the gate normally.

Render everything — banner labels included — in the conversation language (e.g.
Korean labels for a Korean conversation). When `model` is opus, append a short
hint on the model line that the user may request the strongest model (e.g.
`← say "use fable" / "fable로" for the strongest model`); omit the hint otherwise.

`{expanded}` = the schedule written out in full: last slot SYNTH, odd COLD, even
REPAIR — e.g. maxRounds 4 → `COLD → REPAIR → COLD → SYNTH`; maxRounds 6 →
`COLD → REPAIR → COLD → REPAIR → COLD → SYNTH`. NEVER show the odd/even rule to
the user; always print the expanded sequence.

## Phase 2 — launch the Workflow (only after user approval)

Invoke the Workflow tool with the script that ships next to this skill:

```
Workflow({
  scriptPath: "<this skill's base directory>/solve-converge.js",
  args: { brief, maxRounds, confirm, reviewers, model }
})
```

The base directory is announced when this skill loads. Do not copy the script
elsewhere; do not register it as a named workflow.

If the Workflow tool is NOT available in this environment, say so to the user
(Phase 2 requires it) and fall back to running the loop manually with the Agent
tool: fresh solver → fresh independent reviewer per round, following the same
schedule and honesty rules.

## Post-processing (MANDATORY — the return is not user-visible by itself)

Report: `converged` / `evidence` / `roundsUsed` / findings summary (plus
`premiseChallenge` when `evidence` is `"premise-challenge"`). Then:

- `converged: true, evidence: "independent-agreement"` → adopt the answer.
- `converged: true, evidence: "reviewer-silence"` → adopt, but tell the user the
  evidence grade was downgraded (no independent confirmation — budget exhausted,
  confirm disabled, or confirmation agent unavailable; they may rerun with a
  larger budget).
- `converged: false, evidence: "premise-challenge"` → the round-1 solver challenged
  a load-bearing, untested premise of the brief itself — this is NOT a solve
  failure. Do NOT adopt `answer` (it is only a conditional best-effort) and do NOT
  relaunch the solver. Read the `premiseChallenge` field (named premise + exact
  cheap test), RUN that test yourself, and fold the result into the brief. If it
  invalidates the premise the problem statement changes; if it confirms it,
  annotate that. Either way re-present the corrected brief at the Phase-1 user
  gate before any relaunch.
- `converged: false` otherwise (budget exhausted; `answer` may be null if no
  attempt was ever reviewed) → do NOT adopt silently and do NOT auto-rerun. The
  best reviewed attempt is still returned in `answer` — show it clearly marked as
  UNCONVERGED alongside its remaining findings. Then either return to Phase 1
  (suspect the brief — the most common root cause; the user gate applies again
  before any relaunch) or escalate to the user.
