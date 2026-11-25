import assert from 'node:assert/strict'
import test from 'node:test'

import { startProgressBarOperation } from '../../src/renderer/helpers/progressBar.js'

function createStore () {
  const state = { progressOperations: [] }
  const mutations = {
    addProgressOperation (operation) {
      state.progressOperations.push(operation)
    },
    updateProgressOperation ({ id, ...progress }) {
      Object.assign(state.progressOperations.find(operation => operation.id === id), progress)
    },
    removeProgressOperation (id) {
      state.progressOperations = state.progressOperations.filter(operation => operation.id !== id)
    },
  }
  return {
    state,
    commit (mutation, value) {
      mutations[mutation](value)
    },
  }
}

function visibleMessages (store) {
  return store.state.progressOperations.map(operation => operation.message)
}

test('lists every running operation in the order they started', () => {
  const store = createStore()
  const first = startProgressBarOperation(store, {
    icon: ['fas', 'rss'],
    message: 'Refreshing RSS feeds',
    percentage: 0,
  })
  const second = startProgressBarOperation(store, {
    icon: ['fas', 'download'],
    message: 'Tool download: 0%',
    percentage: 0,
  })

  first.update({ percentage: 50 })
  second.update({ message: 'Tool download: 25%', percentage: 25 })
  assert.deepEqual(store.state.progressOperations.map(({ message, percentage }) => ({ message, percentage })), [
    { message: 'Refreshing RSS feeds', percentage: 50 },
    { message: 'Tool download: 25%', percentage: 25 },
  ])

  first.finish()
  assert.deepEqual(visibleMessages(store), ['Tool download: 25%'])

  second.finish()
  assert.deepEqual(store.state.progressOperations, [])
})

test('ignores updates and repeated finishes after an operation finishes', () => {
  const store = createStore()
  const first = startProgressBarOperation(store, { icon: ['fas', 'sync'], message: 'First', percentage: 0 })
  const second = startProgressBarOperation(store, { icon: ['fas', 'sync'], message: 'Second', percentage: 0 })

  first.finish()
  first.update({ message: 'Late update', percentage: 100 })
  first.finish()
  assert.deepEqual(visibleMessages(store), ['Second'])

  second.finish()
})
