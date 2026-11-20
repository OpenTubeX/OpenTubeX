import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileFunction } from 'node:vm'
import test from 'node:test'
import { isIOSNativeMediaUrl } from '../../src/renderer/helpers/player/iosMediaTransport.js'

const source = (await readFile(new URL('../../src/renderer/helpers/player/hlsManifest.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace("import('../api/capacitor-http')", 'loadNativeHttp()')
  .replaceAll('export async function ', 'async function ')

function probe(ios, fetch, nativeFetch, name = 'probeHlsManifest') {
  return compileFunction(`${source}\nreturn ${name}`, ['process', 'fetch', 'loadNativeHttp', 'isIOSNativeMediaUrl'])(
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

test('native HLS probe rejects failed requests and non-HLS bodies', async () => {
  for (const nativeFetch of [
    async () => new Response('#EXTM3U', { status: 403 }),
    async () => new Response('<html>Error</html>'),
    async () => { throw new Error('native request failed') },
  ]) {
    assert.equal(await probe(true, async () => { assert.fail('WebView fetch must not be used') }, nativeFetch)('https://manifest.googlevideo.com/master.m3u8'), false)
  }
})

test('iOS probes a lookalike googlevideo host through the playback WebView transport', async () => {
  let fetched = 0
  let nativeFetched = 0
  const check = probe(true, async () => {
    fetched++
    throw new Error('WebView cannot access the manifest')
  }, async () => {
    nativeFetched++
    return new Response('#EXTM3U\n')
  })
  assert.equal(await check('https://googlevideo.com.attacker.invalid/master.m3u8'), false)
  assert.equal(fetched, 1)
  assert.equal(nativeFetched, 0)
})

test('VR HLS probes tell a 360° panorama from the flat view of a VR180 video', async () => {
  const classify = body => probe(false, async () => new Response(body), undefined, 'probeVrHlsManifest')('https://media.test/master.m3u8')
  assert.equal(await classify('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=3840x1920\nhttps://media.test/a.m3u8\n'), 'panorama')
  assert.equal(await classify('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1918x1080\nhttps://media.test/a.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=2480x1396\nhttps://media.test/b.m3u8\n'), 'flat')
  assert.equal(await classify('#EXTM3U\n'), 'panorama')
  assert.equal(await classify('<html>Error</html>'), null)
})
