import assert from 'node:assert/strict'
import test from 'node:test'

import { escapeAndroidString, resourceDirectory } from '../../_scripts/prepareAndroid.mjs'

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
