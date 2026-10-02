import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { load } from 'js-yaml'

async function fixture (t, tag) {
  const directory = await mkdtemp(join(tmpdir(), 'sidestore-dispatch-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const requests = join(directory, 'requests')
  for (const name of ['gh', 'wget']) {
    const path = join(directory, name)
    await writeFile(path, `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.REQUESTS_FILE, JSON.stringify(['${name}', ...args]) + '\\n')
if (args[1]?.endsWith('/releases/42')) process.stdout.write(process.env.TAG + '\\n')
`)
    await chmod(path, 0o755)
  }
  return {
    directory,
    requests,
    env: {
      ...process.env,
      GH_TOKEN: 'fixture',
      GITHUB_REPOSITORY: 'OpenTubeX/OpenTubeX',
      GITHUB_OUTPUT: join(directory, 'output'),
      RELEASE_ID: '42',
      TAG: tag,
      VERSION: tag.slice(1),
      REQUESTS_FILE: requests,
      PATH: `${directory}:${process.env.PATH}`,
    },
  }
}

test('notifies SideStore after stable release publication with the resolved tag', async (t) => {
  const workflow = load(await readFile('.github/workflows/release.yml', 'utf8'))
  const job = workflow.jobs['trigger-sidestore-update']
  assert.equal(job.needs, 'publish-release')
  assert.equal(job.if, 'inputs.publishRelease')
  assert.ok(workflow.jobs['publish-release'].needs.includes('upload-ios'))
  assert.match(job.steps[1].env.GH_TOKEN, /secrets\.PUSH_TOKEN/)
  const setup = await fixture(t, 'v0.35.2-beta')
  for (const step of job.steps) {
    const result = spawnSync('bash', ['-c', step.run], {
      cwd: setup.directory, env: setup.env, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    if (step.id === 'release') {
      setup.env.TAG = (await readFile(setup.env.GITHUB_OUTPUT, 'utf8')).trim().split('=')[1]
    }
  }
  const requests = (await readFile(setup.requests, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(requests, [
    ['gh', 'api', 'repos/OpenTubeX/OpenTubeX/releases/42', '--jq', '.tag_name'],
    ['gh', 'api', 'repos/OpenTubeX/sidestore/dispatches', '--method', 'POST',
      '-f', 'event_type=opentubex-release', '-f', 'client_payload[tag]=v0.35.2-beta'],
  ])
})

test('notifies SideStore of nightlies after checking the public IPA download', async (t) => {
  const workflow = load(await readFile('.github/workflows/build.yml', 'utf8'))
  const job = workflow.jobs['publish-nightly']
  assert.ok(job.needs.includes('ios'))
  const step = job.steps.find(step => step.name === 'Trigger nightly package repositories')
  assert.match(step.env.GH_TOKEN, /secrets\.PUSH_TOKEN/)
  const setup = await fixture(t, 'v0.35.2-nightly-1758')
  await mkdir(join(setup.directory, '_scripts'))
  await copyFile('_scripts/wait-for-nightly-assets.sh', join(setup.directory, '_scripts/wait-for-nightly-assets.sh'))
  const result = spawnSync('bash', ['-c', step.run], {
    cwd: setup.directory, env: setup.env, encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const requests = (await readFile(setup.requests, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const ipaCheck = requests.findIndex(call => call[0] === 'wget' && call.at(-1).endsWith('-ios-unsigned.ipa'))
  const dispatch = requests.findIndex(call => call[2] === 'repos/OpenTubeX/sidestore/dispatches')
  assert.ok(ipaCheck >= 0 && dispatch > ipaCheck)
  assert.deepEqual(requests[dispatch], [
    'gh', 'api', 'repos/OpenTubeX/sidestore/dispatches', '--method', 'POST',
    '-f', 'event_type=opentubex-nightly', '-f', 'client_payload[tag]=v0.35.2-nightly-1758',
    '-f', 'client_payload[version]=0.35.2-nightly-1758',
  ])
})
