import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as utils from 'googlevideo/utils'
import * as protos from 'googlevideo/protos'
import { CompositeBuffer, UmpReader, UmpWriter } from 'googlevideo/ump'
import * as protocol from '../../src/renderer/helpers/player/sabrProtocol.js'
import * as googleVideoFallback from '../../src/renderer/helpers/player/googleVideoFallback.js'

const source = (await readFile(new URL('../../src/renderer/helpers/player/SabrSchemePlugin.js', import.meta.url), 'utf8'))
  .replace(/^import [\s\S]*? from ['"][^'"]+['"]\n/gm, '').replaceAll('export function ', 'function ')

class Operation {
  constructor(promise, abort = async () => {}) { this.promise = promise; this.abort = abort }
  static completed(value) { return new Operation(Promise.resolve(value)) }
  finally(callback) { this.promise.then(callback, callback) }
}
class ShakaError extends Error {
  static Severity = { RECOVERABLE: 1, CRITICAL: 2 }
  static Category = { NETWORK: 1 }
  static Code = { OPERATION_ABORTED: 7001, BAD_HTTP_STATUS: 1001, HTTP_ERROR: 1002 }
  constructor(severity, category, code) { super(String(code)); this.code = code; this.severity = severity }
}
const audioFormatId = { itag: 140, lastModified: '123' }
const videoFormatId = { itag: 137, lastModified: '456' }
const context = { audioFormatId, videoFormatId, bufferedRanges: [], drcEnabled: false,
  enableVoiceBoost: false, bandwidthEstimate: 2000000, playbackRate: 1.5, width: 640, height: 360 }
const sabrData = { url: 'https://example.test/sabr', scheme: 'sabr1', poToken: '', ustreamerConfig: '', clientInfo: {} }
const request = uri => ({ uris: [uri], retryParameters: { timeout: 1000 } })

function response(data, isInit = false, formatId = audioFormatId, contentLength = data.length, headerId = 1) {
  const buffer = new CompositeBuffer([])
  const writer = new UmpWriter(buffer)
  writer.write(protos.UMPPartId.MEDIA_HEADER, protos.MediaHeader.encode({
    headerId, formatId, isInitSeg: isInit, sequenceNumber: 1, contentLength: contentLength ?? undefined,
  }).finish())
  const idBytes = headerId < 128 ? [headerId] : [0x80 | (headerId & 0x3f), headerId >> 6]
  writer.write(protos.UMPPartId.MEDIA, Uint8Array.of(...idBytes, ...data))
  writer.write(protos.UMPPartId.MEDIA_END, Uint8Array.of(...idBytes))
  return new Response(utils.concatenateChunks(buffer.chunks), { status: 200 })
}

for (const headerId of [130, 256]) test(`reads SABR media header ID ${headerId} without adding ID bytes to the segment`, async () => {
  const { createSabrTransport } = load(async () => response([1, 2, 3], false, audioFormatId, 3, headerId))
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const segment = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...segment.data], [1, 2, 3])
  transport.cleanup()
})

test('complete SABR media survives every network chunk boundary', async t => {
  const bytes = new Uint8Array(await response([1, 2, 3]).arrayBuffer())
  for (let split = 1; split < bytes.length; split++) {
    await t.test(`split at byte ${split}`, async t => {
      const { createSabrTransport } = load(async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, split))
          controller.enqueue(bytes.slice(split))
          controller.close()
        }
      })))
      const transport = createSabrTransport(sabrData, () => context)
      t.after(() => transport.cleanup())
      const uri = 'sabr1:audio?formatId=140-123-&sq=1'
      const segment = await transport.request(uri, request(uri), 1).promise
      assert.deepEqual([...segment.data], [1, 2, 3])
    })
  }
})

test('split MEDIA headers retain all media bytes across retries', async t => {
  const buffer = new CompositeBuffer([])
  const writer = new UmpWriter(buffer)
  writer.write(protos.UMPPartId.MEDIA_HEADER, protos.MediaHeader.encode({
    headerId: 1, formatId: videoFormatId, sequenceNumber: 745, contentLength: 6,
  }).finish())
  writer.write(protos.UMPPartId.MEDIA, Uint8Array.of(1, 1, 2, 3, 4))
  const boundary = buffer.getLength() + 1
  writer.write(protos.UMPPartId.MEDIA, Uint8Array.of(1, 5, 6))
  writer.write(protos.UMPPartId.MEDIA_END, Uint8Array.of(1))
  const bytes = utils.concatenateChunks(buffer.chunks)
  const warnings = []
  const { createSabrTransport } = load(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, boundary))
      controller.enqueue(bytes.slice(boundary))
      controller.close()
    }
  })), { console: { ...console, warn: message => warnings.push(message) } })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  const uri = 'sabr1:video?formatId=137-456-&resolution=1080&startTimeMs=3906000&sq=745'
  for (let attempt = 0; attempt < 3; attempt++) {
    const segment = await transport.request(uri, request(uri), 1).promise
    assert.deepEqual([...segment.data], [1, 2, 3, 4, 5, 6])
  }
  assert.deepEqual(warnings, [])
})

test('SABR headers and media can arrive one byte at a time', async t => {
  // Both the MEDIA size and its header ID need multiple UMP varint bytes.
  const data = Array.from({ length: 256 }, (_, i) => i)
  const bytes = new Uint8Array(await response(data, false, audioFormatId, data.length, 256).arrayBuffer())
  const { createSabrTransport } = load(async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    }
  })))
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const segment = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...segment.data], data)
})

