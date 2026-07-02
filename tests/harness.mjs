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
