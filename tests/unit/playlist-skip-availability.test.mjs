import assert from 'node:assert/strict'
import test from 'node:test'

import { getPlaylistSkipAvailability } from '../../src/renderer/helpers/playlists.js'

test('hides the previous button on the first video and the next button on the last one', () => {
  const first = getPlaylistSkipAvailability({ itemCount: 3, currentIndex: 0, loopEnabled: false })
  assert.deepEqual(first, { canPlayNext: true, canPlayPrevious: false })

  const middle = getPlaylistSkipAvailability({ itemCount: 3, currentIndex: 1, loopEnabled: false })
  assert.deepEqual(middle, { canPlayNext: true, canPlayPrevious: true })

  const last = getPlaylistSkipAvailability({ itemCount: 3, currentIndex: 2, loopEnabled: false })
  assert.deepEqual(last, { canPlayNext: false, canPlayPrevious: true })
})

test('keeps both buttons when loop wraps the playlist around', () => {
  for (const currentIndex of [0, 1, 2]) {
    assert.deepEqual(
      getPlaylistSkipAvailability({ itemCount: 3, currentIndex, loopEnabled: true }),
      { canPlayNext: true, canPlayPrevious: true },
      `loop should allow skipping in both directions at index ${currentIndex}`
    )
  }

  // A single video playlist only has itself to loop back to
  assert.deepEqual(
    getPlaylistSkipAvailability({ itemCount: 1, currentIndex: 0, loopEnabled: true }),
    { canPlayNext: true, canPlayPrevious: true }
  )
  assert.deepEqual(
    getPlaylistSkipAvailability({ itemCount: 1, currentIndex: 0, loopEnabled: false }),
    { canPlayNext: false, canPlayPrevious: false }
  )
})

test('keeps both buttons for videos that are not part of the playlist', () => {
  assert.deepEqual(
    getPlaylistSkipAvailability({ itemCount: 3, currentIndex: -1, loopEnabled: false }),
    { canPlayNext: true, canPlayPrevious: true }
  )
})

test('has nothing to skip to in an empty playlist', () => {
  assert.deepEqual(
    getPlaylistSkipAvailability({ itemCount: 0, currentIndex: -1, loopEnabled: true }),
    { canPlayNext: false, canPlayPrevious: false }
  )
})

test('offers the previous video that took the place of a deleted current video', () => {
  // The deleted video was the second one, so the first one is shown as the current one
  assert.deepEqual(
    getPlaylistSkipAvailability({
      itemCount: 3,
      currentIndex: 0,
      loopEnabled: false,
      previousVideoSourceIndex: 1
    }),
    { canPlayNext: true, canPlayPrevious: true }
  )
})
