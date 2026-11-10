import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import { isCollaborativeVideoAuthor } from '../../src/renderer/helpers/video-collaborators.js'

import { getResultAuthorThumbnailUrl } from '../../src/renderer/helpers/result-channel-avatar.js'

const composable = (await readFile(new URL('../../src/renderer/composables/useResultChannelAvatar.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace('export function', 'function')

function resolve(data, lookup = async () => [{ thumbnail: '//images.test/creator.jpg' }], fetchChannel = async () => null, backend = 'local') {
  let pending
  let refresh
  let unmount
  const calls = []
  const result = { value: data }
  const enabled = { value: true }
  const context = {
    ref: value => ({ value }),
    watch: (_sources, fn) => { refresh = fn; pending = fn() },
    onBeforeUnmount: fn => { unmount = fn },
    store: { getters: { getBackendPreference: backend, getSubscribedChannelsById: new Map() } },
    getResultAuthorThumbnailUrl,
    youtubeImageUrlToInvidious: url => url,
    getCachedChannelInfo: () => null,
    fetchChannelInfo: fetchChannel,
    isCollaborativeVideoAuthor,
    getLocalVideoChannels: async id => { calls.push(id); return lookup(id) },
    result,
    enabled
  }
  const avatar = runInNewContext(`${composable}; useResultChannelAvatar(result, { value: result.value.authorId ?? null }, enabled)`, context)
  return { avatar, calls, result, enabled, pending, refresh, unmount }
}

test('collaboration cards resolve the primary channel avatar by video ID', async () => {
  const f = resolve({ videoId: 'collab', hasCollaborators: true })
  await f.pending
  assert.equal(f.avatar.channelThumbnail.value, 'https://images.test/creator.jpg')
  assert.deepEqual(f.calls, ['collab'])
})

test('direct result avatars avoid a collaborator request', async () => {
  const f = resolve({ videoId: 'regular', authorId: 'UCregular', authorThumbnailUrl: '//images.test/direct.jpg' })
  await f.pending
  assert.equal(f.avatar.channelThumbnail.value, 'https://images.test/direct.jpg')
  assert.deepEqual(f.calls, [])
})

test('a late collaboration lookup cannot overwrite a replacement card avatar', async () => {
  let finish
  const f = resolve({ videoId: 'collab', hasCollaborators: true }, () => new Promise(resolve => { finish = resolve }))
  await Promise.resolve()
  f.result.value = { authorThumbnailUrl: 'https://images.test/other.jpg' }
  await f.refresh()
  finish([{ thumbnail: 'https://images.test/old.jpg' }])
  await f.pending
  assert.equal(f.avatar.channelThumbnail.value, 'https://images.test/other.jpg')
  assert.deepEqual(Array.from(f.avatar.channelThumbnails.value), ['https://images.test/other.jpg'])
})

test('hiding avatars while a collaboration lookup is pending keeps the avatar cleared', async () => {
  let finish
  const f = resolve({ videoId: 'collab', hasCollaborators: true }, () => new Promise(resolve => { finish = resolve }))
  await Promise.resolve()
  f.enabled.value = false
  await f.refresh()
  finish([{ thumbnail: 'https://images.test/old.jpg' }])
  await f.pending
  assert.equal(f.avatar.channelThumbnail.value, null)
  assert.deepEqual(Array.from(f.avatar.channelThumbnails.value), [null])
  assert.deepEqual(f.calls, ['collab'])
})

const collaborators = [
  { id: 'first', thumbnail: '//images.test/first.jpg' },
  { id: 'second', thumbnail: '//images.test/second.jpg' },
  { id: 'third', thumbnail: '' }
]

test('uses supplied collaborator avatars without another request', async () => {
  const f = resolve({ videoId: 'collab', collaborators })
  await f.pending
  assert.deepEqual(Array.from(f.avatar.channelThumbnails.value), ['https://images.test/first.jpg', 'https://images.test/second.jpg', null])
  assert.deepEqual(f.calls, [])
})

test('a supplied avatar on an unflagged ordinary result avoids a video lookup', async () => {
  const f = resolve({ videoId: 'regular', author: 'Creator', authorThumbnailUrl: '//images.test/direct.jpg' })
  await f.pending
  assert.deepEqual(f.calls, [])
  assert.equal(f.avatar.channelThumbnail.value, 'https://images.test/direct.jpg')
})

for (const backend of ['invidious', 'yattee']) {
  test(`${backend} results never look collaborators up on YouTube`, async () => {
    // Yattee servers leave the channel ID of collaborations empty
    const f = resolve({ videoId: 'collab', author: 'Creator One and Creator Two', authorId: null }, undefined, undefined, backend)
    await f.pending
    assert.deepEqual(f.calls, [])
    assert.deepEqual(Array.from(f.avatar.channelThumbnails.value), [null])

    const supplied = resolve({ videoId: 'collab', collaborators }, undefined, undefined, backend)
    await supplied.pending
    assert.equal(supplied.avatar.channelThumbnails.value.length, 3)
  })
}
