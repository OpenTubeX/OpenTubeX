import assert from 'node:assert/strict'
import test from 'node:test'
import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

const CHANNEL_ID = 'UCXuqSBlHAE6Xw-yeJA0Tunw'

const backends = { invidious: null, local: null }
const [{ findChannelTagInfo: findTagInfo }] = await importWithStubs([sourceUrl('src/renderer/helpers/channels.js')], {
  [sourceUrl('src/renderer/helpers/api/invidious.js')]: {
    invidiousGetChannelId: null,
    invidiousGetChannelInfo: () => backends.invidious(),
  },
  [sourceUrl('src/renderer/helpers/api/local.js')]: {
    getLocalChannelId: null,
    getLocalChannel: () => backends.local(),
    parseLocalChannelHeader: channel => ({ name: channel.header.name, thumbnailUrl: channel.header.thumbnail }),
  },
  [sourceUrl('src/renderer/helpers/utils.js')]: { showInvidiousFallbackToast() {} },
})
process.env.SUPPORTS_LOCAL_API = 'true'

/**
 * @param {{ invidious: () => Promise<object>, local: () => Promise<object> }} responses
 */
function loadFindChannelTagInfo(responses) {
  Object.assign(backends, responses)
  return findTagInfo
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

test('keeps the channel name when the channel has no avatar', async () => {
  const findChannelTagInfo = loadFindChannelTagInfo({
    invidious: () => Promise.resolve({ author: 'Yattee name', authorThumbnails: [] }),
    local: () => Promise.reject(new Error('unexpected')),
  })

  assert.deepEqual(
    { ...await findChannelTagInfo(CHANNEL_ID, { preference: 'yattee', fallback: false }) },
    { preferredName: 'Yattee name', icon: '' }
  )
})
