import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { getVideoThumbnailSource, getVideoThumbnailFallbackUrl } from '../../src/renderer/helpers/videoThumbnail.js'
import { getPreferredShortThumbnailUrl } from '../../src/renderer/helpers/player/shorts.js'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const source = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const start = source.indexOf('export function getVideoThumbnailUrl(')
const end = source.indexOf('\n/**', start)
const getVideoThumbnailUrl = vm.runInNewContext(source.slice(start, end).replace('export ', '') + '\ngetVideoThumbnailUrl')
const { parseShort, parseLocalPlaylistVideo } = createLocalFeedParsers(() => false)
const shortsStart = source.indexOf('export function getShortThumbnailUrl(')
const shortsEnd = source.indexOf('\nexport const ToastEventBus', shortsStart)
const getShortThumbnailUrl = vm.runInNewContext(source.slice(shortsStart, shortsEnd).replace('export ', '') + '\ngetShortThumbnailUrl', { getVideoThumbnailUrl, getPreferredShortThumbnailUrl })

for (const type of ['ReelItem', 'ShortsLockupView']) {
  test(`${type} selects the largest supplied portrait image in feeds and playlists`, () => {
    const thumbnail = { thumbnails: [
      { url: 'https://i.ytimg.com/small.jpg', width: 120, height: 180 },
      { url: 'https://i.ytimg.com/large.jpg', width: 720, height: 1080 },
    ] }
    const short = type === 'ReelItem'
      ? new YTNodes.ReelItem({ videoId: 'short', headline: { simpleText: 'Short' }, viewCountText: { simpleText: '123 views' }, thumbnail })
      : new YTNodes.ShortsLockupView({
          thumbnail,
          onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'short' } } },
          overlayMetadata: { primaryText: { content: 'Short' } },
        })
    assert.equal(parseShort(short).thumbnailUrl, 'https://i.ytimg.com/large.jpg')
    assert.equal(parseLocalPlaylistVideo(short).thumbnailUrl, 'https://i.ytimg.com/large.jpg')
    assert.equal(parseShort(short).lowResolutionThumbnailUrl, 'https://i.ytimg.com/small.jpg')
    assert.equal(parseLocalPlaylistVideo(short).lowResolutionThumbnailUrl, 'https://i.ytimg.com/small.jpg')
    assert.equal(getShortThumbnailUrl(parseShort(short), 'local', '', '', true), 'https://i.ytimg.com/small.jpg')
  })
}

test('video cards request maximum resolution for both backends', () => {
  assert.equal(getVideoThumbnailUrl('video', 'local', ''), 'https://i.ytimg.com/vi/video/maxresdefault.jpg')
  assert.equal(getVideoThumbnailUrl('video', 'invidious', 'https://invidious.test'), 'https://invidious.test/vi/video/maxresdefault.jpg')
})

test('data saver restores medium-resolution sources and preserves thumbnail preferences', () => {
  for (const origin of ['https://i.ytimg.com', 'https://invidious.test']) {
    assert.equal(getVideoThumbnailSource(`${origin}/vi/video/maxresdefault.jpg?cache=1`, true), `${origin}/vi/video/mqdefault.jpg?cache=1`)
    assert.equal(getVideoThumbnailSource(`${origin}/vi_webp/video/hqdefault.webp`, true), `${origin}/vi_webp/video/mqdefault.webp`)
  }
  for (const name of ['mqdefault', 'mq1', 'oar1', 'oardefault']) {
    const url = `https://i.ytimg.com/vi/video/${name}.jpg`
    assert.equal(getVideoThumbnailSource(url, true), url)
  }
  const short = { videoId: 'short', thumbnailUrl: 'https://i.ytimg.com/large.jpg', lowResolutionThumbnailUrl: 'https://i.ytimg.com/small.jpg' }
  assert.equal(getShortThumbnailUrl(short, 'local', '', '', false), short.thumbnailUrl)
  assert.equal(getShortThumbnailUrl(short, 'local', '', 'hidden', true), null)
  assert.equal(getShortThumbnailUrl(short, 'local', '', 'start', true), 'https://i.ytimg.com/vi/short/oar1.jpg')
})

test('resolution fallback preserves proxies and parameters without changing other images', () => {
  assert.equal(getVideoThumbnailFallbackUrl('https://i.ytimg.com/vi_webp/video/maxresdefault.webp?x=1'), 'https://i.ytimg.com/vi_webp/video/sddefault.webp?x=1')
  for (const name of ['mqdefault', 'mq1', 'oar1', 'oardefault']) {
    assert.equal(getVideoThumbnailFallbackUrl(`https://i.ytimg.com/vi/video/${name}.jpg`), null)
  }
  assert.equal(getVideoThumbnailFallbackUrl('https://yt3.ggpht.com/avatar'), null)
  assert.equal(getVideoThumbnailFallbackUrl('data:image/png;base64,AA=='), null)
})

test('thumbnail preferences preserve hidden, selected frames, and portrait images', () => {
  assert.equal(getVideoThumbnailUrl('video', 'local', '', 'hidden'), null)
  for (const [preference, frame] of [['start', 1], ['middle', 2], ['end', 3]]) {
    assert.equal(getVideoThumbnailUrl('video', 'local', '', preference), `https://i.ytimg.com/vi/video/mq${frame}.jpg`)
    assert.equal(getVideoThumbnailUrl('video', 'local', '', preference, true), `https://i.ytimg.com/vi/video/oar${frame}.jpg`)
  }
  assert.equal(getVideoThumbnailUrl('video', 'local', '', '', true), 'https://i.ytimg.com/vi/video/oardefault.jpg')
})
