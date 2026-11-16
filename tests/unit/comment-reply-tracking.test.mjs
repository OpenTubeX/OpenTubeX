import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checkCommentHeart,
  COMMENT_REPLY_TRACKING_LIMIT,
  COMMENT_REPLY_TRACKING_MS,
  findCommentHeart,
  findNewReplies,
  getCommentNotificationTarget,
  getWatchedCommentTarget,
  isOwnWatchedComment,
  normalizeTrackedCommentThreads,
  trackComment,
  untrackComment
} from '../../src/commentReplyTracking.js'

const own = { videoId: 'video1', channelId: 'UCme', handle: '@Me', text: 'First', videoTitle: 'Title' }
const reply = (id, authorId, text = 'Nice') => ({ id: `thread1.${id}`, authorId, author: authorId, text })

test('announces each reply to an own comment once, but not own replies', () => {
  const [thread] = trackComment([], { ...own, threadId: 'thread1', commentId: 'thread1' }, 1000)
  const replies = [reply('a', 'UCother'), reply('b', 'UCme')]

  const first = findNewReplies(thread, replies)
  assert.deepEqual(first.added.map(item => item.id), ['thread1.a'])

  const second = findNewReplies({ ...thread, seen: first.seen }, [...replies, reply('c', 'UCthird')])
  assert.deepEqual(second.added.map(item => item.id), ['thread1.c'])
})

test('in another thread, announces only later replies that mention the whole handle', () => {
  const [thread] = trackComment([], { ...own, threadId: 'thread1', commentId: 'thread1.mine' }, 1000)
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
  const threads = trackComment([], { ...own, threadId: 'thread1', commentId: 'thread1' }, 1000)
  const checked = [{ ...threads[0], replyCount: 2, seen: ['thread1.a'] }]
  const [again] = trackComment(checked, { ...own, threadId: 'thread1', commentId: 'thread1.later', text: 'Later', videoTitle: 'Renamed' }, 5000)
  assert.equal(again.commentId, 'thread1')
  assert.deepEqual(again.seen, ['thread1.a'])
  assert.equal(again.postedAt, 5000)
  // The list shows the comment that is watched, on the video as it is now called.
  assert.equal(again.text, 'First')
  assert.equal(again.videoTitle, 'Renamed')
})

test('watches only recent comments, up to the limit', () => {
  const now = COMMENT_REPLY_TRACKING_MS * 2
  const threads = Array.from({ length: COMMENT_REPLY_TRACKING_LIMIT + 2 }, (_, index) => ({
    ...own, threadId: `t${index}`, commentId: `t${index}`, postedAt: now - index, replyCount: 0, seen: []
  }))
  threads.push({ ...threads[0], threadId: 'old', commentId: 'old', postedAt: now - COMMENT_REPLY_TRACKING_MS })
  // Watched before comments kept their text and video title.
  delete threads[1].text
  delete threads[1].videoTitle
  const kept = normalizeTrackedCommentThreads([...threads, { videoId: '../x' }], now)
  assert.equal(kept.length, COMMENT_REPLY_TRACKING_LIMIT)
  assert.equal(kept[0].threadId, 't0')
  assert.equal(kept[1].threadId, 't1')
  assert.ok(!kept.some(thread => thread.threadId === 'old'))
})

test('reply targets accept only reply IDs of a video, and heart targets comment IDs too', () => {
  assert.deepEqual(getCommentNotificationTarget('comment-reply', 'video1', 'thread1.a'), {
    kind: 'comment-reply', path: '/watch/video1', query: { commentId: 'thread1.a' }
  })
  assert.equal(getCommentNotificationTarget('comment-reply', 'video1', 'thread1'), null)
  assert.equal(getCommentNotificationTarget('comment-reply', '../video', 'thread1.a'), null)
  assert.equal(getCommentNotificationTarget('comment-reply', 'video1', 'thread1.a&x=1'), null)
  assert.deepEqual(getCommentNotificationTarget('comment-heart', 'video1', 'thread1'), {
    kind: 'comment-heart', path: '/watch/video1', query: { commentId: 'thread1' }
  })
  assert.equal(getCommentNotificationTarget('comment-heart', 'video1', 'thread1.a.b'), null)
  assert.equal(getCommentNotificationTarget('video', 'video1', 'thread1'), null)
})

