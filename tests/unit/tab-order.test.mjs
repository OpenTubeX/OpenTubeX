import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReorderedTabMap,
  getGroupedTabInsertIndex
} from '../../src/main/tabs/tabOrder.js'

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

test('appends new tabs to the contiguous group created from their opener', () => {
  const tabs = new Map([
    ['subscriptions', { isPinned: false }],
    ['first-video', { isPinned: false, placementOpenerTabId: 'subscriptions' }],
    ['second-video', { isPinned: false, placementOpenerTabId: 'subscriptions' }],
    ['existing', { isPinned: false }]
  ])

  assert.equal(getGroupedTabInsertIndex(tabs, 'subscriptions', false), 3)
})

test('does not follow a grouped tab that was moved elsewhere', () => {
  const tabs = new Map([
    ['subscriptions', { isPinned: false }],
    ['first-video', { isPinned: false, placementOpenerTabId: 'subscriptions' }],
    ['existing', { isPinned: false }],
    ['moved-video', { isPinned: false, placementOpenerTabId: 'subscriptions' }]
  ])

  assert.equal(getGroupedTabInsertIndex(tabs, 'subscriptions', false), 2)
})

test('starts an unpinned group after all pinned tabs', () => {
  const tabs = new Map([
    ['subscriptions', { isPinned: true }],
    ['other-pinned', { isPinned: true }],
    ['existing', { isPinned: false }]
  ])

  assert.equal(getGroupedTabInsertIndex(tabs, 'subscriptions', false), 2)
})
