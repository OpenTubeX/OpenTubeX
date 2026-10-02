import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

test('iOS preparation gives nightly its own Release identity and restores stable on reuse', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ios-identity-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const path of ['_scripts', 'ios/App/App', 'ios/App/App.xcodeproj', 'static/locales']) {
    await mkdir(join(directory, path), { recursive: true })
  }
  await symlink(resolve('node_modules'), join(directory, 'node_modules'))
  await copyFile('_scripts/prepareIos.mjs', join(directory, '_scripts/prepareIos.mjs'))
  const projectPath = join(directory, 'ios/App/App.xcodeproj/project.pbxproj')
  await copyFile('ios/App/App.xcodeproj/project.pbxproj', projectPath)
  await writeFile(join(directory, 'static/locales/activeLocales.json'), '["en-US"]')
  await copyFile('static/locales/en-US.yaml', join(directory, 'static/locales/en-US.yaml'))
  const configPath = join(directory, 'ios/App/App/capacitor.config.json')
  await writeFile(configPath, JSON.stringify({ appId: 'org.opentubex.app', appName: 'OpenTubeX', plugins: { Share: {} } }))

  for (const [version, id, name] of [
    ['0.35.2-nightly-1757', 'org.opentubex.app.nightly', 'OpenTubeX Nightly'],
    ['0.35.2', 'org.opentubex.app', 'OpenTubeX'],
    ['0.35.3-RC-1', 'org.opentubex.app', 'OpenTubeX'],
  ]) {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version }))
    const result = spawnSync(process.execPath, ['_scripts/prepareIos.mjs'], { cwd: directory, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const project = await readFile(projectPath, 'utf8')
    const release = project.match(/504EC3181FED79650016851F \/\* Release \*\/ = \{[\s\S]*?name = Release;/)[0]
    const debug = project.match(/504EC3171FED79650016851F \/\* Debug \*\/ = \{[\s\S]*?name = Debug;/)[0]
    assert.ok(release.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${id};`))
    assert.ok(release.includes(`APP_DISPLAY_NAME = "${name}";`))
    assert.ok(debug.includes('PRODUCT_BUNDLE_IDENTIFIER = org.opentubex.app.dev;'))
    assert.ok(debug.includes('APP_DISPLAY_NAME = "OpenTubeX Dev";'))
    assert.ok(release.includes(`MARKETING_VERSION = ${version.split('-')[0]};`))
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { appId: id, appName: name, plugins: { Share: {} } })
  }
})
