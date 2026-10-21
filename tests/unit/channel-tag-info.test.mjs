import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { usesInvidiousApi } from '../../src/apiBackends.js'

const source = readFileSync(new URL('../../src/renderer/helpers/channels.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replaceAll('export ', '')

const CHANNEL_ID = 'UCXuqSBlHAE6Xw-yeJA0Tunw'

/**
 * @param {{ invidious: () => Promise<object>, local: () => Promise<object> }} backends
 */
function loadFindChannelTagInfo({ invidious, local }) {
  const context = {
    process: { env: { SUPPORTS_LOCAL_API: true } },
    usesInvidiousApi,
    invidiousGetChannelInfo: invidious,
    getLocalChannel: local,
    parseLocalChannelHeader: channel => ({ name: channel.header.name, thumbnailUrl: channel.header.thumbnail }),
    showInvidiousFallbackToast() {},
    console: { error() {} },
  }
  return vm.runInNewContext(`${source}\nfindChannelTagInfo`, context)
}

const localChannel = { header: { name: 'Local name', thumbnail: 'https://yt3.ggpht.com/local' } }

for (const preference of ['invidious', 'yattee']) {
  test(`reads the local channel when the ${preference} lookup falls back to the local API`, async () => {
    const findChannelTagInfo = loadFindChannelTagInfo({
      invidious: () => Promise.reject(new Error('Server error')),
      local: () => Promise.resolve(localChannel),
    })

    assert.deepEqual(
      { ...await findChannelTagInfo(CHANNEL_ID, { preference, fallback: true }) },
      { preferredName: 'Local name', icon: 'https://yt3.ggpht.com/local', iconHref: `/channel/${CHANNEL_ID}` }
    )
  })
}

test('reads the Invidious channel when the local lookup falls back to Invidious', async () => {
  const findChannelTagInfo = loadFindChannelTagInfo({
    invidious: () => Promise.resolve({ author: 'Invidious name', authorThumbnails: [{ url: 'https://invidious.example/avatar' }] }),
    local: () => Promise.reject(new Error('Local error')),
  })

  assert.deepEqual(
    { ...await findChannelTagInfo(CHANNEL_ID, { preference: 'local', fallback: true }) },
    { preferredName: 'Invidious name', icon: 'https://invidious.example/avatar' }
  )
})
