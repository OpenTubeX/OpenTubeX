import assert from 'node:assert/strict'
import test from 'node:test'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const { parseShort } = createLocalFeedParsers(() => false)

test('reads the title of slim Shorts lockups from their accessibility text', () => {
  // Shape of the Shorts on YouTube's hashtag pages, which omit the primary text.
  const short = new YTNodes.ShortsLockupView({
    entityId: 'shorts-shelf-item-slimshort1',
    accessibilityText: 'Pasta, quick and easy, 1.2 thousand views - play Short',
    onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'slimshort1' } } },
    overlayMetadata: { secondaryText: { content: '1.2K views' } }
  })

  const parsed = parseShort(short)
  assert.equal(parsed.videoId, 'slimshort1')
  assert.equal(parsed.title, 'Pasta, quick and easy')
  assert.equal(parsed.viewCount, 1200)
})
