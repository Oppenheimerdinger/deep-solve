# deep-solve Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that automates the delegate-hard-problem → independent-review → re-solve convergence loop as a deterministic Workflow, with auto-trigger (skill) and manual trigger (`/deep-solve` command).

**Architecture:** Two phases. Phase 1 (brief convergence) is skill instructions executed by the main agent — author-in-the-loop, cannot be automated. Phase 2 (solution convergence) is a Workflow script (`solve-converge.js`) running a hard-coded round schedule COLD → REPAIR → COLD → SYNTH with early exit, cold confirmation solve, and best-of non-convergence return. No LLM routing decisions inside the loop.

**Tech Stack:** Claude Code plugin format (`.claude-plugin/plugin.json` + `skills/` + `commands/`), Workflow tool script (plain JS, ESM-style `export const meta`, top-level `return`), Node.js `node:test` for unit tests via an `AsyncFunction` harness that injects mocked `agent`/`parallel` globals.

**Spec:** `docs/superpowers/specs/2026-07-02-deep-solve-design.md` — read it before starting any task.

## Global Constraints

- Defaults (exact values): `maxRounds: 4` (= total solve-call budget INCLUDING the confirmation solve), `confirm: true`, `reviewers: 1`, `model: "opus"`.
- `model: "fable"` only when the user explicitly requests it — never as a default anywhere.
- Solver and confirmation agents: `effort: 'max'`. Reviewer agents: `effort: 'high'`. Equivalence agent: `effort: 'low'`.
- Reviewer receives ONLY brief + submitted answer — never prior findings, never prior answers.
- Panel (`reviewers > 1`): findings = union; zero-finding verdict requires ALL reviewers silent.
- Schedule generalization (internal only): last available slot = SYNTH, odd round = COLD, even round = REPAIR. User-facing output ALWAYS shows the expanded sequence (e.g. `COLD → REPAIR → COLD → SYNTH`), never the odd/even rule.
- Return contract: `{ answer, converged, evidence: "independent-agreement"|"reviewer-silence"|null, findings, roundsUsed, log }`. Never claim success on non-convergence.
- Confirmation disagreement forces SYNTH next round (overrides the schedule).
- REPAIR/SYNTH may only reuse answers that were actually reviewed (`answer` present AND `findings` is an array). Unreviewed answers are never salvage material.
- Workflow is invoked via `scriptPath` (skill base dir), never as a named workflow.
- The existing `delegating-hard-problems` and `review-to-convergence` skills in `~/.claude/skills/` are NOT modified or deleted.
- All work happens in `/fsx/dipark/projects/deep-solve` (its own repo, branch `main` — this repo is not shared, no worktree needed). Commit after every task.

---

### Task 1: Repo scaffolding — plugin manifest, marketplace manifest, README

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `README.md`

**Interfaces:**
- Produces: plugin identity `deep-solve` (skills referenced later as `deep-solve:deep-solve`), local marketplace `dipark-local` used by Task 6 install.

- [ ] **Step 1: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "deep-solve",
  "version": "0.1.0",
  "description": "Delegate a hard self-contained problem to a deterministic solve→review convergence loop (delegating-hard-problems + review-to-convergence, automated end-to-end)",
  "author": { "name": "dipark" }
}
```

- [ ] **Step 2: Write `.claude-plugin/marketplace.json`** (repo doubles as its own local marketplace so `claude plugin install` works from a local path)

```json
{
  "name": "dipark-local",
  "owner": { "name": "dipark" },
  "plugins": [
    {
      "name": "deep-solve",
      "source": "./",
      "description": "Deterministic delegate→review→re-solve convergence harness"
    }
  ]
}
```

- [ ] **Step 3: Write `README.md`**

```markdown
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
```

- [ ] **Step 4: Verify both JSON files parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin README.md
git commit -m "feat: plugin + local-marketplace manifests, README"
```

---

### Task 2: Test harness + happy-path test (failing)

**Files:**
- Create: `tests/harness.mjs`
- Create: `tests/solve-converge.test.mjs`