test('oversized SABR declarations abort the fetch and allow a fresh retry', async t => {
  const header = new CompositeBuffer([])
  const writer = new UmpWriter(header)
  writer.writeVarInt(protos.UMPPartId.MEDIA)
  writer.writeVarInt(128 * 1024 * 1024 + 1)
  let signal
  let calls = 0
  const { createSabrTransport } = load(async (_url, options) => {
    if (++calls > 1) return response([1, 2])
    signal = options.signal
    return new Response(utils.concatenateChunks(header.chunks))
  })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await assert.rejects(transport.request(uri, request(uri), 1).promise,
    error => error.code === ShakaError.Code.HTTP_ERROR)
  assert.equal(signal.aborted, true, 'rejecting the part must stop its network response')
  const result = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...result.data], [1, 2])
})

for (const media of [false, true]) test(`many ${media ? 'media' : 'unknown'} parts cannot exceed the SABR response budget`, async t => {
  const buffer = new CompositeBuffer([])
  const payload = new Uint8Array(1024 * 1024)
  payload[0] = 1
  new UmpWriter(buffer).write(media ? protos.UMPPartId.MEDIA : 300, payload)
  const header = new CompositeBuffer([])
  new UmpWriter(header).write(protos.UMPPartId.MEDIA_HEADER, protos.MediaHeader.encode({
    headerId: 1, formatId: audioFormatId, sequenceNumber: 1,
  }).finish())
  const chunk = utils.concatenateChunks(buffer.chunks)
  let reads = 0
  let signal
  const { createSabrTransport } = load(async (_url, options) => {
    signal = options.signal
    return new Response(new ReadableStream({
      start(controller) {
        if (media) controller.enqueue(utils.concatenateChunks(header.chunks))
      },
      pull(controller) {
        if (++reads <= 140) controller.enqueue(chunk)
        else controller.close()
      }
    }, { highWaterMark: 0 }))
  })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await assert.rejects(transport.request(uri, { ...request(uri), retryParameters: { timeout: 60000 } }, 1).promise,
    error => error.code === ShakaError.Code.HTTP_ERROR)
  assert.equal(reads, 128, 'stop at the budget, without reading the rest of the response')
  assert.equal(signal.aborted, true)
})

test('rejects a SABR segment shorter than its declared content length', async () => {
  let calls = 0
  const { createSabrTransport } = load(async () => {
    calls++
    return calls === 1
      ? response([1, 2], false, audioFormatId, 3)
      : response([1, 2, 3], false, audioFormatId, 3)
  })
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await assert.rejects(transport.request(uri, request(uri), 1).promise,
    error => error.code === ShakaError.Code.HTTP_ERROR)
  const complete = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...complete.data], [1, 2, 3])
  assert.equal(calls, 2)
  transport.cleanup()
})

test('logs each truncated SABR attempt with the bytes that arrived', async () => {
  const warnings = []
  const { createSabrTransport } = load(async () => {
    const buffer = new CompositeBuffer([])
    const writer = new UmpWriter(buffer)
    writer.write(protos.UMPPartId.MEDIA_HEADER, protos.MediaHeader.encode({
      headerId: 1, formatId: audioFormatId, sequenceNumber: 1, contentLength: 3,
    }).finish())
    writer.write(protos.UMPPartId.MEDIA, Uint8Array.of(1, 1, 2))
    return new Response(utils.concatenateChunks(buffer.chunks))
  }, { console: { ...console, warn: message => warnings.push(message) } })
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(transport.request(uri, request(uri), 1).promise,
      error => error.code === ShakaError.Code.HTTP_ERROR)
  }
  assert.equal(warnings.length, 2)
  for (const warning of warnings) {
    assert.match(warning, /^SABR request sabr1:audio\?formatId=140-123-&sq=1 failed: response ended before MEDIA_END \(HTTP 200, received 2 of 3 media bytes, after \d+ ms\)$/)
  }
  transport.cleanup()
})

test('a reload request logs concurrent failures but not its own abort', async () => {
  const warnings = []
  let releaseTruncated
  const { createSabrTransport } = load(async url => {
    const buffer = new CompositeBuffer([])
    const writer = new UmpWriter(buffer)
    if (new URL(url).searchParams.get('rn') === '0') {
      await new Promise(resolve => { releaseTruncated = resolve })
      writer.write(protos.UMPPartId.MEDIA_HEADER, protos.MediaHeader.encode({
        headerId: 1, formatId: audioFormatId, sequenceNumber: 1, contentLength: 3,
      }).finish())
      writer.write(protos.UMPPartId.MEDIA, Uint8Array.of(1, 1))
    } else {
      writer.write(protos.UMPPartId.RELOAD_PLAYER_RESPONSE, protos.ReloadPlaybackContext.encode({ reloadPlaybackParams: { token: 'x' } }).finish())
    }
    return new Response(utils.concatenateChunks(buffer.chunks))
  }, { console: { ...console, warn: message => warnings.push(message) } })
  const transport = createSabrTransport(sabrData, () => context)
  let reloads = 0
  transport.onReloadOnce(() => reloads++)
  const truncatedUri = 'sabr1:audio?formatId=140-123-&sq=1'
  const truncated = transport.request(truncatedUri, request(truncatedUri), 1).promise
  const reloadUri = 'sabr1:audio?formatId=140-123-&sq=2'
  await assert.rejects(transport.request(reloadUri, request(reloadUri), 1).promise)
  assert.equal(reloads, 1)
  const failures = () => warnings.filter(warning => warning.startsWith('SABR request '))
  assert.deepEqual(failures(), [], 'the reloading request must not report its own abort')
  releaseTruncated()
  await assert.rejects(truncated, error => error.code === ShakaError.Code.HTTP_ERROR)
  assert.equal(failures().length, 1)
  assert.match(failures()[0], /^SABR request sabr1:audio\?formatId=140-123-&sq=1 failed: response ended before MEDIA_END/)
  transport.cleanup()
})

