import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_HOME_SECTION_LAYOUT,
  getContinueWatchingCandidates,
  normalizeHomeSectionLayout,
} from '../../src/renderer/helpers/homeSections.js'
import { canMarkHistoryEntryAsWatched } from '../../src/history.js'
import { getHomeShelfLayout } from '../../src/renderer/helpers/homeShelfPagination.js'

test('normalizes a complete current Home layout', () => {
  const input = DEFAULT_HOME_SECTION_LAYOUT.toReversed()
    .map((section, index) => ({ id: section.id, visible: index !== 0 }))

  assert.deepEqual(normalizeHomeSectionLayout(input), input)
})

test('adds recommendations without resetting existing Home order or visibility', () => {
  const previousLayout = DEFAULT_HOME_SECTION_LAYOUT
    .filter(section => section.id !== 'recommendations')
    .toReversed()
    .map(section => ({ ...section, visible: false }))
  assert.deepEqual(normalizeHomeSectionLayout(previousLayout), [
    ...previousLayout,
    { id: 'recommendations', visible: true },
  ])
})

test('continue watching includes only started, unfinished videos', () => {
  const entries = [
    { videoId: 'unfinished', watchProgress: 20, lengthSeconds: 100 },
    { videoId: 'not-started', watchProgress: 0, lengthSeconds: 100 },
    { videoId: 'watched', watchProgress: 20, lengthSeconds: 100, isWatched: true },
    { videoId: 'finished', watchProgress: 100, lengthSeconds: 100 },
    { videoId: 'live', watchProgress: 20, isLive: true },
    { videoId: 'upcoming', watchProgress: 20, isUpcoming: true },
    {
      videoId: 'started-premiere',
      watchProgress: 20,
      lengthSeconds: 100,
      isUpcoming: true,
      premiereTimestamp: Math.floor(Date.now() / 1000) - 1,
    },
  ]

  assert.deepEqual(
    // As the Continue Watching getter filters them
    getContinueWatchingCandidates(entries).filter(canMarkHistoryEntryAsWatched).map(entry => entry.videoId),
    ['unfinished', 'started-premiere']
  )
})

test('Home shelves use one row and reserve space for paging controls', () => {
  assert.deepEqual(getHomeShelfLayout(900, 3, 260, 12), {
    pageSize: 3,
    showControls: false,
  })
  assert.deepEqual(getHomeShelfLayout(900, 8, 260, 12), {
    pageSize: 2,
    showControls: true,
  })
})

test('Home shelves mount only one card before their width is measured', () => {
  for (const width of [0, Number.NaN]) {
    assert.deepEqual(getHomeShelfLayout(width, 10_800, 260, 12), {
      pageSize: 1,
      showControls: false,
    })
  }
})

test('Home shelf capacity handles fractional UI scale measurements', () => {
  assert.deepEqual(getHomeShelfLayout(374.4, 8, 260, 12), {
    pageSize: 1,
    showControls: true,
  })
})
