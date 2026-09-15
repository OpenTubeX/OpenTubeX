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
const parseLiveChatComment = componentFunction('parseLiveChatComment', {
  parseLiveChatMessage,
  props: { channelId: 'channel-id' }
})
const parseLiveChatSuperChat = componentFunction('parseLiveChatSuperChat', {
  getRandomColorClass: () => 'color-class',
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
      name: simpleText('Author'),
      thumbnails: [{ url: 'avatar' }]
    }
  })

  assert.equal(parsed.message, '&lt;paid message&gt;')
})