**Interfaces:**
- Consumes: `skills/deep-solve/solve-converge.js` (does not exist yet — the test MUST fail at this task).
- Produces: `makeMock({solves, reviews, confirms, equivs})` → `{agent, parallel, calls, logs}`; `run(mock, args)` → workflow return value. `calls[i] = {kind, label, prompt, opts}`. Later tasks' tests are written against exactly these two exports.

The harness loads the workflow script source, converts `export const meta` to `const meta`, and evaluates the body as an `AsyncFunction` with the Workflow-runtime globals (`agent`, `parallel`, `log`, `phase`, `args`, `budget`) passed as parameters. This is necessary because Workflow scripts use top-level `return`, which is illegal in a real ES module — they cannot be `import`ed directly.

The mock `agent` dispatches on `opts.label` prefix (`solve:` / `review:` / `confirm` / `equiv`) and shifts scripted results from per-kind queues. A queue value of `null` simulates a dead/skipped agent (the real `agent()` returns `null` in that case).

- [ ] **Step 1: Write `tests/harness.mjs`**

```js
import { readFile } from 'node:fs/promises'

const url = new URL('../skills/deep-solve/solve-converge.js', import.meta.url)
const src = (await readFile(url, 'utf8')).replace(/^export const meta/m, 'const meta')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

export function makeMock({ solves = [], reviews = [], confirms = [], equivs = [] } = {}) {
  const calls = []
  const logs = []
  const q = { solve: [...solves], review: [...reviews], confirm: [...confirms], equiv: [...equivs] }
  async function agent(prompt, opts = {}) {
    const label = opts.label || ''
    const kind = label.startsWith('solve:') ? 'solve'
      : label.startsWith('review:') ? 'review'
      : label.startsWith('confirm') ? 'confirm'
      : label.startsWith('equiv') ? 'equiv'
      : 'other'
    calls.push({ kind, label, prompt, opts })
    if (!(kind in q)) throw new Error(`unexpected agent kind "${kind}" (label: ${label})`)
    if (q[kind].length === 0) throw new Error(`mock queue "${kind}" exhausted (label: ${label})`)
    return q[kind].shift()
  }
  const parallel = thunks => Promise.all(thunks.map(t => t().catch(() => null)))
  return { agent, parallel, calls, logs }
}

export async function run(mock, args) {
  const fn = new AsyncFunction(
    'agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', src)
  return fn(
    mock.agent, mock.parallel, null,
    m => mock.logs.push(m), () => {}, args,
    { total: null, spent: () => 0, remaining: () => Infinity }, null)
}
```

- [ ] **Step 2: Write the happy-path test in `tests/solve-converge.test.mjs`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeMock, run } from './harness.mjs'

const S = (conclusion, answer = `full answer (${conclusion})`) => ({ answer, conclusion })
const R = (...findings) => ({ findings })
const F = (summary, detail = `detail: ${summary}`) => ({ summary, detail })
const BRIEF = 'Self-contained toy brief: compute X. A valid answer states X.'

test('happy path: COLD → zero findings → confirmation agrees → independent-agreement in 2 solves', async () => {
  const mock = makeMock({
    solves: [S('42')],
    reviews: [R()],
    confirms: [S('42')],   // identical conclusion → deterministic match, no equiv call
  })
  const out = await run(mock, { brief: BRIEF })
  assert.equal(out.converged, true)
  assert.equal(out.evidence, 'independent-agreement')
  assert.equal(out.roundsUsed, 2)
  assert.deepEqual(out.findings, [])
  assert.equal(out.answer, 'full answer (42)')
  assert.deepEqual(mock.calls.map(c => c.kind), ['solve', 'review', 'confirm'])
  assert.equal(mock.calls[0].label, 'solve:COLD:r1')
  assert.equal(mock.calls[0].opts.effort, 'max')
  assert.equal(mock.calls[0].opts.model, 'opus')   // default model
  assert.equal(mock.calls[1].opts.effort, 'high')
})
```

- [ ] **Step 3: Run and verify it FAILS (script does not exist)**

Run: `node --test tests/`
Expected: FAIL — harness throws `ENOENT ... solve-converge.js`

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: harness (AsyncFunction loader + mock agent queues) and failing happy-path test"
```

