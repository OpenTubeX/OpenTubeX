import assert from 'node:assert/strict'
import test from 'node:test'

import { YTNodes } from 'youtubei.js'

import { parseLocalVideoMusicTracks, parseVideoMusicTracks } from '../../src/renderer/helpers/video-music.js'

/**
 * Shape captured from a real `/next` response (video I8Kplsf1p5Q).
 * @param {object} [overrides]
 */
function rawMusicCard(overrides = {}) {
  return {
    videoAttributeViewModel: {
      image: { sources: [{ url: 'https://yt3.googleusercontent.com/album-art' }] },
      imageStyle: 'VIDEO_ATTRIBUTE_IMAGE_STYLE_SQUARE',
      title: 'Brighter Now (107315)',
      subtitle: 'Adrian Disch',
      secondarySubtitle: { content: 'Finding My Way' },
      orientation: 'VIDEO_ATTRIBUTE_ORIENTATION_HORIZONTAL',
      onTap: {
        innertubeCommand: {
          commandMetadata: { webCommandMetadata: { url: '/watch?v=Mwq5L8U7s98', webPageType: 'WEB_PAGE_TYPE_WATCH' } },
          watchEndpoint: { videoId: 'Mwq5L8U7s98' }
        }
      },
      sizingRule: 'VIDEO_ATTRIBUTE_SIZING_RULE_RESPONSIVE',
      overflowMenuOnTap: {
        innertubeCommand: {
          confirmDialogEndpoint: {
            content: {
              confirmDialogRenderer: {
                title: { runs: [{ text: 'Song credits' }] },
                dialogMessages: [{ runs: [{ text: 'Song', bold: true }, { text: ': ', bold: true }, { text: 'Brighter Now (107315)' }] }]
              }
            }
          }
        }
      },
      ...overrides
    }
  }
}

/**
 * @param {object[]} cards
 */
function musicSection(cards) {
  return new YTNodes.HorizontalCardList({
    cards,
    header: { richListHeaderRenderer: { title: { simpleText: 'Music' }, subtitle: { simpleText: `${cards.length} songs` } } }
  })
}

const chaptersSection = new YTNodes.HorizontalCardList({
  cards: [{
    macroMarkersListItemRenderer: {
      title: { simpleText: 'Intro' },
      timeDescription: { simpleText: '0:00' },
      thumbnail: { thumbnails: [] },
      onTap: { watchEndpoint: { videoId: 'I8Kplsf1p5Q', startTimeSeconds: 0 } }
    }
  }],
  header: { richListHeaderRenderer: { title: { simpleText: 'Chapters' } } }
})

/**
 * @param {object} options
 * @param {import('youtubei.js').Helpers.YTNode[]} [options.items]
 * @param {object[]} [options.musicTracks] YouTube.js' parsed older music section
 * @param {string} [options.panelIdentifier]
 */
function videoInfo({ items = [], musicTracks = [], panelIdentifier = 'engagement-panel-structured-description' }) {
  return {
    music_tracks: musicTracks,
    page: [
      {},
      {
        engagement_panels: [
          { panel_identifier: 'engagement-panel-comments-section', content: { items: [] } },
          { panel_identifier: panelIdentifier, content: { items } }
        ]
      }
    ]
  }
}

test('extracts the song, artist, album, album art and song video', () => {
  assert.deepEqual(parseLocalVideoMusicTracks(videoInfo({ items: [musicSection([rawMusicCard()])] })), [
    {
      title: 'Brighter Now (107315)',
      artist: 'Adrian Disch',
      album: 'Finding My Way',
      license: '',
      thumbnail: 'https://yt3.googleusercontent.com/album-art',
      videoId: 'Mwq5L8U7s98',
      channelId: undefined
    }
  ])
})

test('keeps a song that YouTube does not link to a video', () => {
  const card = rawMusicCard({ onTap: undefined })
  // YouTube leaves the key out when it doesn't know the album
  delete card.videoAttributeViewModel.secondarySubtitle

  const [track] = parseLocalVideoMusicTracks(videoInfo({ items: [musicSection([card])] }))

  assert.equal(track.videoId, undefined)
  assert.equal(track.album, '')
})

test('extracts every song in order and skips the chapters', () => {
  const second = rawMusicCard({ title: 'Closer (114563)', subtitle: 'ICELANDIA' })

  const tracks = parseLocalVideoMusicTracks(videoInfo({ items: [chaptersSection, musicSection([rawMusicCard(), second])] }))

  assert.deepEqual(tracks.map(track => track.title), ['Brighter Now (107315)', 'Closer (114563)'])
})

test('ignores attribute cards that are not square album art', () => {
  const card = rawMusicCard({ imageStyle: 'VIDEO_ATTRIBUTE_IMAGE_STYLE_PORTRAIT' })

  assert.deepEqual(parseLocalVideoMusicTracks(videoInfo({ items: [musicSection([card])] })), [])
})

test('falls back to the older music section layout', () => {
  const musicTracks = [
    { song: 'Song', artist: 'Artist', album: 'Album', license: 'Label (on behalf of Artist)', videoId: 'abcdefghijk', channelId: 'UC123' },
    { song: undefined, artist: 'Empty track' }
  ]

  assert.deepEqual(parseLocalVideoMusicTracks(videoInfo({ items: [chaptersSection], musicTracks })), [
    {
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      license: 'Label (on behalf of Artist)',
      thumbnail: '',
      videoId: 'abcdefghijk',
      channelId: 'UC123'
    }
  ])
})

test('handles a video without a structured description', () => {
  assert.deepEqual(parseLocalVideoMusicTracks(videoInfo({ panelIdentifier: 'engagement-panel-searchable-transcript' })), [])
  assert.deepEqual(parseLocalVideoMusicTracks({ page: [{}, {}] }), [])
})

test('normalises the Invidious music tracks', () => {
  assert.deepEqual(parseVideoMusicTracks([{ song: 'Song', artist: 'Artist', album: '', license: 'License' }, { song: '', artist: '', album: '', license: '' }]), [
    {
      title: 'Song',
      artist: 'Artist',
      album: '',
      license: 'License',
      thumbnail: '',
      videoId: undefined,
      channelId: undefined
    }
  ])
  assert.deepEqual(parseVideoMusicTracks(undefined), [])
})
