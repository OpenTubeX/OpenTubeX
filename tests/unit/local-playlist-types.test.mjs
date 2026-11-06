import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const { parseLocalListPlaylist } = createLocalFeedParsers(() => false)

function lockup(contentType, iconName) {
  return {
    type: 'LockupView', content_type: contentType, content_id: 'PL-types',
    metadata: { title: { text: 'Playlist type' } },
    content_image: { primary_thumbnail: {
      image: [{ url: 'https://example.test/thumbnail.jpg' }],
      overlays: [{ is: () => true, badges: [{ text: '12 episodes', icon_name: iconName }] }]
    } }
  }
}

for (const [contentType, flag] of [['COURSE', 'isCourse'], ['ALBUM', 'isAlbum'], ['PODCAST', 'isPodcast']]) {
  test(`parses ${contentType} lockups with their playlist type and channel fallback`, () => {
    const result = parseLocalListPlaylist(lockup(contentType), 'UC-types', 'Type channel')
    assert.equal(result[flag], true)
    assert.equal(result.videoCount, 12)
    assert.equal(result.channelId, 'UC-types')
    assert.equal(result.channelName, 'Type channel')
  })
}

for (const [iconName, flag] of [['COURSE', 'isCourse'], ['music', 'isAlbum']]) {
  test(`recognizes ${iconName} badges on ordinary playlist lockups`, () => {
    assert.equal(parseLocalListPlaylist(lockup('PLAYLIST', iconName))[flag], true)
  })
}

test('keeps OpenTubeX show episode-count text', () => {
  const result = parseLocalListPlaylist(lockup('SHOW'))
  assert.equal(result.itemCountText, '12 episodes')
  assert.equal(result.videoCount, undefined)
})

for (const type of ['GridPlaylist', 'Playlist']) {
  test(`recognizes music overlays on ${type} without requiring overlays for ordinary playlists`, () => {
    const playlist = {
      type, id: 'PL-album', title: { text: 'Album' },
      thumbnails: [{ url: 'https://example.test/album.jpg' }],
      video_count: { text: '4' }
    }
    assert.equal(parseLocalListPlaylist(playlist).isAlbum, false)
    playlist.thumbnail_overlays = [{ icon_type: 'MUSIC' }]
    assert.equal(parseLocalListPlaylist(playlist).isAlbum, true)
    if (type === 'Playlist') {
      playlist.thumbnail_overlays = [{ icon_type: 'COURSE' }]
      assert.equal(parseLocalListPlaylist(playlist).isCourse, true)
    }
  })
}
