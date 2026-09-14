import assert from 'node:assert/strict'
import test from 'node:test'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const { parseLocalListVideo } = createLocalFeedParsers(() => false)

for (const videoId of [null, undefined, '']) {
  test(`skips an unavailable grid clip with ${String(videoId)} video ID`, () => {
    const clip = new YTNodes.GridVideo({
      videoId,
      title: { simpleText: 'Unavailable clip' },
      thumbnailOverlays: [],
    })
    assert.equal(parseLocalListVideo(clip), null)
  })
}

test('parses an available grid video and preserves channel fallbacks', () => {
  const video = new YTNodes.GridVideo({
    videoId: 'available-id',
    title: { simpleText: ' Available clip ' },
    lengthText: { simpleText: '1:23' },
    thumbnailOverlays: [],
  })
  const result = parseLocalListVideo(video, 'channel-id', 'Channel')

  assert.equal(result.videoId, 'available-id')
  assert.equal(result.title, 'Available clip')
  assert.equal(result.authorId, 'channel-id')
  assert.equal(result.author, 'Channel')
  assert.equal(result.lengthSeconds, 83)
  assert.equal(result.liveNow, false)
})
