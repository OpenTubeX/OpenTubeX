import assert from 'node:assert/strict'
import test from 'node:test'

import { getTabPageIcon } from '../../src/renderer/tabs/tabPageIcon.js'

test('external media tabs use platform icons from their media URL', () => {
  for (const [url, platform] of [
    ['https://www.twitch.tv/example', 'twitch'],
    ['https://vimeo.com/123', 'vimeo'],
    ['https://www.dailymotion.com/video/123', 'dailymotion'],
    ['https://soundcloud.com/example/track', 'soundcloud']
  ]) {
    const fullPath = `/external-media?url=${encodeURIComponent(url)}`
    assert.deepEqual(getTabPageIcon({ route: { path: '/external-media', fullPath } }), ['fab', platform])
  }
})

test('external media icon matching uses the URL host and falls back for unknown sites', () => {
  const fullPath = `/external-media?url=${encodeURIComponent('https://not-twitch.tv/video')}`
  assert.deepEqual(getTabPageIcon({ route: { path: '/external-media', fullPath } }), ['fas', 'globe'])
})
