import assert from 'node:assert/strict'
import test from 'node:test'

import { applyTwitchPlaylistOrigin } from '../../src/twitchPlaylistOrigin.js'

test('sends Twitch playlist requests with the Twitch origin', () => {
  const headers = { Origin: 'app://bundle' }
  applyTwitchPlaylistOrigin(new URL('https://euc12.playlist.ttvnw.net/v1/playlist/token.m3u8'), headers)
  assert.equal(headers.Origin, 'https://www.twitch.tv')
})

test('does not change origins for Twitch segments or unrelated hosts', () => {
  for (const url of [
    'https://euc12.playlist.ttvnw.net/v1/segment/token.ts',
    'https://playlist.ttvnw.net.evil.test/v1/playlist/token.m3u8',
    'https://example.test/v1/playlist/token.m3u8'
  ]) {
    const headers = { Origin: 'app://bundle' }
    applyTwitchPlaylistOrigin(new URL(url), headers)
    assert.equal(headers.Origin, 'app://bundle')
  }
})
