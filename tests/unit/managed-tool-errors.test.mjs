import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'

import { managedToolErrorMessage } from '../../src/renderer/helpers/managedToolErrors.js'

const source = readFileSync(new URL('../../src/renderer/helpers/managedToolErrors.js', import.meta.url), 'utf8')
const messages = parse(readFileSync(new URL('../../static/locales/en-US.yaml', import.meta.url), 'utf8'))

/**
 * @param {string} key
 * @returns {string}
 */
function translate(key) {
  return key.split('.').reduce((value, part) => value?.[part], messages)
}

test('known managed tool failures are translated', () => {
  assert.equal(
    managedToolErrorMessage({ error: 'The downloaded yt-dlp binary was removed', errorCode: 'MANAGED_TOOL_REMOVED' }, translate),
    'The downloaded file was removed, most likely by antivirus software'
  )
})

test('every managed tool error code has an English message', () => {
  const codes = [...source.matchAll(/^ {2}(MANAGED_TOOL_\w+):/gm)].map(match => match[1])
  assert.ok(codes.length > 0)
  for (const errorCode of codes) {
    const message = managedToolErrorMessage({ error: '', errorCode }, translate)
    assert.ok(typeof message === 'string' && message.length > 0, errorCode)
  }
})

test('unknown failures keep their reported message', () => {
  assert.equal(managedToolErrorMessage({ error: '404 Not Found' }, translate), '404 Not Found')
  assert.equal(managedToolErrorMessage({ error: 'EPERM: operation not permitted', errorCode: 'EPERM' }, translate), 'EPERM: operation not permitted')
  assert.equal(managedToolErrorMessage(null, translate), '')
})
