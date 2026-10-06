import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { createCastMediaServer, resolveCastMediaAddresses } from '../../src/main/castMediaServer.js'
import { applyTwitchPlaylistOrigin } from '../../src/twitchPlaylistOrigin.js'

async function fixture(defaultInstance = 'http://192.168.1.2:3000') {
  const main = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')
  let start
  const resolvers = new Map()
  const headers = new Map()
  const context = vm.createContext({
    URL, IpcChannels: { CAST_START: 'start' },
    ipcMain: { handle: (_channel, handler) => { start = handler } },
    isOpenTubeXUrl: url => url === 'app://opentubex/index.html',
    baseHandlers: { settings: { _findOne: async () => ({ value: defaultInstance }) } },
    invidiousAuthorizations: new Map(),
    resolveCastMediaAddresses, applyTwitchPlaylistOrigin,
    getYtDlpExternalStreamHeaders: () => ({}),
    getYtDlpExternalStreamCookieHeader: () => null,
    session: { defaultSession: { getUserAgent: () => 'Cast test', resolveHost: async () => ({ endpoints: [{ address: '192.168.1.10', family: 'ipv4' }] }) } },
    chromecast: {
      start: async (owner, _payload, getHeaders, resolve) => { resolvers.set(owner, resolve); headers.set(owner, getHeaders); return {} }
    }
  })
  vm.runInContext(main.slice(main.indexOf('  const castOwners ='), main.indexOf('  ipcMain.handle(IpcChannels.CAST_STATUS')), context)
  return {
    async start(instance, owner = 1, focused = true, frame = 'app://opentubex/index.html') {
      return start({ sender: { id: owner, isFocused: () => focused }, senderFrame: { url: frame } }, { invidiousInstanceUrl: instance })
    },
    resolve(owner, url) { return resolvers.get(owner)(new URL(url)) },
    headers(owner, url) { return headers.get(owner)(url) },
    resolvers
  }
}

for (const defaultInstance of ['', 'http://192.168.1.2:3000']) {
  test(`Cast authorizes the active private instance independently of default ${JSON.stringify(defaultInstance)}`, async () => {
    const f = await fixture(defaultInstance)
    await f.start('http://192.168.1.10:3000/invidious')
    assert.deepEqual(await f.resolve(1, 'http://192.168.1.10:3000/invidious/video'), [{ address: '192.168.1.10', family: 4 }])
    assert.equal(await f.resolve(1, 'http://192.168.1.2:3000/video'), null)
    assert.equal(await f.resolve(1, 'http://192.168.1.10:3001/video'), null)
    assert.equal(await f.resolve(1, 'https://192.168.1.10:3000/video'), null)
  })
}

test('each window and cast session retains its own selected private origin', async () => {
  const f = await fixture()
  await f.start('http://192.168.1.10:3000', 1)
  await f.start('http://192.168.1.20:3000', 2)
  assert.ok(await f.resolve(1, 'http://192.168.1.10:3000/video'))
  assert.equal(await f.resolve(2, 'http://192.168.1.10:3000/video'), null)
  assert.ok(await f.resolve(2, 'http://192.168.1.20:3000/video'))
  assert.equal(await f.resolve(1, 'http://192.168.1.20:3000/video'), null)
})

test('Cast playlist redirects receive the Twitch Origin without forwarding it to media hosts', async t => {
  const f = await fixture()
  await f.start('')
  const initial = 'https://usher.ttvnw.net/channel.m3u8'
  const playlist = 'https://euc12.playlist.ttvnw.net/v1/playlist/token.m3u8'
  const requests = []
  const media = createCastMediaServer({ url: initial }, '127.0.0.1', 'token', url => f.headers(1, url), () => [{ address: '127.0.0.1', family: 4 }], async (url, { headers }) => {
    requests.push({ url, origin: headers.get('Origin') })
    if (url === initial) return new Response(null, { status: 302, headers: { location: playlist } })
    if (url === playlist) return headers.get('Origin') === 'https://www.twitch.tv'
      ? new Response('#EXTM3U\n#EXTINF:5,\nhttps://media.test/segment.ts\n', { headers: { 'content-type': 'application/x-mpegurl' } })
      : new Response('Origin required', { status: 403 })
    return new Response('segment')
  })
  await new Promise(resolve => media.server.listen(0, '127.0.0.1', resolve))
  media.setOrigin(`http://127.0.0.1:${media.server.address().port}`)
  t.after(() => { media.server.closeAllConnections(); media.server.close() })
  const response = await fetch(media.mediaUrl())
  assert.equal(response.status, 200)
  const segment = await fetch((await response.text()).trim().split('\n').at(-1))
  assert.equal(await segment.text(), 'segment')
  assert.deepEqual(requests, [{ url: initial, origin: null }, { url: playlist, origin: 'https://www.twitch.tv' }, { url: 'https://media.test/segment.ts', origin: null }])
})

test('missing or invalid instance URLs do not authorize private destinations', async () => {
  for (const instance of [undefined, null, '', {}, 'invalid', 'file://192.168.1.10/video', 'ftp://192.168.1.10/video', 'http://user:secret@192.168.1.10:3000']) {
    const f = await fixture()
    await f.start(instance)
    assert.equal(await f.resolve(1, 'http://192.168.1.10:3000/video'), null)
    assert.equal(await f.resolve(1, 'http://192.168.1.2:3000/video'), null)
  }
})

test('unfocused windows and non-app frames cannot authorize a private Cast origin', async () => {
  const f = await fixture()
  assert.match((await f.start('http://192.168.1.10:3000', 1, false)).error, /active OpenTubeX window/)
  assert.match((await f.start('http://192.168.1.10:3000', 1, true, 'https://example.test')).error, /active OpenTubeX window/)
  assert.equal(f.resolvers.size, 0)
})
