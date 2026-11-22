import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checkCommentHearts,
  COMMENT_REPLY_TRACKING_LIMIT,
  COMMENT_REPLY_TRACKING_MS,
  findCommentHeart,
  findCommentsToLink,
  findNewReplies,
  getCommentNotificationTarget,
  getCommentWebUrl,
  getWatchedCommentTarget,
  isOwnWatchedComment,
  markThreadOpened,
  normalizeTrackedCommentThreads,
  trackComment,
  untrackComment,
  updateWatchedCommentText
} from '../../src/commentReplyTracking.js'

const own = { videoId: 'video1', channelId: 'UCme', handle: '@Me', text: 'First', videoTitle: 'Title' }
// Made up, in the shape of post IDs
const POST_ID = 'UgkxExamplePostIdentifier0123456789'
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

test('new replies, the account\'s replies, and opening the thread keep a comment watched', () => {
  const [thread] = trackComment([], { ...own, accountId: 'UCme', threadId: 'thread1', commentId: 'thread1.mine' }, 1000)
  const mine = reply('mine', 'UCme')
  assert.equal(findNewReplies(thread, [mine, reply('unrelated', 'UCother', 'Not for you')]).active, false)
  assert.equal(findNewReplies(thread, [mine, reply('mention', 'UCother', 'Thanks @Me')]).active, true)
  // Posted elsewhere, as on YouTube's website, so it is not announced.
  const elsewhere = findNewReplies(thread, [mine, reply('later', 'UCme', 'More')])
  assert.deepEqual(elsewhere, { added: [], active: true, seen: ['thread1.mine', 'thread1.later'] })
  assert.equal(findNewReplies({ ...thread, seen: elsewhere.seen }, [mine, reply('later', 'UCme', 'More')]).active, false)

  // Watching ends 30 days after the last activity, or after watching for entries saved before activity counted.
  const now = 1000 + COMMENT_REPLY_TRACKING_MS
  assert.equal(normalizeTrackedCommentThreads([{ ...thread, activeAt: now - 1 }], now).length, 1)
  const { activeAt: _, ...older } = thread
  assert.equal(normalizeTrackedCommentThreads([older], now).length, 0)

  const [opened] = markThreadOpened([older], 'video1', 'thread1', now - 1)
  assert.equal(opened.activeAt, now - 1)
  assert.equal(opened.postedAt, 1000)
  assert.equal(markThreadOpened([older], 'video1', 'thread2', now - 1), null)
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
  // Comments on posts lead to the post.
  assert.deepEqual(getCommentNotificationTarget('comment-reply', POST_ID, 'thread1.a'), {
    kind: 'comment-reply', path: `/post/${POST_ID}`, query: { commentId: 'thread1.a' }
  })
  assert.equal(getCommentWebUrl(POST_ID, 'thread1.a'), `https://www.youtube.com/post/${POST_ID}?lc=thread1.a`)
  assert.equal(getCommentWebUrl('abcdefghijk', 'thread1.a'), 'https://www.youtube.com/watch?v=abcdefghijk&lc=thread1.a')
})

