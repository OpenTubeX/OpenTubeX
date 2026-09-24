import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findDeadPlaylistItems,
  isUnavailableInvidiousResponse,
  isUnavailablePlayerResponse,
} from '../../src/renderer/helpers/playlist-dead-videos.js'

test('only explicit unavailable or private responses are treated as dead', () => {
  assert.equal(isUnavailablePlayerResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Private video' } }, 'a'), true)
  assert.equal(isUnavailablePlayerResponse({ playabilityStatus: { status: 'ERROR', reason: 'Video unavailable' } }, 'a'), true)
  assert.equal(isUnavailablePlayerResponse({ videoDetails: { videoId: 'a' }, playabilityStatus: { status: 'OK' } }, 'a'), false)
  assert.throws(() => isUnavailablePlayerResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you are not a bot' } }, 'a'))
  assert.equal(isUnavailableInvidiousResponse({ error: 'This video is unavailable' }, 'a'), true)
  assert.throws(() => isUnavailableInvidiousResponse({ error: 'Rate limited' }, 'a'))
})

test('scan keeps uncertain videos and includes duplicate playlist entries', async () => {
  const videos = [
    { videoId: 'dead', playlistItemId: 'first' },
    { videoId: 'live', playlistItemId: 'second' },
    { videoId: 'dead', playlistItemId: 'third' },
    { videoId: 'unknown', playlistItemId: 'fourth' },
  ]
  const calls = []
  const result = await findDeadPlaylistItems(videos, async id => {
    calls.push(id)
    if (id === 'unknown') throw new Error('Network failed')
    return id === 'dead'
  }, new AbortController().signal)

  assert.deepEqual(new Set(calls), new Set(['dead', 'live', 'unknown']))
  assert.deepEqual(result.itemIds, new Set(['first', 'third']))
  assert.equal(result.uncertain, 1)
})

test('cancelled scans cannot return a partial deletion set', async () => {
  const controller = new AbortController()
  await assert.rejects(findDeadPlaylistItems(
    [{ videoId: 'dead', playlistItemId: 'first' }],
    async () => { controller.abort(); return true },
    controller.signal,
  ), { name: 'AbortError' })
})
