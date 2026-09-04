import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('embeds the generated nightly version in the Android web bundle', async () => {
  const workflow = await readFile('.github/workflows/build.yml', 'utf8')
  const buildStart = workflow.indexOf('    - name: Build signed universal APK')
  const buildEnd = workflow.indexOf('    - name: Upload Android APK', buildStart)
  const build = workflow.slice(buildStart, buildEnd)

  const packageVersionUpdate = build.indexOf("jq --arg version \"$version\" '.version = $version' package.json")
  const capacitorBuild = build.indexOf('pnpm run capacitor:sync:android')

  assert.notEqual(packageVersionUpdate, -1)
  assert.ok(packageVersionUpdate < capacitorBuild)
})

test('gives the Android debug package nightly launcher branding', async () => {
  const strings = await readFile(
    'android/app/src/debug/res/values/strings.xml',
    'utf8'
  )

  assert.match(strings, /<string name="app_name">OpenTubeX Nightly<\/string>/)
  assert.match(strings, /<string name="title_activity_main">OpenTubeX Nightly<\/string>/)

  const icon = await readFile(
    'android/app/src/debug/res/drawable/ic_launcher_nightly_foreground.xml',
    'utf8'
  )

  assert.match(icon, /nightly wrench/i)

  for (const api of [26, 33]) {
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const adaptiveIcon = await readFile(
        `android/app/src/debug/res/mipmap-anydpi-v${api}/${name}`,
        'utf8'
      )

      assert.match(adaptiveIcon, /@drawable\/ic_launcher_nightly_foreground/)
      if (api === 33) {
        assert.match(adaptiveIcon, /@drawable\/ic_launcher_nightly_monochrome/)
      }
    }
  }

  for (const [density, size] of Object.entries({
    mdpi: 48,
    hdpi: 72,
    xhdpi: 96,
    xxhdpi: 144,
    xxxhdpi: 192
  })) {
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      const png = await readFile(
        `android/app/src/debug/res/mipmap-${density}/${name}`
      )

      assert.equal(png.subarray(1, 4).toString(), 'PNG')
      assert.equal(png.readUInt32BE(16), size)
      assert.equal(png.readUInt32BE(20), size)
    }
  }
})
