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
