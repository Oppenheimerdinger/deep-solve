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

test('args delivered as a JSON string (real Workflow runtime behavior) still works', async () => {
  const mock = makeMock({ solves: [S('42')], reviews: [R()], confirms: [S('42')] })
  const out = await run(mock, JSON.stringify({ brief: BRIEF, maxRounds: 4 }))
  assert.equal(out.converged, true)
  assert.equal(out.evidence, 'independent-agreement')
})

test('degraded panel (dead reviewer) cannot grant zero-finding convergence', async () => {
  const mock = makeMock({
    solves: [S('42'), S('42')],
    reviews: [null, R(), R(), R(), R(), R()], // r1: 1 dead + 2 silent → not attested; r2: 3 silent
    confirms: [S('42')],
  })
  const out = await run(mock, { brief: BRIEF, reviewers: 3 })
  assert.equal(out.converged, true)
  assert.equal(out.roundsUsed, 3) // r1 must NOT converge despite zero findings from survivors
})

test('forceSynth persists across a dead forced-SYNTH solver', async () => {
  const mock = makeMock({
    solves: [S('42'), null, S('42v2')],
    reviews: [R(), R()],
    confirms: [S('SEVENTEEN'), S('42v2')],
    equivs: [{ equivalent: false }],
  })
  const out = await run(mock, { brief: BRIEF, maxRounds: 6 })
  assert.equal(out.converged, true)
  assert.equal(out.evidence, 'independent-agreement')
  const solveLabels = mock.calls.filter(c => c.kind === 'solve').map(c => c.label)
  assert.deepEqual(solveLabels, ['solve:COLD:r1', 'solve:SYNTH:r2', 'solve:SYNTH:r3']) // SYNTH re-forced after dead solver
})

test('CONFIRM half-round never wins best-of on exhaustion', async () => {
  const mock = makeMock({
    solves: [S('42')],
    reviews: [R()],
    confirms: [S('SEVENTEEN')],
    equivs: [{ equivalent: false }],
  })
  const out = await run(mock, { brief: BRIEF, maxRounds: 2 })
  assert.equal(out.converged, false)
  assert.equal(out.answer, 'full answer (42)') // the REVIEWED answer, not the confirmation answer
  assert.equal(out.findings.length, 1) // the disagreement, honestly attached
})

test('premise-challenge: round-1 solver challenges a brief premise → early exit, no review burned', async () => {
  const mock = makeMock({
    solves: [{ ...S('conditional-42'), premiseChallenge: 'the d884=G1 attribution is untested; run the grid-dims query' }],
  })
  const out = await run(mock, { brief: BRIEF })
  assert.equal(out.converged, false)
  assert.equal(out.evidence, 'premise-challenge')
  assert.equal(out.premiseChallenge, 'the d884=G1 attribution is untested; run the grid-dims query')
  assert.equal(out.roundsUsed, 1)
  assert.deepEqual(mock.calls.map(c => c.kind), ['solve'])   // no reviewer, no confirm
})

test('premise-challenge ignored after round 1: round-2 REPAIR with a challenge still converges normally', async () => {
  const mock = makeMock({
    solves: [S('41'), { ...S('42'), premiseChallenge: 'late challenge — must be ignored' }],
    reviews: [R(F('slip')), R()],
    confirms: [S('42')],
  })
  const out = await run(mock, { brief: BRIEF })
  assert.equal(out.converged, true)
  assert.equal(out.evidence, 'independent-agreement')
  assert.equal(out.premiseChallenge, undefined)
})

test('empty premiseChallenge string on round 1 does NOT early-exit', async () => {
  const mock = makeMock({
    solves: [{ ...S('42'), premiseChallenge: '  ' }],
    reviews: [R()],
    confirms: [S('42')],
  })
  const out = await run(mock, { brief: BRIEF })
  assert.equal(out.converged, true)
  assert.equal(out.evidence, 'independent-agreement')
})

test('premise-challenge: dead round-1 solver, round-2 first-real-solve challenge still early-exits', async () => {
  const mock = makeMock({
    solves: [null, { ...S('cond'), premiseChallenge: 'premise X untested; run test Y' }],
  })
  const out = await run(mock, { brief: BRIEF })
  assert.equal(out.evidence, 'premise-challenge')
  assert.equal(out.premiseChallenge, 'premise X untested; run test Y')
  assert.equal(out.roundsUsed, 2)   // dead slot + the challenging solve
})
