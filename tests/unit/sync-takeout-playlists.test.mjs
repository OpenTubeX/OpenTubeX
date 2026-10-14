import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { reactive } from 'vue'
import { strToU8, zipSync } from 'fflate'

import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeHistory, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import { createEmptySyncDocument, EncryptedSyncAdapter } from '../../src/renderer/helpers/sync-server-privacy.js'
import { forEachSelectedTakeoutZipEntry, parseTakeoutPlaylistCsv } from '../../src/renderer/helpers/youtube-takeout-zip.js'
import { historyToRemote as releasedHistoryToRemote, syncPlaylists as syncReleasedPlaylists } from '../helpers/released-sync-playlists.mjs'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({
  DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeSyncIds, syncVideoToRemote,
  generateRandomUniqueId: randomUUID,
  deepCopy: value => JSON.parse(JSON.stringify(value)),
  normalizePlaylistThumbnail: async value => {
    if (['data:image/png;base64,AAAA', 'data:image/gif;base64,AAAA'].includes(value)) throw new Error('Invalid image')
    return value
  },
})
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)

function createStore(playlists = []) {
  const state = reactive({ playlists: { playlists } })
  return {
    state,
    async persistPlaylistSyncBaseline() {},
    async dispatch(action, payload) {
      const playlist = action === 'updatePlaylistFromSync' ? payload.playlist : payload
      if (action === 'addPlaylist') state.playlists.playlists.push(playlist)
      else if (action === 'updatePlaylist' || action === 'updatePlaylistFromSync') {
        const index = state.playlists.playlists.findIndex(item => item._id === playlist._id)
        state.playlists.playlists[index] = playlist
      } else assert.fail(`Unexpected action: ${action}`)
      return true
    },
  }
}

test('concurrent edits merge each playlist metadata field independently', async () => {
  const original = { playlistName: 'Original title', description: 'Original description', customThumbnail: 'data:image/webp;base64,b3JpZ2luYWw=' }
  const edits = { playlistName: 'Edited title', description: 'Edited description', customThumbnail: '' }
  for (const localField of Object.keys(edits)) {
    for (const remoteField of Object.keys(edits)) {
      const first = createStore([{ _id: 'concurrent', ...original, videos: [] }])
      const second = createStore()
      const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
      let firstSnapshot = await context.syncPlaylists(adapter, first)
      let secondSnapshot = await context.syncPlaylists(adapter, second)
      first.state.playlists.playlists[0][localField] = edits[localField]
      second.state.playlists.playlists[0][remoteField] = edits[remoteField]
      secondSnapshot = await context.syncPlaylists(adapter, second, secondSnapshot)
      firstSnapshot = await context.syncPlaylists(adapter, first, firstSnapshot)
      await context.syncPlaylists(adapter, second, secondSnapshot)
      for (const store of [first, second]) {
        for (const field of Object.keys(edits)) {
          assert.equal(store.state.playlists.playlists[0][field], field === localField || field === remoteField ? edits[field] : original[field], `${localField} locally, ${remoteField} remotely: ${field}`)
        }
      }
      adapter.updatePlaylist = async () => assert.fail('Merged metadata must remain stable')
      await context.syncPlaylists(adapter, first, firstSnapshot)
    }
  }
})

test('invalid remote covers fall back to defaults without blocking later playlists', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createPlaylist({ id: 'invalid', title: 'Invalid cover', custom_thumbnail: 'data:image/png;base64,AAAA' })
  await adapter.createPlaylist({ id: 'later', title: 'Later playlist' })
  const store = createStore()
  const snapshot = await context.syncPlaylists(adapter, store)
  assert.equal(store.state.playlists.playlists.find(playlist => playlist._id === 'invalid').customThumbnail, '')
  assert.equal(store.state.playlists.playlists.find(playlist => playlist._id === 'later').playlistName, 'Later playlist')
  assert.equal(snapshot.invalid.metadata.custom_thumbnail, null)
  assert.equal((await adapter.getPlaylist('invalid')).playlist.custom_thumbnail, null)
})

