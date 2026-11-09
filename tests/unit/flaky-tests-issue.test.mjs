import assert from 'node:assert/strict'
import test from 'node:test'

import { updateFlakyTestsBody } from '../../_scripts/flakyTestsIssue.mjs'

const filmstrip = {
  project: 'offline',
  title: 'finger drags on the seek bar show the filmstrip, taps do not',
  file: 'e2e/tests/offline/seekbar-filmstrip.spec.mjs',
  line: 356
}

function run(body, tests, branch, date = '2026-10-28') {
  return updateFlakyTestsBody(body, tests, { runUrl: `https://example.test/runs/${branch}`, branch, date })
}

function items(body) {
  return body.split('\n').filter(line => line.startsWith('- '))
}

test('keeps untrusted titles and branches inert in Markdown and in the entry data', () => {
  const hostile = { ...filmstrip, title: 'ping @someone `x` | --> --!> <b>[link](https://evil.test)' }
  const body = run('', [hostile], 'feature/`a`-->')
  const [line] = items(body)

  assert.ok(line.includes("`ping @someone 'x' | --> --!> <b>[link](https://evil.test)`"), line)
  assert.ok(line.includes("on `feature/'a'-->`"), line)
  // No ">" may end the comment early, whether as "-->" or "--!>".
  const data = line.slice(line.indexOf('<!-- flaky-test'))
  assert.ok(data.endsWith(' -->'), data)
  assert.equal(data.slice(0, -1).includes('>'), false)
  assert.equal(data.includes('|'), false)
  assert.deepEqual(items(run(body, [hostile], 'pr-b')).map(item => item.match(/\*\*(\d+)×/)[1]), ['2'])
})
