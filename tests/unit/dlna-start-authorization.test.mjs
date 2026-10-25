import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function fixture() {
  const castIpc = await readFile(new URL('../../src/main/castIpc.js', import.meta.url), 'utf8')
  const preload = await readFile(new URL('../../src/preload/interface.js', import.meta.url), 'utf8')
  const handlers = new Map()
  const attempts = []
  const invocations = []
  let focused = true
  let finishValidation
  const event = {
    sender: { id: 1, isFocused: () => focused, isDestroyed: () => false, once() {} },
    senderFrame: { url: 'app://opentubex/index.html' }
  }
  const context = vm.createContext({
    IpcChannels: { DLNA_START: 'start' },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isOpenTubeXUrl: url => url === event.senderFrame.url,
    invidiousAuthorizations: new Map(),
    getYtDlpExternalStreamHeaders: () => ({}),
    getYtDlpExternalStreamCookieHeader: () => null,
    getDlnaFfmpegExecutable: () => new Promise((_, reject) => { finishValidation = () => reject(new Error('FFmpeg unavailable')) }),
    createMediaAddressResolver: async () => ({ privateInstance: null, resolveAddresses: async () => [{ address: '93.184.215.14', family: 4 }] }),
    startDlnaCast: async (_owner, payload) => { attempts.push(payload); return { castId: 'cast-1' } },
    stopDlnaCast: async () => {},
    console,
    URL,
    navigator: { userActivation: { isActive: true } },
    ipcRenderer: { invoke: (channel, payload) => { invocations.push(payload); return handlers.get(channel)(event, payload) } }
  })
  vm.runInContext(castIpc.slice(castIpc.indexOf('  const dlnaOwners ='), castIpc.indexOf('  ipcMain.handle(IpcChannels.DLNA_RECOVER')), context)
  const dlna = vm.runInContext(`({${preload.slice(preload.indexOf('  dlna: {'), preload.indexOf('\n  /**', preload.indexOf('  dlna: {')))}}).dlna`, context)
  return {
    dlna, attempts, invocations, context,
    finish() { finishValidation() },
    blur() { focused = false }
  }
}

const payload = {
  deviceId: 'tv', mediaUrl: 'https://media.example/video.mp4', audioUrl: 'https://media.example/audio.m4a',
  fallbackMediaUrl: 'https://media.example/complete.mp4', title: 'Video', startSeconds: 12
}

test('slow mux validation falls back within the original authorized start after focus and activation expire', async () => {
  const f = await fixture()
  const pending = f.dlna.start(payload)
  f.blur()
  f.context.navigator.userActivation.isActive = false
  f.finish()
  const result = await pending
  assert.equal(result.castId, 'cast-1')
  assert.equal(result.usedFallback, true)
  assert.equal(f.invocations.length, 1, 'fallback must stay inside the original main-process operation')
  assert.equal(f.attempts[0].mediaUrl, payload.fallbackMediaUrl)
  assert.equal(f.attempts[0].audioUrl, undefined)
  assert.equal(f.attempts[0].startSeconds, 12)
})

test('a fresh cast still requires both a user gesture and initial window focus', async () => {
  const f = await fixture()
  f.context.navigator.userActivation.isActive = false
  assert.match((await f.dlna.start(payload)).error, /user action/)
  assert.equal(f.invocations.length, 0)
  f.context.navigator.userActivation.isActive = true
  f.blur()
  assert.match((await f.dlna.start(payload)).error, /active OpenTubeX window/)
  assert.equal(f.attempts.length, 0)
})

test('a source the relay would refuse does not start a cast', async () => {
  const f = await fixture()
  f.context.createMediaAddressResolver = async () => ({ resolveAddresses: async url => url.hostname === 'media.example' ? null : [] })
  const { audioUrl, fallbackMediaUrl, ...single } = payload
  assert.match((await f.dlna.start(single)).error, /not allowed/)
  assert.equal(f.attempts.length, 0)
})
