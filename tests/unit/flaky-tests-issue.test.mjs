import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { readFlakyTests, updateFlakyTestsBody } from '../../_scripts/flakyTestsIssue.mjs'

const filmstrip = {
  project: 'offline',
  title: 'finger drags on the seek bar show the filmstrip, taps do not',
  file: 'e2e/tests/offline/seekbar-filmstrip.spec.mjs',
  line: 356
}
const tabSwitcher = {
  project: 'offline-95',
  title: 'tab switcher hold delay › scrolls the held selection into view after wrapping @scale',
  file: 'e2e/tests/offline/tab-switcher-keyboard.spec.mjs',
  line: 31
}

function run(body, tests, branch, date = '2026-10-28') {
  return updateFlakyTestsBody(body, tests, { runUrl: `https://example.test/runs/${branch}`, branch, date })
}

function items(body) {
  return body.split('\n').filter(line => line.startsWith('- '))
}

test('counts repeated flakes across runs and lists the most frequent first', () => {
  let body = run('', [tabSwitcher], 'pr-a')
  body = run(body, [filmstrip], 'pr-b')
  body = run(body, [filmstrip, { ...filmstrip, project: 'offline-125' }], 'pr-c', '2026-10-29')

  const [first, second] = items(body)
  assert.match(first, /^- \*\*3×\*\* `e2e\/tests\/offline\/seekbar-filmstrip\.spec\.mjs:356`/)
  assert.match(first, /\(`offline`, `offline-125`\), last on 2026-10-29 in \[this run\]\(https:\/\/example\.test\/runs\/pr-c\) on `pr-c`, `pr-b`/)
  assert.match(second, /^- \*\*1×\*\* `e2e\/tests\/offline\/tab-switcher-keyboard\.spec\.mjs:31`/)
})

test('deleting a line after a fix resets that test and keeps the others', () => {
  const body = run(run('', [filmstrip, tabSwitcher], 'pr-a'), [filmstrip], 'pr-b')
  const fixed = body.split('\n').filter(line => !line.includes('seekbar-filmstrip')).join('\n')

  const next = items(run(fixed, [filmstrip], 'pr-c'))
  assert.equal(next.length, 2)
  assert.ok(next.some(line => line.startsWith('- **1×** `e2e/tests/offline/seekbar-filmstrip')))
})

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

test('reads the reports of every shard and ignores malformed entries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'flaky-tests-'))
  try {
    for (const [name, tests] of [['e2e-flaky-offline-1', [filmstrip, { title: 'missing fields' }]], ['e2e-flaky-offline-2', [tabSwitcher]]]) {
      mkdirSync(join(directory, name))
      writeFileSync(join(directory, name, 'e2e-flaky.json'), JSON.stringify(tests))
    }
    assert.deepEqual(readFlakyTests(directory).map(test => test.line).sort(), [31, 356])
    assert.deepEqual(readFlakyTests(join(directory, 'missing')), [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
