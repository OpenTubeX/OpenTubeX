import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../src/renderer/components/PlaylistInfo/PlaylistInfo.vue', import.meta.url), 'utf8')
const copyFunction = source.slice(source.indexOf('function copyPlaylist()'), source.indexOf('async function addPlaylistToQueue'))

function copy(context) {
  vm.createContext(context)
  vm.runInContext(`${copyFunction}; copyPlaylist()`, context)
}

test('copying a remote playlist opens the prompt right away while its videos load', () => {
  const loading = { promise: Promise.resolve([]), cancel: () => {} }
  const loadedIds = []
  let copied
  copy({
    props: { id: 'source', videos: ['a', 'b', 'c', 'd'].map(videoId => ({ videoId })), videoCount: 102, title: 'Source', channelName: '', description: '' },
    isUserPlaylist: { value: false },
    selectedUserPlaylist: { value: undefined },
    loadPlaylistVideos: (id) => { loadedIds.push(id); return loading },
    store: { dispatch: (_action, payload) => { copied = payload } },
    t: key => key,
  })
  assert.deepEqual(loadedIds, ['source'])
  assert.equal(copied.videos, undefined)
  assert.equal(copied.pendingVideos.promise, loading.promise)
  assert.equal(copied.pendingVideos.cancel, loading.cancel)
  assert.equal(copied.pendingVideos.videoCount, 102)
  assert.deepEqual(copied.pendingVideos.previewVideos.map(video => video.videoId), ['a', 'b', 'c'])
  assert.equal(copied.newPlaylistDefaultProperties.sourcePlaylistId, 'source')
})

test('copying a user playlist hands over its videos without loading anything', () => {
  const videos = [{ videoId: 'a' }]
  let copied
  copy({
    props: { id: 'local', videos, title: 'Local', channelName: '', description: '' },
    isUserPlaylist: { value: true },
    selectedUserPlaylist: { value: { sourcePlaylistId: 'source' } },
    loadPlaylistVideos: () => assert.fail('User playlists are already loaded'),
    store: { dispatch: (_action, payload) => { copied = payload } },
  })
  assert.equal(copied.videos, videos)
  assert.equal(copied.newPlaylistDefaultProperties.sourcePlaylistId, 'source')
})
