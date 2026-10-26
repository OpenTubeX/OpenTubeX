import assert from 'node:assert/strict'
import test from 'node:test'

import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const { parseLocalListPlaylist, parseLocalListPlaylists } = createLocalFeedParsers(() => false)

function playlistCard() {
  return {
    type: 'LockupView', content_type: 'PLAYLIST', content_id: 'PLexample',
    metadata: { title: { text: 'Example playlist' } },
    content_image: { primary_thumbnail: {
      image: [{ url: 'https://example.com/thumbnail.jpg' }],
      overlays: [{ is: type => type === YTNodes.ThumbnailOverlayBadgeView, badges: [{ text: '12 videos' }] }],
    } },
  }
}

for (const field of ['title', 'metadata']) {
  test(`preserves a playlist when its ${field} is missing`, () => {
    const card = playlistCard()
    if (field === 'metadata') delete card.metadata
    else delete card.metadata.title
    const playlist = parseLocalListPlaylist(card)
    assert.equal(playlist.playlistId, 'PLexample')
    assert.equal(playlist.title, '')
  })
}

test('drops playlists without IDs and unsupported mixes from a mixed playlist list', () => {
  const valid = playlistCard()
  const missingId = { ...playlistCard(), content_id: undefined }
  const mix = { ...playlistCard(), content_id: 'RDexample' }
  assert.equal(parseLocalListPlaylist(missingId), null)
  assert.deepEqual(parseLocalListPlaylists([missingId, mix, valid], 'UCfallback', 'Fallback channel'), [
    parseLocalListPlaylist(valid, 'UCfallback', 'Fallback channel'),
  ])
})

test('parses a GridShow as its episode playlist and preserves the season label', () => {
  const show = new YTNodes.GridShow({
    title: { simpleText: 'Example show' },
    navigationEndpoint: { browseEndpoint: { browseId: 'VLPLexample' } },
    thumbnailRenderer: { showCustomThumbnailRenderer: {
      thumbnail: { thumbnails: [{ url: 'https://example.com/show.jpg', width: 1280, height: 720 }] },
    } },
    thumbnailOverlays: [{ thumbnailOverlayBottomPanelRenderer: { text: { simpleText: '3 seasons' } } }],
  })
  const playlist = parseLocalListPlaylist(show, 'UCfallback', 'Fallback channel')
  assert.equal(playlist.playlistId, 'PLexample')
  assert.equal(playlist.title, 'Example show')
  assert.equal(playlist.thumbnail, 'https://example.com/show.jpg')
  assert.equal(playlist.channelId, 'UCfallback')
  assert.equal(playlist.channelName, 'Fallback channel')
  assert.equal(playlist.itemCountText, '3 seasons')
  assert.equal(playlist.videoCount, undefined)
})

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
    authorVerified: false,
    authorVerifiedArtist: false,
    videoCount: undefined,
    itemCountText: '3 seasons',
    isPodcast: false,
    isAlbum: false,
    isCourse: false
  })
})

test('preserves the playlist author ID and uses a channel name fallback when available', () => {
  const playlist = {
    type: 'Playlist',
    id: 'PLexample',
    title: { text: 'Example playlist' },
    author: { id: 'UCchannel', name: 'N/A' },
    thumbnails: [{ url: 'https://example.com/thumbnail.jpg' }],
    video_count: { text: '12 videos' }
  }

  for (const [channelId, channelName, expectedName] of [
    [undefined, undefined, 'N/A'],
    ['UCfallback', 'Example channel', 'Example channel'],
    ['UCfallback', '', 'N/A']
  ]) {
    const result = parseLocalListPlaylist(playlist, channelId, channelName)
    assert.equal(result.channelName, expectedName)
    assert.equal(result.channelId, 'UCchannel')
  }
})

test('replaces a generic playlist label only when a channel name fallback is available', () => {
  const playlist = {
    type: 'LockupView',
    content_type: 'PLAYLIST',
    content_id: 'PLexample',
    metadata: {
      title: { text: 'Example playlist' },
      metadata: {
        metadata_rows: [{ metadata_parts: [{ text: {
          text: 'Playlist',
          endpoint: {
            metadata: { page_type: 'WEB_PAGE_TYPE_CHANNEL' },
            payload: { browseId: 'UCchannel' }
          }
        } }] }]
      }
    },
    content_image: {
      primary_thumbnail: {
        image: [{ url: 'https://example.com/thumbnail.jpg' }],
        overlays: [{
          is: type => type === YTNodes.ThumbnailOverlayBadgeView,
          badges: [{ text: '12 videos' }]
        }]
      }
    }
  }

  for (const [channelName, expectedName] of [
    ['Example channel', 'Example channel'],
    [undefined, 'Playlist'],
    ['', 'Playlist']
  ]) {
    const result = parseLocalListPlaylist(playlist, undefined, channelName)
    assert.equal(result.channelName, expectedName)
    assert.equal(result.channelId, 'UCchannel')
  }
})