test('reads whether a linked comment or reply is hearted, and by whom, from the response', () => {
  const comment = (commentId, stateKey, tooltip) => ({
    entityKey: `entity-${commentId}`,
    payload: {
      commentEntityPayload: {
        properties: { commentId, toolbarStateKey: stateKey, content: { content: `\u200B \u2068Text of ${commentId}\u2069 \u{1F469}\u200D\u{1F4BB} ` } },
        toolbar: { heartActiveTooltip: tooltip }
      }
    }
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
  assert.deepEqual(findCommentHeart(response, 'thread1'), { hearted: false, author: '@Creator.Name', text: 'Text of thread1 \u{1F469}\u200D\u{1F4BB}' })
  assert.deepEqual(findCommentHeart(response, 'thread1.a'), { hearted: true, author: '@Creator.Name', text: 'Text of thread1.a \u{1F469}\u200D\u{1F4BB}' })
  assert.equal(findCommentHeart(response, 'thread1.b'), null)
  assert.equal(findCommentHeart({}, 'thread1'), null)
})

test('announces a heart on an own comment once, but not one it had before hearts were checked', () => {
  const [posted] = trackComment([], { ...own, accountId: 'UCme', threadId: 'thread1', commentId: 'thread1', hearted: false }, 1000)
  const hearted = { hearted: true, author: '@Creator', text: 'First' }
  const check = (thread, heart) => checkCommentHearts(thread, new Map(heart ? [['thread1', heart]] : []))
  assert.deepEqual(check(posted, { ...hearted, hearted: false }), { announce: [], active: false, comments: [{ id: 'thread1', hearted: false }] })
  assert.deepEqual(check(posted, hearted), { announce: [{ id: 'thread1', heart: hearted }], active: true, comments: [{ id: 'thread1', hearted: true }] })
  // Missing from the response, as when it was deleted, it keeps its state.
  assert.deepEqual(check(posted, null), { announce: [], active: false, comments: [{ id: 'thread1', hearted: false }] })
  const announced = { ...posted, comments: [{ id: 'thread1', hearted: true }] }
  assert.deepEqual(check(announced, { ...hearted, hearted: false }), { announce: [], active: false, comments: [{ id: 'thread1', hearted: true }] })

  // Saved before hearts were checked
  const { comments: _, ...older } = posted
  assert.deepEqual(check(older, hearted), { announce: [], active: false, comments: [{ id: 'thread1', hearted: true }] })
  // Others' comments are not announced, but a new heart keeps them watched.
  const others = { ...posted, channelId: 'UCother', accountId: 'UCme' }
  assert.deepEqual(check(others, hearted), { announce: [], active: true, comments: [{ id: 'thread1', hearted: true }] })
})

test('announces hearts on each own comment watched together in a thread', () => {
  const comment = { ...own, accountId: 'UCme', threadId: 'thread1', hearted: false }
  // Two replies, then the top-level comment, which then is the watched one
  let threads = trackComment([], { ...comment, commentId: 'thread1.a' }, 1000)
  threads = trackComment(threads, { ...comment, commentId: 'b' }, 2000)
  threads = trackComment([{ ...threads[0], comments: [{ id: 'thread1.a', hearted: true }, threads[0].comments[1]] }],
    { ...comment, commentId: 'thread1', hearted: undefined }, 3000)
  const [thread] = threads
  assert.equal(thread.commentId, 'thread1')
  // A known heart stays known, and one unknown is only saved on its first check.
  assert.deepEqual(thread.comments, [{ id: 'thread1' }, { id: 'thread1.a', hearted: true }, { id: 'thread1.b', hearted: false }])

  const heart = (text, hearted = true) => ({ hearted, author: '@Creator', text })
  const { announce, comments } = checkCommentHearts(thread, new Map([
    ['thread1', heart('Top')], ['thread1.a', heart('A', false)], ['thread1.b', heart('B')]
  ]))
  assert.deepEqual(announce, [{ id: 'thread1.b', heart: heart('B') }])
  assert.deepEqual(comments, [{ id: 'thread1', hearted: true }, { id: 'thread1.a', hearted: true }, { id: 'thread1.b', hearted: true }])

  // The request for the watched comment covers it, so only the others found nowhere else get one each.
  assert.deepEqual(findCommentsToLink(thread, new Map([['thread1.a', heart('A')]])), [{ id: 'thread1.b', hearted: false }])
  assert.deepEqual(findCommentsToLink({ ...thread, channelId: 'UCother' }, new Map()), [])
})

test('checks the hearts of the watched comment and the newest others in a thread', () => {
  const comment = { ...own, accountId: 'UCme', threadId: 'thread1', hearted: false }
  let threads = []
  for (let index = 0; index < 15; index++) threads = trackComment(threads, { ...comment, commentId: `thread1.r${index}` }, 1000 + index)
  const ids = threads[0].comments.map(item => item.id)
  assert.deepEqual(ids, ['thread1.r0', ...Array.from({ length: 9 }, (_, index) => `thread1.r${index + 6}`)])
  // Valid entries keep the list, malformed ones are dropped.
  assert.equal(normalizeTrackedCommentThreads(threads, 2000).length, 1)
  assert.equal(normalizeTrackedCommentThreads([{ ...threads[0], comments: [{ id: 1 }] }], 2000).length, 0)
})

test('watched comments open with the account\'s comment highlighted', () => {
  const target = (threadId, commentId) => getWatchedCommentTarget({ ...own, threadId, commentId, postedAt: 0, replyCount: 0, seen: [] })
  assert.deepEqual(target('thread1', 'thread1'), { path: '/watch/video1', query: { commentId: 'thread1' } })
  assert.deepEqual(target('thread1', 'thread1.mine').query, { commentId: 'thread1.mine' })
  assert.deepEqual(target('thread1', 'mine').query, { commentId: 'thread1.mine' })

  // Comments on a post keep the post's channel, which opening the post needs.
  const onPost = trackComment([], {
    ...own, videoId: POST_ID, postAuthorId: 'UCcreator', threadId: 'thread1', commentId: 'thread1', accountId: 'UCme'
  }, 1000)[0]
  assert.equal(normalizeTrackedCommentThreads([onPost], 2000).length, 1)
  assert.deepEqual(getWatchedCommentTarget(onPost), {
    path: `/post/${POST_ID}`, query: { authorId: 'UCcreator', commentId: 'thread1' }
  })
  assert.equal(normalizeTrackedCommentThreads([{ ...onPost, postAuthorId: '../x' }], 2000).length, 0)
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

test('an edit changes the text of the watched comment only', () => {
  const threads = trackComment(trackComment([], { ...own, threadId: 'thread1', commentId: 'mine' }, 1000),
    { ...own, threadId: 'thread2', commentId: 'thread2' }, 2000)

  // Posted replies may lack the `threadId.` that edited ones have.
  const edited = updateWatchedCommentText(threads, 'video1', 'thread1.mine', 'Edited')
  assert.deepEqual(edited.map(thread => [thread.threadId, thread.text]), [['thread2', 'First'], ['thread1', 'Edited']])
  assert.equal(updateWatchedCommentText(threads, 'video1', 'thread1.other', 'Edited'), null)
  assert.equal(updateWatchedCommentText(threads, 'video2', 'thread2', 'Edited'), null)
})
