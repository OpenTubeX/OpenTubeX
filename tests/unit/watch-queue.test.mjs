import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createStore } from 'vuex'
import downloads from '../../src/renderer/store/modules/downloads.js'

import {
  default as watchQueue,
  createWatchQueueState,
  watchQueueGetters,
  watchQueueMutations,
} from '../../src/renderer/store/modules/watch-queue.js'

function video (videoId) {
  return { videoId, title: `Video ${videoId}` }
}

test('removing a download also removes its queued copies without affecting other sources', () => {
  const store = createStore({ modules: {
    downloads: { ...downloads, state: () => ({ ytDlpDownloads: { 1: { id: 1 }, 2: { id: 2 } } }) },
    watchQueue,
  } })
  for (const downloadId of ['1', '2', '1', undefined]) {
    store.commit('addVideoToWatchQueue', {
      video: { videoId: 'same-video', route: downloadId ? { query: { downloadId } } : undefined },
    })
  }
  store.commit('removeYtDlpDownload', 1)
  assert.equal(store.getters.getYtDlpDownloads[1], undefined)
  assert.equal(store.getters.getYtDlpDownloads[2].id, 2)
  assert.deepEqual(store.getters.getWatchQueue.map(item => item.route?.query.downloadId), ['2', undefined])
})

test('adds videos to the end or front of the watch queue', () => {
  const state = createWatchQueueState()

  watchQueueMutations.addVideoToWatchQueue(state, { video: video('one') })
  watchQueueMutations.addVideoToWatchQueue(state, { video: video('two') })
  watchQueueMutations.addVideoToWatchQueue(state, { video: video('next'), playNext: true })

  assert.deepEqual(state.items.map(item => item.videoId), ['next', 'one', 'two'])
  assert.equal(watchQueueGetters.getNextQueuedVideo(state).videoId, 'next')
  assert.equal(watchQueueGetters.getWatchQueueLength(state), 3)
})

test('reorders, removes, and clears queued videos', () => {
  const state = createWatchQueueState()
  for (const id of ['one', 'two', 'three']) {
    watchQueueMutations.addVideoToWatchQueue(state, { video: video(id) })
  }

  const secondId = state.items[1].queueItemId
  watchQueueMutations.moveVideoInWatchQueue(state, { queueItemId: secondId, offset: -1 })
  assert.deepEqual(state.items.map(item => item.videoId), ['two', 'one', 'three'])

  watchQueueMutations.removeVideoFromWatchQueue(state, secondId)
  assert.deepEqual(state.items.map(item => item.videoId), ['one', 'three'])

  watchQueueMutations.clearWatchQueue(state)
  assert.deepEqual(state.items, [])
})

for (const route of [undefined, { path: '/watch/saved', query: { downloadId: '42' } }]) {
  test(`queue advancement ${route ? 'preserves the downloaded file route' : 'opens online videos normally'}`, async () => {
    const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
    const start = source.indexOf('    playNextQueuedVideo:')
    const end = source.indexOf('\n    },', start)
    const playNext = runInNewContext(`({ ${source.slice(start, end)}\n} }).playNextQueuedVideo`, { showToast() {} })
    const navigations = []
    const removed = []
    const watch = {
      nextQueuedVideo: { videoId: 'saved', queueItemId: 1, route },
      $store: { commit: (name, id) => removed.push([name, id]) },
      tabRouter: { push: route => navigations.push(route) },
      t: key => key,
    }
    assert.equal(playNext.call(watch), true)
    assert.deepEqual(JSON.parse(JSON.stringify(navigations)), [route ?? { path: '/watch/saved' }])
    assert.deepEqual(removed, [['removeVideoFromWatchQueue', 1]])
  })
}