test('invalid remote images preserve a valid saved cover and repair the remote record', async () => {
  const original = 'data:image/webp;base64,b3JpZ2luYWw='
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const store = createStore([{ _id: 'saved', playlistName: 'Saved cover', customThumbnail: original, videos: [] }])
  let previous = await context.syncPlaylists(adapter, store)
  for (const invalid of ['data:image/png;base64,AAAA', 'data:image/gif;base64,AAAA']) {
    await adapter.updatePlaylist('saved', { custom_thumbnail: invalid })
    previous = await context.syncPlaylists(adapter, store, previous)
    assert.equal(store.state.playlists.playlists[0].customThumbnail, original)
    assert.equal(previous.saved.metadata.custom_thumbnail, original)
    assert.equal((await adapter.getPlaylist('saved')).playlist.custom_thumbnail, original)
  }
  await adapter.updatePlaylist('saved', { custom_thumbnail: '' })
  await context.syncPlaylists(adapter, store, previous)
  assert.equal(store.state.playlists.playlists[0].customThumbnail, '')
})

test('invalid local and remote covers fall back to defaults without persisting invalid data', async () => {
  const invalid = 'data:image/png;base64,AAAA'
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createPlaylist({ id: 'invalid', title: 'Invalid cover', custom_thumbnail: invalid })
  const store = createStore([{ _id: 'invalid', playlistName: 'Invalid cover', customThumbnail: invalid, videos: [] }])
  const snapshot = await context.syncPlaylists(adapter, store)
  assert.equal(store.state.playlists.playlists[0].customThumbnail, '')
  assert.equal(snapshot.invalid.metadata.custom_thumbnail, null)
  assert.equal((await adapter.getPlaylist('invalid')).playlist.custom_thumbnail, null)
})

test('simultaneous changes to the same metadata field keep the local edit', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const store = createStore([{ _id: 'conflict', playlistName: 'Original', videos: [] }])
  const previous = await context.syncPlaylists(adapter, store)
  store.state.playlists.playlists[0].playlistName = 'Local title'
  await adapter.updatePlaylist('conflict', { title: 'Remote title', description: 'Remote description' })
  await context.syncPlaylists(adapter, store, previous)
  assert.equal(store.state.playlists.playlists[0].playlistName, 'Local title')
  assert.equal(store.state.playlists.playlists[0].description, 'Remote description')
})

test('local thumbnail replacements and resets repair invalid remote images', async () => {
  for (const replacement of ['data:image/webp;base64,cmVwbGFjZW1lbnQ=', '']) {
    const original = 'data:image/webp;base64,b3JpZ2luYWw='
    const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
    const store = createStore([{ _id: 'repair', playlistName: 'Repair cover', customThumbnail: original, videos: [] }])
    const previous = await context.syncPlaylists(adapter, store)
    await adapter.updatePlaylist('repair', { custom_thumbnail: 'data:image/png;base64,AAAA' })
    store.state.playlists.playlists[0].customThumbnail = replacement
    const snapshot = await context.syncPlaylists(adapter, store, previous)
    assert.equal((await adapter.getPlaylist('repair')).playlist.custom_thumbnail, replacement || null)
    assert.equal(store.state.playlists.playlists[0].customThumbnail, replacement)
    assert.equal(snapshot.repair.metadata.custom_thumbnail, replacement || null)
  }
})

test('released clients preserve covers through repeated syncs and title edits', async () => {
  const image = 'data:image/webp;base64,b3JpZ2luYWw='
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const upgraded = createStore([{ _id: 'mixed', playlistName: 'Mixed versions', customThumbnail: image, videos: [] }])
  let upgradedSnapshot = await context.syncPlaylists(adapter, upgraded)
  const released = createStore()
  let releasedSnapshot = await syncReleasedPlaylists(adapter, released)
  releasedSnapshot = await syncReleasedPlaylists(adapter, released, releasedSnapshot)
  assert.equal((await adapter.getPlaylist('mixed')).playlist.custom_thumbnail, image)
  released.state.playlists.playlists[0].playlistName = 'Renamed by released client'
  await syncReleasedPlaylists(adapter, released, releasedSnapshot)
  upgradedSnapshot = await context.syncPlaylists(adapter, upgraded, upgradedSnapshot)
  assert.equal(upgraded.state.playlists.playlists[0].customThumbnail, image)
  assert.equal(upgraded.state.playlists.playlists[0].playlistName, 'Renamed by released client')
  upgraded.state.playlists.playlists[0].customThumbnail = ''
  await context.syncPlaylists(adapter, upgraded, upgradedSnapshot)
  assert.equal((await adapter.getPlaylist('mixed')).playlist.custom_thumbnail, null)
})

