import assert from 'node:assert/strict'
import test from 'node:test'
import { Parser, YTNodes } from 'youtubei.js'
import { normalizeCommentResponse } from '../../src/renderer/helpers/api/local-comment-response.js'

const comment = id => ({ commentViewModel: { commentId: id, commentKey: id } })
const continuation = token => ({
  continuationItemRenderer: {
    button: { buttonRenderer: { command: { continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' } } } },
    continuationEndpoint: { continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' } }
  }
})
const response = items => ({
  onResponseReceivedEndpoints: [{ appendContinuationItemsAction: { continuationItems: items } }],
  frameworkUpdates: {
    entityBatchUpdate: {
      mutations: items.filter(item => item.commentViewModel).map(item => ({
        payload: {
          commentEntityPayload: {
            key: item.commentViewModel.commentId,
            properties: { content: { content: 'Reply text' }, publishedTime: 'today' },
            author: { displayName: 'Author', channelId: 'UCtest' },
            toolbar: {}
          }
        }
      }))
    }
  }
})

test('loads flat YouTube replies and their next page through the real parser', async () => {
  const data = {
    commentThreadRenderer: {
      commentViewModel: comment('parent'),
      replies: { commentRepliesRenderer: { contents: [continuation('first')] } }
    }
  }
  normalizeCommentResponse(data)
  const thread = Parser.parseItem(data, YTNodes.CommentThread)
  const pages = [response([comment('reply-1'), continuation('second')]), response([comment('reply-2')])]
  const tokens = []
  thread.setActions({
    execute: async (endpoint, args) => {
      tokens.push(args.continuation)
      const page = pages.shift()
      normalizeCommentResponse(page)
      return Parser.parseResponse(page)
    }
  })
  await thread.getReplies()
  assert.deepEqual(thread.replies.map(reply => reply.comment.comment_id), ['reply-1'])
  assert.equal(thread.has_continuation, true)
  assert.equal(thread.replies[0].comment.content.toString(), 'Reply text')
  const next = await thread.getContinuation()
  assert.deepEqual(next.replies.map(reply => reply.comment.comment_id), ['reply-2'])
  assert.equal(next.has_continuation, false)
  assert.deepEqual(tokens, ['first', 'second'])
})

test('preserves modern nested reply threads and unrelated response fields', () => {
  const data = {
    commentThreadRenderer: {
      commentViewModel: comment('parent'),
      replies: { commentRepliesRenderer: { subThreads: [{ commentThreadRenderer: { commentViewModel: comment('nested') } }] } }
    },
    frameworkUpdates: { entityBatchUpdate: { mutations: [] } }
  }
  const expected = structuredClone(data)
  normalizeCommentResponse(data)
  assert.deepEqual(data, expected)
})

test('loads inline flat replies without making another request', async () => {
  const data = {
    commentThreadRenderer: {
      commentViewModel: comment('parent'),
      replies: { commentRepliesRenderer: { contents: [comment('inline')] } }
    }
  }
  normalizeCommentResponse(data)
  const thread = Parser.parseItem(data, YTNodes.CommentThread)
  thread.setActions({ execute: () => assert.fail('inline replies must not fetch') })
  thread.processRepliesData()
  await thread.getReplies()
  assert.deepEqual(thread.replies.map(reply => reply.comment.comment_id), ['inline'])
  assert.equal(thread.has_continuation, false)
})