test('reads whether a linked comment or reply is hearted, and by whom, from the response', () => {
  const comment = (commentId, stateKey, tooltip) => ({
    entityKey: `entity-${commentId}`,
    payload: { commentEntityPayload: { properties: { commentId, toolbarStateKey: stateKey }, toolbar: { heartActiveTooltip: tooltip } } }
  })
  const state = (key, heartState) => ({ entityKey: key, payload: { engagementToolbarStateEntityPayload: { key, heartState } } })
  const response = {
    frameworkUpdates: {
      entityBatchUpdate: {
        mutations: [
          comment('thread1', 'state1', '❤ by @Creator.Name'),
          state('state1', 'TOOLBAR_HEART_STATE_UNHEARTED'),
          comment('thread1.a', 'state2', '❤ von @Creator.Name'),
          state('state2', 'TOOLBAR_HEART_STATE_HEARTED')
        ]
      }
    }
  }
  assert.deepEqual(findCommentHeart(response, 'thread1'), { hearted: false, author: '@Creator.Name' })
  assert.deepEqual(findCommentHeart(response, 'thread1.a'), { hearted: true, author: '@Creator.Name' })
  assert.equal(findCommentHeart(response, 'thread1.b'), null)
  assert.equal(findCommentHeart({}, 'thread1'), null)
})

test('announces a heart on an own comment once, but not one it had before hearts were checked', () => {
  const [posted] = trackComment([], { ...own, accountId: 'UCme', threadId: 'thread1', commentId: 'thread1', hearted: false }, 1000)
  const hearted = { hearted: true, author: '@Creator' }
  assert.deepEqual(checkCommentHeart(posted, { hearted: false, author: '' }), { announce: false, hearted: false })
  assert.deepEqual(checkCommentHeart(posted, hearted), { announce: true, hearted: true })
  // Missing from the response, as when it was deleted, it keeps its state.
  assert.deepEqual(checkCommentHeart(posted, null), { announce: false, hearted: false })
  assert.deepEqual(checkCommentHeart({ ...posted, hearted: true }, { hearted: false, author: '' }), { announce: false, hearted: true })

  const { hearted: _, ...older } = posted
  assert.deepEqual(checkCommentHeart(older, hearted), { announce: false, hearted: true })
  const others = { ...posted, channelId: 'UCother', accountId: 'UCme' }
  assert.equal(checkCommentHeart(others, hearted).announce, false)
})

test('watched comments open with the account\'s comment highlighted', () => {
  const target = (threadId, commentId) => getWatchedCommentTarget({ ...own, threadId, commentId, postedAt: 0, replyCount: 0, seen: [] })
  assert.deepEqual(target('thread1', 'thread1'), { path: '/watch/video1', query: { commentId: 'thread1' } })
  assert.deepEqual(target('thread1', 'thread1.mine').query, { commentId: 'thread1.mine' })
  assert.deepEqual(target('thread1', 'mine').query, { commentId: 'thread1.mine' })
})

test('watches others\' comments from now on and apart from own ones', () => {
  const thread = { videoId: 'video1', threadId: 'thread1', commentId: 'thread1', text: 'Question', videoTitle: 'Title' }
  const theirs = { ...thread, channelId: 'UCthem', handle: '@Them', accountId: 'UCme', replyCount: 1, seen: ['thread1.old'] }
  let threads = trackComment([], theirs, 1000)
  assert.equal(isOwnWatchedComment(threads[0]), false)
  // Replies it had already are not announced, nor the account's, but its author's are.
  const { added } = findNewReplies(threads[0], [reply('old', 'UCx'), reply('author', 'UCthem'), reply('mine', 'UCme'), reply('new', 'UCx')])
  assert.deepEqual(added.map(item => item.id), ['thread1.author', 'thread1.new'])
  // Watched while signed out, but answered after signing in
  const signedOut = { ...threads[0], accountId: '' }
  assert.deepEqual(findNewReplies(signedOut, [reply('mine', 'UCme'), reply('new', 'UCx')], 'UCme').added.map(item => item.id), ['thread1.new'])

  // Their top-level comment covers the thread from the replies it had when watched.
  const [replyWatch] = trackComment([], { ...theirs, commentId: 'thread1.theirs', seen: ['thread1.old'] }, 1000)
  const [upgraded] = trackComment([replyWatch], { ...theirs, seen: ['thread1.old', 'thread1.since'] }, 2000)
  assert.equal(upgraded.commentId, 'thread1')
  assert.deepEqual(upgraded.seen, ['thread1.old', 'thread1.since'])

  // The account's own comment in that thread is watched apart from it.
  threads = trackComment(threads, { ...own, threadId: 'thread1', commentId: 'thread1.mine', accountId: 'UCme' }, 2000)
  assert.equal(threads.length, 2)
  threads = untrackComment(threads, theirs)
  assert.deepEqual(threads.map(thread => thread.channelId), ['UCme'])
  // Comments watched before others' could be are the account's own.
  const { accountId, ...legacy } = threads[0]
  assert.equal(accountId, 'UCme')
  assert.equal(isOwnWatchedComment(legacy), true)
})
