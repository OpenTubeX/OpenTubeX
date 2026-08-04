import assert from 'node:assert/strict'
import test from 'node:test'

// Loads the platform shim that youtubei.js' event emitter needs.
import 'youtubei.js'

// Imported by path because youtubei.js doesn't export its internals, and because
// these cover behaviour that only exists thanks to patches/youtubei.js@17.2.0.patch.
import LiveChat from '../../node_modules/youtubei.js/dist/src/parser/youtube/LiveChat.js'
import { LiveChatContinuation } from '../../node_modules/youtubei.js/dist/src/parser/continuations.js'

const INITIAL_CONTINUATION = 'INITIAL_CONTINUATION'

/**
 * The real continuations come out of the parser, which needs far more of a response
 * than these tests care about, so the prototype is borrowed for the `instanceof`
 * check that LiveChat does and only the fields it reads are filled in.
 */
function fakeContinuation({ actions = [], continuation = 'NEXT', header = null }) {
  return Object.assign(Object.create(LiveChatContinuation.prototype), {
    actions,
    continuation: continuation === null ? undefined : { token: continuation },
    header,
  })
}

function fakeReplayAction(videoOffsetTimeMsec) {
  return { video_offset_time_msec: videoOffsetTimeMsec }
}

/**
 * @param {((args: any, callIndex: number) => any)} respond
 */
function createReplay(respond) {
  const requests = []

  const videoInfo = {
    basic_info: { id: 'dQw4w9WgXcQ', channel_id: 'UC38IQsAvIsxxjztdMZQtwHA' },
    livechat: { continuation: INITIAL_CONTINUATION, is_replay: true },
    actions: {
      execute(endpoint, args) {
        requests.push({ endpoint, args })
        return Promise.resolve(respond(args, requests.length - 1))
      },
    },
  }

  const liveChat = new LiveChat(videoInfo)

  const started = []
  const updates = []
  liveChat.on('start', (contents) => started.push(contents))
  liveChat.on('chat-update', (action) => updates.push(action))

  return { liveChat, requests, started, updates }
}

/** Lets the polling promise chain settle. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

test('replays wait for the consumer instead of polling on their own', async () => {
  const { liveChat, requests, started } = createReplay((args, callIndex) => ({
    continuation_contents: fakeContinuation({
      continuation: `AFTER_${callIndex}`,
      header: callIndex === 0 ? {} : null,
      actions: [fakeReplayAction('1000')],
    }),
  }))

  liveChat.start()
  await flush()

  assert.equal(started.length, 1)
  // A live chat would have kept polling here, and would also have started polling
  // /updated_metadata, which a video that already ended has nothing to report for.
  assert.equal(requests.length, 1)
  assert.equal(requests[0].endpoint, 'live_chat/get_live_chat_replay')

  await liveChat.pollNext()
  await flush()

  assert.equal(requests.length, 2)
  assert.equal(requests[1].args.continuation, 'AFTER_0')
})

test('replays hand their actions over without pacing them', async () => {
  const { liveChat, updates } = createReplay((args, callIndex) => ({
    continuation_contents: fakeContinuation({
      continuation: `AFTER_${callIndex}`,
      header: callIndex === 0 ? {} : null,
      actions: [fakeReplayAction('60000'), fakeReplayAction('61000')],
    }),
  }))

  liveChat.start()
  await flush()
  await liveChat.pollNext()

  // The smoothed queue would have spread these out over the next few seconds,
  // which is the wrong pacing for messages that carry their own player offsets.
  assert.deepEqual(updates, [fakeReplayAction('60000'), fakeReplayAction('61000')])
})

test('seeking re-anchors the replay to the given player position', async () => {
  const { liveChat, requests } = createReplay((args, callIndex) => ({
    continuation_contents: fakeContinuation({
      continuation: `AFTER_${callIndex}`,
      header: callIndex === 0 ? {} : null,
    }),
  }))

  liveChat.start()
  await flush()
  assert.equal(requests[0].args.currentPlayerState, undefined)

  liveChat.seekTo(1_800_000)
  await liveChat.pollNext()
  await flush()

  assert.equal(requests[1].args.continuation, INITIAL_CONTINUATION)
  assert.deepEqual(requests[1].args.currentPlayerState, { playerOffsetMs: '1800000' })

  await liveChat.pollNext()
  await flush()

  // Sending the offset again would keep pulling the replay back to the seek position.
  assert.equal(requests[2].args.continuation, 'AFTER_1')
  assert.equal(requests[2].args.currentPlayerState, undefined)
})

test('seeking before the replay is started begins it at that position', async () => {
  const { liveChat, requests } = createReplay(() => ({
    continuation_contents: fakeContinuation({ header: {} }),
  }))

  liveChat.seekTo(90_000)
  liveChat.start()
  await flush()

  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].args.currentPlayerState, { playerOffsetMs: '90000' })
})

test('a response that a seek has overtaken is discarded', async () => {
  /** @type {((value: any) => void)[]} */
  const pendingResponses = []

  const { liveChat, requests, updates } = createReplay((args, callIndex) => {
    if (callIndex === 1) {
      return new Promise((resolve) => pendingResponses.push(resolve))
    }

    return {
      continuation_contents: fakeContinuation({
        continuation: `AFTER_${callIndex}`,
        header: callIndex === 0 ? {} : null,
        actions: [fakeReplayAction(callIndex === 0 ? '0' : '600000')],
      }),
    }
  })

  liveChat.start()
  await flush()
  updates.length = 0

  // Fetch a batch, then seek away before it comes back.
  liveChat.pollNext()
  await flush()
  assert.equal(requests.length, 2)

  liveChat.seekTo(60_000)

  pendingResponses[0]({
    continuation_contents: fakeContinuation({
      continuation: 'STALE',
      actions: [fakeReplayAction('900000')],
    }),
  })
  await flush()

  // The overtaken batch belongs to the position that was left behind.
  assert.deepEqual(updates, [])

  await liveChat.pollNext()
  await flush()

  // The stale response must not have advanced the continuation either.
  assert.equal(requests[2].args.continuation, INITIAL_CONTINUATION)
  assert.deepEqual(updates, [fakeReplayAction('600000')])
})

test('the end of the replay stops further fetching without ending the chat', async () => {
  let ended = false

  const { liveChat, requests } = createReplay((args, callIndex) => ({
    continuation_contents: fakeContinuation({
      continuation: callIndex === 0 ? 'AFTER_0' : null,
      header: callIndex === 0 ? {} : null,
      actions: [fakeReplayAction('7200000')],
    }),
  }))
  liveChat.on('end', () => { ended = true })

  liveChat.start()
  await flush()
  await liveChat.pollNext()
  await flush()
  assert.equal(requests.length, 2)

  await liveChat.pollNext()
  await flush()

  assert.equal(requests.length, 2)
  // Running out of chat is not an error, and seeking back has to keep working.
  assert.equal(ended, false)

  liveChat.seekTo(60_000)
  await liveChat.pollNext()
  await flush()

  assert.equal(requests.length, 3)
  assert.equal(requests[2].args.continuation, INITIAL_CONTINUATION)
})

test('concurrent polls are collapsed into one request', async () => {
  const { liveChat, requests } = createReplay((args, callIndex) => ({
    continuation_contents: fakeContinuation({
      continuation: `AFTER_${callIndex}`,
      header: callIndex === 0 ? {} : null,
    }),
  }))

  liveChat.start()
  await flush()

  await Promise.all([liveChat.pollNext(), liveChat.pollNext(), liveChat.pollNext()])
  await flush()

  assert.equal(requests.length, 2)
})