---

### Task 3: `solve-converge.js` — full workflow script

**Files:**
- Create: `skills/deep-solve/solve-converge.js`
- Test: `tests/solve-converge.test.mjs` (from Task 2)

**Interfaces:**
- Consumes: Workflow runtime globals `agent(prompt, opts)`, `parallel(thunks)`, `log(msg)`, `args`.
- Produces: return value `{ answer: string|null, converged: boolean, evidence: 'independent-agreement'|'reviewer-silence'|null, findings: [{summary, detail, ...}], roundsUsed: number, log: [{round, mode, findings: number|null}] }`. Agent labels (relied on by tests and by the /workflows progress UI): `solve:<MODE>:r<N>`, `review:r<N>:<i>`, `confirm:cold`, `equiv`.

This is the complete file. Copy verbatim — every design decision here is traceable to the spec (schedule table, confirmation semantics, best-of, honesty rules).

- [ ] **Step 1: Write `skills/deep-solve/solve-converge.js`**

```js
export const meta = {
  name: 'deep-solve-converge',
  description: 'Deterministic solve→review convergence loop over a validated self-contained brief',
  phases: [
    { title: 'Solve' },
    { title: 'Review' },
    { title: 'Confirm' },
  ],
}

// ---------- schemas ----------
const SOLVE_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'Complete answer including full reasoning' },
    conclusion: { type: 'string', description: 'Final conclusion only — one compact sentence or expression' },
  },
  required: ['answer', 'conclusion'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['summary', 'detail'],
      },
    },
  },
  required: ['findings'],
}

const EQUIV_SCHEMA = {
  type: 'object',
  properties: { equivalent: { type: 'boolean' } },
  required: ['equivalent'],
}

// ---------- pure helpers ----------
// Schedule (internal generalization; user-facing display is the EXPANDED sequence):
// last available slot = SYNTH, odd round = COLD, even round = REPAIR.
// SYNTH/REPAIR require at least one *reviewed* prior answer; otherwise degrade to COLD.
function modeFor(round, isLastSlot, forceSynth, hasReviewed) {
  if ((forceSynth || isLastSlot) && hasReviewed) return 'SYNTH'
  if (round % 2 === 0 && hasReviewed) return 'REPAIR'
  return 'COLD'
}

function findingsBlock(findings) {
  return findings.map(f => `- [round ${f.round}] ${f.summary}: ${f.detail}`).join('\n')
}

// Reviewed = has an answer AND was actually reviewed. Only reviewed answers are
// reusable as salvage material (REPAIR) or synthesis candidates (SYNTH).
function reviewedEntries(history) {
  return history.filter(h => h.answer && Array.isArray(h.findings))
}

// Rank: fewest findings first; prefer reviewer-visited integer rounds over the
// unreviewed-by-design CONFIRM half-rounds; then latest.
function rankEntries(entries) {
  return [...entries].sort((a, b) =>
    a.findings.length - b.findings.length ||
    (Number.isInteger(b.round) ? 1 : 0) - (Number.isInteger(a.round) ? 1 : 0) ||
    b.round - a.round)
}

function buildSolverPrompt(mode, brief, history, allFindings) {
  const head = `You are a fresh expert solver with a clean context. Solve the following self-contained problem. Everything you need is stated in the brief; do not assume any prior discussion.\n\n# Brief\n\n${brief}`

  if (mode === 'COLD') {
    if (allFindings.length === 0) {
      return `${head}\n\nProvide your full reasoning and final answer.`
    }
    return `${head}\n\n# Pitfall list\nPrior attempts (withheld) produced these defect findings. Treat them as cautions about known traps; if a finding references content you did not produce, treat it as a warning, not an instruction.\n${findingsBlock(allFindings)}\n\nRe-derive the answer from the brief alone, avoiding these pitfalls. Provide your full reasoning and final answer.`
  }

  if (mode === 'REPAIR') {
    const reviewed = reviewedEntries(history)
    const prev = reviewed[reviewed.length - 1]
    return `${head}\n\n# Task\nBefore reading the prior attempt below, re-derive the correct overall approach from the brief alone. Then treat the prior attempt as salvage material, not ground truth: explicitly decide keep-or-replace for its framing and justify the decision. Fix ALL listed findings; do not restrict yourself to them.\n\n# Prior attempt\n${prev.answer.answer}\n\n# Review findings on the prior attempt\n${findingsBlock(prev.findings.map(f => ({ round: prev.round, ...f })))}`
  }

  // SYNTH — adjudicate between the two best reviewed candidates, then repair the winner.
  const ranked = rankEntries(reviewedEntries(history))
  const lineup = ranked.slice(0, 2)
    .map((h, i) => `## Candidate ${i + 1} (round ${h.round}, ${h.findings.length} finding(s))\n${h.answer.answer}`)
    .join('\n\n')
  return `${head}\n\n# Task\nCandidate answers from independent derivation lineages follow, with all review findings accumulated so far. Adjudicate between their framings FIRST — decide which framing is correct and why — then repair the winner into a defect-free final answer.\n\n${lineup}\n\n# All findings so far\n${findingsBlock(allFindings)}`
}

