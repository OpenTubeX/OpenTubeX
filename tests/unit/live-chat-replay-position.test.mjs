import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createContext, runInContext, runInNewContext } from 'node:vm'
import { effectScope, nextTick, reactive, watch } from 'vue'
import * as replayHelpers from '../../src/renderer/components/WatchVideoLiveChat/liveChatReplay.js'

const source = readFileSync(new URL('../../src/renderer/components/WatchVideoLiveChat/WatchVideoLiveChat.vue', import.meta.url), 'utf8')
const clearChat = source.slice(source.indexOf('function clearChat()'), source.indexOf('/**', source.indexOf('function clearChat()')))
const positionUpdates = source.slice(source.indexOf('function releaseReplayComments()'), source.indexOf('/**', source.indexOf('function releaseReplayComments()')))

function setup(t, isReplay = true, ready = true) {
  const props = reactive({ currentTime: 10, seekRequest: null })
  const comments = ['already visible']
  const seeks = []
  let polls = 0
  const scope = effectScope()
  t.after(() => scope.stop())
  const instance = { seekTo: position => seeks.push(position), is_replay: true, on() {}, once() {}, start() {} }
  const context = createContext({
    ...replayHelpers,
    props, comments, watch,
    isReplay: { value: isReplay },
    liveChatInstance: ready ? instance : null,
    pendingReplaySeekSeconds: null,
    pendingReadbackTrimRestore: null,
    superChatComments: [],
    showSuperChat: { value: false },
    pendingReplayComments: [{ offsetMs: 12_000, comment: 'next message' }],
    replayFetchedUntilMs: 30_000,
    deliverComment: comment => comments.push(comment),
    requestMoreReplayComments: () => { polls++ },
  })
  scope.run(() => runInContext(`${clearChat}\n${positionUpdates}`, context))
  return { props, comments, seeks, context, instance, polls: () => polls }
}

test('delayed playback updates keep visible chat and release buffered messages', async t => {
  const chat = setup(t)
  chat.props.currentTime = 18
  await nextTick()
  assert.deepEqual(chat.comments, ['already visible', 'next message'], 'playback must not return chat to its empty enabled message')
  assert.deepEqual(chat.seeks, [])
  assert.equal(chat.polls(), 1)
})

for (const seconds of [10.2, 8, 600]) {
  test(`an actual seek to ${seconds}s clears old chat and fetches while paused`, async t => {
    const chat = setup(t)
    // The rounded playback prop need not have changed before seeking fires.
    chat.props.seekRequest = { seconds }
    await nextTick()
    assert.deepEqual(chat.comments, [])
    assert.deepEqual(chat.seeks, [seconds * 1000])
    assert.equal(chat.polls(), 1)

    chat.props.currentTime = Math.floor(seconds)
    await nextTick()
    assert.deepEqual(chat.seeks, [seconds * 1000], 'the following time update must not seek again')
  })
}

test('repeated seeks to the same position are delivered', async t => {
  const chat = setup(t)
  for (let i = 0; i < 2; i++) {
    chat.props.seekRequest = { seconds: 10 }
    await nextTick()
  }
  assert.deepEqual(chat.seeks, [10_000, 10_000])
})

test('a seek and time update in the same render use the precise seek position', async t => {
  const chat = setup(t)
  chat.props.currentTime = 600
  chat.props.seekRequest = { seconds: 600.25 }
  await nextTick()
  assert.deepEqual(chat.comments, [])
  assert.deepEqual(chat.seeks, [600_250])
  assert.equal(chat.polls(), 1)
})

test('live chat ignores playback updates and seeks', async t => {
  const chat = setup(t, false)
  chat.props.currentTime = 600
  chat.props.seekRequest = { seconds: 600 }
  await nextTick()
  assert.deepEqual(chat.comments, ['already visible'])
  assert.deepEqual(chat.seeks, [])
  assert.equal(chat.polls(), 0)
})

test('the Watch seeking handler forwards the current player position for regular videos', async t => {
  const watchSource = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
  const handler = watchSource.slice(watchSource.indexOf('    handlePlayerSeeking() {'), watchSource.indexOf('    clearPendingWatchTime()'))
  const handlePlayerSeeking = runInNewContext(`({${handler}}).handlePlayerSeeking`)
  const chat = setup(t)
  const watchState = {
    customShortsPlayerActive: false,
    getWatchedProgress: () => 42.25,
    set liveChatSeekRequest(request) { chat.props.seekRequest = request },
  }
  handlePlayerSeeking.call(watchState)
  await nextTick()
  assert.deepEqual(chat.seeks, [42_250])

  const template = readFileSync(new URL('../../src/renderer/views/Watch/Watch.vue', import.meta.url), 'utf8')
  assert.match(template, /@seeking="handlePlayerSeeking"/)
  assert.match(template, /<watch-video-live-chat\b[^>]*:seek-request="liveChatSeekRequest"/)
})


for (const playbackPosition of [null, 20, 23]) {
  test(`a seek during metadata loading follows the latest position after update ${playbackPosition}`, async t => {
    const chat = setup(t, false, false)
    let resolveInfo
    chat.context.getLocalVideoInfo = () => new Promise(resolve => { resolveInfo = resolve })
    for (const handler of ['handleStart', 'handleChatUpdate', 'handleMetadataUpdate', 'handleError', 'handleEnd']) {
      chat.context[handler] = () => {}
    }
    const getLocalChat = source.slice(source.indexOf('async function getLiveChatLocal()'), source.indexOf('function showLiveChatUnavailable()'))
    const startChat = source.slice(source.indexOf('function startLiveChatLocal()'), source.indexOf('const commentsRef ='))
    const loading = runInContext(`${getLocalChat}\n${startChat}\ngetLiveChatLocal()`, chat.context)

    chat.props.seekRequest = { seconds: 20.9 }
    await nextTick()
    assert.deepEqual(chat.seeks, [])
    if (playbackPosition !== null) {
      chat.props.currentTime = playbackPosition
      await nextTick()
    }

    resolveInfo({ livechat: {}, getLiveChat: () => chat.instance })
    await loading
    assert.deepEqual(chat.seeks, [playbackPosition === 23 ? 23_000 : 20_900])
  })
}
