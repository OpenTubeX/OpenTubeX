import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Misc, YTNodes } from 'youtubei.js'

import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const { parseLocalTextRuns } = createLocalFeedParsers(() => false)

const source = readFileSync(new URL('../../src/renderer/components/WatchVideoLiveChat/WatchVideoLiveChat.vue', import.meta.url), 'utf8')
function componentFunction(name, globals = {}) {
  const start = source.indexOf(`function ${name}(`)
  const functionSource = source.slice(start, source.indexOf('\n}\n', start) + 3)
  return runInNewContext(`(${functionSource})`, {
    YTNodes,
    formatLiveChatTimestamp: () => '',
    autolinker: { link: text => text },
    parseLocalTextRuns,
    ...globals
  })
}

const parseLiveChatMessage = componentFunction('parseLiveChatMessage')
const isLiveChatAuthorVerified = componentFunction('isLiveChatAuthorVerified')
const parseLiveChatComment = componentFunction('parseLiveChatComment', {
  isLiveChatAuthorVerified,
  parseLiveChatMessage,
  props: { channelId: 'channel-id' }
})
const parseLiveChatSuperChat = componentFunction('parseLiveChatSuperChat', {
  getRandomColorClass: () => 'color-class',
  isLiveChatAuthorVerified,
  parseLiveChatMessage
})

function simpleText(value) {
  return new Misc.Text({ simpleText: value })
}

test('parses a live-chat message represented as simple text', () => {
  const parsed = parseLiveChatComment({
    id: 'message-id',
    message: simpleText('<message>'),
    author: {
      id: 'author-id',
      name: 'Author',
      thumbnails: [{ url: 'avatar' }],
      badges: [],
      is_moderator: false
    }
  })

  assert.equal(parsed.message, '&lt;message&gt;')
})

test('parses a paid live-chat message represented as simple text', () => {
  const parsed = parseLiveChatSuperChat({
    id: 'message-id',
    message: simpleText('<paid message>'),
    purchase_amount: '$5.00',
    author: {
      id: 'author-id',
      name: 'Author',
      thumbnails: [{ url: 'avatar' }]
    }
  })

  assert.equal(parsed.message, '&lt;paid message&gt;')
  assert.equal(parsed.author.name, 'Author')
})

for (const authorName of [{ simpleText: '@donor' }, { runs: [{ text: '@donor' }] }]) {
  test(`preserves the donor handle from a paid-message node (${Object.keys(authorName)[0]})`, () => {
    const message = new YTNodes.LiveChatPaidMessage({
      id: 'donation',
      authorName,
      authorExternalChannelId: 'donor-channel',
      authorPhoto: { thumbnails: [{ url: 'avatar' }] },
      message: { simpleText: 'Thank you!' },
      purchaseAmountText: { simpleText: '$10.00' },
      contextMenuEndpoint: {},
      contextMenuAccessibility: { accessibilityData: { label: 'Menu' } },
      timestampUsec: '1000000'
    })

    const parsed = parseLiveChatSuperChat(message)
    assert.equal(parsed.author.name, '@donor')
    assert.equal(parsed.author.id, 'donor-channel')
    assert.equal(parsed.superChat.amount, '$10.00')
  })
}

for (const [iconType, expected] of [['VERIFIED', true], ['MODERATOR', false]]) {
  test(`marks live-chat authors with a ${iconType} badge as ${expected ? 'verified' : 'unverified'}`, () => {
    const message = new YTNodes.LiveChatTextMessage({
      id: 'message-id',
      message: { simpleText: 'Hello' },
      authorName: { simpleText: '@creator' },
      authorExternalChannelId: 'creator-channel',
      authorPhoto: { thumbnails: [{ url: 'avatar' }] },
      authorBadges: [{ liveChatAuthorBadgeRenderer: { icon: { iconType }, tooltip: iconType } }],
      contextMenuEndpoint: {},
      contextMenuAccessibility: { accessibilityData: { label: 'Menu' } },
      timestampUsec: '1000000'
    })

    assert.equal(parseLiveChatComment(message).author.isVerified, expected)
  })
}
