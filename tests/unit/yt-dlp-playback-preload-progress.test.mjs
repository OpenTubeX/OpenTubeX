import assert from 'node:assert/strict'
import test from 'node:test'

import { startYtDlpPlaybackPreloadProgress } from '../../src/renderer/helpers/player/ytDlpPlaybackPreloadProgress.js'

function createStore () {
  const state = {}
  return {
    state,
    commit (mutation, value) {
      state[mutation] = value
    },
  }
}

test('restores an earlier playlist preload after an overlapping preload finishes', () => {
  const store = createStore()
  const first = startYtDlpPlaybackPreloadProgress(store, {
    icon: ['fas', 'forward'],
    message: 'First: 0 of 2',
    percentage: 0,
  })
  first.update({ message: 'First: 1 of 2', percentage: 50 })

  const second = startYtDlpPlaybackPreloadProgress(store, {
    icon: ['fas', 'forward'],
    message: 'Second: 0 of 1',
    percentage: 0,
  })
  first.update({ message: 'First: 2 of 2', percentage: 100 })
  assert.equal(store.state.setProgressBarMessage, 'Second: 0 of 1')

  second.finish()
  assert.equal(store.state.setShowProgressBar, true)
  assert.equal(store.state.setProgressBarMessage, 'First: 2 of 2')
  assert.equal(store.state.setProgressBarPercentage, 100)

  first.finish()
  assert.equal(store.state.setShowProgressBar, false)
  assert.equal(store.state.setProgressBarMessage, '')
  assert.equal(store.state.setProgressBarPercentage, 0)
})

test('keeps a newer playlist preload visible when an earlier one finishes', () => {
  const store = createStore()
  const first = startYtDlpPlaybackPreloadProgress(store, {
    icon: ['fas', 'forward'],
    message: 'First',
    percentage: 50,
  })
  const second = startYtDlpPlaybackPreloadProgress(store, {
    icon: ['fas', 'forward'],
    message: 'Second',
    percentage: 25,
  })

  first.finish()
  assert.equal(store.state.setShowProgressBar, true)
  assert.equal(store.state.setProgressBarMessage, 'Second')
  assert.equal(store.state.setProgressBarPercentage, 25)

  second.finish()
  assert.equal(store.state.setShowProgressBar, false)
})