test('a request timing out after another requested a reload is still logged', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const warnings = []
  const { createSabrTransport } = load(async (url, init) => {
    if (new URL(url).searchParams.get('rn') === '0') {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    const buffer = new CompositeBuffer([])
    new UmpWriter(buffer).write(protos.UMPPartId.RELOAD_PLAYER_RESPONSE,
      protos.ReloadPlaybackContext.encode({ reloadPlaybackParams: { token: 'x' } }).finish())
    return new Response(utils.concatenateChunks(buffer.chunks))
  }, { Date, console: { ...console, warn: message => warnings.push(message) } })
  const transport = createSabrTransport(sabrData, () => context)
  const stalledUri = 'sabr1:audio?formatId=140-123-&sq=1'
  const stalled = transport.request(stalledUri, request(stalledUri), 1).promise
  const reloadUri = 'sabr1:audio?formatId=140-123-&sq=2'
  await assert.rejects(transport.request(reloadUri, request(reloadUri), 1).promise)
  t.mock.timers.tick(1000)
  await assert.rejects(stalled)
  assert.deepEqual(warnings.filter(warning => warning.startsWith('SABR request ')), [
    'SABR request sabr1:audio?formatId=140-123-&sq=1 failed: timed out (received 0 media bytes, after 1000 ms)',
  ])
  transport.cleanup()
})

test('rejects media bytes when the SABR header declares zero content length', async () => {
  const { createSabrTransport } = load(async () => response([1], false, audioFormatId, 0))
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await assert.rejects(transport.request(uri, request(uri), 1).promise,
    error => error.code === ShakaError.Code.HTTP_ERROR)
  transport.cleanup()
})

test('accepts a complete SABR segment when the media header omits content length', async () => {
  const { createSabrTransport } = load(async () => response([1, 2], false, audioFormatId, null))
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const segment = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...segment.data], [1, 2])
  transport.cleanup()
})

test('selects a media segment after an init header with the same sequence number', async () => {
  const buffer = new CompositeBuffer([])
  const writer = new UmpWriter(buffer)
  for (const [headerId, isInitSeg, data] of [[1, true, [9]], [2, false, [1, 2]]]) {
    writer.write(protos.UMPPartId.MEDIA_HEADER, protos.MediaHeader.encode({
      headerId, formatId: audioFormatId, isInitSeg, sequenceNumber: 1, contentLength: data.length,
    }).finish())
    writer.write(protos.UMPPartId.MEDIA, Uint8Array.of(headerId, ...data))
    writer.write(protos.UMPPartId.MEDIA_END, Uint8Array.of(headerId))
  }
  const { createSabrTransport } = load(async () => new Response(utils.concatenateChunks(buffer.chunks)))
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const segment = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...segment.data], [1, 2])
  transport.cleanup()
})

test('rejects HTTP 403 even when it contains a complete init segment', async () => {
  let calls = 0
  const { createSabrTransport } = load(async () => {
    calls++
    const media = await response([1, 2], true).arrayBuffer()
    return new Response(media, { status: calls === 1 ? 403 : 200 })
  })
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&init'
  await assert.rejects(transport.request(uri, request(uri), 1).promise, error =>
    error.code === ShakaError.Code.BAD_HTTP_STATUS &&
    error.severity === ShakaError.Severity.CRITICAL)
  const segment = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...segment.data], [1, 2])
  assert.equal(calls, 2, 'a failed init segment must not be cached')
  transport.cleanup()
})

test('a SABR request switches to the backup server when its node cannot be reached', async t => {
  const hosts = []
  const { createSabrTransport } = load(async url => {
    hosts.push(new URL(url).hostname)
    if (hosts.length === 1) throw new TypeError('Failed to fetch')
    return response([1, 2, 3])
  })
  const transport = createSabrTransport({
    ...sabrData,
    url: 'https://rr2---sn-sabrdead-1.googlevideo.com/videoplayback?mn=sn-sabrdead-1%2Csn-sabrbackup-2&fvip=5',
  }, () => context)
  t.after(() => transport.cleanup())
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const segment = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...segment.data], [1, 2, 3])
  await transport.request(uri, request(uri), 1).promise
  assert.deepEqual(hosts, ['rr2---sn-sabrdead-1.googlevideo.com', 'rr5---sn-sabrbackup-2.googlevideo.com',
    'rr5---sn-sabrbackup-2.googlevideo.com'])
})

function load(fetch, globals = {}) {
  const schemes = new Map()
  const api = vm.runInNewContext(`${source}\n({ createSabrTransport, setupSabrScheme })`, {
    ...utils, ...protos, ...protocol, ...googleVideoFallback, CompositeBuffer, UmpReader,
    shaka: { util: { AbortableOperation: Operation, Error: ShakaError }, net: {
      NetworkingEngine: { registerScheme: (key, value) => schemes.set(key, value),
        unregisterScheme: key => schemes.delete(key) },
    } },
    fetch, process: { env: {} }, URL, AbortController, setTimeout, clearTimeout, console,
    ...globals,
  })
  return { ...api, schemes }
}