function buildReviewerPrompt(brief, solved) {
  return `You are an independent reviewer with a clean context. Review the submitted answer strictly against the brief. Report genuine defects only — correctness errors, unsupported claims, constraint violations, gaps in reasoning — not style preferences. Return zero findings ONLY if you would stake correctness on this answer.\n\n# Brief\n\n${brief}\n\n# Submitted answer\n\n${solved.answer}\n\n# Submitted conclusion\n\n${solved.conclusion}`
}

async function conclusionsMatch(a, b, model) {
  const norm = s => s.trim().toLowerCase().replace(/\s+/g, ' ')
  if (norm(a) === norm(b)) return true
  const verdict = await agent(
    `Two independently derived conclusions to the same problem follow. Do they assert the same thing, allowing for phrasing and notation differences?\n\nA: ${a}\n\nB: ${b}`,
    { label: 'equiv', phase: 'Confirm', schema: EQUIV_SCHEMA, model, effort: 'low' })
  return verdict ? verdict.equivalent : false // unverifiable → conservative: treat as disagreement
}

// ---------- args ----------
if (!args || typeof args.brief !== 'string' || !args.brief.trim()) {
  throw new Error('args.brief (non-empty string) is required — Phase 1 must pass the converged brief')
}
const BRIEF = args.brief
const MAX = Number.isInteger(args.maxRounds) && args.maxRounds > 0 ? args.maxRounds : 4
const CONFIRM = args.confirm !== false
const REVIEWERS = Number.isInteger(args.reviewers) && args.reviewers > 0 ? args.reviewers : 1
const MODEL = typeof args.model === 'string' ? args.model : 'opus'

// ---------- state ----------
const history = []      // { round, mode, answer: {answer, conclusion}|null, findings: [...]|null }
const allFindings = []  // { round, summary, detail }
let slotsUsed = 0       // total solve calls (rounds + confirmation) — hard budget
let forceSynth = false  // set by confirmation disagreement; overrides schedule for one round
let round = 0

function summarizeLog() {
  return history.map(h => ({
    round: h.round,
    mode: h.mode,
    findings: Array.isArray(h.findings) ? h.findings.length : null,
  }))
}

