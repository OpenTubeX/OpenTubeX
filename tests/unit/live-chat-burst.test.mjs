import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
import { nextTick, shallowReactive } from 'vue'
import { takeDueReplayComments } from '../../src/renderer/components/WatchVideoLiveChat/liveChatReplay.js'

const source = readFileSync(new URL('../../src/renderer/components/WatchVideoLiveChat/WatchVideoLiveChat.vue', import.meta.url), 'utf8')
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`)
  return source.slice(start, source.indexOf('\n}\n', start) + 3)
}

function setup(count = 150) {
  let scrolls = 0
  const frames = []
  const context = createContext({
    nextTick, takeDueReplayComments,
    comments: shallowReactive([]),
    superChatComments: [],
    pendingReplayComments: Array.from({ length: count }, (_, id) => ({ offsetMs: 1000, comment: { id } })),
    props: { currentTime: 1 },
    stayAtBottom: true,
    isUnmounted: false,
    liveEdgeScrollFrame: null,
    requestAnimationFrame: callback => frames.push(callback),
    isLoading: { value: false },
    commentsRef: { value: null },
    MAX_LIVE_CHAT_COMMENTS: 150,
    MAX_LIVE_CHAT_READBACK_COMMENTS: 500,
    scrollToBottom: () => { scrolls++ },
  })
  for (const name of ['scheduleLiveEdgeScroll', 'pushComment', 'trimLiveChatComments', 'deliverComment', 'releaseReplayComments', 'onLiveChatMessageEntered']) {
    runInContext(functionSource(name), context)
  }
  return { context, scrolls: () => scrolls, frame: async () => {
    await nextTick()
    for (const callback of frames.splice(0)) callback()
  } }
}

test('a replay burst performs one scroll correction after rendering', async () => {
  const chat = setup()
  runInContext('releaseReplayComments()', chat.context)
  await chat.frame()
  assert.equal(chat.context.comments.length, 150)
  assert.equal(chat.scrolls(), 1)
})

test('enter hooks for a burst share one scroll correction', async () => {
  const chat = setup()
  runInContext('for (let i = 0; i < 150; i++) onLiveChatMessageEntered()', chat.context)
  await chat.frame()
  assert.equal(chat.scrolls(), 1)
})

for (const change of ['stayAtBottom = false', 'isUnmounted = true']) {
  test(`queued following respects ${change}`, async () => {
    const chat = setup()
    runInContext(`releaseReplayComments(); ${change}`, chat.context)
    await chat.frame()
    assert.equal(chat.scrolls(), 0)
  })
}

test('later batches still follow and retain the bounded history', async () => {
  const chat = setup(300)
  runInContext('releaseReplayComments()', chat.context)
  await chat.frame()
  runInContext('pushComment({ id: 300 })', chat.context)
  await chat.frame()
  assert.equal(chat.context.comments.length, 150)
  assert.equal(chat.context.comments[0].id, 151)
  assert.equal(chat.scrolls(), 2)
})


test('buffered replay messages still follow after the last network response', async () => {
  const chat = setup()
  runInContext('hasEnded = true; releaseReplayComments()', chat.context)
  await chat.frame()
  assert.equal(chat.scrolls(), 1)
})