function policyResponse(backoffTimeMs, protectionStatus) {
  const buffer = new CompositeBuffer([])
  const writer = new UmpWriter(buffer)
  if (protectionStatus !== undefined) {
    writer.write(protos.UMPPartId.STREAM_PROTECTION_STATUS,
      protos.StreamProtectionStatus.encode({ status: protectionStatus }).finish())
  }
  writer.write(protos.UMPPartId.NEXT_REQUEST_POLICY,
    protos.NextRequestPolicy.encode({ backoffTimeMs }).finish())
  return new Response(utils.concatenateChunks(buffer.chunks))
}

function contextResponse(sendByDefault, writePolicy = protos.SabrContextWritePolicy.OVERWRITE, withPolicy = false, value = 42) {
  const buffer = new CompositeBuffer([])
  const writer = new UmpWriter(buffer)
  writer.write(protos.UMPPartId.SABR_CONTEXT_UPDATE, protos.SabrContextUpdate.encode({
    type: 1, value: Uint8Array.of(value), sendByDefault, writePolicy,
  }).finish())
  if (withPolicy) {
    writer.write(protos.UMPPartId.NEXT_REQUEST_POLICY,
      Uint8Array.of(0x08, 0))
  }
  return new Response(utils.concatenateChunks(buffer.chunks))
}

test('forwards the server reload context to the player owner', async t => {
  const buffer = new CompositeBuffer([])
  new UmpWriter(buffer).write(protos.UMPPartId.RELOAD_PLAYER_RESPONSE,
    protos.ReloadPlaybackContext.encode({ reloadPlaybackParams: { token: 'reload-token' } }).finish())
  const { createSabrTransport } = load(async () => new Response(utils.concatenateChunks(buffer.chunks)))
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  let reloadContext
  transport.onReloadOnce(value => { reloadContext = value })
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await assert.rejects(transport.request(uri, request(uri), 1).promise)
  assert.equal(reloadContext?.reloadPlaybackParams?.token, 'reload-token')
})

test('retries a context-only response with the supplied context', async t => {
  const bodies = []
  const { createSabrTransport } = load(async (_uri, options) => {
    bodies.push(protos.VideoPlaybackAbrRequest.decode(options.body))
    return bodies.length === 1 ? contextResponse(true) : response([1, 2])
  })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const segment = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...segment.data], [1, 2])
  assert.equal(bodies.length, 2)
  assert.equal(bodies[1].streamerContext.sabrContexts[0].type, 1)
  assert.deepEqual([...bodies[1].streamerContext.sabrContexts[0].value], [42])
})

for (const withPolicy of [false, true]) test(`activates a retained context when the server changes sendByDefault ${withPolicy ? 'with' : 'without'} a retry policy`, async t => {
  const bodies = []
  const { createSabrTransport } = load(async (_uri, options) => {
    bodies.push(protos.VideoPlaybackAbrRequest.decode(options.body))
    if (bodies.length === 1) return contextResponse(false, protos.SabrContextWritePolicy.OVERWRITE, withPolicy)
    if (bodies.length === 2) return contextResponse(true, protos.SabrContextWritePolicy.KEEP_EXISTING, withPolicy, 99)
    return response([1])
  })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...bodies[1].streamerContext.unsentSabrContexts], [1])
  assert.deepEqual([...bodies[2].streamerContext.unsentSabrContexts], [])
  assert.equal(bodies[2].streamerContext.sabrContexts[0].type, 1)
  assert.deepEqual([...bodies[2].streamerContext.sabrContexts[0].value], [42], 'KEEP_EXISTING must retain the original value')
})

for (const [sendByDefault, writePolicy] of [
  [true, protos.SabrContextWritePolicy.OVERWRITE],
  [false, protos.SabrContextWritePolicy.OVERWRITE],
  [true, protos.SabrContextWritePolicy.KEEP_EXISTING],
]) test(`stops context-only retries when ${writePolicy === protos.SabrContextWritePolicy.KEEP_EXISTING ? 'KEEP_EXISTING' : 'OVERWRITE'} updates leave the ${sendByDefault ? 'active' : 'inactive'} context unchanged`, async t => {
  let calls = 0
  let reloads = 0
  const { createSabrTransport } = load(async () => {
    calls++
    return contextResponse(sendByDefault, writePolicy, false,
      writePolicy === protos.SabrContextWritePolicy.KEEP_EXISTING ? calls : 42)
  })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onReloadOnce(() => reloads++)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await assert.rejects(transport.request(uri, request(uri), 1).promise,
    error => error.code === ShakaError.Code.HTTP_ERROR)
  assert.equal(calls, 2)
  assert.equal(reloads, 0)
})

for (const withPolicy of [false, true]) test(`bounds ${withPolicy ? 'explicit policy' : 'changing context-only'} retries before requesting a fresh player session`, async t => {
  let calls = 0
  let reloads = 0
  const { createSabrTransport } = load(async () => {
    calls++
    return contextResponse(true, protos.SabrContextWritePolicy.OVERWRITE, withPolicy, withPolicy ? 42 : calls)
  })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onReloadOnce(() => reloads++)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await assert.rejects(transport.request(uri, request(uri), 1).promise)
  assert.equal(calls, 100)
  assert.equal(reloads, 1)
})

