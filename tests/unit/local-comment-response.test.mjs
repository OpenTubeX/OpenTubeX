import assert from 'node:assert/strict'
import test from 'node:test'
import { Parser, YTNodes } from 'youtubei.js'
import { normalizeCommentResponse, parseLocalCommentImageAttachment } from '../../src/renderer/helpers/api/local-comment-response.js'

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

test('preserves animated image attachments from comment surface mutations', () => {
  const data = response([comment('gif-comment')])
  data.onResponseReceivedEndpoints[0].appendContinuationItemsAction.continuationItems[0]
    .commentViewModel.commentSurfaceKey = 'gif-surface'
  const attachment = {
    width: 120,
    height: 240,
    image: {
      sources: [{ url: 'https://i.ytimg.com/c_exp/comment/animated.webp?rs=signed', width: 120, height: 240 }],
      imageFormatHint: 'IMAGE_FORMAT_ANIMATED_WEBP'
    },
    unavailableText: 'GIF unavailable',
    rendererContext: { accessibilityContext: { label: 'Comment image attachment' } }
  }
  data.frameworkUpdates.entityBatchUpdate.mutations.push({
    payload: {
      commentSurfaceEntityPayload: {
        key: 'gif-surface',
        imageAttachmentViewModel: { commentImageAttachmentViewModel: attachment }
      }
    }
  })
  normalizeCommentResponse(data)
  const parsed = Parser.parseResponse(data)
  const thread = parsed.on_response_received_endpoints[0].contents[0]
  const image = thread.comment.image_attachment
  assert.ok(image instanceof YTNodes.CommentImageAttachmentView)
  assert.equal(image.image_format_hint, 'IMAGE_FORMAT_ANIMATED_WEBP')
  const parsedAttachment = parseLocalCommentImageAttachment(image)
  assert.equal(parsedAttachment.image.sources[0].url, attachment.image.sources[0].url)
  assert.equal(parsedAttachment.width, attachment.width)
  assert.equal(parsedAttachment.height, attachment.height)
  assert.equal(parsedAttachment.unavailableText, attachment.unavailableText)
  assert.equal(parsedAttachment.rendererContext.accessibilityContext.label, attachment.rendererContext.accessibilityContext.label)
  assert.equal(thread.comment.content.toString(), 'Reply text')
})

test('preserves unavailable comment images without a source', () => {
  const attachment = new YTNodes.CommentImageAttachmentView({ unavailableText: 'Image unavailable' })
  const parsed = parseLocalCommentImageAttachment(attachment)
  assert.deepEqual(parsed.image.sources, [])
  assert.equal(parsed.unavailableText, 'Image unavailable')
  assert.equal(parseLocalCommentImageAttachment(null), undefined)
  assert.equal(parseLocalCommentImageAttachment(undefined), undefined)
})
