import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { countEarlierIssues, isExcessIssue, isExempt } from '../../_scripts/issueRateLimit.mjs'

const current = {
  number: 104,
  created_at: '2026-09-27T12:00:00Z',
  user: { id: 1 }
}

test('counts open and closed issues from the same author in the prior 24 hours', () => {
  const issues = [
    { ...current, number: 101, created_at: '2026-09-26T12:00:00Z', state: 'closed' },
    { ...current, number: 102, created_at: '2026-09-27T11:00:00Z', state: 'open' },
    { ...current, number: 103, created_at: '2026-09-27T12:00:00Z' },
    current
  ]
  assert.equal(countEarlierIssues(issues, current, Date.parse(current.created_at) - 86400000), 3)
})

test('ignores older issues, other authors, PRs, and issues created later', () => {
  const issues = [
    { ...current, number: 100, created_at: '2026-09-26T11:59:59Z' },
    { ...current, number: 101, user: { id: 2 } },
    { ...current, number: 102, pull_request: { url: 'https://example.com' } },
    { ...current, number: 105 },
    { ...current, number: 103, created_at: '2026-09-27T11:59:59Z' }
  ]
  assert.equal(countEarlierIssues(issues, current, Date.parse(current.created_at) - 86400000), 1)
})

test('exempts maintainers and bots from the issue limit', () => {
  assert.equal(isExempt({ user: { id: 1, login: 'D3SOX', type: 'User' } }), true)
  assert.equal(isExempt({ user: { id: 1, login: 'app', type: 'Bot' } }), true)
  assert.equal(isExempt({ user: { id: 1, login: 'maintainer', type: 'User' }, author_association: 'COLLABORATOR' }), true)
  assert.equal(isExempt({ user: { id: 1, login: 'reporter', type: 'User' }, author_association: 'NONE' }), false)
})

test('allows 15 issues in a rolling day and closes the 16th', () => {
  const issues = Array.from({ length: 16 }, (_, index) => ({
    ...current,
    number: 101 + index,
    user: { id: 1, login: 'reporter', type: 'User' },
    created_at: `2026-09-27T00:${String(index).padStart(2, '0')}:00Z`
  }))
  assert.deepEqual(issues.map(issue => isExcessIssue(issues, issue)), [
    ...Array(15).fill(false), true
  ])
})

test('closes an excess issue before triage can run', t => {
  const directory = mkdtempSync(join(tmpdir(), 'issue-rate-limit-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const issue = {
    ...current,
    user: { id: 1, login: 'reporter', type: 'User' },
    author_association: 'NONE'
  }
  const earlier = Array.from({ length: 15 }, (_, index) => ({
    ...issue,
    number: 80 + index,
    created_at: `2026-09-27T11:${String(index).padStart(2, '0')}:00Z`
  }))
  const eventPath = join(directory, 'event.json')
  const outputPath = join(directory, 'output')
  const callsPath = join(directory, 'calls')
  writeFileSync(eventPath, JSON.stringify({ action: 'opened', issue }))
  writeFileSync(join(directory, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.CALLS_PATH, JSON.stringify(args) + '\\n')
if (args[1].includes('?state=all')) process.stdout.write(process.env.ISSUES_JSON)
else process.stdout.write(JSON.stringify({ state: 'open' }))
`, { mode: 0o755 })

  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../_scripts/issueRateLimit.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      CALLS_PATH: callsPath,
      ISSUES_JSON: JSON.stringify([issue, ...earlier]),
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_REPOSITORY: 'OpenTubeX/OpenTubeX'
    }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(outputPath, 'utf8'), 'allowed=false\n')
  const calls = readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse)
  assert.deepEqual(calls.map(args => args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET'), [
    'GET', 'GET', 'POST', 'PATCH'
  ])
})