// ---------- main loop ----------
while (slotsUsed < MAX) {
  round++
  const hasReviewed = reviewedEntries(history).length > 0
  const mode = modeFor(round, slotsUsed === MAX - 1, forceSynth, hasReviewed)
  forceSynth = false
  log(`round ${round}: ${mode} (slot ${slotsUsed + 1}/${MAX})`)

  const solved = await agent(buildSolverPrompt(mode, BRIEF, history, allFindings), {
    label: `solve:${mode}:r${round}`, phase: 'Solve',
    schema: SOLVE_SCHEMA, model: MODEL, effort: 'max',
  })
  slotsUsed++
  if (!solved) {
    history.push({ round, mode, answer: null, findings: null })
    log(`round ${round}: solver unavailable — slot consumed`)
    continue
  }

  const reviews = (await parallel(Array.from({ length: REVIEWERS }, (_, i) => () =>
    agent(buildReviewerPrompt(BRIEF, solved), {
      label: `review:r${round}:${i + 1}`, phase: 'Review',
      schema: REVIEW_SCHEMA, model: MODEL, effort: 'high',
    })))).filter(Boolean)

  if (reviews.length === 0) {
    history.push({ round, mode, answer: solved, findings: null })
    log(`round ${round}: all reviewers unavailable — answer kept but unreviewed (not reusable)`)
    continue
  }

  // Panel semantics: union of findings; zero ⇔ every reviewer silent.
  const findings = reviews.flatMap(r => r.findings)
  history.push({ round, mode, answer: solved, findings })
  log(`round ${round}: ${findings.length} finding(s) from ${reviews.length} reviewer(s)`)

  if (findings.length === 0) {
    if (CONFIRM && slotsUsed < MAX) {
      // Cold confirmation: brief only — upgrades "reviewer-silence" to "independent-agreement".
      const confirm = await agent(buildSolverPrompt('COLD', BRIEF, [], []), {
        label: 'confirm:cold', phase: 'Confirm',
        schema: SOLVE_SCHEMA, model: MODEL, effort: 'max',
      })
      slotsUsed++
      if (confirm) {
        if (await conclusionsMatch(solved.conclusion, confirm.conclusion, MODEL)) {
          return {
            answer: solved.answer, converged: true, evidence: 'independent-agreement',
            findings: [], roundsUsed: slotsUsed, log: summarizeLog(),
          }
        }
        const dis = {
          summary: 'independent cold confirmation reached a different conclusion',
          detail: `reviewed answer concluded: ${solved.conclusion} / confirmation concluded: ${confirm.conclusion}`,
        }
        findings.push(dis) // same array object as the history entry — best-of stays honest
        allFindings.push({ round, ...dis })
        history.push({
          round: round + 0.5, mode: 'CONFIRM', answer: confirm,
          findings: [{ summary: 'unreviewed; disagrees with a reviewed zero-finding answer', detail: `conclusion: ${confirm.conclusion}` }],
        })
        forceSynth = true // spec: disagreement forces SYNTH next, overriding the schedule
        log(`round ${round}: confirmation DISAGREED — forcing SYNTH next round`)
        continue
      }
      // confirmation agent unavailable → honest downgrade below
    }
    return {
      answer: solved.answer, converged: true, evidence: 'reviewer-silence',
      findings: [], roundsUsed: slotsUsed, log: summarizeLog(),
    }
  }

  for (const f of findings) allFindings.push({ round, ...f })
}

// ---------- budget exhausted: best-of, honest non-convergence ----------
const reviewed = reviewedEntries(history)
if (reviewed.length === 0) {
  return {
    answer: null, converged: false, evidence: null,
    findings: allFindings, roundsUsed: slotsUsed, log: summarizeLog(),
  }
}
const best = rankEntries(reviewed)[0]
return {
  answer: best.answer.answer, converged: false, evidence: null,
  findings: best.findings, roundsUsed: slotsUsed, log: summarizeLog(),
}
```

- [ ] **Step 2: Run the happy-path test — verify it PASSES**

Run: `node --test tests/`
Expected: `pass 1` / `fail 0`

- [ ] **Step 3: Commit**

```bash
git add skills/deep-solve/solve-converge.js
git commit -m "feat: solve-converge workflow script (scheduled COLD/REPAIR/COLD/SYNTH + confirmation + best-of)"
```

---

### Task 4: Full scenario test suite

**Files:**
- Modify: `tests/solve-converge.test.mjs` (append tests)

**Interfaces:**
- Consumes: `makeMock`/`run` from Task 2, labels and return contract from Task 3.

Append ALL tests below. They encode the spec's path-budget table and edge semantics. If any test fails, fix `solve-converge.js` (not the test) unless the test itself contradicts the spec.

- [ ] **Step 1: Append the scenario tests**

```js
test('local slip: COLD(findings) → REPAIR(clean) → confirm agrees → 3 solves', async () => {
  const mock = makeMock({
    solves: [S('41'), S('42')],
    reviews: [R(F('off-by-one in step 3')), R()],
    confirms: [S('42')],
  })
  const out = await run(mock, { brief: BRIEF })
  assert.equal(out.converged, true)
  assert.equal(out.evidence, 'independent-agreement')
  assert.equal(out.roundsUsed, 3)
  assert.equal(mock.calls[2].label, 'solve:REPAIR:r2')
  // REPAIR prompt carries prior answer + findings + frame-first mandate
  assert.match(mock.calls[2].prompt, /full answer \(41\)/)
  assert.match(mock.calls[2].prompt, /off-by-one in step 3/)
  assert.match(mock.calls[2].prompt, /keep-or-replace/)
})

