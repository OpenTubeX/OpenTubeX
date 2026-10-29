import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { ref, shallowRef } from 'vue'

import { hasMoreInvidiousPlaylistPages, mergeInvidiousPlaylistVideos } from '../../src/renderer/helpers/api/invidious-playlists.js'

const playlistSource = readFileSync(new URL('../../src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', import.meta.url), 'utf8')

function extractSourceBetweenMarkers(start, end) {
  const from = playlistSource.indexOf(start)
  const to = playlistSource.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `Update the harness after changing the boundaries around ${start}`)
  return playlistSource.slice(from, to)
}

const video = index => ({ videoId: `video${index}`, index, title: `Video ${index}`, author: 'Channel', authorId: 'channel' })
const range = (from, to) => Array.from({ length: to - from }, (_, i) => video(from + i))

function harness(pages) {
  const requests = []
  const errors = []
  const context = {
    props: { playlistId: 'long-playlist' },
    playlistLoadGeneration: 0,
    getPlaylistInfoRun: false,
    playlistItems: shallowRef([]), isLoading: ref(true), isFetchingPlaylistContinuation: ref(false), hasUnloadedPlaylistVideos: ref(false),
    shuffleEnabled: ref(false), randomizedPlaylistItems: shallowRef([]),
    playlistTitle: ref(''), playlistTotalVideoCount: ref(0), channelName: ref(''), channelId: ref(''),
    backendPreference: ref('invidious'), backendFallback: ref(false), isUserPlaylist: ref(false), playlistCacheTabId: 'web',
    store: { commit() {} },
    hasMoreInvidiousPlaylistPages, mergeInvidiousPlaylistVideos,
    invidiousGetPlaylistInfo: async (_id, page = 1) => {
      requests.push(page)
      const videos = pages[page - 1] ?? []
      return { title: 'Long', author: 'Channel', authorId: 'channel', videoCount: 250, videos, pageVideoCount: videos.length }
    },
    filterVisiblePlaylistVideos: videos => videos.slice(),
    applyReversePlaylistState: videos => videos,
    findIndexOfCurrentVideoInPlaylist: () => 0,
    shufflePlaylistItems() {},
    getInvidiousApiErrorMessage: () => 'Invidious API Error',
    showApiErrorToast: (_message, error) => errors.push(error),
    console: { error() {} },
    process: { env: { SUPPORTS_LOCAL_API: true } },
  }
  const loaders = vm.runInNewContext(`${extractSourceBetweenMarkers('function appendLocalPlaylistPage(', '\nasync function getPlaylistInformationLocal(')}
${extractSourceBetweenMarkers('async function getPlaylistInformationInvidious() {', '\nfunction parseUserPlaylist(')}
;({ loadCachedPlaylistInformation, getPlaylistInformationInvidious })`, context)
  return { context, requests, errors, ...loaders }
}

test('the watch page loads every Invidious playlist page after showing the first one', async () => {
  // Invidious pages advance 100 positions but can return up to 200 overlapping entries.
  const { context, requests, errors, getPlaylistInformationInvidious } = harness([range(0, 200), range(100, 250)])
  await getPlaylistInformationInvidious()
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [1, 2])
  assert.deepEqual(context.playlistItems.value.map(item => item.index), range(0, 250).map(item => item.index))
  assert.equal(context.hasUnloadedPlaylistVideos.value, false)
  assert.equal(context.isFetchingPlaylistContinuation.value, false)
})

test('a playlist handed over from the Playlist page continues with its next Invidious page', async () => {
  const { context, requests, loadCachedPlaylistInformation } = harness([range(0, 200), range(100, 250)])
  await loadCachedPlaylistInformation({
    id: 'long-playlist', title: 'Long', totalVideoCount: 250, channelName: 'Channel', channelId: 'channel',
    items: range(0, 200), continuationData: null, nextInvidiousPage: 2,
  })
  assert.deepEqual(requests, [2])
  assert.deepEqual(context.playlistItems.value.map(item => item.index), range(0, 250).map(item => item.index))
  assert.equal(context.isFetchingPlaylistContinuation.value, false)
})

test('a failed later Invidious page keeps the videos already shown', async () => {
  const { context, errors, getPlaylistInformationInvidious } = harness([range(0, 200)])
  context.invidiousGetPlaylistInfo = async (_id, page = 1) => {
    if (page > 1) throw new Error('instance unavailable')
    return { title: 'Long', author: 'Channel', authorId: 'channel', videoCount: 250, videos: range(0, 200), pageVideoCount: 200 }
  }
  await getPlaylistInformationInvidious()
  assert.equal(errors.length, 1)
  assert.equal(context.playlistItems.value.length, 200)
  assert.equal(context.hasUnloadedPlaylistVideos.value, true)
  assert.equal(context.isFetchingPlaylistContinuation.value, false)
})
