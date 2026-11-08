import assert from 'node:assert/strict'
import test from 'node:test'

import { YTNodes } from 'youtubei.js'

import { parseLocalVideoGames } from '../../src/renderer/helpers/video-games.js'

/**
 * Shape captured from a real `/next` response (video PzHN73RQPQs).
 * @param {object} [overrides]
 */
function rawGamesSection(overrides = {}) {
  return {
    headerTitle: 'Games',
    videoAttributeViewModels: [
      {
        videoAttributeViewModel: {
          image: {
            sources: [
              { url: 'https://yt3.ggpht.com/boxart=s112-w80-h112', width: 80, height: 112 },
              { url: 'https://yt3.ggpht.com/boxart=s224-w160-h224', width: 160, height: 224 }
            ]
          },
          imageStyle: 'VIDEO_ATTRIBUTE_IMAGE_STYLE_PORTRAIT',
          title: 'Hytale',
          subtitle: '2026',
          orientation: 'VIDEO_ATTRIBUTE_ORIENTATION_HORIZONTAL',
          onTap: {
            innertubeCommand: {
              browseEndpoint: { browseId: 'UCgQN2C6x-1AobLFMpewpAZw' }
            }
          },
          ...overrides
        }
      }
    ]
  }
}

/**
 * @param {object} options
 * @param {string} [options.category]
 * @param {import('youtubei.js').Helpers.YTNode[]} [options.items]
 * @param {string} [options.panelIdentifier]
 */
function videoInfo(options) {
  const { items = [], panelIdentifier = 'engagement-panel-structured-description' } = options

  // an explicit `category: undefined` has to survive, so it can't be a destructuring default
  const category = 'category' in options ? options.category : 'Gaming'

  return {
    basic_info: { category },
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

test('extracts the game, its release year, box art and channel', () => {
  const section = new YTNodes.VideoAttributesSectionView(rawGamesSection())

  assert.deepEqual(parseLocalVideoGames(videoInfo({ items: [section] })), [
    {
      title: 'Hytale',
      subtitle: '2026',
      // the largest box art, youtubei.js sorts the thumbnails descending
      thumbnail: 'https://yt3.ggpht.com/boxart=s224-w160-h224',
      channelId: 'UCgQN2C6x-1AobLFMpewpAZw'
    }
  ])
})

test('ignores the games section on videos that are not categorised as gaming', () => {
  const section = new YTNodes.VideoAttributesSectionView(rawGamesSection())

  assert.deepEqual(parseLocalVideoGames(videoInfo({ category: 'Music', items: [section] })), [])
  assert.deepEqual(parseLocalVideoGames(videoInfo({ category: undefined, items: [section] })), [])
})

test('skips the sections that do not list games', () => {
  const transcriptSection = new YTNodes.VideoDescriptionTranscriptSection({})

  assert.deepEqual(parseLocalVideoGames(videoInfo({ items: [transcriptSection] })), [])
})

test('handles a video without a structured description', () => {
  assert.deepEqual(parseLocalVideoGames(videoInfo({ panelIdentifier: 'engagement-panel-searchable-transcript' })), [])
  assert.deepEqual(parseLocalVideoGames({ basic_info: { category: 'Gaming' }, page: [{}, {}] }), [])
})

test('keeps a game that has no box art or channel', () => {
  const section = new YTNodes.VideoAttributesSectionView(rawGamesSection({
    image: { contentPreviewImageViewModel: {} },
    subtitle: undefined,
    onTap: undefined
  }))

  assert.deepEqual(parseLocalVideoGames(videoInfo({ items: [section] })), [
    {
      title: 'Hytale',
      subtitle: '',
      thumbnail: '',
      channelId: undefined
    }
  ])
})

test('extracts every game of a video that lists more than one', () => {
  const raw = rawGamesSection()
  raw.videoAttributeViewModels.push({
    videoAttributeViewModel: {
      image: { sources: [{ url: 'https://yt3.ggpht.com/other=s224', width: 160, height: 224 }] },
      title: 'Minecraft',
      subtitle: '2011',
      onTap: { innertubeCommand: { browseEndpoint: { browseId: 'UCq6aw03lNILzV96UvEAASfQ' } } }
    }
  })

  const games = parseLocalVideoGames(videoInfo({ items: [new YTNodes.VideoAttributesSectionView(raw)] }))

  assert.deepEqual(games.map(game => game.title), ['Hytale', 'Minecraft'])
  assert.equal(games[1].channelId, 'UCq6aw03lNILzV96UvEAASfQ')
})
