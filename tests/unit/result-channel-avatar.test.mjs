import assert from 'node:assert/strict'
import test from 'node:test'

import { getResultAuthorThumbnailUrl } from '../../src/renderer/helpers/result-channel-avatar.js'

test('keeps the channel avatar from local video search results', () => {
  const thumbnail = getResultAuthorThumbnailUrl({
    author: {
      best_thumbnail: { url: 'https://yt3.ggpht.com/channel-avatar=s88' }
    }
  })

  assert.equal(thumbnail, 'https://yt3.ggpht.com/channel-avatar=s88')
})

test('uses the largest Invidious author thumbnail', () => {
  const thumbnail = getResultAuthorThumbnailUrl({
    authorThumbnails: [
      { url: '//invidious.example/avatar-small' },
      { url: '//invidious.example/avatar-large' }
    ]
  })

  assert.equal(thumbnail, 'https://invidious.example/avatar-large')
})
