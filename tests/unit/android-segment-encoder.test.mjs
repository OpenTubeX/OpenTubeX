import assert from 'node:assert/strict'
import test from 'node:test'
import { createAndroidSegmentEncoder } from '../../src/renderer/helpers/player/androidSegmentEncoder.js'

function fixture() {
  const events = new Map()
  const sent = []
  let terminated = false
  const encoder = createAndroidSegmentEncoder(() => ({
    addEventListener(name, fn) { events.set(name, fn) },
    postMessage(message, transfer) { sent.push(structuredClone(message, { transfer })) },
    terminate() { terminated = true },
  }))
  return { encoder, sent, events, terminated: () => terminated }
}

test('encoding transfers only the requested view and preserves shared source bytes', async () => {
  const { encoder, sent, events } = fixture()
  const original = Uint8Array.of(99, 1, 2, 3, 88)
  const first = encoder.encode(original.subarray(1, 4))
  const second = encoder.encode(Uint8Array.of(4))
  assert.deepEqual([...original], [99, 1, 2, 3, 88])
  assert.deepEqual([...sent[0].bytes], [1, 2, 3])
  events.get('message')({ data: { id: sent[1].id, data: 'BA==' } })
  events.get('message')({ data: { id: sent[0].id, data: 'AQID' } })
  assert.deepEqual(await Promise.all([first, second]), ['AQID', 'BA=='])
  encoder.close()
})

for (const failure of ['close', 'error', 'messageerror']) {
  test(`encoder ${failure} settles all pending requests and terminates the worker`, async () => {
    const { encoder, events, terminated } = fixture()
    const first = assert.rejects(encoder.encode(new Uint8Array(1)))
    const second = assert.rejects(encoder.encode(new Uint8Array(1)))
    if (failure === 'close') encoder.close()
    else events.get(failure)({})
    await Promise.all([first, second])
    assert.equal(terminated(), true)
    await assert.rejects(encoder.encode(new Uint8Array(1)), /replaced/)
  })
}

test('encoding rejects oversized segments before posting to the worker', async () => {
  const { encoder, sent } = fixture()
  await assert.rejects(encoder.encode(new Uint8Array(32 * 1024 * 1024 + 1)), /size limit/)
  assert.equal(sent.length, 0)
  encoder.close()
})

test('a timeout rejects only its segment and leaves later segments usable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { encoder, sent, events, terminated } = fixture()
  const first = assert.rejects(encoder.encode(Uint8Array.of(1)), /timed out/)
  t.mock.timers.tick(1000)
  const second = encoder.encode(Uint8Array.of(2))
  // Install a handler immediately so failure remains an assertion, not an unhandled rejection.
  const result = Promise.allSettled([second])
  t.mock.timers.tick(29_000)
  await first
  events.get('message')({ data: { id: sent[1].id, data: 'Ag==' } })
  assert.deepEqual(await result, [{ status: 'fulfilled', value: 'Ag==' }])
  assert.equal(terminated(), false)
  encoder.close()
})
