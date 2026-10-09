import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileFunction } from 'node:vm'
import test from 'node:test'
import { isIOSNativeMediaUrl } from '../../src/renderer/helpers/player/iosMediaTransport.js'

const source = (await readFile(new URL('../../src/renderer/helpers/player/hlsManifest.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace("import('../api/capacitor-http')", 'loadNativeHttp()')
  .replace('export async function ', 'async function ')

function probe(ios, fetch, nativeFetch) {
  return compileFunction(`${source}\nreturn probeHlsManifest`, ['process', 'fetch', 'loadNativeHttp', 'isIOSNativeMediaUrl'])(
    { env: { IS_IOS: ios } }, fetch, async () => ({ capacitorHttpFetch: nativeFetch }), isIOSNativeMediaUrl
  )
}

test('iOS probes HLS through native HTTP when WebView fetch cannot access it', async () => {
  let request
  const check = probe(true, async () => { throw new Error('WebView CORS') }, async (url, options) => {
    request = { url, options }
    return new Response('#EXTM3U\n')
  })
  const url = 'https://manifest.googlevideo.com/api/manifest/hls/index.m3u8'
  assert.equal(await check(url), true)
  assert.equal(request.url, url)
  assert.equal(request.options.nativeTimeoutMs, 10000)
  assert.ok(request.options.signal instanceof AbortSignal)
})

test('desktop and Android HLS probes keep WebView fetch', async () => {
  let fetched = 0
  const check = probe(false, async () => { fetched++; return new Response('  #EXTM3U\n') }, async () => {
    assert.fail('native iOS HTTP must not be used')
  })
  assert.equal(await check('https://media.test/master.m3u8'), true)
  assert.equal(fetched, 1)
})

test('iOS accepts external HLS reachable through WebView fetch', async () => {
  const check = probe(true, async () => new Response('#EXTM3U\n'), async () => {
    assert.fail('external playback must not use native iOS HTTP')
  })
  assert.equal(await check('https://invidious.test/master.m3u8'), true)
})

test('native HLS probe rejects failed requests and non-HLS bodies', async () => {
  for (const nativeFetch of [
    async () => new Response('#EXTM3U', { status: 403 }),
    async () => new Response('<html>Error</html>'),
    async () => { throw new Error('native request failed') },
  ]) {
    assert.equal(await probe(true, async () => { assert.fail('WebView fetch must not be used') }, nativeFetch)('https://manifest.googlevideo.com/master.m3u8'), false)
  }
})

for (const url of [
  'https://invidious.test/master.m3u8',
  'http://manifest.googlevideo.com/master.m3u8',
  'https://googlevideo.com.attacker.invalid/master.m3u8',
  'https://user:password@manifest.googlevideo.com/master.m3u8',
]) {
  test(`iOS probes ${url} through the playback WebView transport`, async () => {
    let fetched = 0
    let nativeFetched = 0
    const check = probe(true, async () => {
      fetched++
      throw new Error('WebView cannot access the manifest')
    }, async () => {
      nativeFetched++
      return new Response('#EXTM3U\n')
    })
    assert.equal(await check(url), false)
    assert.equal(fetched, 1)
    assert.equal(nativeFetched, 0)
  })
}