test('structural path: findings r1-r3 → SYNTH r4 clean → budget exhausted → reviewer-silence', async () => {
  const mock = makeMock({
    solves: [S('a'), S('b'), S('c'), S('d')],
    reviews: [R(F('f1')), R(F('f2')), R(F('f3')), R()],
  })
  const out = await run(mock, { brief: BRIEF })
  assert.equal(out.converged, true)
  assert.equal(out.evidence, 'reviewer-silence') // no slot left for confirmation — honest downgrade
  assert.equal(out.roundsUsed, 4)
  const solveLabels = mock.calls.filter(c => c.kind === 'solve').map(c => c.label)
  assert.deepEqual(solveLabels, ['solve:COLD:r1', 'solve:REPAIR:r2', 'solve:COLD:r3', 'solve:SYNTH:r4'])
  const cold3 = mock.calls.find(c => c.label === 'solve:COLD:r3')
  assert.match(cold3.prompt, /Pitfall list/)
  assert.match(cold3.prompt, /f1/)                       // accumulated findings present
  assert.doesNotMatch(cold3.prompt, /full answer \(a\)/) // prior ANSWERS withheld on COLD
  const synth = mock.calls.find(c => c.label === 'solve:SYNTH:r4')
  assert.match(synth.prompt, /Candidate 1/)
  assert.match(synth.prompt, /Candidate 2/)
})

test('non-convergence: best-of returns argmin-findings answer, converged:false', async () => {
  const mock = makeMock({
    solves: [S('x'), S('y')],
    reviews: [R(F('a'), F('b')), R(F('c'))],
  })
  const out = await run(mock, { brief: BRIEF, maxRounds: 2 })
  assert.equal(out.converged, false)
  assert.equal(out.evidence, null)
  assert.equal(out.answer, 'full answer (y)') // 1 finding beats 2
  assert.equal(out.findings.length, 1)
  assert.equal(out.findings[0].summary, 'c')
  assert.equal(out.roundsUsed, 2)
})

test('confirmation disagreement forces SYNTH next round, then converges', async () => {
  const mock = makeMock({
    solves: [S('42'), S('42 final')],
    reviews: [R(), R()],
    confirms: [S('THE ANSWER IS DIFFERENT'), S('42 final')],
    equivs: [{ equivalent: false }],
  })
  const out = await run(mock, { brief: BRIEF })
  assert.equal(out.converged, true)
  assert.equal(out.evidence, 'independent-agreement')
  assert.equal(out.roundsUsed, 4) // solve + confirm + SYNTH + confirm
  const solveLabels = mock.calls.filter(c => c.kind === 'solve').map(c => c.label)
  assert.deepEqual(solveLabels, ['solve:COLD:r1', 'solve:SYNTH:r2']) // SYNTH forced, schedule overridden
})

test('confirm:false → reviewer-silence immediately, no confirmation call', async () => {
  const mock = makeMock({ solves: [S('42')], reviews: [R()] })
  const out = await run(mock, { brief: BRIEF, confirm: false })
  assert.equal(out.converged, true)
  assert.equal(out.evidence, 'reviewer-silence')
  assert.equal(out.roundsUsed, 1)
  assert.equal(mock.calls.filter(c => c.kind === 'confirm').length, 0)
})

