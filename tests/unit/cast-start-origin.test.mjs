import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { createCastMediaServer, resolveCastMediaAddresses } from '../../src/main/castMediaServer.js'
import { applyTwitchPlaylistOrigin } from '../../src/twitchPlaylistOrigin.js'
import { isInvidiousInstanceUrl } from '../../src/main/invidiousAuthorization.js'

async function fixture(defaultInstance = 'http://192.168.1.2:3000') {
  const main = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')
  const handlers = new Map()
  const listeners = new Map()
  let focused = true
  let destroyed = false
  let onDestroyed
  const sender = { id: 1, isFocused: () => focused, isDestroyed: () => destroyed, once: (_name, callback) => { onDestroyed = callback } }
  const event = { sender, senderFrame: { url: 'app://opentubex/index.html' } }
  const userActivation = { isActive: true }
  const resolvers = new Map()
  const headers = new Map()
  const prompts = []
  let allowPrivate = true
  let pendingConsent
  const context = vm.createContext({
    URL, randomUUID, IpcChannels: { CAST_START: 'start', CAST_PREPARE: 'prepare', CAST_CANCEL_PREPARATION: 'cancel' },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: (channel, handler) => listeners.set(channel, handler) },
    ipcRenderer: { on: () => {}, invoke: (channel, ...args) => handlers.get(channel)(event, ...args), send: (channel, ...args) => listeners.get(channel)?.(event, ...args) },
    navigator: { userActivation }, document: { body: { dataset: {} } }, webFrame: {},
    process: { argv: [], env: {}, versions: {} }, console,
    isOpenTubeXUrl: url => url === 'app://opentubex/index.html',
    baseHandlers: { settings: { _findOne: async () => ({ value: defaultInstance }) } },
    invidiousAuthorizations: new Map(),
    resolveCastMediaAddresses, applyTwitchPlaylistOrigin, isInvidiousInstanceUrl,
    BrowserWindow: { fromWebContents: () => ({}) },
    createMainTranslator: async () => (key, values) => values?.instance ?? key,
    dialog: { showMessageBox: async (_window, options) => { prompts.push(options); return pendingConsent ? await pendingConsent : { response: allowPrivate ? 1 : 0 } } },
    getYtDlpExternalStreamHeaders: () => ({}),
    getYtDlpExternalStreamCookieHeader: () => null,
    session: { defaultSession: { getUserAgent: () => 'Cast test', resolveHost: async () => ({ endpoints: [{ address: '192.168.1.10', family: 'ipv4' }] }) } },
    chromecast: {
      start: async (owner, _payload, getHeaders, resolve) => { resolvers.set(owner, resolve); headers.set(owner, getHeaders); return { castId: 'cast-1' } }
    }
  })
  vm.runInContext(main.slice(main.indexOf('  const castOwners ='), main.indexOf('  ipcMain.handle(IpcChannels.CAST_STATUS')), context)
  const preload = (await readFile(new URL('../../src/preload/interface.js', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '').replace('export default {', 'globalThis.preloadInterface = {')
  vm.runInContext(preload, context)
  return {
    api: context.preloadInterface.chromecast,
    prompts,
    setConsent(value) { allowPrivate = value },
    holdConsent(value) { pendingConsent = value },
    setDefault(value) { defaultInstance = value },
    destroy() { destroyed = true; onDestroyed?.() },
    prepare: () => handlers.get('prepare')(event),
    complete: preparationId => handlers.get('start')(event, {}, preparationId),
    cancel: preparationId => listeners.get('cancel')(event, preparationId),
    changeFrame(id) { event.senderFrame.routingId = id },
    changeOwner(id) { sender.id = id },
    setFocus(value) { focused = value; userActivation.isActive = value },
    async start(instance, owner = 1, focused = true, frame = 'app://opentubex/index.html') {
      const event = { sender: { id: owner, isFocused: () => focused, isDestroyed: () => false, once: () => {} }, senderFrame: { url: frame } }
      const preparation = await handlers.get('prepare')(event)
      if (preparation.error) return preparation
      return handlers.get('start')(event, { invidiousInstanceUrl: instance }, preparation.preparationId)
    },
    resolve(owner, url) { return resolvers.get(owner)(new URL(url)) },
    headers(owner, url) { return headers.get(owner)(url) },
    resolvers
  }
}

for (const configuredInstance of ['http://192.168.1.10:3000/invidious', 'http://user:secret@192.168.1.10:3000/invidious']) {
  test(`Cast authorizes the persisted private instance ${JSON.stringify(configuredInstance)}`, async () => {
    const f = await fixture(configuredInstance)
    await f.start('http://192.168.1.2:3000')
    assert.deepEqual(await f.resolve(1, 'http://192.168.1.10:3000/invidious/video'), [{ address: '192.168.1.10', family: 4 }])
    assert.equal(await f.resolve(1, 'http://192.168.1.2:3000/video'), null)
    assert.equal(await f.resolve(1, 'http://192.168.1.10:3001/video'), null)
    assert.equal(await f.resolve(1, 'https://192.168.1.10:3000/video'), null)
  })
}

test('each cast session retains its own configured private origin after settings change', async () => {
  const f = await fixture('http://192.168.1.10:3000')
  await f.start(undefined, 1)
  f.setDefault('http://192.168.1.20:3000')
  await f.start(undefined, 2)
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

test('missing or invalid persisted instance URLs do not authorize private destinations', async () => {
  for (const instance of [undefined, null, '', {}, 'invalid', 'file://192.168.1.10/video', 'ftp://192.168.1.10/video']) {
    const f = await fixture('')
    f.setDefault(instance)
    await f.start('http://192.168.1.10:3000')
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


test('Cast preparation retains initial focus authorization through the actual preload/main handoff', async () => {
  const f = await fixture('')
  let complete
  const pending = f.api.start(() => new Promise(resolve => { complete = resolve }))
  // Allow authorization/preparation to enter before the user changes focus.
  while (!complete) await new Promise(resolve => setImmediate(resolve))
  f.setFocus(false)
  complete({ deviceId: 'tv' })
  assert.equal((await pending).castId, 'cast-1')
})

test('renderer payload cannot replace the configured private Cast origin', async () => {
  const f = await fixture('http://192.168.1.2:3000')
  await f.start('http://192.168.1.10:3000')
  assert.equal(await f.resolve(1, 'http://192.168.1.10:3000/video'), null)
  assert.ok(await f.resolve(1, 'http://192.168.1.2:3000/video'))
})

test('writing a private instance setting cannot authorize Cast without native consent', async () => {
  const f = await fixture('')
  f.setDefault('http://192.168.1.10:3000/invidious')
  f.setConsent(false)
  await f.start(undefined)
  assert.equal(await f.resolve(1, 'http://192.168.1.10:3000/invidious/video'), null)
  assert.equal(f.prompts.length, 1)
})

test('declining private source consent stops startup before the receiver is launched', async () => {
  const f = await fixture('http://192.168.1.10:3000/invidious')
  f.setConsent(false)
  const result = await f.api.start(() => ({ source: { url: 'http://192.168.1.10:3000/invidious/video' } }))
  assert.match(result.error, /not authorized/)
  assert.equal(f.resolvers.size, 0)
})

test('approved private Cast access stays inside the configured instance path', async () => {
  const f = await fixture('http://user:secret@192.168.1.10:3000/invidious/')
  await f.start(undefined)
  assert.ok(await f.resolve(1, 'http://192.168.1.10:3000/invidious/video'))
  assert.equal(await f.resolve(1, 'http://192.168.1.10:3000/admin'), null)
  assert.equal(await f.resolve(1, 'http://192.168.1.10:3000/invidious-other/video'), null)
  for (const path of ['invidious/%2e%2e%2fadmin', 'invidious/%252e%252e%252fadmin', 'invidious/%5c..%5cadmin']) {
    assert.equal(await f.resolve(1, `http://192.168.1.10:3000/${path}`), null)
  }
  assert.equal(f.prompts.length, 1)
  assert.ok(!f.prompts[0].message.includes('secret'))
})

test('private approval is shared by concurrent requests but not later Cast sessions', async () => {
  const f = await fixture('http://192.168.1.10:3000/invidious')
  let answer
  f.holdConsent(new Promise(resolve => { answer = resolve }))
  await f.start(undefined)
  const first = f.resolve(1, 'http://192.168.1.10:3000/invidious/video')
  const second = f.resolve(1, 'http://192.168.1.10:3000/invidious/audio')
  while (!f.prompts.length) await new Promise(resolve => setImmediate(resolve))
  answer({ response: 1 })
  assert.ok(await first)
  assert.ok(await second)
  assert.equal(f.prompts.length, 1)
  f.holdConsent(null)
  f.setConsent(false)
  await f.start(undefined)
  assert.equal(await f.resolve(1, 'http://192.168.1.10:3000/invidious/video'), null)
  assert.equal(f.prompts.length, 2)
})

test('a destroyed Cast owner cannot accept an outstanding private-network prompt', async () => {
  const f = await fixture('http://192.168.1.10:3000/invidious')
  let answer
  f.holdConsent(new Promise(resolve => { answer = resolve }))
  await f.api.start(() => ({}))
  const resolving = f.resolve(1, 'http://192.168.1.10:3000/invidious/video')
  while (!f.prompts.length) await new Promise(resolve => setImmediate(resolve))
  f.destroy()
  answer({ response: 1 })
  assert.equal(await resolving, null)
})

test('public media and private resources outside the instance path never request private consent', async () => {
  const f = await fixture('http://192.168.1.10:3000/invidious')
  await f.start(undefined)
  assert.ok(await f.resolve(1, 'http://8.8.8.8/video'))
  assert.equal(await f.resolve(1, 'http://192.168.1.10:3000/other/video'), null)
  assert.equal(f.prompts.length, 0)
})


test('Cast grants are single-use and cancelled preparation cannot start', async () => {
  const f = await fixture('')
  const first = await f.prepare()
  assert.equal((await f.complete(first.preparationId)).castId, 'cast-1')
  assert.match((await f.complete(first.preparationId)).error, /not authorized/)
  const cancelled = await f.prepare()
  f.cancel(cancelled.preparationId)
  assert.match((await f.complete(cancelled.preparationId)).error, /not authorized/)
})

test('Cast grants reject another frame, owner, or a forged identifier', async () => {
  const f = await fixture('')
  const preparation = await f.prepare()
  assert.match((await f.complete('unrecognized')).error, /not authorized/)
  f.changeFrame(2)
  assert.match((await f.complete(preparation.preparationId)).error, /not authorized/)
  f.changeFrame(undefined)
  f.changeOwner(2)
  assert.match((await f.complete(preparation.preparationId)).error, /not authorized/)
  f.changeOwner(1)
  assert.equal((await f.complete(preparation.preparationId)).castId, 'cast-1')
})


test('closing the owner discards a pending Cast preparation grant', async () => {
  const f = await fixture('')
  const preparation = await f.prepare()
  f.destroy()
  assert.match((await f.complete(preparation.preparationId)).error, /not authorized/)
  assert.equal(f.resolvers.size, 0)
})
