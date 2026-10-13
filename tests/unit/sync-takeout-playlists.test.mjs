import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { reactive } from 'vue'
import { strToU8, zipSync } from 'fflate'

import { DEFAULT_CHANNEL_AVATAR, normalizeChannelAvatar, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import { createEmptySyncDocument, EncryptedSyncAdapter } from '../../src/renderer/helpers/sync-server-privacy.js'
import { forEachSelectedTakeoutZipEntry, parseTakeoutPlaylistCsv } from '../../src/renderer/helpers/youtube-takeout-zip.js'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({
  DEFAULT_CHANNEL_AVATAR, normalizeChannelAvatar, mergeSyncIds, syncVideoToRemote,
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
    async dispatch(action, playlist) {
      if (action === 'addPlaylist') state.playlists.playlists.push(playlist)
      else if (action === 'updatePlaylist') {
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
  assert.equal(remote.uploader.id, '')
  assert.equal(remote.uploader.name, '')
  assert.equal(syncVideoToRemote({}, { allowMissingUploader: true }), null)
  const known = { ...video, authorId: 'known-channel', author: 'Known channel' }
  assert.deepEqual(syncVideoToRemote(known, { allowMissingUploader: true }), syncVideoToRemote(known))
})