test('servers without thumbnail support keep local covers out of synced metadata', async () => {
  const image = 'data:image/webp;base64,b3JpZ2luYWw='
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  adapter.supportsPlaylistThumbnails = async () => false
  const store = createStore([{ _id: 'unsupported', playlistName: 'Unsupported server', customThumbnail: image, videos: [] }])
  let previous = await context.syncPlaylists(adapter, store)
  assert.ok(!Object.hasOwn((await adapter.getPlaylist('unsupported')).playlist, 'custom_thumbnail'))
  assert.ok(!Object.hasOwn(previous.unsupported.metadata, 'custom_thumbnail'))
  store.state.playlists.playlists[0].playlistName = 'Local rename'
  previous = await context.syncPlaylists(adapter, store, previous)
  await adapter.updatePlaylist('unsupported', { description: 'Remote description' })
  await context.syncPlaylists(adapter, store, previous)
  assert.equal(store.state.playlists.playlists[0].customThumbnail, image)
  assert.equal(store.state.playlists.playlists[0].description, 'Remote description')
  assert.ok(!Object.hasOwn((await adapter.getPlaylist('unsupported')).playlist, 'custom_thumbnail'))
})

test('custom playlist thumbnails sync between devices, including replacement and restoring defaults', async () => {
  const original = 'data:image/webp;base64,b3JpZ2luYWw='
  const replacement = 'data:image/png;base64,cmVwbGFjZW1lbnQ='
  const first = createStore([{ _id: 'cover', playlistName: 'Custom cover', description: 'Keep this description', customThumbnail: original, videos: [] }])
  const second = createStore()
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  let writes = 0
  const update = adapter.updatePlaylist.bind(adapter)
  adapter.updatePlaylist = async (...args) => { writes++; return update(...args) }

  let firstSnapshot = await context.syncPlaylists(adapter, first)
  assert.equal((await adapter.getPlaylist('cover')).playlist.custom_thumbnail, original)
  let secondSnapshot = await context.syncPlaylists(adapter, second)
  assert.equal(second.state.playlists.playlists[0].customThumbnail, original)

  second.state.playlists.playlists[0].customThumbnail = replacement
  secondSnapshot = await context.syncPlaylists(adapter, second, secondSnapshot)
  firstSnapshot = await context.syncPlaylists(adapter, first, firstSnapshot)
  assert.equal(first.state.playlists.playlists[0].customThumbnail, replacement)
  assert.equal(first.state.playlists.playlists[0].description, 'Keep this description')
  assert.equal(writes, 1)
  firstSnapshot = await context.syncPlaylists(adapter, first, firstSnapshot)
  secondSnapshot = await context.syncPlaylists(adapter, second, secondSnapshot)
  assert.equal(writes, 1, 'unchanged images should not be uploaded again')

  first.state.playlists.playlists[0].customThumbnail = ''
  firstSnapshot = await context.syncPlaylists(adapter, first, firstSnapshot)
  assert.equal((await adapter.getPlaylist('cover')).playlist.custom_thumbnail, null)
  secondSnapshot = await context.syncPlaylists(adapter, second, secondSnapshot)
  assert.equal(second.state.playlists.playlists[0].customThumbnail, '')
  await context.syncPlaylists(adapter, first, firstSnapshot)
  await context.syncPlaylists(adapter, second, secondSnapshot)
  assert.equal(writes, 2)
})

