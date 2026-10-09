import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { createInvidiousFeedParsers } from '../../src/renderer/helpers/api/invidious-feed-parsers.js'

const source = (await readFile(new URL('../../src/renderer/store/modules/invidious.js', import.meta.url), 'utf8'))
  .replace(/^import .* from .*\n/gm, '')
  .replace('export default', 'globalThis.module =')
const { mutations } = vm.runInNewContext(`${source}; module`, {
  URL, process: { env: { IS_ELECTRON: false } },
  base64EncodeUtf8: value => Buffer.from(value).toString('base64')
})

test('normalizes selected Invidious URLs before constructing image proxies', () => {
  for (const [input, expected, authorization] of [
    ['https://invidious.test/', 'https://invidious.test', null],
    ['https://INVIDIOUS.test:443/proxy/', 'https://invidious.test/proxy', null],
    ['https://user:password@invidious.test/proxy/', 'https://invidious.test/proxy', 'Basic dXNlcjpwYXNzd29yZA==']
  ]) {
    const state = {}
    mutations.setCurrentInvidiousInstance(state, input)
    assert.equal(state.currentInvidiousInstance, input, 'preserve the configured value')
    assert.equal(state.currentInvidiousInstanceUrl, expected)
    assert.equal(state.currentInvidiousInstanceAuthorization, authorization)
    const { youtubeImageUrlToInvidious } = createInvidiousFeedParsers(() => state.currentInvidiousInstanceUrl)
    assert.equal(youtubeImageUrlToInvidious('https://yt3.ggpht.com/banner'), `${expected}/ggpht/banner`)
  }
})

test('preserves incomplete and unsupported Invidious input', () => {
  for (const input of ['', 'https://', 'not a URL']) {
    const state = {}
    mutations.setCurrentInvidiousInstance(state, input)
    assert.equal(state.currentInvidiousInstanceUrl, input)
    assert.equal(state.currentInvidiousInstanceAuthorization, null)
  }
})