test('panel reviewers=3: findings are a union; one dissenter blocks convergence', async () => {
  const mock = makeMock({
    solves: [S('42'), S('42')],
    reviews: [R(), R(F('dissent')), R(), R(), R(), R()], // r1: 3 reviewers (1 finding), r2: 3 silent
    confirms: [S('42')],
  })
  const out = await run(mock, { brief: BRIEF, reviewers: 3 })
  assert.equal(out.converged, true)
  assert.equal(out.roundsUsed, 3) // r1 did NOT converge despite 2/3 silent
  assert.equal(mock.calls.filter(c => c.kind === 'review').length, 6)
  assert.equal(out.log[0].findings, 1) // union captured the single dissent
})

test('dead solver consumes the slot; next round degrades to COLD (no reviewed prior)', async () => {
  const mock = makeMock({
    solves: [null, S('42')],
    reviews: [R()],
    confirms: [S('42')],
  })
  const out = await run(mock, { brief: BRIEF })
  assert.equal(out.converged, true)
  assert.equal(out.roundsUsed, 3) // dead slot + solve + confirm
  const solveLabels = mock.calls.filter(c => c.kind === 'solve').map(c => c.label)
  assert.deepEqual(solveLabels, ['solve:COLD:r1', 'solve:COLD:r2']) // r2 even but no reviewed prior → COLD
})

test('dead reviewers: answer kept but unreviewed — never reused, never converges silently', async () => {
  const mock = makeMock({
    solves: [S('x'), S('y')],
    reviews: [null, R(F('z'))],
  })
  const out = await run(mock, { brief: BRIEF, maxRounds: 2 })
  assert.equal(out.converged, false)
  assert.equal(out.answer, 'full answer (y)') // unreviewed r1 answer is not a best-of candidate
  const r2 = mock.calls.find(c => c.label === 'solve:COLD:r2')
  assert.ok(r2, 'round 2 must degrade to COLD — unreviewed answer is not salvage material')
})

test('maxRounds=6 schedule expands to COLD REPAIR COLD REPAIR COLD SYNTH', async () => {
  const mock = makeMock({
    solves: [S('1'), S('2'), S('3'), S('4'), S('5'), S('6')],
    reviews: [R(F('a')), R(F('b')), R(F('c')), R(F('d')), R(F('e')), R(F('f'))],
  })
  const out = await run(mock, { brief: BRIEF, maxRounds: 6 })
  assert.equal(out.converged, false)
  const solveLabels = mock.calls.filter(c => c.kind === 'solve').map(c => c.label)
  assert.deepEqual(solveLabels, [
    'solve:COLD:r1', 'solve:REPAIR:r2', 'solve:COLD:r3',
    'solve:REPAIR:r4', 'solve:COLD:r5', 'solve:SYNTH:r6',
  ])
})

test('model override propagates to solver, reviewer, and confirmation', async () => {
  const mock = makeMock({ solves: [S('42')], reviews: [R()], confirms: [S('42')] })
  await run(mock, { brief: BRIEF, model: 'fable' })
  for (const c of mock.calls) assert.equal(c.opts.model, 'fable')
})

test('missing brief throws', async () => {
  const mock = makeMock()
  await assert.rejects(() => run(mock, {}), /args\.brief/)
})
```

- [ ] **Step 2: Run the full suite**

Run: `node --test tests/`
Expected: all 12 tests pass (`fail 0`). If a test fails, debug `solve-converge.js` against the spec — the tests encode the spec.

- [ ] **Step 3: Commit**

```bash
git add tests/solve-converge.test.mjs
git commit -m "test: full scenario suite (schedule, confirmation, panel union, dead agents, best-of, overrides)"
```

---

### Task 5: SKILL.md + /deep-solve command

**Files:**
- Create: `skills/deep-solve/SKILL.md`
- Create: `commands/deep-solve.md`

**Interfaces:**
- Consumes: `solve-converge.js` args contract `{brief, maxRounds, confirm, reviewers, model}` and return contract from Task 3.
- Produces: skill `deep-solve:deep-solve` (auto-trigger), command `/deep-solve` (manual trigger → same skill).

- [ ] **Step 1: Write `skills/deep-solve/SKILL.md`**

````markdown
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
````

- [ ] **Step 2: Write `commands/deep-solve.md`**

```markdown
---
description: Solve a hard self-contained problem via the deep-solve convergence harness
argument-hint: <problem> [N라운드] [리뷰어 N] [확증 생략] [fable로]
---

