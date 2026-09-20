import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import { getResultAuthorThumbnailUrl } from '../../src/renderer/helpers/result-channel-avatar.js'

const card = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')
const visibility = card.slice(card.indexOf('const showChannelAvatar ='), card.indexOf('\nconst { channelThumbnails }'))
const composable = (await readFile(new URL('../../src/renderer/composables/useResultChannelAvatar.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace('export function', 'function')

function visible({ hidden = false, appearance = 'result' } = {}) {
  return runInNewContext(`${visibility}; showChannelAvatar.value`, {
    computed: fn => ({ value: fn() }),
    store: { getters: { getHideChannelAvatars: hidden } },
    props: { appearance },
    channelName: { value: 'Creator One and Creator Two' },
    channelId: { value: null }
  })
}

function resolve(data, lookup = async () => [{ thumbnail: '//images.test/creator.jpg' }]) {
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
    store: { getters: { getBackendPreference: 'local', getSubscribedChannelsById: new Map() } },
    getResultAuthorThumbnailUrl,
    getCachedChannelInfo: () => null,
    fetchChannelInfo: async () => null,
    getLocalVideoChannels: async id => { calls.push(id); return lookup(id) },
    result,
    enabled
  }
  const avatar = runInNewContext(`${composable}; useResultChannelAvatar(result, { value: result.value.authorId ?? null }, enabled)`, context)
  return { avatar, calls, result, enabled, pending, refresh, unmount }
}

test('collaboration bylines show avatars without a single channel ID in grid/list cards', () => {
  assert.equal(visible(), true)
  assert.equal(visible({ appearance: 'youtubeShort' }), true)
  assert.equal(visible({ hidden: true }), false)
})

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

test('failed collaboration lookups leave the avatar fallback usable', async () => {
  const f = resolve({ videoId: 'collab', hasCollaborators: true }, async () => { throw new Error('offline') })
  await f.pending
  assert.equal(f.avatar.channelThumbnail.value, null)
  assert.deepEqual(Array.from(f.avatar.channelThumbnails.value), [null])
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

test('unmounted cards ignore pending collaboration lookups', async () => {
  let finish
  const f = resolve({ videoId: 'collab', hasCollaborators: true }, () => new Promise(resolve => { finish = resolve }))
  await Promise.resolve()
  f.unmount()
  finish([{ thumbnail: 'https://images.test/old.jpg' }])
  await f.pending
  assert.equal(f.avatar.channelThumbnail.value, null)
  assert.deepEqual(Array.from(f.avatar.channelThumbnails.value), [null])
})

const collaborators = [
  { id: 'first', thumbnail: '//images.test/first.jpg' },
  { id: 'second', thumbnail: '//images.test/second.jpg' },
  { id: 'third', thumbnail: '' }
]

test('loads every collaborator even when a primary avatar is already available', async () => {
  const f = resolve({ videoId: 'collab', hasCollaborators: true, authorThumbnailUrl: '//images.test/first.jpg' }, async () => collaborators)
  await f.pending
  assert.deepEqual(Array.from(f.avatar.channelThumbnails.value), ['https://images.test/first.jpg', 'https://images.test/second.jpg', null])
  assert.deepEqual(f.calls, ['collab'])
})

test('uses supplied collaborator avatars without another request', async () => {
  const f = resolve({ videoId: 'collab', collaborators })
  await f.pending
  assert.deepEqual(Array.from(f.avatar.channelThumbnails.value), ['https://images.test/first.jpg', 'https://images.test/second.jpg', null])
  assert.deepEqual(f.calls, [])
})

test('resolves collaborators for playlist and grid results without a collaboration flag or channel ID', async () => {
  const f = resolve({ videoId: 'collab', author: 'Creator One and Creator Two' }, async () => collaborators)
  await f.pending
  assert.deepEqual(Array.from(f.avatar.channelThumbnails.value), ['https://images.test/first.jpg', 'https://images.test/second.jpg', null])
  assert.deepEqual(f.calls, ['collab'])
})

test('retains the available primary avatar when collaborator metadata omits its image', async () => {
  const f = resolve({ videoId: 'collab', hasCollaborators: true, authorThumbnailUrl: '//images.test/primary.jpg' }, async () => [
    { id: 'first', thumbnail: '' },
    { id: 'second', thumbnail: '//images.test/second.jpg' }
  ])
  await f.pending
  assert.deepEqual(Array.from(f.avatar.channelThumbnails.value), ['https://images.test/primary.jpg', 'https://images.test/second.jpg'])
  assert.equal(f.avatar.channelThumbnail.value, 'https://images.test/primary.jpg')
})
