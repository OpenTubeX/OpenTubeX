import assert from 'node:assert/strict'
import test from 'node:test'
import { Parser } from 'youtubei.js'
import { getLocalMusicChartPlaylistId } from '../../src/renderer/helpers/api/local-feed-parsers.js'

function chartItem(browseId, pageType = 'MUSIC_PAGE_TYPE_PLAYLIST') {
  return {
    musicTwoRowItemRenderer: {
      title: { runs: [{ text: browseId }] },
      subtitle: { runs: [{ text: 'Chart' }] },
      thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [] } } },
      navigationEndpoint: {
        browseEndpoint: {
          browseId,
          browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } }
        }
      }
    }
  }
}

// Shaped like YouTube Music's FEmusic_charts response
function chartsResponse(...shelves) {
  return Parser.parseResponse({
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: shelves.map(contents => ({
                  musicCarouselShelfRenderer: {
                    header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Shelf' }] } } },
                    contents
                  }
                }))
              }
            }
          }
        }]
      }
    }
  })
}

test('picks the trending chart wherever it is among the video charts', () => {
  const charts = chartsResponse(
    [
      chartItem('VLPL4fGSI1pDJn4yCNzulPkUbxgr4pl0gmI-'),
      chartItem('VLOLAK5uy_kNWGJvgWVqlt5LsFDL9Sdluly4M8TvGkM'),
      chartItem('VLPL4fGSI1pDJn61unMfmrUSz68RT8IFFnks')
    ],
    [chartItem('MPSPPLtrending', 'MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE')]
  )

  assert.equal(getLocalMusicChartPlaylistId(charts), 'VLOLAK5uy_kNWGJvgWVqlt5LsFDL9Sdluly4M8TvGkM')
})

test('falls back to the first video chart when the global charts have no trending chart', () => {
  const charts = chartsResponse(
    [chartItem('UCartist', 'MUSIC_PAGE_TYPE_ARTIST')],
    [
      chartItem('VLPL4fGSI1pDJn6t3TXLGiiJdD-sZbrG3tG0'),
      chartItem('VLPL4fGSI1pDJn5kI81J1fYWK5eZRl1zJ5kM')
    ]
  )

  assert.equal(getLocalMusicChartPlaylistId(charts), 'VLPL4fGSI1pDJn6t3TXLGiiJdD-sZbrG3tG0')
})

test('returns nothing when the charts have no video charts', () => {
  assert.equal(getLocalMusicChartPlaylistId(chartsResponse([chartItem('UCartist', 'MUSIC_PAGE_TYPE_ARTIST')])), undefined)
})
