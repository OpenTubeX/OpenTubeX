import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { load } from 'js-yaml'
import { withWindowsPortable } from '../../_scripts/windowsPortable.mjs'

test('portable archives include scoped registry isolation without changing the installer', async () => {
  const installedConfig = { files: ['dist/**/*'] }
  const portableConfig = withWindowsPortable(installedConfig)

  assert.equal(installedConfig.extraFiles, undefined)
  assert.notEqual(portableConfig.files, installedConfig.files)
  assert.deepEqual(portableConfig.files, installedConfig.files)
  assert.deepEqual(portableConfig.extraFiles.map(file => file.to), [
    'version.dll', '.interposer/Config.yml', 'LANCommander.Interposer.LICENSE.txt', 'portable.marker'
  ])
  for (const file of portableConfig.extraFiles.filter(file => file.to !== 'version.dll')) {
    await access(file.from)
  }
})

test('portable packaging preserves existing extra files without changing the installer', () => {
  const installedConfig = {
    extraFiles: [{ from: 'shared.txt', to: 'shared.txt' }]
  }
  const portableConfig = withWindowsPortable(installedConfig)

  assert.deepEqual(portableConfig.extraFiles.map(file => file.to), [
    'shared.txt', 'version.dll', '.interposer/Config.yml',
    'LANCommander.Interposer.LICENSE.txt', 'portable.marker'
  ])
  assert.equal(installedConfig.extraFiles.length, 1)
  assert.equal(installedConfig.files, undefined)
})

test('ARM64 archives enable portable app data without bundling Interposer', async () => {
  const installedConfig = { extraFiles: [{ from: 'shared.txt', to: 'shared.txt' }] }
  const portableConfig = withWindowsPortable(installedConfig, 'arm64')

  assert.deepEqual(portableConfig.extraFiles.map(file => file.to), [
    'shared.txt', 'portable.marker'
  ])
  await access(portableConfig.extraFiles[1].from)
  assert.equal(installedConfig.extraFiles.length, 1)
})

for (const architecture of ['x64', 'arm64']) {
  test(`Windows ${architecture} builds keep portable files out of the installer`, async () => {
    const source = (await readFile('_scripts/build.mjs', 'utf8')).replace(/^import .*\n/gm, '')
    const requests = []
    const shareArchitectures = []
    let interposerPreparations = 0
    await runInNewContext(`(async () => { ${source} })()`, {
      process: { platform: 'win32', argv: ['node', 'build.mjs', architecture] },
      Arch: { x64: 'x64', arm64: 'arm64' },
      Platform: { WINDOWS: { createTarget: (formats, arch) => ({ formats: Array.from(formats), arch }) } },
      config: {},
      prepareWindowsShare: async arch => shareArchitectures.push(arch),
      prepareWindowsInterposer: async () => { interposerPreparations++ },
      withWindowsPortable,
      build: async request => { requests.push(request); return [] },
      console: { log () {} }
    })

    assert.deepEqual(shareArchitectures, [architecture])
    assert.equal(interposerPreparations, architecture === 'x64' ? 1 : 0)
    assert.equal(requests.length, 2)
    assert.deepEqual(requests.map(request => request.targets), [
      { formats: ['nsis'], arch: architecture },
      { formats: ['zip', '7z'], arch: architecture }
    ])
    assert.equal(requests[0].config.extraFiles, undefined)
    assert.ok(requests[1].config.extraFiles.some(file => file.to === 'portable.marker'))
    assert.equal(requests[1].config.extraFiles.some(file => file.to === 'version.dll'), architecture === 'x64')
    assert.ok(requests.every(request => request.publish === 'never'))
  })
}

test('ARM64 archive artifacts and release uploads use the packaged filenames', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-arm64-assets-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const version = '0.35.1'
  await mkdir(join(directory, 'build'))
  const buildWorkflow = load(await readFile('.github/workflows/build.yml', 'utf8'))
  const uploads = Object.values(buildWorkflow.jobs).flatMap(job => job.steps ?? [])
    .filter(step => step.uses?.startsWith('actions/upload-artifact@') && step.if?.includes("'win-arm64'"))
  assert.equal(uploads.length, 3)
  for (const upload of uploads) {
    const file = upload.with.path.replace('${{ steps.versionNumber.outputs.version }}', version)
    await writeFile(join(directory, file), 'packaged asset')
    if (/\.(zip|7z)$/.test(file)) assert.equal(upload.with['if-no-files-found'], 'error')
  }
  const releaseWorkflow = load(await readFile('.github/workflows/release.yml', 'utf8'))
  const prepare = Object.values(releaseWorkflow.jobs).flatMap(job => job.steps ?? [])
    .find(step => step.name === 'Prepare release assets')
  const result = spawnSync('bash', ['-c', prepare.run], {
    cwd: directory,
    env: { ...process.env, RUNTIME: 'win-arm64', VERSION: version },
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await readdir(join(directory, 'release-assets'))).sort(), [
    `opentubex-${version}-beta-setup-arm64.exe`,
    `opentubex-${version}-beta-win-arm64-portable.7z`,
    `opentubex-${version}-beta-win-arm64-portable.zip`
  ])
})
