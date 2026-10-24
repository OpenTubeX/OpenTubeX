import assert from 'node:assert/strict'
import test from 'node:test'
import { CompositeBuffer, UmpWriter } from 'googlevideo/ump'
import { concatenateChunks } from 'googlevideo/utils'

import {
  createAbandonedSabrResponse,
  extractRawProtobufField,
  parseSabrFormatId,
  MAX_SABR_RESPONSE_BYTES,
  readCompleteUmpParts
} from '../../src/renderer/helpers/player/sabrProtocol.js'

test('retains split UMP types and emits empty parts exactly once', () => {
  const encoded = new CompositeBuffer([])
  const writer = new UmpWriter(encoded)
  writer.write(300, new Uint8Array())
  writer.write(301, Uint8Array.of(1, 2))
  let pending = null
  const parts = []
  for (const byte of concatenateChunks(encoded.chunks)) {
    pending ??= new CompositeBuffer([])
    pending.append(Uint8Array.of(byte))
    pending = readCompleteUmpParts(pending, part => {
      parts.push([part.type, [...concatenateChunks(part.data.chunks)]])
    })
  }
  assert.deepEqual(parts, [[300, []], [301, [1, 2]]])
  assert.equal(pending, null)
})

test('rejects an oversized UMP declaration before buffering its payload', () => {
  for (const type of [21, 300]) {
    const header = new CompositeBuffer([])
    const writer = new UmpWriter(header)
    writer.writeVarInt(type)
    writer.writeVarInt(128 * 1024 * 1024 + 1)
    const bytes = concatenateChunks(header.chunks)
    let pending = null
    for (const byte of bytes.slice(0, -1)) {
      pending ??= new CompositeBuffer([])
      pending.append(Uint8Array.of(byte))
      pending = readCompleteUmpParts(pending, () => assert.fail('no payload received'))
    }
    pending.append(bytes.slice(-1))
    assert.throws(() => readCompleteUmpParts(pending, () => {}), /SABR.*limit/)
  }
})

test('accepts a part declaration up to the response budget including its header', () => {
  const header = new CompositeBuffer([])
  const writer = new UmpWriter(header)
  writer.writeVarInt(21)
  // This size uses four UMP varint bytes plus the one-byte type.
  writer.writeVarInt(MAX_SABR_RESPONSE_BYTES - 5)
  assert.equal(header.getLength(), 5)
  assert.equal(readCompleteUmpParts(header, () => assert.fail('no payload')), header)
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

test('extracts the playback cookie without dropping explicit defaults', () => {
  const cookie = Uint8Array.from([0x08, 0x01, 0x10, 0x00])
  const nextRequestPolicy = Uint8Array.from([
    0x08, 0x01,
    0x3a, cookie.length, ...cookie,
    0x40, 0x02
  ])

  assert.deepEqual(
    extractRawProtobufField(nextRequestPolicy, 7),
    cookie
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
