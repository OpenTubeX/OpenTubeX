import assert from 'node:assert/strict'
import test from 'node:test'

import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const { parseLocalListPlaylist } = createLocalFeedParsers(() => false)

test('parses a channel TV show as a playlist with its season count', () => {
  const show = {
    type: 'LockupView',
    content_type: 'SHOW',
    content_id: 'PLTqcR5ouTGRU',
    metadata: { title: { text: 'Meta Runner' } },
    content_image: {
      primary_thumbnail: {
        image: [{ url: 'https://i.ytimg.com/tvfilm_banner/PLTqcR5ouTGRU/16_9_.jpg' }],
        overlays: [{
          is: type => type === YTNodes.ThumbnailOverlayBadgeView,
          badges: [{ text: '3 seasons' }]
        }]
      }
    }
  }

  assert.deepEqual(parseLocalListPlaylist(show, 'UCn_FAXem2-e3HQvmK-mOH4g', 'GLITCH'), {
    type: 'playlist',
    dataSource: 'local',
    playlistId: 'PLTqcR5ouTGRU',
    title: 'Meta Runner',
    thumbnail: 'https://i.ytimg.com/tvfilm_banner/PLTqcR5ouTGRU/16_9_.jpg',
    channelName: 'GLITCH',
    channelId: 'UCn_FAXem2-e3HQvmK-mOH4g',
    videoCount: undefined,
    itemCountText: '3 seasons'
  })
})
