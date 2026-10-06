import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

async function prepareFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ios-identity-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const path of ['_scripts', 'ios/App/App', 'ios/App/App.xcodeproj', 'ios/App/CapApp-SPM', 'static/locales']) {
    await mkdir(join(directory, path), { recursive: true })
  }
  await symlink(resolve('node_modules'), join(directory, 'node_modules'))
  await copyFile('_scripts/prepareIos.mjs', join(directory, '_scripts/prepareIos.mjs'))
  await copyFile('ios/App/CapApp-SPM/Package.swift', join(directory, 'ios/App/CapApp-SPM/Package.swift'))
  const projectPath = join(directory, 'ios/App/App.xcodeproj/project.pbxproj')
  await copyFile('ios/App/App.xcodeproj/project.pbxproj', projectPath)
  await writeFile(join(directory, 'static/locales/activeLocales.json'), '["en-US"]')
  await copyFile('static/locales/en-US.yaml', join(directory, 'static/locales/en-US.yaml'))
  const configPath = join(directory, 'ios/App/App/capacitor.config.json')
  await writeFile(configPath, JSON.stringify({ appId: 'org.opentubex.app', appName: 'OpenTubeX', plugins: { Share: {} } }))
  return { directory, projectPath, configPath }
}

test('iOS preparation gives nightly its own Release identity and restores stable on reuse', async t => {
  const { directory, projectPath, configPath } = await prepareFixture(t)

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
    assert.ok(release.includes(`APP_URL_SCHEME = ${id.endsWith('.nightly') ? 'opentubex-nightly' : 'opentubex'};`))
    assert.ok(debug.includes('PRODUCT_BUNDLE_IDENTIFIER = org.opentubex.app.dev;'))
    assert.ok(debug.includes('APP_DISPLAY_NAME = "OpenTubeX Dev";'))
    assert.ok(release.includes(`MARKETING_VERSION = ${version.split('-')[0]};`))
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { appId: id, appName: name, plugins: { Share: {} } })
  }

  const originalProject = await readFile('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.35.2-nightly-1757' }))
  for (const [name, invalidProject] of [
    ['changed Release configuration identifier', originalProject.replaceAll('504EC3181FED79650016851F', '504EC3181FED79650016851E')],
    ['missing bundle identifier', originalProject.replace('PRODUCT_BUNDLE_IDENTIFIER = org.opentubex.app;', '')],
    ['missing display name', originalProject.replace('APP_DISPLAY_NAME = OpenTubeX;', '')],
    ['missing URL scheme', originalProject.replace('APP_URL_SCHEME = opentubex;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = org.opentubex.app;', 'PRODUCT_BUNDLE_IDENTIFIER = org.opentubex.app;')],
  ]) {
    await t.test(`rejects ${name} before changing Capacitor identity`, async () => {
      await writeFile(projectPath, invalidProject)
      const config = { appId: 'org.opentubex.app', appName: 'OpenTubeX' }
      await writeFile(configPath, JSON.stringify(config))
      const result = spawnSync(process.execPath, ['_scripts/prepareIos.mjs'], { cwd: directory, encoding: 'utf8' })
      assert.notEqual(result.status, 0, 'Preparation must reject a missing Release identity setting')
      assert.match(result.stderr, /Unable to configure iOS Release identity/)
      assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), config)
    })
  }
})

test('iOS preparation repairs partial FFmpeg dependencies and rejects unmatched manifest edits', async t => {
  const { directory } = await prepareFixture(t)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.35.2' }))
  const packagePath = join(directory, 'ios/App/CapApp-SPM/Package.swift')
  const original = await readFile(packagePath, 'utf8')
  const packageEntry = '.package(name: "OpenTubeXFFmpeg", path: "../FFmpegKit")'
  const productEntry = '.product(name: "OpenTubeXFFmpeg", package: "OpenTubeXFFmpeg")'
  const withoutPackage = original.replace(`        ${packageEntry},\n`, '')
  const withoutProduct = original.replace(`                ${productEntry},\n`, '')

  for (const [name, manifest] of [
    ['fresh Capacitor manifest', withoutPackage.replace(`                ${productEntry},\n`, '').replace('platforms: [.iOS("17.4")]', 'platforms: [.iOS(.v17)]')],
    ['missing package', withoutPackage],
    ['missing product', withoutProduct],
    ['already configured manifest', original],
  ]) {
    await t.test(name, async () => {
      await writeFile(packagePath, manifest)
      const result = spawnSync(process.execPath, ['_scripts/prepareIos.mjs'], { cwd: directory, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(await readFile(packagePath, 'utf8'), original)
      const repeated = spawnSync(process.execPath, ['_scripts/prepareIos.mjs'], { cwd: directory, encoding: 'utf8' })
      assert.equal(repeated.status, 0, repeated.stderr)
      assert.equal(await readFile(packagePath, 'utf8'), original)
    })
  }

  for (const [name, manifest] of [
    ['missing package insertion point', withoutPackage.replace('dependencies: [', 'dependencies : [')],
    ['missing product insertion point', withoutProduct.replace('dependencies: [\n                .product', 'dependencies: [\n              .product')],
    ['partial replacement', withoutPackage.replace(`                ${productEntry},\n`, '').replace('dependencies: [\n                .product', 'dependencies: [\n              .product')],
  ]) {
    await t.test(name, async () => {
      await writeFile(packagePath, manifest)
      const result = spawnSync(process.execPath, ['_scripts/prepareIos.mjs'], { cwd: directory, encoding: 'utf8' })
      assert.notEqual(result.status, 0, 'Preparation must reject an unapplied FFmpeg dependency edit')
      assert.match(result.stderr, /Unable to configure the Capacitor Swift package for FFmpegKit/)
      assert.equal(await readFile(packagePath, 'utf8'), manifest, 'A failed edit must leave the manifest unchanged')
    })
  }
})
