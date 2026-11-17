import assert from 'node:assert/strict'
import test from 'node:test'

import { YTNodes } from 'youtubei.js'

import { parseLocalVideoDescriptionSections } from '../../src/renderer/helpers/video-description-sections.js'

/**
 * @param {string} category
 * @param {import('youtubei.js').Helpers.YTNode[]} items
 */
function videoInfo(category, items) {
  return {
    basic_info: { category },
    page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content: { items } }] }]
  }
}

// Shapes captured from real `/next` responses
const peopleSection = new YTNodes.VideoAttributesSectionView({
  headerTitle: 'People mentioned',
  headerSubtitle: '1 person',
  videoAttributeViewModels: [{
    videoAttributeViewModel: {
      image: { sources: [{ url: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:example' }] },
      imageStyle: 'VIDEO_ATTRIBUTE_IMAGE_STYLE_SQUARE',
      title: 'Example Person',
      subtitle: 'Example occupation (born 1970)',
      orientation: 'VIDEO_ATTRIBUTE_ORIENTATION_VERTICAL',
      onTap: { innertubeCommand: {} }
    }
  }]
})

const podcastSection = new YTNodes.VideoDescriptionCourseSection({
  sectionTitle: { simpleText: 'Explore the podcast' },
  mediaLockups: [{
    structuredDescriptionPlaylistLockupRenderer: {
      thumbnail: {
        thumbnails: [
          { url: 'https://i.ytimg.com/pl_c/PLexample/square_720.jpg', width: 720, height: 720 },
          { url: 'https://i.ytimg.com/pl_c/PLexample/square_240.jpg', width: 240, height: 240 }
        ]
      },
      title: { simpleText: 'Example Podcast' },
      shortBylineText: { simpleText: 'Example Channel' },
      videoCountShortText: { runs: [{ text: '1,234' }, { text: ' episodes' }] },
      navigationEndpoint: {
        commandMetadata: { webCommandMetadata: { url: '/playlist?list=PLexample', webPageType: 'WEB_PAGE_TYPE_PLAYLIST' } },
        browseEndpoint: { browseId: 'VLPLexample' }
      }
    }
  }]
})

test('extracts the people mentioned and the podcast of a video, also on gaming videos', () => {
  assert.deepEqual(parseLocalVideoDescriptionSections(videoInfo('Gaming', [peopleSection, podcastSection])), [
    {
      title: 'People mentioned',
      items: [{
        title: 'Example Person',
        details: ['Example occupation (born 1970)'],
        thumbnail: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:example',
        playlistId: undefined
      }]
    },
    {
      title: 'Explore the podcast',
      items: [{
        title: 'Example Podcast',
        details: ['Example Channel', '1,234 episodes'],
        thumbnail: 'https://i.ytimg.com/pl_c/PLexample/square_240.jpg',
        playlistId: 'PLexample'
      }]
    }
  ])
})
