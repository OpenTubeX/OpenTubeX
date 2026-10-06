import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { load } from 'js-yaml'

const workflow = async name => load(await readFile(`.github/workflows/${name}.yml`, 'utf8'))

test('build and release publishing wait for their iOS artifact', async () => {
  const build = await workflow('build')
  const release = await workflow('release')
  assert.equal(build.jobs.ios?.uses, './.github/workflows/package-ios.yml')
  assert.ok(build.jobs['publish-nightly'].needs.includes('ios'))
  assert.equal(release.jobs.ios?.uses, build.jobs.ios.uses)
  assert.equal(release.jobs['upload-ios'].needs, 'ios')
  assert.ok(release.jobs['publish-release'].needs.includes('upload-ios'))
  const download = release.jobs['upload-ios'].steps.find(step => step.uses?.startsWith('actions/download-artifact@'))
  assert.equal(download.with.name, '${{ needs.ios.outputs.artifact-name }}')
  const upload = release.jobs['upload-ios'].steps.find(step => step.uses?.startsWith('softprops/action-gh-release@'))
  assert.equal(upload.with.files, 'release-assets/*.ipa')
  assert.equal(upload.with['fail_on_unmatched_files'], true)
})

for (const [snapshot, ref, expected] of [
  ['true', 'refs/heads/development', '0.34.0-nightly-123'],
  ['true', 'refs/heads/v0.34.0-RC', '0.34.0-RC-123'],
  ['false', 'refs/heads/development', '0.34.0'],
]) {
  test(`iOS artifact version for ${ref}, snapshot=${snapshot}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'ios-version-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.34.0' }))
    const output = join(directory, 'output')
    const job = (await workflow('package-ios')).jobs.archive
    const metadata = job.steps.find(step => step.id === 'package')
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', metadata.run], {
      cwd: directory, encoding: 'utf8',
      env: { ...process.env, SNAPSHOT: snapshot, GITHUB_REF: ref, GITHUB_RUN_NUMBER: '123', GITHUB_OUTPUT: output },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).version, expected)
    assert.equal(await readFile(output, 'utf8'), `name=opentubex-${expected}-ios-unsigned.ipa\n`)
    const artifact = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))
    assert.equal(artifact.with.name, '${{ steps.package.outputs.name }}')
    assert.equal(artifact.with['if-no-files-found'], 'error')
  })
}

test('nightly asset preparation includes the IPA alongside desktop packages', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ios-nightly-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const names = ['opentubex-0.34.0-nightly-123-ios-unsigned.ipa', 'opentubex-0.34.0-nightly-123-amd64.AppImage']
  for (const name of names) {
    const artifact = join(directory, 'artifacts', name)
    await mkdir(artifact, { recursive: true })
    await writeFile(join(artifact, name), name)
  }
  const job = (await workflow('build')).jobs['publish-nightly']
  const prepare = job.steps.find(step => step.name === 'Prepare release assets')
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', prepare.run], { cwd: directory, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await readdir(join(directory, 'release-assets'))).sort(), names.sort())
})

for (const { state, bootRace = false } of [
  { state: 'Shutdown' },
  { state: 'Booting' },
  { state: 'Booted' },
  { state: 'Shutdown', bootRace: true },
]) {
  test(`iOS workflow waits for simulator readiness (${state}${bootRace ? ', racing boot' : ''}) without clones`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'ios-simulator-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const log = join(directory, 'commands')
    await writeFile(join(directory, 'xcrun'), `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['IOS_MOCK_LOG'], 'a') as output:
    output.write(json.dumps(args) + '\\n')
if args == ['simctl', 'list', 'devices', 'available', '--json']:
    print(json.dumps({'devices': {'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [
        {'name': 'iPhone 17', 'udid': 'test-simulator', 'state': '${state}'}
    ]}}))
elif args == ['simctl', 'boot', 'test-simulator']:
    if '${state}' == 'Booting' or ${bootRace ? 'True' : 'False'}:
        sys.exit('Unable to boot device in current state: Booted or Booting')
elif args != ['simctl', 'bootstatus', 'test-simulator', '-b']:
    sys.exit('Unexpected simulator command: ' + str(args))
if 'bootstatus' in args and os.environ.get('IOS_MOCK_FAIL_BOOT'):
    sys.exit('Simulator boot failed')
`, { mode: 0o755 })
    const job = (await workflow('ios')).jobs.simulator
    const select = job.steps.find(step => step.env?.DEVICE_FAMILY)
    const envFile = join(directory, 'env')
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, IOS_MOCK_LOG: log, DEVICE_FAMILY: 'iPhone', GITHUB_ENV: envFile }
    const selected = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', select.run], { cwd: directory, encoding: 'utf8', env })
    assert.equal(selected.status, 0, selected.stderr)
    const commands = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(commands, [
      ['simctl', 'list', 'devices', 'available', '--json'],
      ['simctl', 'bootstatus', 'test-simulator', '-b'],
    ])
    assert.equal(await readFile(envFile, 'utf8'), 'SIMULATOR_ID=test-simulator\n')
    const build = job.steps.find(step => step.env?.TEST_PLAYBACK)
    await writeFile(join(directory, 'xcodebuild'), '#!/usr/bin/env python3\nimport json, sys\nprint(json.dumps(sys.argv[1:]))\n', { mode: 0o755 })
    const tested = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', build.run], {
      cwd: directory, encoding: 'utf8', env: { ...env, TEST_PLAYBACK: 'false', SIMULATOR_ID: 'test-simulator' },
    })
    assert.equal(tested.status, 0, tested.stderr)
    const args = JSON.parse(tested.stdout)
    assert.equal(args[args.indexOf('-destination') + 1], 'platform=iOS Simulator,id=test-simulator')
    assert.equal(args[args.indexOf('-parallel-testing-enabled') + 1], 'NO')
    assert.ok(args.includes('-skip-testing:AppTests/AppTests/testApplicationAndDirectPlayback'))
    assert.ok(!args.includes('-retry-tests-on-failure'))
    const failedEnv = join(directory, 'failed-env')
    const failed = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', select.run], {
      cwd: directory, encoding: 'utf8', env: { ...env, IOS_MOCK_FAIL_BOOT: 'true', GITHUB_ENV: failedEnv },
    })
    assert.notEqual(failed.status, 0)
    assert.match(failed.stderr, /Simulator boot failed/)
    await assert.rejects(readFile(failedEnv), { code: 'ENOENT' })
  })
}
