import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

import { escapeAndroidString, resourceDirectory } from '../../_scripts/prepareAndroid.mjs'
import { locales, root } from '../../_scripts/nativeTranslations.mjs'

test('maps app locales to Android resource directories', () => {
  assert.equal(resourceDirectory('en-US'), 'values')
  assert.equal(resourceDirectory('en-GB'), 'values-en-rGB')
  assert.equal(resourceDirectory('de-DE'), 'values-de')
  assert.equal(resourceDirectory('nb-NO'), 'values-nb')
  assert.equal(resourceDirectory('es'), 'values-es')
  assert.equal(resourceDirectory('es-MX'), 'values-es-rMX')
  assert.equal(resourceDirectory('pt-BR'), 'values-pt-rBR')
  assert.equal(resourceDirectory('he'), 'values-iw')
  assert.equal(resourceDirectory('id'), 'values-in')
})

test('escapes Android string resource values', () => {
  assert.equal(escapeAndroidString('Video\'s "A" & <B> \\n'), 'Video\\\'s \\"A\\" &amp; &lt;B&gt; \\\\n')
  assert.equal(escapeAndroidString('@string/x'), '\\@string/x')
  assert.equal(escapeAndroidString('?attr'), '\\?attr')
  assert.equal(escapeAndroidString('a@b?'), 'a@b?')
})

test('commits generated widget strings for every active locale', () => {
  for (const locale of locales) {
    const file = new URL(`android/app/src/main/res/${resourceDirectory(locale)}/widget_strings.xml`, root)
    assert.ok(existsSync(file), `Run node _scripts/prepareAndroid.mjs: missing ${resourceDirectory(locale)}/widget_strings.xml`)
  }
})

test('commits generated iOS localizations for every active locale', () => {
  const project = readFileSync(new URL('ios/App/App.xcodeproj/project.pbxproj', root), 'utf8')
  for (const locale of locales) {
    for (const path of [`App/${locale}.lproj/InfoPlist.strings`, `OpenTubeXWidgets/${locale}.lproj/Localizable.strings`]) {
      assert.ok(existsSync(new URL(`ios/App/${path}`, root)), `Run node _scripts/prepareIos.mjs: missing ios/App/${path}`)
    }
    assert.ok(project.includes(`path = "${locale}.lproj/InfoPlist.strings"`), `Run node _scripts/prepareIos.mjs: ${locale} missing from project.pbxproj`)
    assert.ok(project.includes(`path = "${locale}.lproj/Localizable.strings"`), `Run node _scripts/prepareIos.mjs: ${locale} widget strings missing from project.pbxproj`)
  }
})
