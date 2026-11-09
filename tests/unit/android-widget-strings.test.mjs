import assert from 'node:assert/strict'
import test from 'node:test'

import { escapeAndroidString } from '../../_scripts/prepareAndroid.mjs'

test('escapes Android string resource values', () => {
  assert.equal(escapeAndroidString('Video\'s "A" & <B> \\n'), 'Video\\\'s \\"A\\" &amp; &lt;B&gt; \\\\n')
  assert.equal(escapeAndroidString('@string/x'), '\\@string/x')
  assert.equal(escapeAndroidString('?attr'), '\\?attr')
  assert.equal(escapeAndroidString('a@b?'), 'a@b?')
})
