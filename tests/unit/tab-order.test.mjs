import assert from 'node:assert/strict'
import test from 'node:test'

import { buildReorderedTabMap } from '../../src/main/tabs/tabOrder.js'

function createTabs() {
  return new Map([
    ['pinned', { isPinned: true }],
    ['first', { isPinned: false }],
    ['second', { isPinned: false }]
  ])
}

test('rejects incomplete, duplicate, unknown, and interleaved tab orders', () => {
  const tabs = createTabs()
  const sparseTabIds = ['pinned', 'first', 'second']
  delete sparseTabIds[1]

  assert.equal(buildReorderedTabMap(tabs, ['pinned', 'first']), null)
  assert.equal(buildReorderedTabMap(tabs, ['pinned', 'first', 'first']), null)
  assert.equal(buildReorderedTabMap(tabs, ['pinned', 'first', 'unknown']), null)
  assert.equal(buildReorderedTabMap(tabs, ['first', 'pinned', 'second']), null)
  assert.equal(buildReorderedTabMap(tabs, ['pinned', 1, 'second']), null)
  assert.equal(buildReorderedTabMap(tabs, sparseTabIds), null)
})

test('returns the existing map for a no-op tab order', () => {
  const tabs = createTabs()

  assert.equal(
    buildReorderedTabMap(tabs, ['pinned', 'first', 'second']),
    tabs
  )
})

test('builds a valid changed order without changing tab objects', () => {
  const tabs = createTabs()
  const reorderedTabs = buildReorderedTabMap(tabs, ['pinned', 'second', 'first'])

  assert.deepEqual(Array.from(reorderedTabs.keys()), ['pinned', 'second', 'first'])
  assert.equal(reorderedTabs.get('first'), tabs.get('first'))
  assert.equal(reorderedTabs.get('second'), tabs.get('second'))
})