test('server-generated playlist thumbnails remain automatic defaults without repeated writes', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createPlaylist({ id: 'automatic', title: 'Automatic cover', description: '', thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg' })
  adapter.updatePlaylist = async () => assert.fail('An automatic cover should not trigger a metadata upload')
  const store = createStore()
  const snapshot = await context.syncPlaylists(adapter, store)
  assert.equal(store.state.playlists.playlists[0].customThumbnail, '')
  assert.equal(snapshot.automatic.metadata.custom_thumbnail, null)
  await context.syncPlaylists(adapter, store, snapshot)
})

test('a released HTTP-thumbnail baseline does not overwrite a remote-only custom cover', async () => {
  const original = { id: 'legacy-cover', title: 'Legacy cover', description: '', thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg' }
  const image = 'data:image/webp;base64,Y292ZXI='
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createPlaylist({ ...original, custom_thumbnail: image })
  adapter.updatePlaylist = async () => assert.fail('A remote-only cover change must not be overwritten')
  const store = createStore([{ _id: original.id, playlistName: original.title, description: '', videos: [] }])
  const snapshot = await context.syncPlaylists(adapter, store, {
    [original.id]: { metadata: original, videos: [] },
  })
  assert.equal(store.state.playlists.playlists[0].customThumbnail, image)
  assert.equal(snapshot[original.id].metadata.custom_thumbnail, image)
})

test('syncs videos imported from a Takeout ZIP to a second device and repairs an empty remote playlist', async () => {
  const file = new Blob([zipSync({
    'Takeout/YouTube/playlists/Imported-videos.csv': strToU8(
      'Video ID,Playlist Video Creation Timestamp\nabcdefghijk,2025-01-01T00:00:00Z\n-abcdefghij,2025-01-02T00:00:00Z\nabcdefghijk,2025-01-03T00:00:00Z'
    ),
  })])
  let imported
  await forEachSelectedTakeoutZipEntry(file, new Set(['playlists']), entry => {
    imported = { _id: 'imported', ...parseTakeoutPlaylistCsv(entry.content, 'Imported-videos.csv') }
  })
  imported.videos.forEach((video, index) => { video.playlistItemId = `item-${index}` })
  const originalVideos = structuredClone(imported.videos)
  const expectedIds = [...new Set(imported.videos.map(video => video.videoId))]
  const firstDevice = createStore([imported])
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  // Previous versions uploaded the header but silently excluded its videos.
  await adapter.createPlaylist({ id: imported._id, title: imported.playlistName, description: '' })
  const previous = { imported: { metadata: { id: 'imported', title: 'Imported', description: '', thumbnail_url: null }, videos: [] } }
  const options = { allowMissingUploader: true }
  const snapshot = await context.syncPlaylists(adapter, firstDevice, previous, options)
  assert.deepEqual(Array.from(firstDevice.state.playlists.playlists[0].videos, video => structuredClone({ ...video })), originalVideos)
  assert.deepEqual((await adapter.getPlaylist(imported._id)).videos.map(video => video.id), expectedIds)
  assert.deepEqual(Array.from(snapshot.imported.videos), expectedIds)

  const secondDevice = createStore()
  const secondSnapshot = await context.syncPlaylists(adapter, secondDevice, {}, options)
  assert.deepEqual(Array.from(secondDevice.state.playlists.playlists[0].videos, video => video.videoId), expectedIds)
  for (const video of secondDevice.state.playlists.playlists[0].videos) {
    assert.equal(video.author, undefined)
    assert.equal(video.authorId, undefined)
  }
  await context.syncPlaylists(adapter, secondDevice, secondSnapshot, options)
  await context.syncPlaylists(adapter, firstDevice, snapshot, options)
  assert.deepEqual(Array.from(firstDevice.state.playlists.playlists[0].videos, video => structuredClone({ ...video })), originalVideos)
  assert.deepEqual((await adapter.getPlaylist(imported._id)).videos.map(video => video.id), expectedIds)

  await adapter.addPlaylistVideos(imported._id, [syncVideoToRemote({ videoId: 'remote-only', authorId: 'known-channel' })])
  const withRemote = await context.syncPlaylists(adapter, firstDevice, snapshot, options)
  const localVideos = () => Array.from(firstDevice.state.playlists.playlists[0].videos, video => structuredClone({ ...video }))
  assert.deepEqual(localVideos().slice(0, originalVideos.length), originalVideos)
  assert.equal(localVideos().at(-1).videoId, 'remote-only')
  const remoteAddition = localVideos().at(-1)
  await adapter.removePlaylistVideo(imported._id, '-abcdefghij')
  await context.syncPlaylists(adapter, firstDevice, withRemote, options)
  assert.deepEqual(localVideos(), [originalVideos[0], originalVideos[2], remoteAddition])
})

test('only permits unknown uploaders when encrypted playlist sync opts in', () => {
  const video = { videoId: 'abcdefghijk', title: 'Imported video' }
  assert.equal(syncVideoToRemote(video), null)
  const remote = syncVideoToRemote(video, { allowMissingUploader: true })
  assert.equal(remote.id, video.videoId)
  assert.equal(remote.uploader.id, UNKNOWN_SYNC_UPLOADER_ID)
  assert.equal(remote.uploader.name, '')
  assert.equal(syncVideoToRemote({ ...video, authorId: UNKNOWN_SYNC_UPLOADER_ID }), null)
  assert.equal(syncVideoToRemote({}, { allowMissingUploader: true }), null)
  const known = { ...video, authorId: 'known-channel', author: 'Known channel' }
  assert.deepEqual(syncVideoToRemote(known, { allowMissingUploader: true }), syncVideoToRemote(known))
  const namedLikeMarker = { ...known, author: UNKNOWN_SYNC_UPLOADER_ID }
  assert.equal(syncVideoToRemote(namedLikeMarker).uploader.name, UNKNOWN_SYNC_UPLOADER_ID)
  assert.deepEqual(uploaderToLocal(syncVideoToRemote(namedLikeMarker).uploader), {
    authorId: known.authorId, author: UNKNOWN_SYNC_UPLOADER_ID,
  })
})

test('repaired Takeout metadata replaces encrypted unknown uploaders and fills the receiving device', async () => {
  const options = { allowMissingUploader: true }
  const imported = { _id: 'repaired', playlistName: 'Imported', videos: [
    { videoId: 'abcdefghijk', title: 'abcdefghijk', playlistItemId: 'first', timeAdded: 1 },
    { videoId: 'abcdefghijk', title: 'abcdefghijk', playlistItemId: 'duplicate', timeAdded: 2 },
  ] }
  const sender = createStore([imported])
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const sent = await context.syncPlaylists(adapter, sender, {}, options)
  const receiver = createStore()
  const received = await context.syncPlaylists(adapter, receiver, {}, options)
  const receivingId = receiver.state.playlists.playlists[0].videos[0].playlistItemId
  for (const video of sender.state.playlists.playlists[0].videos) {
    Object.assign(video, { title: 'Fetched title', authorId: 'known-channel', author: 'Known channel', published: 100, lengthSeconds: 120 })
  }
  await context.syncPlaylists(adapter, sender, sent, options)
  const remote = (await adapter.getPlaylist(imported._id)).videos
  assert.equal(remote.length, 1)
  assert.equal(remote[0].uploader.id, 'known-channel')
  assert.equal(remote[0].uploader.name, 'Known channel')
  await context.syncPlaylists(adapter, receiver, received, options)
  const restored = receiver.state.playlists.playlists[0].videos[0]
  assert.equal(restored.playlistItemId, receivingId)
  assert.equal(restored.title, 'Fetched title')
  assert.equal(restored.authorId, 'known-channel')
  assert.equal(restored.author, 'Known channel')
  assert.equal(restored.lengthSeconds, 120)
  assert.deepEqual(Array.from(sender.state.playlists.playlists[0].videos, video => video.playlistItemId), ['first', 'duplicate'])
})

test('released clients preserve imported memberships during mixed-version sync', async () => {
  const imported = parseTakeoutPlaylistCsv(
    'Video ID,Playlist Video Creation Timestamp\nabcdefghijk,2025-01-01T00:00:00Z', 'Imported.csv'
  )
  imported._id = 'mixed-versions'
  imported.videos.push({ videoId: 'known-video', authorId: 'known-channel', author: 'Known channel' })
  const expected = imported.videos.map(video => video.videoId)
  const upgraded = createStore([imported])
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const options = { allowMissingUploader: true }
  const upgradedSnapshot = await context.syncPlaylists(adapter, upgraded, {}, options)

  const released = createStore()
  let releasedSnapshot = await syncReleasedPlaylists(adapter, released)
  releasedSnapshot = await syncReleasedPlaylists(adapter, released, releasedSnapshot)
  assert.deepEqual((await adapter.getPlaylist(imported._id)).videos.map(video => video.id), expected)
  await context.syncPlaylists(adapter, upgraded, upgradedSnapshot, options)
  assert.deepEqual(Array.from(upgraded.state.playlists.playlists[0].videos, video => video.videoId), expected)

  // A released client re-uploads the unknown uploader using its ID as the name.
  released.state.playlists.playlists.push({
    _id: 'released-copy', playlistName: 'Released copy',
    videos: [{ ...released.state.playlists.playlists[0].videos[0] }],
  })
  await syncReleasedPlaylists(adapter, released, releasedSnapshot)
  const receiver = createStore()
  await context.syncPlaylists(adapter, receiver, {}, options)
  const copied = receiver.state.playlists.playlists.find(playlist => playlist._id === 'released-copy').videos[0]
  assert.equal(copied.videoId, expected[0])
  assert.equal(copied.authorId, undefined)
  assert.equal(copied.author, undefined)

  // Marking a downloaded video watched on an older app copies its uploader to history.
  const releasedHistory = released.state.playlists.playlists[0].videos.map(video => ({
    ...video, timeWatched: 100, isWatched: true,
  }))
  const remoteHistory = releasedHistory.map(releasedHistoryToRemote)
  const receivedHistory = mergeHistory({ localHistory: [], remoteHistory, options })
  const repeatedHistory = mergeHistory({
    localHistory: receivedHistory.insertions, remoteHistory, previous: receivedHistory.next, options,
  })
  assert.deepEqual(repeatedHistory.remoteDeletions, [])
  assert.deepEqual(Object.keys(repeatedHistory.next), expected)
  assert.equal(receivedHistory.insertions[0].authorId, undefined)
  assert.equal(receivedHistory.insertions[0].author, undefined)

  remoteHistory[0].video.duration = 500
  const upgradedHistory = mergeHistory({
    localHistory: releasedHistory, remoteHistory, previous: receivedHistory.next, options,
  })
  const historyUpdates = upgradedHistory.updates.filter(video => video.videoId === expected[0])
  assert.equal(historyUpdates.length, 1)
  assert.equal(historyUpdates[0].authorId, undefined)
  assert.equal(historyUpdates[0].author, undefined)
  assert.equal(historyUpdates[0].lengthSeconds, 500)

  await context.syncPlaylists(adapter, released, releasedSnapshot, options)
  const upgradedEntry = released.state.playlists.playlists[0].videos.find(video => video.videoId === expected[0])
  assert.equal(upgradedEntry.authorId, undefined)
  assert.equal(upgradedEntry.author, undefined)
})

test('newer imported history preserves known remote uploader metadata and local progress', () => {
  const local = {
    videoId: 'abcdefghijk', title: 'Imported', timeWatched: 200,
    watchProgress: 42, isWatched: false, lengthSeconds: 0,
  }
  const remote = releasedHistoryToRemote({
    ...local, timeWatched: 100, watchProgress: 10, isWatched: true,
    authorId: 'known-channel', author: 'Known channel', lengthSeconds: 500,
  })
  const result = mergeHistory({ localHistory: [local], remoteHistory: [remote], options: { allowMissingUploader: true } })
  assert.equal(result.historyToUpload[0].video.uploader.id, remote.video.uploader.id)
  assert.equal(result.historyToUpload[0].video.uploader.name, remote.video.uploader.name)
  assert.equal(result.historyToUpload[0].metadata.added_date, local.timeWatched)
  assert.equal(result.historyToUpload[0].metadata.position_millis, 42_000)
  assert.equal(result.historyToUpload[0].metadata.watched_state, 'watching')
  assert.equal(result.updates.length, 1)
  assert.equal(result.updates[0].lengthSeconds, 500)
  assert.equal(local.authorId, undefined)
  const knownLocal = { ...local, authorId: 'known-channel', author: 'Locally renamed channel' }
  const knownResult = mergeHistory({ localHistory: [knownLocal], remoteHistory: [remote], options: { allowMissingUploader: true } })
  assert.equal(knownResult.historyToUpload[0].video.uploader.name, knownLocal.author)
})

test('newer imported history preserves richer remote video metadata through repeated syncs', () => {
  const imported = parseTakeoutPlaylistCsv(
    'Video ID,Playlist Video Creation Timestamp\nabcdefghijk,2025-01-01T00:00:00Z', 'Imported.csv'
  ).videos[0]
  const local = { ...imported, timeWatched: 200, watchProgress: 42, isWatched: false }
  const known = {
    ...local, title: 'Actual video title', published: 123,
    thumbnail: 'https://example.com/video.jpg', authorThumbnail: 'https://example.com/channel.jpg',
    authorId: 'known-channel', author: 'Known channel', lengthSeconds: 500,
    timeWatched: 100, watchProgress: 10,
  }
  const options = { allowMissingUploader: true }
  const remote = releasedHistoryToRemote(known)
  const result = mergeHistory({ localHistory: [local], remoteHistory: [remote], options })
  assert.equal(result.updates.length, 1)
  assert.deepEqual(result.historyToUpload[0].video, remote.video)
  assert.equal(result.historyToUpload[0].metadata.position_millis, 42_000)
  const repeated = mergeHistory({
    localHistory: result.updates, remoteHistory: result.historyToUpload, previous: result.next, options,
  })
  assert.deepEqual(repeated.updates, [])
  assert.deepEqual(repeated.historyToUpload, [])
  const edited = { ...result.updates[0], timeWatched: 300, watchProgress: 50 }
  const next = mergeHistory({ localHistory: [edited], remoteHistory: result.historyToUpload, previous: result.next, options })
  assert.deepEqual(next.historyToUpload[0].video, remote.video)
  const renamed = { ...edited, title: 'Local title', thumbnail: 'https://example.com/local.jpg', published: 456 }
  const renamedResult = mergeHistory({ localHistory: [renamed], remoteHistory: [remote], options })
  assert.equal(renamedResult.historyToUpload[0].video.title, renamed.title)
  assert.equal(renamedResult.historyToUpload[0].video.thumbnail_url, renamed.thumbnail)
  assert.equal(renamedResult.historyToUpload[0].video.upload_date, renamed.published)
})

test('newer unknown remote history preserves locally known video metadata', () => {
  const local = {
    videoId: 'abcdefghijk', title: 'Actual video title', published: 123,
    thumbnail: 'https://example.com/video.jpg', authorThumbnail: 'https://example.com/channel.jpg',
    authorId: 'known-channel', author: 'Known channel', lengthSeconds: 500,
    timeWatched: 100, watchProgress: 10, isWatched: false,
  }
  const options = { allowMissingUploader: true }
  const remote = {
    video: syncVideoToRemote({ videoId: local.videoId }, options),
    metadata: { added_date: 200, watched_state: 'completed', position_millis: 42_000 },
  }
  const result = mergeHistory({ localHistory: [local], remoteHistory: [remote], options })
  assert.equal(result.updates.length, 1)
  const updated = result.updates[0]
  assert.deepEqual(syncVideoToRemote(updated), syncVideoToRemote(local))
  assert.equal(updated.timeWatched, 200)
  assert.equal(updated.watchProgress, 42)
  assert.equal(updated.isWatched, true)
  const repeated = mergeHistory({ localHistory: [updated], remoteHistory: [remote], previous: result.next, options })
  assert.deepEqual(repeated.updates, [])
  const edited = { ...updated, timeWatched: 300 }
  const next = mergeHistory({ localHistory: [edited], remoteHistory: [remote], previous: result.next, options })
  assert.deepEqual(next.historyToUpload[0].video, syncVideoToRemote(local))
  const received = mergeHistory({ localHistory: [], remoteHistory: next.historyToUpload, options })
  assert.deepEqual(syncVideoToRemote(received.insertions[0]), syncVideoToRemote(local))
})
