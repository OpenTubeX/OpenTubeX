import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { listReleaseNoteHistory } from '../../_scripts/releaseNotes.mjs'

test('release note history starts at the commit that last added the file', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-notes-history-'))
  const originalDirectory = process.cwd()
  t.after(() => {
    process.chdir(originalDirectory)
    rmSync(directory, { recursive: true, force: true })
  })

  let time = 1_700_000_000
  // Keep the developer's Git configuration, such as commit signing, out of the fixture repository.
  const git = (...args) => execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Release notes test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Release notes test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_COMMITTER_DATE: `@${time} +0000`,
    },
  }).trim()
  const file = 'release-notes/player.md'
  const commit = (message, content) => {
    time += 1
    if (content === null) {
      git('rm', '--quiet', file)
    } else {
      // Removing the only note also removes its directory.
      mkdirSync(path.join(directory, 'release-notes'), { recursive: true })
      writeFileSync(path.join(directory, file), content)
      git('add', file)
    }
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }

  git('init', '--quiet')
  commit('Add an earlier note', 'first')
  commit('Release', null)
  const added = commit('Add the note again', 'second')
  time += 1
  git('commit', '--quiet', '--allow-empty', '-m', 'Unrelated change')
  const updated = commit('Update the note', 'third')
  process.chdir(directory)

  assert.deepEqual(listReleaseNoteHistory(file), { commits: [updated, added], createdAt: 1_700_000_003 })

  // Notes can also be added while resolving a merge, such as an upstream sync.
  const mainBranch = git('branch', '--show-current')
  git('checkout', '--quiet', '-b', 'upstream', added)
  time += 1
  git('commit', '--quiet', '--allow-empty', '-m', 'Upstream change')
  git('checkout', '--quiet', mainBranch)
  git('merge', '--quiet', '--no-ff', '--no-commit', 'upstream')
  time += 1
  const mergedFile = 'release-notes/upstream.md'
  writeFileSync(path.join(directory, mergedFile), 'upstream')
  git('add', mergedFile)
  git('commit', '--quiet', '-m', 'Merge upstream with a note')

  assert.deepEqual(listReleaseNoteHistory(mergedFile), { commits: [git('rev-parse', 'HEAD')], createdAt: time })

  writeFileSync(path.join(directory, 'release-notes/draft.md'), 'draft')
  assert.deepEqual(listReleaseNoteHistory('release-notes/draft.md'), {
    commits: [],
    createdAt: Number.MAX_SAFE_INTEGER,
  })
})
