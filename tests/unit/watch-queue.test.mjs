import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createWatchQueueState,
  watchQueueGetters,
  watchQueueMutations,
} from '../../src/renderer/store/modules/watch-queue.js'

function video (videoId) {
  return { videoId, title: `Video ${videoId}` }
}

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
