import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

test('uses the push token for protected-branch version bumps', async () => {
  const workflow = loadYaml(await readFile(
    '.github/workflows/create-draft-release.yml',
    'utf8'
  ))
  const checkout = workflow.jobs.create.steps.find(
    step => step.uses?.startsWith('actions/checkout@')
  )

  assert.equal(checkout.with.token, '${{ secrets.PUSH_TOKEN }}')
})

test('records the release commit Android version code and changelog for F-Droid and consumes the release notes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'draft-release-version-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com'
  }
  const git = (...args) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8' }).trim()
  git('init', '--quiet')
  await mkdir(join(directory, 'android/app'), { recursive: true })
  await writeFile(join(directory, 'package.json'), '{"version":"0.37.0"}\n')
  const properties = await readFile('android/app/version.properties', 'utf8')
  await writeFile(join(directory, 'android/app/version.properties'), properties)
  for (const file of ['_scripts/storeReleaseNotes.mjs', 'src/renderer/helpers/releaseNotePlatforms.js']) {
    await mkdir(join(directory, dirname(file)), { recursive: true })
    await writeFile(join(directory, file), await readFile(file, 'utf8'))
  }
  await mkdir(join(directory, 'release-notes'))
  await writeFile(join(directory, 'release-notes/README.md'), '# Release notes\n')
  await writeFile(join(directory, 'release-notes/groups.md'), '---\ncategory: highlight\n---\n\nAdded groups.\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'first')
  git('commit', '--quiet', '--allow-empty', '-m', 'second')
  await writeFile(join(directory, 'release-notes.md'), '## Highlights\n\n- Added groups (#548, #2248)\n')

  const workflow = loadYaml(await readFile('.github/workflows/create-draft-release.yml', 'utf8'))
  const bump = workflow.jobs.create.steps.find(step => step.name === 'Bump package version')
  const result = spawnSync('bash', ['-c', bump.run], {
    cwd: directory,
    env: { ...env, VERSION: '0.38.0', GITHUB_OUTPUT: join(directory, 'output') },
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)

  // Release builds require twice the release commit's own count plus one.
  assert.equal(git('rev-list', '--count', 'HEAD'), '3')
  assert.equal(
    await readFile(join(directory, 'android/app/version.properties'), 'utf8'),
    properties.replace(/^versionCode=.*$/m, 'versionCode=7')
  )
  assert.deepEqual(git('show', '--format=', '--name-only', 'HEAD').split('\n'), [
    'android/app/version.properties',
    'fastlane/metadata/android/en-US/changelogs/default.txt',
    'package.json',
    'release-notes/groups.md'
  ])
  assert.deepEqual(git('ls-files', 'release-notes').split('\n'), ['release-notes/README.md'])
  assert.equal(
    await readFile(join(directory, 'fastlane/metadata/android/en-US/changelogs/default.txt'), 'utf8'),
    'Highlights\n• Added groups\n'
  )
  assert.equal(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).version, '0.38.0')
})
