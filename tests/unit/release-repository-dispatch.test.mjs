import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { load } from 'js-yaml'

async function fixture (t, tag) {
  const directory = await mkdtemp(join(tmpdir(), 'release-dispatch-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const requests = join(directory, 'requests')
  const version = tag.slice(1)
  const stable = version.endsWith('-beta')
  const base = `https://github.com/OpenTubeX/OpenTubeX/releases/download/${tag}/`
  const names = [
    ...['amd64', 'arm64'].map(arch => `opentubex_${version.replace('-beta', '_beta')}_${arch}.deb`),
    ...['amd64', 'arm64'].map(arch => `opentubex-${version}.${arch}.rpm`),
    ...['x64', 'arm64'].flatMap(arch => [
      `opentubex-${version}-linux-${arch}-portable.zip`,
      `opentubex-${version}-mac-${arch}.zip`,
      `opentubex-${version}-win-${arch}-portable.zip`,
      `opentubex-${version}-setup-${arch}.exe`,
    ]),
    ...['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64', 'universal'].map(arch => stable
      ? `org.opentubex.app-${version}${arch === 'universal' ? '' : `-${arch}`}.apk`
      : `opentubex-${version}-android-${arch}.apk`),
    ...['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64', 'universal'].map(arch => stable
      ? `org.opentubex.app-${version}-lite${arch === 'universal' ? '' : `-${arch}`}.apk`
      : `opentubex-${version}-android-lite-${arch}.apk`),
    `opentubex-${version.replace(/-beta$/, '')}-ios-unsigned.ipa`,
  ]
  for (const name of ['gh', 'wget']) {
    const path = join(directory, name)
    await writeFile(path, `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.REQUESTS_FILE, JSON.stringify(['${name}', ...args]) + '\\n')
if ('${name}' === 'gh' && args[1]?.includes('/releases/')) {
  let output = args.at(-1) === '.tag_name' ? process.env.TAG : process.env.RELEASE_JSON
  const failure = process.env.REQUESTS_FILE + '.incomplete'
  if (process.env.INCOMPLETE_METADATA && args.at(-1) !== '.tag_name' && !fs.existsSync(failure)) {
    fs.writeFileSync(failure, '')
    const release = JSON.parse(output)
    release.assets = release.assets.filter(asset => !asset.name.endsWith('.ipa'))
    output = JSON.stringify(release)
  }
  process.stdout.write(output + '\\n')
}
if ('${name}' === 'wget' && new RegExp(process.env.FAIL_PATTERN || '(?!)').test(args.at(-1))) {
  const failure = process.env.REQUESTS_FILE + '.failed'
  if (process.env.FAIL_MODE === 'always' || !fs.existsSync(failure)) {
    fs.writeFileSync(failure, '')
    process.exit(1)
  }
}
`)
    await chmod(path, 0o755)
  }
  await mkdir(join(directory, '_scripts'))
  for (const script of ['wait-for-release-assets.sh', 'wait-for-release-asset.sh']) {
    await copyFile(`_scripts/${script}`, join(directory, '_scripts', script))
  }
  return {
    directory,
    requests,
    names,
    base,
    env: {
      ...process.env,
      GH_TOKEN: 'fixture',
      GITHUB_REPOSITORY: 'OpenTubeX/OpenTubeX',
      GITHUB_REF_NAME: 'development',
      GITHUB_OUTPUT: join(directory, 'output'),
      RELEASE_ID: '42',
      RELEASE_JSON: JSON.stringify({ assets: names.map(name => ({ name, browser_download_url: base + name })) }),
      TAG: tag,
      VERSION: version,
      RELEASE_ASSET_MAX_ATTEMPTS: '2',
      RELEASE_ASSET_RETRY_DELAY: '0',
      REQUESTS_FILE: requests,
      PATH: `${directory}:${process.env.PATH}`,
    },
  }
}

function runSteps (setup, steps) {
  for (const step of steps) {
    if (!step.run) continue
    const result = spawnSync('bash', ['-c', step.run], {
      cwd: setup.directory, env: setup.env, encoding: 'utf8',
    })
    if (result.status !== 0) return result
  }
  return { status: 0 }
}

async function calls (setup) {
  return (await readFile(setup.requests, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
}

async function stableJob () {
  const workflow = load(await readFile('.github/workflows/release.yml', 'utf8'))
  return workflow.jobs['notify-package-repositories']
}

async function stableSetup (t, slot) {
  const setup = await fixture(t, 'v0.35.2-beta')
  Object.assign(setup.env, { REPOSITORY: slot.repository, ASSET_PATTERN: slot.pattern, ASSET_COUNT: String(slot.count) })
  return setup
}

test('stable publishers wait for their downloads before they are notified', async (t) => {
  const job = await stableJob()
  assert.equal(job.needs, 'publish-release')
  assert.equal(job.if, 'inputs.publishRelease')
  assert.equal(job.strategy['fail-fast'], false)
  assert.deepEqual(job.strategy.matrix.include.map(slot => slot.repository), ['flatpak', 'aur', 'rpm', 'apt', 'arch', 'snap', 'fdroid', 'sidestore', 'nix', 'homebrew-tap', 'scoop-bucket'])
  assert.match(job.steps.at(-1).env.GH_TOKEN, /secrets\.PUSH_TOKEN/)
  for (const slot of job.strategy.matrix.include) {
    const setup = await stableSetup(t, slot)
    setup.env.FAIL_PATTERN = slot.pattern
    const result = runSteps(setup, job.steps)
    assert.equal(result.status, 0, result.stderr)
    const requests = await calls(setup)
    const probes = requests.filter(call => call[0] === 'wget').map(call => call.at(-1))
    const expected = setup.names.filter(name => new RegExp(slot.pattern).test(name)).map(name => setup.base + name)
    assert.equal(expected.length, slot.count, slot.repository)
    assert.deepEqual(probes, [expected[0], ...expected])
    assert.deepEqual(requests.at(-1), [
      'gh', 'api', `repos/OpenTubeX/${slot.repository}/dispatches`, '--method', 'POST',
      '-f', 'event_type=opentubex-release', '-f', `client_payload[tag]=${setup.env.TAG}`,
    ])
  }
})

test('stable publishers are not notified while their downloads are unavailable', async (t) => {
  const job = await stableJob()
  for (const slot of job.strategy.matrix.include) {
    const setup = await stableSetup(t, slot)
    setup.env.FAIL_PATTERN = slot.pattern
    setup.env.FAIL_MODE = 'always'
    const result = runSteps(setup, job.steps)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /did not become available before dispatch/)
    assert.ok((await calls(setup)).every(call => !call.includes('POST')))
  }
})

test('nightly publishers wait independently so a missing IPA cannot suppress other notifications', async (t) => {
  const workflow = load(await readFile('.github/workflows/build.yml', 'utf8'))
  const publish = workflow.jobs['publish-nightly']
  assert.ok(publish.needs.includes('ios'))
  assert.match(publish.outputs.tag, /steps\.release\.outputs\.tag/)
  const job = workflow.jobs['notify-nightly-repositories']
  assert.equal(job.needs, 'publish-nightly')
  assert.equal(job.strategy['fail-fast'], false)
  assert.deepEqual(job.strategy.matrix.include.map(slot => slot.repository), ['apt', 'rpm', 'arch', 'aur', 'fdroid', 'flatpak', 'snap', 'sidestore', 'homebrew-tap', 'scoop-bucket'])
  assert.match(job.steps.at(-1).env.GH_TOKEN, /secrets\.PUSH_TOKEN/)
  for (const slot of job.strategy.matrix.include) {
    const setup = await fixture(t, 'v0.35.2-nightly-1758')
    Object.assign(setup.env, { REPOSITORY: slot.repository, ASSET_PATTERN: slot.pattern, ASSET_COUNT: String(slot.count), FAIL_PATTERN: '\\.ipa$', FAIL_MODE: 'always' })
    const result = runSteps(setup, job.steps)
    const requests = await calls(setup)
    const probes = requests.filter(call => call[0] === 'wget').map(call => call.at(-1))
    const expected = setup.names.filter(name => new RegExp(slot.pattern).test(name)).map(name => setup.base + name)
    if (slot.repository === 'sidestore') {
      assert.notEqual(result.status, 0)
      assert.ok(requests.every(call => !call.includes('POST')))
      assert.deepEqual(probes, [expected[0], expected[0]])
    } else {
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(probes, expected)
      assert.deepEqual(requests.at(-1), [
        'gh', 'api', `repos/OpenTubeX/${slot.repository}/dispatches`, '--method', 'POST',
        '-f', 'event_type=opentubex-nightly', '-f', `client_payload[tag]=${setup.env.TAG}`,
        '-f', `client_payload[version]=${setup.env.VERSION}`,
      ])
    }
  }
})

test('incomplete release metadata is retried before probing downloads and notifying SideStore', async (t) => {
  const job = await stableJob()
  const setup = await stableSetup(t, job.strategy.matrix.include.find(slot => slot.repository === 'sidestore'))
  setup.env.INCOMPLETE_METADATA = 'once'
  const result = runSteps(setup, job.steps)
  assert.equal(result.status, 0, result.stderr)
  const requests = await calls(setup)
  assert.equal(requests.filter(call => call[0] === 'gh' && call[2].endsWith('/releases/42') && !call.includes('--jq')).length, 2)
  assert.equal(requests.filter(call => call[0] === 'wget').length, 1)
  assert.ok(requests.at(-1).includes('repos/OpenTubeX/sidestore/dispatches'))
})

test('permanently missing release metadata cannot bypass the download check', async (t) => {
  const setup = await fixture(t, 'v0.35.2-beta')
  setup.env.RELEASE_JSON = '{"assets":[]}'
  const result = spawnSync('bash', ['_scripts/wait-for-release-assets.sh', '42', '[.]deb$', '3'], {
    cwd: setup.directory, env: setup.env, encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Expected 3 release assets/)
  assert.equal((await calls(setup)).length, 2)
})
