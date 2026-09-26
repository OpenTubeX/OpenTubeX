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
