import assert from 'node:assert/strict'
import test from 'node:test'
import { CompositeBuffer, UmpWriter } from 'googlevideo/ump'
import { concatenateChunks } from 'googlevideo/utils'

import {
  createAbandonedSabrResponse,
  createSabrUmpReader,
  parseSabrFormatId,
  MAX_SABR_RESPONSE_BYTES
} from '../../src/renderer/helpers/player/sabrProtocol.js'

test('rejects an oversized UMP declaration before buffering its payload', async () => {
  for (const type of [21, 300]) {
    const header = new CompositeBuffer([])
    const writer = new UmpWriter(header)
    writer.writeVarInt(type)
    writer.writeVarInt(MAX_SABR_RESPONSE_BYTES + 1)
    const reader = createSabrUmpReader({ onPart: () => assert.fail('no payload received') })
    await reader.feed(concatenateChunks(header.chunks))
    await assert.rejects(reader.feed(Uint8Array.of(0)), /SABR.*limit/)
  }
})

test('accepts a part declaration up to the response budget', async () => {
  const header = new CompositeBuffer([])
  const writer = new UmpWriter(header)
  writer.writeVarInt(21)
  writer.writeVarInt(MAX_SABR_RESPONSE_BYTES)
  const reader = createSabrUmpReader({ onPart: () => assert.fail('no payload') })
  await reader.feed(concatenateChunks(header.chunks))
  await reader.feed(Uint8Array.of(0))
})

test('preserves hyphens inside SABR format xtags', () => {
  assert.deepEqual(
    parseSabrFormatId('251-1720000000000-acont=dubbed-auto:lang=ar'),
    {
      itag: 251,
      lastModified: '1720000000000',
      xtags: 'acont=dubbed-auto:lang=ar'
    }
  )
})

test('returns the response shape Shaka expects for an abandoned request', () => {
  const request = { uris: ['sabr1:video'] }
  const response = createAbandonedSabrResponse('sabr1:video', request)

  assert.equal(response.uri, 'sabr1:video')
  assert.equal(response.originalUri, 'sabr1:video')
  assert.equal(response.originalRequest, request)
  assert.equal(response.data.byteLength, 0)
  assert.equal(response.status, 200)
  assert.equal(response.timeMs, 0)
})