test('server pacing after delivered media does not reload a healthy stream', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  let reloads = 0
  const { createSabrTransport } = load(async () => {
    calls++
    return calls > 1 && calls < 6 ? policyResponse(100) : response([1])
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onReloadOnce(() => reloads++)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await transport.request(uri, request(uri), 1).promise
  const pending = transport.request(uri, request(uri), 1).promise
  pending.catch(() => {})
  for (let index = 0; index < 4; index++) {
    await flushRequests()
    t.mock.timers.tick(100)
  }
  const segment = await pending
  assert.deepEqual([...segment.data], [1])
  assert.equal(calls, 6)
  assert.equal(reloads, 0)
})

test('withheld media pending attestation reloads after bounded backoffs despite delivered media', async t => {
  // YouTube serves about a minute of an unattested session, then only backoffs
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  let reloads = 0
  const { createSabrTransport } = load(async () => {
    return ++calls === 1 ? response([1]) : policyResponse(2000, 2)
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onReloadOnce(() => reloads++)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await transport.request(uri, request(uri), 1).promise
  const rejected = assert.rejects(transport.request(uri, { uris: [uri], retryParameters: { timeout: 60000 } }, 1).promise,
    error => error.code === ShakaError.Code.OPERATION_ABORTED)
  for (let index = 0; index < 6; index++) {
    await flushRequests()
    t.mock.timers.tick(2000)
  }
  await flushRequests()
  t.mock.timers.tick(60000)
  await rejected
  assert.equal(calls, 7)
  assert.equal(reloads, 1)
})

test('withheld media pending attestation waits to reload until playback needs it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  let reloads = 0
  let bufferedAheadSeconds = 40
  const { createSabrTransport } = load(async () => {
    return ++calls === 1 ? response([1]) : policyResponse(2000, 2)
  }, { Date })
  const transport = createSabrTransport(sabrData, () => ({ ...context, getBufferedAheadSeconds: () => bufferedAheadSeconds }))
  t.after(() => transport.cleanup())
  transport.onReloadOnce(() => reloads++)
  const waits = []
  transport.onBackoffRequested(({ backoffMs }) => waits.push(backoffMs))
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  await transport.request(uri, request(uri), 1).promise
  const rejected = assert.rejects(transport.request(uri, { uris: [uri], retryParameters: { timeout: 60000 } }, 1).promise,
    error => error.code === ShakaError.Code.OPERATION_ABORTED)
  // A paused video keeps its buffer, so wait without requests or timeouts
  for (let index = 0; index < 100; index++) {
    await flushRequests()
    t.mock.timers.tick(2000)
  }
  await flushRequests()
  assert.equal(calls, 7)
  assert.equal(reloads, 0)
  // Buffered playback hides the startup countdown
  assert.deepEqual(waits, [])
  bufferedAheadSeconds = 5
  t.mock.timers.tick(2000)
  await rejected
  assert.equal(calls, 7)
  assert.equal(reloads, 1)
})

test('withheld media pending attestation aborts waiting audio and video requests with one reload', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  let reloads = 0
  let bufferedAheadSeconds = 40
  const { createSabrTransport } = load(async () => {
    calls++
    if (calls === 1) return response([1])
    if (calls === 2) return response([1], false, videoFormatId)
    return policyResponse(2000, 2)
  }, { Date })
  const transport = createSabrTransport(sabrData, () => ({ ...context, getBufferedAheadSeconds: () => bufferedAheadSeconds }))
  t.after(() => transport.cleanup())
  transport.onReloadOnce(() => reloads++)
  const audioUri = 'sabr1:audio?formatId=140-123-&sq=1'
  const videoUri = 'sabr1:video?formatId=137-456-&resolution=1080&sq=1'
  await transport.request(audioUri, request(audioUri), 1).promise
  await transport.request(videoUri, request(videoUri), 1).promise
  const rejected = [audioUri, videoUri].map(uri => assert.rejects(
    transport.request(uri, { uris: [uri], retryParameters: { timeout: 60000 } }, 1).promise,
    error => error.code === ShakaError.Code.OPERATION_ABORTED))
  for (let index = 0; index < 10; index++) {
    await flushRequests()
    t.mock.timers.tick(2000)
  }
  bufferedAheadSeconds = 5
  for (let index = 0; index < 2; index++) {
    await flushRequests()
    t.mock.timers.tick(1000)
  }
  await Promise.all(rejected)
  assert.equal(reloads, 1)
})

for (const backoffMs of [100, 10000]) {
  test(`initialization does not disable startup recovery after ${backoffMs}ms backoffs`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    let calls = 0
    let reloads = 0
    const { createSabrTransport } = load(async () => {
      return ++calls === 1 ? response([1], true, videoFormatId) : policyResponse(backoffMs)
    }, { Date })
    const transport = createSabrTransport(sabrData, () => context)
    t.after(() => transport.cleanup())
    transport.onReloadOnce(() => reloads++)
    const video = 'sabr1:video?formatId=137-456-&resolution=1080'
    const init = `${video}&init`
    await transport.request(init, request(init), 1).promise
    const media = `${video}&sq=1`
    const rejected = assert.rejects(transport.request(media, { uris: [media], retryParameters: { timeout: 60000 } }, 1).promise)
    const rounds = backoffMs === 100 ? 6 : 2
    for (let index = 0; index < rounds; index++) {
      await flushRequests()
      t.mock.timers.tick(backoffMs)
    }
    await flushRequests()
    t.mock.timers.tick(60000)
    await rejected
    assert.equal(calls, rounds + 1)
    assert.equal(reloads, 1)
  })

  test(`a video stream without media still reloads after bounded ${backoffMs}ms backoffs when audio works`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    let videoCalls = 0
    let reloads = 0
    const { createSabrTransport } = load(async (_uri, options) => {
      const body = protos.VideoPlaybackAbrRequest.decode(options.body)
      if (body.clientAbrState.enabledTrackTypesBitfield === 1) return response([1])
      videoCalls++
      return policyResponse(backoffMs)
    }, { Date })
    const transport = createSabrTransport(sabrData, () => context)
    t.after(() => transport.cleanup())
    transport.onReloadOnce(() => reloads++)
    const audio = 'sabr1:audio?formatId=140-123-&sq=1'
    await transport.request(audio, request(audio), 1).promise
    const video = 'sabr1:video?formatId=137-456-&resolution=1080&sq=1'
    const rejected = assert.rejects(transport.request(video, { uris: [video], retryParameters: { timeout: 60000 } }, 1).promise)
    const rounds = backoffMs === 100 ? 6 : 2
    for (let index = 0; index < rounds; index++) {
      await flushRequests()
      t.mock.timers.tick(backoffMs)
    }
    await flushRequests()
    t.mock.timers.tick(60000)
    await rejected
    assert.equal(videoCalls, rounds)
    assert.equal(reloads, 1)
  })
}

