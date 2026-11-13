import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const component = await readFile(new URL('../../src/renderer/components/CommentSection/CommentSection.vue', import.meta.url), 'utf8')
const localCountStart = component.indexOf('function getCommentCountText(')
const localCountSource = component.slice(localCountStart, component.indexOf('const formattedCommentCount', localCountStart))
const { parseLocalSubscriberCount } = createLocalFeedParsers(() => false)

function readLocalCount(data, previousCount = null) {
  let count = previousCount
  const update = vm.runInNewContext(`${localCountSource};setLocalCommentCount`, {
    parseLocalSubscriberCount,
    setCommentCount: value => { count = value }
  })
  update({ header: data && new YTNodes.CommentsHeader(data) })
  return count
}

test('local comment counts fall back to countText when commentsCount is empty', () => {
  assert.equal(readLocalCount({ countText: { simpleText: '12,345 Comments' } }), 12345)
  assert.equal(readLocalCount({ countText: { simpleText: '12,345 Comments' }, commentsCount: { simpleText: '' } }), 12345)
  assert.equal(readLocalCount({ countText: { simpleText: '12,345 Comments' }, commentsCount: { simpleText: '12K' } }), 12000)
})

test('a missing local comment count stays unknown or preserves the previous total', () => {
  assert.equal(readLocalCount(undefined), null)
  assert.equal(readLocalCount({}, 12345), 12345)
  assert.equal(readLocalCount({ countText: { simpleText: '0 Comments' } }, 12345), 0)
})
