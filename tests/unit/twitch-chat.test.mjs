import assert from 'node:assert/strict'
import test from 'node:test'
import { getTwitchChatTarget, parseTwitchIrcMessage, parseTwitchReplayPage } from '../../src/renderer/views/ExternalMedia/twitchChat.js'
import { createTwitchChatReplayRequest, readTwitchReplayResponse } from '../../src/twitchChatReplayRequest.js'

test('detects only Twitch live channels and VODs', () => {
  assert.deepEqual(getTwitchChatTarget('https://www.twitch.tv/Example_1', true), { type: 'live', id: 'example_1' })
  assert.deepEqual(getTwitchChatTarget('https://www.twitch.tv/xqc', true), { type: 'live', id: 'xqc' })
  assert.deepEqual(getTwitchChatTarget('https://www.twitch.tv/videos/12345', false), { type: 'replay', id: '12345' })
  assert.equal(getTwitchChatTarget('https://www.twitch.tv/Example_1', false), null)
  assert.equal(getTwitchChatTarget('https://twitch.tv.evil.test/Example_1', true), null)
  assert.equal(getTwitchChatTarget('https://www.twitch.tv/Example_1/clip/Foo', true), null)
})

test('parses tagged IRC chat without interpreting message text as markup', () => {
  const message = parseTwitchIrcMessage('@display-name=Viewer;color=#123ABC;id=abc;tmi-sent-ts=1234 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #example :<b>hello</b>')
  assert.deepEqual(message, { id: 'abc', name: 'Viewer', text: '<b>hello</b>', color: '#123ABC', timestamp: 1234 })
  assert.equal(parseTwitchIrcMessage('PING :tmi.twitch.tv'), null)
})

test('parses VOD comments and continuation cursor', () => {
  const page = parseTwitchReplayPage({ data: { video: { comments: {
    pageInfo: { hasNextPage: true },
    edges: [{ cursor: 'next', node: {
      id: 'm1', contentOffsetSeconds: 12.5, commenter: { displayName: 'Viewer' },
      message: { userColor: '#123ABC', fragments: [{ text: 'Hello ' }, { text: 'world' }] }
    } }]
  } } } })
  assert.deepEqual(page, {
    messages: [{ id: 'm1', name: 'Viewer', text: 'Hello world', color: '#123ABC', offset: 12.5 }],
    cursor: 'next'
  })
})

test('uses one persisted query shape for replay offsets and cursors', () => {
  const offset = createTwitchChatReplayRequest('12345', 20)[0]
  const cursor = createTwitchChatReplayRequest('12345', 'next')[0]
  assert.equal(offset.operationName, 'VideoCommentsByOffsetOrCursor')
  assert.equal(offset.variables.contentOffsetSeconds, 20)
  assert.equal(cursor.variables.cursor, 'next')
  assert.equal(offset.extensions.persistedQuery.sha256Hash, cursor.extensions.persistedQuery.sha256Hash)
})

test('limits replay responses even when their content length is missing', async () => {
  const oversized = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(600_000))
      controller.enqueue(new Uint8Array(600_000))
      controller.close()
    }
  }))
  await assert.rejects(readTwitchReplayResponse(oversized), /too large/)
  const valid = new Response(JSON.stringify([{ data: { video: null } }]))
  assert.deepEqual(await readTwitchReplayResponse(valid), { data: { video: null } })
})

test('rejects bodyless Twitch replay responses with a clear error', async () => {
  await assert.rejects(readTwitchReplayResponse(new Response(null, { status: 204 })), /Twitch chat replay response has no body/)
})
