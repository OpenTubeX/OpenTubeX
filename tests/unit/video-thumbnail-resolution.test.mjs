import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { getVideoThumbnailSource, getVideoThumbnailFallbackUrl, getVideoThumbnailSrcset, isMissingThumbnailPlaceholder } from '../../src/renderer/helpers/videoThumbnail.js'
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
    const thumbnail = {
      thumbnails: [
        { url: 'https://i.ytimg.com/small.jpg', width: 120, height: 180 },
        { url: 'https://i.ytimg.com/large.jpg', width: 720, height: 1080 },
      ]
    }
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

test('Shorts view model images retain both resolutions with missing legacy thumbnails', () => {
  const short = new YTNodes.ShortsLockupView({
    thumbnailViewModel: {
      thumbnailViewModel: {
        image: {
          sources: [
            { url: 'https://i.ytimg.com/short-small.jpg?rs=signed', width: 120, height: 180 },
            { url: 'https://i.ytimg.com/short-large.jpg?rs=signed', width: 720, height: 1080 }
          ]
        }
      }
    },
    onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'short' } } },
    overlayMetadata: { primaryText: { content: 'Short' } }
  })
  for (const parse of [parseShort, parseLocalPlaylistVideo]) {
    assert.equal(parse(short).thumbnailUrl, 'https://i.ytimg.com/short-large.jpg?rs=signed')
    assert.equal(parse(short).lowResolutionThumbnailUrl, 'https://i.ytimg.com/short-small.jpg?rs=signed')
  }
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
  for (const name of ['mqdefault', 'mq1', 'oar1', 'oar2']) {
    assert.equal(getVideoThumbnailFallbackUrl(`https://i.ytimg.com/vi/video/${name}.jpg`), null)
  }
  // Not every Short has a selected portrait thumbnail, but each has generated frames
  assert.equal(getVideoThumbnailFallbackUrl('https://i.ytimg.com/vi/short/oardefault.jpg'), 'https://i.ytimg.com/vi/short/oar2.jpg')
  assert.equal(getVideoThumbnailFallbackUrl('https://invidious.test/vi/short/oardefault.jpg?host=x'), 'https://invidious.test/vi/short/oar2.jpg?host=x')
  assert.equal(getVideoThumbnailFallbackUrl('https://yt3.ggpht.com/avatar'), null)
  assert.equal(getVideoThumbnailFallbackUrl('data:image/png;base64,AA=='), null)
})

test('only full-resolution landscape thumbnails get a medium-resolution srcset candidate', () => {
  assert.equal(getVideoThumbnailSrcset('https://invidious.test/vi_webp/video/maxresdefault.webp?host=x&opentubex_retry=1'),
    'https://invidious.test/vi_webp/video/mqdefault.webp?host=x&opentubex_retry=1 320w, https://invidious.test/vi_webp/video/maxresdefault.webp?host=x&opentubex_retry=1 1280w')
  for (const name of ['mqdefault', 'sddefault', 'hqdefault', 'oardefault', 'oar2', 'mq1']) {
    assert.equal(getVideoThumbnailSrcset(`https://i.ytimg.com/vi/video/${name}.jpg`), null)
  }
  assert.equal(getVideoThumbnailSrcset('https://dearrow-thumb.test/api/v1/getThumbnail?videoID=video'), null)
  assert.equal(getVideoThumbnailSrcset('data:image/png;base64,AA=='), null)
})

test('missing-resolution placeholders are recognized at any srcset density', () => {
  const maxres = 'https://i.ytimg.com/vi/video/maxresdefault.jpg'
  const mq = 'https://i.ytimg.com/vi/video/mqdefault.jpg'
  const srcset = `${mq} 320w, ${maxres} 1280w`
  assert.equal(isMissingThumbnailPlaceholder({ naturalWidth: 120, naturalHeight: 90, currentSrc: 'https://i.ytimg.com/vi/video/sddefault.jpg', srcset: '' }), true)
  assert.equal(isMissingThumbnailPlaceholder({ naturalWidth: 640, naturalHeight: 480, currentSrc: 'https://i.ytimg.com/vi/video/sddefault.jpg', srcset: '' }), false)
  // 120x90 chosen as the 1280w candidate of a 288px slot measures a rounded 27x20.
  assert.equal(isMissingThumbnailPlaceholder({ naturalWidth: 27, naturalHeight: 20, currentSrc: maxres, srcset }), true)
  assert.equal(isMissingThumbnailPlaceholder({ naturalWidth: 288, naturalHeight: 162, currentSrc: maxres, srcset }), false)
  assert.equal(isMissingThumbnailPlaceholder({ naturalWidth: 36, naturalHeight: 20, currentSrc: maxres, srcset }), false)
  // A density-scaled medium candidate that happens to measure 120x90 is still the smallest fallback.
  assert.equal(isMissingThumbnailPlaceholder({ naturalWidth: 120, naturalHeight: 90, currentSrc: mq, srcset }), false)
})
