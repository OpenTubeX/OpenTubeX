import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Parser, YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const lockupFixture = JSON.parse(await readFile(new URL('../../e2e/fixtures/innertube/watch/review-channel-lockup.json', import.meta.url), 'utf8'))
const { parseLockupView, parseLocalListVideo } = createLocalFeedParsers(() => false)

function searchVideo(timeStatus) {
  return Parser.parseItem({
    videoRenderer: {
      videoId: 'abcdefghijk',
      title: { runs: [{ text: 'Title' }] },
      ownerText: { runs: [{ text: 'Channel', navigationEndpoint: { browseEndpoint: { browseId: 'UC-sample-channel' } } }] },
      lengthText: { simpleText: '4:05' },
      thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: '4:05' }, style: 'DEFAULT', ...timeStatus } }]
    }
  }, YTNodes.Video)
}

test('marks search results whose duration badge has the music icon', () => {
  assert.equal(parseLocalListVideo(searchVideo({ icon: { iconType: 'MUSIC' } })).isMusic, true)
  assert.equal(parseLocalListVideo(searchVideo({})).isMusic, false)
})

test('marks video lockups whose duration badge has the music icon', () => {
  const raw = structuredClone(lockupFixture)
  const badge = raw.contentImage.thumbnailViewModel.overlays[0].thumbnailBottomOverlayViewModel.badges[0].thumbnailBadgeViewModel
  assert.equal(parseLockupView(new YTNodes.LockupView(raw)).isMusic, false)

  badge.icon = { sources: [{ clientResource: { imageName: 'MUSIC' } }] }
  const video = parseLockupView(new YTNodes.LockupView(raw))
  assert.equal(video.isMusic, true)
  assert.equal(video.lengthSeconds, 245)
})
