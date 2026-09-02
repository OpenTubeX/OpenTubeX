import assert from 'node:assert/strict'
import test from 'node:test'

import { startProgressBarOperation } from '../../src/renderer/helpers/progressBar.js'

function createStore () {
  const state = {}
  return {
    state,
    commit (mutation, value) {
      state[mutation] = value
    },
  }
}

test('restores an earlier operation after an overlapping operation finishes', () => {
  const store = createStore()
  const first = startProgressBarOperation(store, {
    icon: ['fas', 'forward'],
    message: 'Playlist: 0 of 2',
    percentage: 0,
  })
  first.update({ message: 'Playlist: 1 of 2', percentage: 50 })

  const second = startProgressBarOperation(store, {
    icon: ['fas', 'forward'],
    message: 'Tool download: 0%',
    percentage: 0,
  })
  first.update({ message: 'Playlist: 2 of 2', percentage: 100 })
  assert.equal(store.state.setProgressBarMessage, 'Tool download: 0%')

  second.finish()
  assert.equal(store.state.setShowProgressBar, true)
  assert.equal(store.state.setProgressBarMessage, 'Playlist: 2 of 2')
  assert.equal(store.state.setProgressBarPercentage, 100)

  first.finish()
  assert.equal(store.state.setShowProgressBar, false)
  assert.equal(store.state.setProgressBarMessage, '')
  assert.equal(store.state.setProgressBarPercentage, 0)
})

test('keeps a newer operation visible when an earlier operation finishes', () => {
  const store = createStore()
  const first = startProgressBarOperation(store, {
    icon: ['fas', 'forward'],
    message: 'First',
    percentage: 50,
  })
  const second = startProgressBarOperation(store, {
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
