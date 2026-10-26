import assert from 'node:assert/strict'
import test from 'node:test'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const { parseLocalHashtagHeader } = createLocalFeedParsers(() => false)

function pageHeader (...metadataParts) {
  return new YTNodes.PageHeader({
    pageTitle: '#minecraft',
    content: {
      pageHeaderViewModel: {
        metadata: {
          contentMetadataViewModel: {
            metadataRows: [{ metadataParts: metadataParts.map(content => ({ text: { content } })) }],
            delimiter: '•'
          }
        }
      }
    }
  })
}

test('parses the counts of a page header', () => {
  assert.deepEqual(parseLocalHashtagHeader(pageHeader('47M videos • 5.6M channels')), {
    videoCount: 47000000,
    channelCount: 5600000
  })
})

test('parses counts split across page header metadata parts', () => {
  assert.deepEqual(parseLocalHashtagHeader(pageHeader('1.8K videos', '229 channels')), {
    videoCount: 1800,
    channelCount: 229
  })
})

test('parses the counts of a legacy hashtag header', () => {
  const header = new YTNodes.HashtagHeader({
    hashtag: { simpleText: '#cats' },
    hashtagInfoText: { simpleText: '1 video • 1 channel' }
  })

  assert.deepEqual(parseLocalHashtagHeader(header), { videoCount: 1, channelCount: 1 })
})

test('returns only the counts it can parse', () => {
  assert.deepEqual(parseLocalHashtagHeader(pageHeader('12K videos • unknown')), {
    videoCount: 12000,
    channelCount: null
  })
  assert.deepEqual(parseLocalHashtagHeader(pageHeader('many videos')), { videoCount: null, channelCount: null })
  assert.deepEqual(parseLocalHashtagHeader(new YTNodes.PageHeader({ pageTitle: '#empty' })), {
    videoCount: null,
    channelCount: null
  })
  assert.deepEqual(parseLocalHashtagHeader(undefined), { videoCount: null, channelCount: null })
})
