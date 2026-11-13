import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COMMENT_REPLY_TRACKING_LIMIT,
  COMMENT_REPLY_TRACKING_MS,
  findNewReplies,
  getCommentReplyTarget,
  normalizeTrackedCommentThreads,
  trackPostedComment
} from '../../src/commentReplyTracking.js'

const own = { videoId: 'video1', channelId: 'UCme', handle: '@Me' }
const reply = (id, authorId, text = 'Nice') => ({ id: `thread1.${id}`, authorId, author: authorId, text })

test('announces each reply to an own comment once, but not own replies', () => {
  const [thread] = trackPostedComment([], { ...own, threadId: 'thread1', commentId: 'thread1' }, 1000)
  const replies = [reply('a', 'UCother'), reply('b', 'UCme')]

  const first = findNewReplies(thread, replies)
  assert.deepEqual(first.added.map(item => item.id), ['thread1.a'])

  const second = findNewReplies({ ...thread, seen: first.seen }, [...replies, reply('c', 'UCthird')])
  assert.deepEqual(second.added.map(item => item.id), ['thread1.c'])
})

test('in another thread, announces only later replies that mention the whole handle', () => {
  const [thread] = trackPostedComment([], { ...own, threadId: 'thread1', commentId: 'thread1.mine' }, 1000)
  const { added } = findNewReplies(thread, [
    reply('before', 'UCother', '@me earlier'),
    reply('mine', 'UCme', 'My reply'),
    reply('unrelated', 'UCother', 'Not for you'),
    reply('longer', 'UCother', '@meadow hello'),
    reply('accented', 'UCother', '@Meé hello'),
    reply('dotted', 'UCother', '@Me·other hello'),
    reply('mention', 'UCother', 'Thanks @Me.')
  ])
  assert.deepEqual(added.map(item => item.id), ['thread1.mention'])
  // Without the account's reply, earlier mentions do not count as answers.
  assert.deepEqual(findNewReplies(thread, [reply('mention', 'UCother', '@me hi')]).added, [])
})

test('posting in a watched thread again keeps its state and extends watching', () => {
  const threads = trackPostedComment([], { ...own, threadId: 'thread1', commentId: 'thread1' }, 1000)
  const checked = [{ ...threads[0], replyCount: 2, seen: ['thread1.a'] }]
  const [again] = trackPostedComment(checked, { ...own, threadId: 'thread1', commentId: 'thread1.later' }, 5000)
  assert.equal(again.commentId, 'thread1')
  assert.deepEqual(again.seen, ['thread1.a'])
  assert.equal(again.postedAt, 5000)
})

test('watches only recent comments, up to the limit', () => {
  const now = COMMENT_REPLY_TRACKING_MS * 2
  const threads = Array.from({ length: COMMENT_REPLY_TRACKING_LIMIT + 2 }, (_, index) => ({
    ...own, threadId: `t${index}`, commentId: `t${index}`, postedAt: now - index, replyCount: 0, seen: []
  }))
  threads.push({ ...threads[0], threadId: 'old', commentId: 'old', postedAt: now - COMMENT_REPLY_TRACKING_MS })
  const kept = normalizeTrackedCommentThreads([...threads, { videoId: '../x' }], now)
  assert.equal(kept.length, COMMENT_REPLY_TRACKING_LIMIT)
  assert.equal(kept[0].threadId, 't0')
  assert.ok(!kept.some(thread => thread.threadId === 'old'))
})

test('reply targets accept only reply IDs of a video', () => {
  assert.deepEqual(getCommentReplyTarget('video1', 'thread1.a'), {
    kind: 'comment-reply', path: '/watch/video1', query: { commentId: 'thread1.a' }
  })
  assert.equal(getCommentReplyTarget('video1', 'thread1'), null)
  assert.equal(getCommentReplyTarget('../video', 'thread1.a'), null)
  assert.equal(getCommentReplyTarget('video1', 'thread1.a&x=1'), null)
})
