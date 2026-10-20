import assert from 'node:assert/strict'
import { test } from 'node:test'
import { queueSwipeAction, findSwipeDownload, downloadSwipeAction } from '../../src/renderer/helpers/videoSwipeActions.js'
import { watchQueueMutations } from '../../src/watchQueue.js'

const video = { videoId: 'video', title: 'Video' }
const t = key => key

test('queue swipes add then remove matching copies without removing other sources', () => {
  const local = { ...video, route: { query: { downloadId: '12', downloadFilePath: '/video.mp4' } } }
  const state = { items: [{ ...local, queueItemId: 'local' }] }
  const options = {
    t,
    commit: (name, payload) => watchQueueMutations[name](state, payload),
    add: playNext => watchQueueMutations.addVideoToWatchQueue(state, { video, playNext }),
  }
  const resolve = () => queueSwipeAction('addToQueue', [video], state.items, options)
  resolve().run()
  assert.equal(state.items.length, 2)
  assert.equal(resolve().label, 'Video.Remove from Queue')
  resolve().run()
  assert.deepEqual(state.items, [{ ...local, queueItemId: 'local' }])
})

test('play-next moves an existing entry to the front then removes it on the next swipe', () => {
  const other = { videoId: 'other', queueItemId: 'other' }
  const state = { items: [other, { ...video, queueItemId: 'video' }] }
  const options = {
    t, commit: (name, payload) => watchQueueMutations[name](state, payload),
    add: () => assert.fail('must move the queued item, not duplicate it'),
  }
  const resolve = () => queueSwipeAction('playNext', [video], state.items, options)
  resolve().run()
  assert.deepEqual(state.items.map(item => item.videoId), ['video', 'other'])
  resolve().run()
  assert.deepEqual(state.items, [other])
})

test('download swipes cancel active work and remove completed files', () => {
  const calls = []
  const options = { t, cancel: record => calls.push(['cancel', record.id]), remove: record => calls.push(['remove', record.id]) }
  for (const status of ['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused']) {
    const action = downloadSwipeAction({ id: 1, status }, options)
    assert.equal(action.label, 'Downloads.Cancel Download')
    action.run()
  }
  downloadSwipeAction({ id: 2, status: 'completed', destination: '/video.mp4' }, options).run()
  assert.deepEqual(calls.at(-1), ['remove', 2])
  assert.equal(calls.filter(([type]) => type === 'cancel').length, 6)
  assert.equal(downloadSwipeAction({ status: 'completed', destination: '/video.mp4', availability: 'missing' }, options), null)
  assert.equal(downloadSwipeAction(null, options), null)
})

test('feed swipe matching excludes playlist jobs and stale cancelled downloads', () => {
  const completed = { id: 3, videoId: 'video', status: 'completed', destination: '/video.mp4' }
  assert.equal(findSwipeDownload({
    1: { videoId: 'video', playlistId: 'playlist', status: 'completed', destination: '/video.mp4' },
    2: { videoId: 'video', status: 'cancelled' },
    3: completed,
  }, 'video'), completed)
})

test('download reversal prefers active work, then the newest matching record', () => {
  const downloads = {
    1: { id: 1, videoId: 'video', status: 'completed', destination: '/video.mp4' },
    2: { id: 2, videoId: 'video', status: 'downloading' },
    3: { id: 3, videoId: 'video', status: 'queued' },
    4: { id: 4, videoId: 'video', status: 'completed', destination: '/video.mp4' },
    5: { id: 5, videoId: 'other', status: 'downloading' },
  }
  assert.equal(findSwipeDownload(downloads, 'video'), downloads[3])
  downloads[3].status = 'cancelled'
  assert.equal(findSwipeDownload(downloads, 'video'), downloads[2])
  downloads[2].status = 'completed'
  assert.equal(findSwipeDownload(downloads, 'video'), downloads[4])
})

test('play-next moves all matching download files together in playlist order', () => {
  const videos = ['first', 'second', 'third'].map(videoId => ({
    videoId, title: videoId, route: { query: { downloadId: '12', downloadFilePath: `/${videoId}.mp4` } },
  }))
  const items = videos.map((video, index) => ({ ...video, queueItemId: `file-${index}` }))
  const others = [{ videoId: 'before', queueItemId: 'before' }, { videoId: 'between', queueItemId: 'between' }]
  const state = { items: [others[0], items[2], others[1], items[0], items[1]] }
  const options = {
    t,
    commit: (name, payload) => {
      watchQueueMutations[name](state, payload)
      // Shared queue persistence can replace the array after each mutation.
      state.items = structuredClone(state.items)
    },
    add: () => assert.fail('must preserve existing queued entries'),
  }
  const resolve = () => queueSwipeAction('playNext', videos, state.items, options)
  resolve().run()
  assert.deepEqual(state.items.map(item => item.queueItemId), ['file-0', 'file-1', 'file-2', 'before', 'between'])
  resolve().run()
  assert.deepEqual(state.items, others)
})

test('download reversal skips unusable completed files but keeps active jobs eligible', () => {
  const downloads = {
    1: { id: 1, videoId: 'video', status: 'completed', destination: '/older.mp4' },
    2: { id: 2, videoId: 'video', status: 'completed', destination: '/missing.mp4', availability: 'missing' },
    3: { id: 3, videoId: 'video', status: 'completed' },
  }
  assert.equal(findSwipeDownload(downloads, 'video'), downloads[1])
  delete downloads[1]
  assert.equal(findSwipeDownload(downloads, 'video'), undefined)
  for (const status of ['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused']) {
    downloads[4] = { id: 4, videoId: 'video', status, availability: 'missing' }
    assert.equal(findSwipeDownload(downloads, 'video'), downloads[4])
  }
})
