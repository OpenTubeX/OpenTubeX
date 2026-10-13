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