test('resumed audio and video requests retain the playback cookie from a completed init segment', async t => {
  // Include an explicit zero and an unknown field, as in server cookies. The
  // opaque cookie must survive without decoding and re-encoding it.
  const cookie = Uint8Array.of(0x08, 0x01, 0x10, 0x00, 0x78, 0x02)
  const resumedRequests = []
  let calls = 0
  const { createSabrTransport } = load(async (_uri, options) => {
    const body = protos.VideoPlaybackAbrRequest.decode(options.body)
    const formatId = body.clientAbrState.enabledTrackTypesBitfield === 1 ? audioFormatId : videoFormatId
    if (++calls === 1) {
      const policy = new CompositeBuffer([])
      new UmpWriter(policy).write(protos.UMPPartId.NEXT_REQUEST_POLICY,
        Uint8Array.of(0x3a, cookie.length, ...cookie))
      const media = new Uint8Array(await response([1], true, formatId).arrayBuffer())
      return new Response(utils.concatenateChunks([...policy.chunks, media]))
    }
    resumedRequests.push(body)
    return response([2], false, formatId)
  })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  const init = 'sabr1:audio?formatId=140-123-&init'
  await transport.request(init, request(init), 1).promise
  for (const uri of [
    'sabr1:audio?formatId=140-123-&startTimeMs=600000&sq=1',
    'sabr1:video?formatId=137-456-&resolution=1080&startTimeMs=600000&sq=1',
  ]) {
    const segment = await transport.request(uri, request(uri), 1).promise
    assert.deepEqual([...segment.data], [2])
  }
  assert.equal(calls, 3)
  for (const body of resumedRequests) {
    assert.equal(body.clientAbrState.playerTimeMs, '600000')
    assert.deepEqual(body.streamerContext.playbackCookie, cookie,
      'resuming must send the session cookie returned before MEDIA_END')
  }
})

for (const segmentComplete of [true, false]) test(`a cookie-less policy ${segmentComplete ? 'with a completed segment' : 'requiring a retry'} retains the established playback cookie`, async t => {
  const cookie = Uint8Array.of(0x08, 0x01, 0x10, 0x00, 0x78, 0x02)
  const requests = []
  const { createSabrTransport } = load(async (_uri, options) => {
    const body = protos.VideoPlaybackAbrRequest.decode(options.body)
    requests.push(body)
    const formatId = body.clientAbrState.enabledTrackTypesBitfield === 1 ? audioFormatId : videoFormatId
    if (requests.length === 1) {
      const policy = new CompositeBuffer([])
      new UmpWriter(policy).write(protos.UMPPartId.NEXT_REQUEST_POLICY,
        Uint8Array.of(0x3a, cookie.length, ...cookie))
      const media = new Uint8Array(await response([1], true, formatId).arrayBuffer())
      return new Response(utils.concatenateChunks([...policy.chunks, media]))
    }
    if (requests.length === 2) {
      const policy = new CompositeBuffer([])
      // An explicit zero keeps the cookie-less policy present on the wire.
      new UmpWriter(policy).write(protos.UMPPartId.NEXT_REQUEST_POLICY, Uint8Array.of(0x20, 0))
      const media = segmentComplete
        ? new Uint8Array(await response([2], false, formatId).arrayBuffer())
        : new Uint8Array()
      return new Response(utils.concatenateChunks([...policy.chunks, media]))
    }
    return response([2], false, formatId)
  })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  for (const uri of [
    'sabr1:audio?formatId=140-123-&init',
    'sabr1:audio?formatId=140-123-&startTimeMs=600000&sq=1',
    'sabr1:video?formatId=137-456-&resolution=1080&startTimeMs=600000&sq=1',
  ]) {
    await transport.request(uri, request(uri), 1).promise
  }
  assert.equal(requests.length, segmentComplete ? 3 : 4)
  for (const body of requests.slice(1)) {
    assert.deepEqual(body.streamerContext.playbackCookie, cookie,
      'omitting a cookie must preserve it in retries and subsequent segment requests')
  }
})

function errorWithPolicyResponse(backoffTimeMs, policyFirst) {
  const buffer = new CompositeBuffer([])
  const writer = new UmpWriter(buffer)
  const writeError = () => writer.write(protos.UMPPartId.SABR_ERROR,
    protos.SabrError.encode({ type: 1, code: 1 }).finish())
  const writePolicy = () => writer.write(protos.UMPPartId.NEXT_REQUEST_POLICY,
    protos.NextRequestPolicy.encode({ backoffTimeMs }).finish())
  if (policyFirst) {
    writePolicy()
    writeError()
  } else {
    writeError()
    writePolicy()
  }
  return new Response(utils.concatenateChunks(buffer.chunks), { status: 200 })
}

