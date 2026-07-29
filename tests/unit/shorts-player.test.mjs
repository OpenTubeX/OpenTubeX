import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSubscriptionShortsFeed,
  getChannelShortsNavigationContext,
  getPreferredShortThumbnailUrl,
  getVideoAspectRatio,
  isYouTubeShort,
  parseLocalShortLinkedVideo,
  setChannelShortsNavigationContext,
} from '../../src/renderer/helpers/player/shorts.js'

test('prefers YouTube selected Shorts thumbnails only for the default preference', () => {
  const video = {
    thumbnailUrl: 'https://i.ytimg.com/vi/short/frame0.jpg'
  }

  assert.equal(
    getPreferredShortThumbnailUrl(video, '', 'https://i.ytimg.com/vi/short/oardefault.jpg'),
    video.thumbnailUrl
  )
  assert.equal(
    getPreferredShortThumbnailUrl(video, 'middle', 'https://i.ytimg.com/vi/short/oar2.jpg'),
    'https://i.ytimg.com/vi/short/oar2.jpg'
  )
  assert.equal(getPreferredShortThumbnailUrl(video, 'hidden', null), null)
})

test('reads aspect ratios from local and Invidious formats', () => {
  assert.equal(getVideoAspectRatio([{ width: 1080, height: 1920 }]), 9 / 16)
  assert.equal(getVideoAspectRatio([{ size: '1080x1920' }]), 9 / 16)
  assert.equal(getVideoAspectRatio([{ audioQuality: 'AUDIO_QUALITY_MEDIUM' }]), null)
})

test('detects square and portrait Shorts up to three minutes long', () => {
  assert.equal(isYouTubeShort({
    duration: 180,
    formats: [{ width: 1080, height: 1920 }],
  }), true)
  assert.equal(isYouTubeShort({
    duration: 60,
    formats: [{ width: 1080, height: 1080 }],
  }), true)
})

test('does not mistake landscape or long portrait videos for Shorts', () => {
  assert.equal(isYouTubeShort({
    duration: 60,
    formats: [{ width: 1920, height: 1080 }],
  }), false)
  assert.equal(isYouTubeShort({
    duration: 181,
    formats: [{ width: 1080, height: 1920 }],
  }), false)
})

test('trusts an explicit Shorts route without stream dimensions', () => {
  assert.equal(isYouTubeShort({ explicit: true }), true)
})

test('extracts a linked full video from Reel metadata', () => {
  const response = {
    data: {
      overlay: {
        reelPlayerOverlayRenderer: {
          playerOverlay: {
            reelPlayerOverlayViewModel: {
              metapanel: {
                reelMetapanelViewModel: {
                  metadataItems: [{
                    reelCarouselViewModel: {
                      buttonViewModels: [{
                        reelCarouselButtonViewModel: {
                          buttonViewModel: {
                            buttonViewModel: {
                              titleFormatted: { content: 'Related full video' },
                              onTap: {
                                innertubeCommand: {
                                  watchEndpoint: { videoId: 'linked-video' }
                                }
                              }
                            }
                          }
                        }
                      }]
                    }
                  }]
                }
              }
            }
          }
        }
      }
    }
  }

  assert.deepEqual(parseLocalShortLinkedVideo(response), {
    videoId: 'linked-video',
    title: 'Related full video',
  })
  assert.equal(parseLocalShortLinkedVideo({}), null)
})

test('builds a newest-first, filtered subscription Shorts feed', () => {
  const feed = buildSubscriptionShortsFeed({
    subscriptions: [{ id: 'channel-a' }, { id: 'channel-b' }],
    cache: {
      'channel-a': {
        videos: [
          { videoId: 'a-new', authorId: 'channel-a', published: 30 },
          { videoId: 'a-old', authorId: 'channel-a', published: 10 },
        ]
      },
      'channel-b': {
        videos: [
          { videoId: 'hidden', authorId: 'channel-b', published: 40 },
          { videoId: 'b', authorId: 'channel-b', published: 20 },
        ]
      }
    },
    isHidden: video => video.videoId === 'hidden',
    maxPerChannel: 1,
  })

  assert.deepEqual(feed.map(video => video.videoId), ['a-new', 'b'])
})

test('keeps an isolated Shorts navigation sequence for each channel', () => {
  setChannelShortsNavigationContext('channel-a', [
    { videoId: 'a-1' },
    { videoId: 'a-2' },
  ])
  setChannelShortsNavigationContext('channel-b', [{ videoId: 'b-1' }])

  assert.deepEqual(
    getChannelShortsNavigationContext('channel-a').map(video => video.videoId),
    ['a-1', 'a-2']
  )
  assert.deepEqual(
    getChannelShortsNavigationContext('channel-b').map(video => video.videoId),
    ['b-1']
  )
})
