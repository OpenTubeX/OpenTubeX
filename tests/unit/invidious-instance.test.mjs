import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import * as apiBackends from '../../src/apiBackends.js'
import { createInvidiousFeedParsers } from '../../src/renderer/helpers/api/invidious-feed-parsers.js'

const source = (await readFile(new URL('../../src/renderer/store/modules/invidious.js', import.meta.url), 'utf8'))
  .replace(/^import .* from .*\n/gm, '')
  .replace('export default', 'globalThis.module =')
const { getters, mutations } = vm.runInNewContext(`${source}; module`, {
  ...apiBackends,
  URL,
  process: { env: { IS_ELECTRON: false } },
  base64EncodeUtf8: value => Buffer.from(value).toString('base64')
})

/** The header the current instance receives with the saved credentials. */
function authorization(state, credentials) {
  return getters.getCurrentInvidiousInstanceAuthorization(state, {}, { settings: { invidiousInstanceCredentials: credentials } })
}

test('normalizes selected Invidious URLs before constructing image proxies', () => {
  for (const [input, current, expected] of [
    ['https://invidious.test/', 'https://invidious.test/', 'https://invidious.test'],
    ['https://INVIDIOUS.test:443/proxy/', 'https://INVIDIOUS.test:443/proxy/', 'https://invidious.test/proxy'],
    // Credentials are their own setting, so the address never shows them
    ['https://user:password@invidious.test/proxy/', 'https://invidious.test/proxy', 'https://invidious.test/proxy']
  ]) {
    const state = {}
    mutations.setCurrentInvidiousInstance(state, input)
    assert.equal(state.currentInvidiousInstance, current)
    assert.equal(state.currentInvidiousInstanceUrl, expected)
    const { youtubeImageUrlToInvidious } = createInvidiousFeedParsers(() => state.currentInvidiousInstanceUrl)
    assert.equal(youtubeImageUrlToInvidious('https://yt3.ggpht.com/banner'), `${expected}/ggpht/banner`)
    // comment authors can have avatars on yt4, which must not be requested from Google directly
    assert.equal(youtubeImageUrlToInvidious('https://yt4.ggpht.com/avatar'), `${expected}/ggpht/avatar`)
  }
})

test('splits decoded credentials off instance URLs however they are written', () => {
  for (const [input, instance, username, password] of [
    ['https://us er:p@ss w0rd@invidious.test/', 'https://invidious.test', 'us er', 'p@ss w0rd'],
    ['https://user:%E2%82%AC100%25@invidious.test/', 'https://invidious.test', 'user', '€100%'],
    ['https://user:50%zz@invidious.test/', 'https://invidious.test', 'user', '50%zz'],
    ['https:user:pass@invidious.test', 'https://invidious.test', 'user', 'pass'],
    ['https:\\\\user@invidious.test/proxy/', 'https://invidious.test/proxy', 'user', ''],
  ]) {
    assert.deepEqual(apiBackends.splitInvidiousInstanceCredentials(input), {
      instance,
      credentials: { instance, username, password }
    }, input)
  }
  for (const input of ['https://invidious.test/watch@later', 'invidious', '', null]) {
    assert.deepEqual(apiBackends.splitInvidiousInstanceCredentials(input), { instance: input, credentials: null })
  }
})

test('sends the saved credentials only to the instance they belong to', () => {
  // As the settings migration splits and saves an address with credentials
  const { instance, credentials } = apiBackends.splitInvidiousInstanceCredentials('https://user:%E2%82%AC100%25@INVIDIOUS.test/proxy//')
  const state = {}
  mutations.setCurrentInvidiousInstance(state, instance)
  assert.equal(authorization(state, credentials), `Basic ${Buffer.from('user:€100%').toString('base64')}`)

  mutations.setCurrentInvidiousInstance(state, 'https://other.test/proxy')
  assert.equal(authorization(state, credentials), null)
  mutations.setCurrentInvidiousInstance(state, instance)
  for (const saved of [null, '', { ...credentials, username: '', password: '' }, { ...credentials, password: 1 }]) {
    assert.equal(authorization(state, saved), null)
  }
})