async function flushRequests() {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

for (const policyFirst of [false, true]) test(`a SABR error ${policyFirst ? 'after' : 'before'} a retry policy fails without a long backoff`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  const waits = []
  const { createSabrTransport } = load(async () => {
    calls++
    return calls === 1 ? errorWithPolicyResponse(20000, policyFirst) : response([1])
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onBackoffRequested(({ backoffMs }) => waits.push(backoffMs))
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const pending = transport.request(uri, request(uri), 1).promise
  await flushRequests()
  assert.deepEqual(waits, [], 'a terminal error must not start a 20-second countdown')
  assert.equal(calls, 1)
  await assert.rejects(pending, error => error.code === ShakaError.Code.HTTP_ERROR)
  await transport.request(uri, request(uri), 1).promise
  assert.deepEqual(waits, [], 'a failed response must not delay the next request')
  assert.equal(calls, 2)
})

test('an HTTP error with a retry policy fails without a long backoff', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  const waits = []
  const { createSabrTransport } = load(async () => {
    calls++
    const policy = await policyResponse(20000).arrayBuffer()
    return new Response(policy, { status: 403 })
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onBackoffRequested(({ backoffMs }) => waits.push(backoffMs))
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const pending = transport.request(uri, request(uri), 1).promise
  await flushRequests()
  assert.deepEqual(waits, [])
  assert.equal(calls, 1)
  await assert.rejects(pending, error =>
    error.code === ShakaError.Code.BAD_HTTP_STATUS &&
    error.severity === ShakaError.Severity.CRITICAL)
})

test('incomplete media fails before applying a retry policy', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  const waits = []
  const { createSabrTransport } = load(async () => {
    calls++
    const buffer = new CompositeBuffer([])
    const writer = new UmpWriter(buffer)
    writer.write(protos.UMPPartId.MEDIA_HEADER, protos.MediaHeader.encode({
      headerId: 1, formatId: audioFormatId, sequenceNumber: 1, contentLength: 2,
    }).finish())
    writer.write(protos.UMPPartId.MEDIA, Uint8Array.of(1, 9))
    writer.write(protos.UMPPartId.NEXT_REQUEST_POLICY,
      protos.NextRequestPolicy.encode({ backoffTimeMs: 20000 }).finish())
    return new Response(utils.concatenateChunks(buffer.chunks))
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onBackoffRequested(({ backoffMs }) => waits.push(backoffMs))
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const pending = transport.request(uri, request(uri), 1).promise
  await flushRequests()
  assert.deepEqual(waits, [], 'truncated media must not start the policy countdown')
  assert.equal(calls, 1)
  await assert.rejects(pending, error => error.code === ShakaError.Code.HTTP_ERROR)
})

for (const coalesced of [false, true]) {
  test(`a completed segment does not apply a trailing backoff with ${coalesced ? 'coalesced' : 'separate'} network chunks`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    const media = new Uint8Array(await response([1], true).arrayBuffer())
    const policy = new Uint8Array(await policyResponse(30000).arrayBuffer())
    const chunks = coalesced ? [utils.concatenateChunks([media, policy])] : [media, policy]
    const calls = []
    const waits = []
    const { createSabrTransport } = load(async () => {
      calls.push(Date.now())
      if (calls.length > 1) return response([2], true, videoFormatId)
      return new Response(new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk)
          controller.close()
        }
      }))
    }, { Date })
    const transport = createSabrTransport(sabrData, () => context)
    t.after(() => transport.cleanup())
    transport.onBackoffRequested(({ backoffMs }) => waits.push(backoffMs))
    const makeRequest = uri => transport.request(uri, {
      uris: [uri], retryParameters: { timeout: 60000 }
    }, 1).promise
    await makeRequest('sabr1:audio?formatId=140-123-&init')
    const video = makeRequest('sabr1:video?formatId=137-456-&resolution=1080&init')
    await flushRequests()
    t.mock.timers.tick(30000)
    await video
    assert.deepEqual(waits, [], 'bytes after the requested MEDIA_END must not delay another loader')
    assert.deepEqual(calls, [0, 0])
  })
}