Invoke the `deep-solve:deep-solve` skill (Skill tool) now and follow it exactly,
treating the following as the problem statement plus any overrides
(rounds / reviewers / confirm / model):

$ARGUMENTS
```

- [ ] **Step 3: Verify frontmatter and referenced paths**

Run: `node -e "const s=require('fs').readFileSync('skills/deep-solve/SKILL.md','utf8'); if(!/^---\nname: deep-solve\n/.test(s)) throw new Error('frontmatter'); require('fs').accessSync('skills/deep-solve/solve-converge.js'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Run full test suite (regression)**

Run: `node --test tests/`
Expected: `fail 0`

- [ ] **Step 5: Commit**

```bash
git add skills/deep-solve/SKILL.md commands/deep-solve.md
git commit -m "feat: deep-solve skill (Phase 1 + banner + launch + post-processing) and /deep-solve command"
```

---

### Task 6: Install + live smoke test

**Files:**
- Modify: none (CLI + Workflow invocation only)

**Interfaces:**
- Consumes: marketplace `dipark-local` (Task 1), plugin `deep-solve` (Tasks 3+5).

**NOTE:** This task must be executed by the MAIN agent (it needs the `Workflow` tool and the `claude` CLI), not delegated to a subagent.

- [ ] **Step 1: Register the local marketplace and install**

Run: `claude plugin marketplace add /fsx/dipark/projects/deep-solve && claude plugin install deep-solve@dipark-local`
Expected: install success. If the marketplace command reports a schema error, fix `.claude-plugin/marketplace.json` per the error message and retry.

- [ ] **Step 2: Live smoke test of the workflow script (cheap model, tiny budget)**

Invoke the Workflow tool directly:

```
Workflow({
  scriptPath: "/fsx/dipark/projects/deep-solve/skills/deep-solve/solve-converge.js",
  args: {
    brief: "Compute 2^10 exactly. A valid answer states the integer and shows the doubling steps.",
    maxRounds: 2,
    model: "haiku"
  }
})
```

Expected: returns `converged: true` with `evidence: "independent-agreement"` (2 solves) and `answer` containing `1024`. `evidence: "reviewer-silence"` is acceptable only if the confirmation slot was consumed (roundsUsed reached 2 before confirm) — inspect `log` if so.

- [ ] **Step 3: Verify skill and command are visible**

In a NEW Claude Code session (or after the plugin reload prompt): confirm the available-skills list contains `deep-solve:deep-solve` and `/deep-solve` autocompletes. (If verifying from this session is impossible, tell the user to check in their next session — do not claim it verified.)

- [ ] **Step 4: Commit any fixes, tag v0.1.0**

```bash
git add -A && git status --short   # commit only if fixes were made
git tag v0.1.0
```

---

## Self-Review Notes (already applied)

- Spec coverage: packaging (T1/T5), Phase 1 procedure + JSONL-grep rule (T5 SKILL.md), Phase 2 schedule/confirmation/best-of/return contract (T3), panel union (T3+T4), kickoff banner + expanded-schedule display (T5), overrides incl. fable-only-explicit (T3 default + T4 test + T5 table), error handling for dead agents (T3+T4), spec's test plan items 1–5 (T4 scenarios + T6 live run covers item 4's arg parsing partially — full natural-language parsing is skill behavior, verified in live use).
- Pre-fixed defect: REPAIR/SYNTH must only reuse REVIEWED answers (`hasReviewed`), else a dead-reviewer round would crash `findingsBlock(null)` — encoded in T3 code and T4 "dead reviewers" test.
- Type consistency: `{answer, conclusion}` solver shape, `{findings:[{summary,detail}]}` reviewer shape, and label scheme are identical across T2 harness, T3 script, T4 tests.