test('staggered native audio and video initialization share the server backoff deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const calls = []
  const waits = []
  const { createSabrTransport } = load(async (_uri, options) => {
    const body = protos.VideoPlaybackAbrRequest.decode(options.body)
    calls.push(Date.now())
    if (calls.length === 1) return policyResponse(15000)
    return response([1], true, body.clientAbrState.enabledTrackTypesBitfield === 1 ? audioFormatId : videoFormatId)
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onBackoffRequested(({ backoffMs }) => waits.push(backoffMs))
  const audio = 'sabr1:audio?formatId=140-123-&init'
  const video = 'sabr1:video?formatId=137-456-&resolution=1080&init'
  const makeRequest = uri => ({ uris: [uri], retryParameters: { timeout: 30000 } })
  const audioPending = transport.request(audio, makeRequest(audio), 1).promise
  await flushRequests()
  t.mock.timers.tick(5000)
  const videoPending = transport.request(video, makeRequest(video), 1).promise
  await flushRequests()
  t.mock.timers.tick(10000)
  await flushRequests()
  // Observe both completions before assertions so a failing run can clean up.
  t.mock.timers.tick(5000)
  await Promise.all([audioPending, videoPending])
  assert.deepEqual(waits, [15000, 10000], 'the second loader must not restart the full startup countdown')
  assert.deepEqual(calls, [0, 15000, 15000])
})

test('later native segments do not repeat an expired server backoff', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  const waits = []
  const { createSabrTransport } = load(async () => {
    if (++calls === 1) return policyResponse(15000)
    return response([1])
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onBackoffRequested(({ backoffMs }) => waits.push(backoffMs))
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const request = { uris: [uri], retryParameters: { timeout: 30000 } }
  const first = transport.request(uri, request, 1).promise
  await flushRequests()
  t.mock.timers.tick(15000)
  await first
  const later = transport.request(uri, request, 1).promise
  await flushRequests()
  t.mock.timers.tick(15000)
  await later
  assert.deepEqual(waits, [15000])
  assert.equal(calls, 3)
})

test('closing a native source cancels its backoff without sending a delayed request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  const { createSabrTransport } = load(async () => {
    calls++
    return policyResponse(15000)
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&init'
  const pending = transport.request(uri, { uris: [uri], retryParameters: { timeout: 30000 } }, 1).promise
  await flushRequests()
  transport.cleanup()
  await assert.rejects(pending, error => error.code === ShakaError.Code.OPERATION_ABORTED)
  t.mock.timers.tick(30000)
  await flushRequests()
  assert.equal(calls, 1)
})

test('a newer server policy extends the deadline for loaders already waiting', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let releaseVideo
  const calls = []
  const { createSabrTransport } = load(async (_uri, options) => {
    calls.push(Date.now())
    if (calls.length === 1) return policyResponse(15000)
    if (calls.length === 2) return new Promise(resolve => { releaseVideo = resolve })
    const body = protos.VideoPlaybackAbrRequest.decode(options.body)
    return response([1], true, body.clientAbrState.enabledTrackTypesBitfield === 1 ? audioFormatId : videoFormatId)
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  const pending = [
    'sabr1:audio?formatId=140-123-&init',
    'sabr1:video?formatId=137-456-&resolution=1080&init',
  ].map(uri => transport.request(uri, { uris: [uri], retryParameters: { timeout: 30000 } }, 1).promise)
  await flushRequests()
  t.mock.timers.tick(5000)
  releaseVideo(policyResponse(20000))
  await flushRequests()
  t.mock.timers.tick(10000)
  await flushRequests()
  assert.equal(calls.length, 2, 'the audio loader must respect the newer deadline')
  t.mock.timers.tick(10000)
  await Promise.all(pending)
  assert.deepEqual(calls, [0, 0, 25000, 25000])
})

test('native SABR transport encodes decoder state and returns only the requested media bytes', async () => {
  const requests = []
  const { createSabrTransport } = load(async (uri, options) => {
    requests.push({ uri, body: protos.VideoPlaybackAbrRequest.decode(options.body) })
    return response([5, 6, 7])
  })
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1&startTimeMs=10000'
  const result = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...result.data], [5, 6, 7])
  assert.equal(requests[0].body.clientAbrState.playbackRate, 1.5)
  assert.equal(requests[0].body.clientAbrState.playerTimeMs, '10000')
  assert.equal(requests[0].body.preferredAudioFormatIds[0].itag, 140)
  assert.equal(requests[0].body.preferredVideoFormatIds[0].itag, 137)
  assert.equal(new URL(requests[0].uri).searchParams.get('rn'), '0')
  transport.cleanup()
})

test('SABR initialization stays cached until the native source closes', async () => {
  let calls = 0
  const { createSabrTransport } = load(async () => { calls++; return response([1, 2, 3], true) })
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&init'
  await transport.request(uri, request(uri), 1).promise
  const cached = await transport.request(uri, request(uri), 1).promise
  assert.equal(cached.fromCache, true)
  assert.equal(calls, 1)
  transport.cleanup()
  const abandoned = await transport.request(uri, request(uri), 1).promise
  assert.equal(abandoned.data.byteLength, 0)
  assert.equal(calls, 1)
})

test('replacing a SABR source aborts its outstanding network request', async () => {
  const { createSabrTransport } = load((_uri, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const pending = transport.request(uri, request(uri), 1).promise
  transport.cleanup()
  await assert.rejects(pending, error => error.code === ShakaError.Code.OPERATION_ABORTED)
})

test('the Shaka adapter retains format selection, registration and teardown behavior', async () => {
  let body
  const { setupSabrScheme, schemes } = load(async (_uri, options) => {
    body = protos.VideoPlaybackAbrRequest.decode(options.body)
    return response([1], true)
  })
  const player = {
    isAudioOnly: () => false,
    getVariantTracks: () => [{ originalVideoId: '137-456-', originalAudioId: '140-123-', audioRoles: ['main'] }],
    getStats: () => ({ estimatedBandwidth: 1234567 }), getPlaybackRate: () => 2,
  }
  const transport = setupSabrScheme(sabrData, () => player, () => ({}), { value: 1920 }, { value: 1080 })
  const uri = 'sabr1:audio?formatId=140-123-&init'
  await schemes.get('sabr1')(uri, request(uri), 1).promise
  assert.equal(body.clientAbrState.playbackRate, 2)
  assert.equal(body.clientAbrState.clientViewportWidth, 1920)
  assert.equal(body.preferredVideoFormatIds[0].itag, 137)
  transport.cleanup()
  assert.equal(schemes.size, 0)
})
