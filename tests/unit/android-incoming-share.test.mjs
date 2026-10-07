import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { extractSharedYoutubeLink } from '../../src/renderer/helpers/sharedYoutubeLink.js'
import { parseHistoryRepairPlayer } from '../../src/historyRepair.js'

const app = readFileSync('src/renderer/App.vue', 'utf8')
const component = readFileSync('src/renderer/components/SharedYoutubeLinkPrompt/SharedYoutubeLinkPrompt.vue', 'utf8')
const handler = app.slice(app.indexOf('async function handleAndroidSharedText('), app.indexOf('async function enableCapacitorIntegrations()'))
const actions = component.slice(component.indexOf('async function loadVideo('), component.indexOf('</script>'))
const receiverSource = readFileSync('src/renderer/helpers/androidIncomingShare.js', 'utf8')
const initializeReceiver = compileFunction(`${receiverSource.slice(receiverSource.indexOf('export async')).replace('export async', 'async')}\nreturn initializeAndroidIncomingShare`, ['AndroidShare'])
const id = 'abcdefghijk'
const video = { videoId: id, title: 'Shared video', lengthSeconds: 120, author: 'Channel', authorId: 'UC-channel', published: 100, liveNow: false }

test('receiver delivers retained cold-start and warm shares and removes its listener', async () => {
  const received = []
  let listener
  let removed = false
  const initialize = initializeReceiver({
    addListener: async (name, callback) => {
      assert.equal(name, 'sharedText')
      listener = callback
      callback({ text: 'Cold share' })
      return { remove() { removed = true } }
    }
  })
  const remove = await initialize(async text => received.push(text))
  listener({ text: 'Warm share' })
  assert.deepEqual(received, ['Cold share', 'Warm share'])
  remove()
  assert.equal(removed, true)
})

test('non-Android builds do not subscribe to incoming shares', async () => {
  const cleanup = await initializeReceiver(null)(async () => assert.fail('No Android share event expected'))
  cleanup()
})

test('shared text finds YouTube URLs among titles, punctuation and unrelated links', () => {
  for (const text of [
    `https://youtu.be/${id}?t=42`,
    `A title\nhttps://youtu.be/${id}?t=42`,
    `Read https://example.com first, then (https://youtu.be/${id}?t=42).`,
  ]) assert.equal(extractSharedYoutubeLink(text), `https://youtu.be/${id}?t=42`)
  for (const host of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']) {
    assert.equal(extractSharedYoutubeLink(`${host}/watch?v=${id}`), `http://${host}/watch?v=${id}`)
  }
  assert.equal(extractSharedYoutubeLink(`https://www.youtube.com/shorts/${id}`), `https://www.youtube.com/shorts/${id}`)
  assert.equal(extractSharedYoutubeLink(`https://www.youtube.com/live/${id}`), `https://www.youtube.com/live/${id}`)
})

test('shared text rejects unsupported hosts, credentials and missing links', () => {
  for (const text of [undefined, '', 'Just a title', `https://youtube.com.evil.test/watch?v=${id}`, `https://evil.test/watch?v=${id}`, `https://user:pass@youtube.com/watch?v=${id}`, 'mailto:test@youtube.com', `https://youtube.com:999999/watch?v=${id}`]) {
    assert.equal(extractSharedYoutubeLink(text), null, text)
  }
})

function shareHandler(dispatch) {
  const state = { value: null }
  const opened = []
  const toasts = []
  const { share, open } = compileFunction(`let sharedYoutubeLinkId = 0\n${handler}\nreturn { share: handleAndroidSharedText, open: openSharedYoutubeLink }`, ['sharedYoutubeLink', 'store', 'extractSharedYoutubeLink', 'showToast', 't', 'handleYoutubeLink'])(
    state, { dispatch }, extractSharedYoutubeLink, toast => toasts.push(toast), key => key, url => opened.push(url)
  )
  return { state, opened, toasts, share, open }
}

test('shares show actions before navigation and repeated shares reopen the dialog', async () => {
  const h = shareHandler(async () => ({ urlType: 'video', videoId: id }))
  const url = `https://youtu.be/${id}?t=42&list=PL-test`
  await h.share(url)
  const firstId = h.state.value.id
  assert.equal(h.state.value.url, url)
  assert.deepEqual(h.opened, [])
  await h.share(url)
  assert.ok(h.state.value.id > firstId)
  h.open()
  assert.deepEqual(h.opened, [url])
  assert.equal(h.state.value, null)
})

test('latest share wins over an older asynchronous URL resolution', async () => {
  let resolveFirst
  const first = new Promise(resolve => { resolveFirst = resolve })
  const h = shareHandler(async (_, url) => url.includes(id) ? first : { urlType: 'video', videoId: '12345678901' })
  const pending = h.share(`https://youtu.be/${id}`)
  await h.share('https://youtu.be/12345678901')
  resolveFirst({ urlType: 'video', videoId: id })
  await pending
  assert.equal(h.state.value.videoId, '12345678901')
})

test('invalid shared text and malformed video IDs show feedback without navigation', async () => {
  const h = shareHandler(async () => ({ urlType: 'video', videoId: 'invalid' }))
  await h.share('No link')
  await h.share('https://youtube.com/watch?v=invalid')
  assert.equal(h.state.value, null)
  assert.equal(h.toasts.length, 2)
  assert.deepEqual(h.opened, [])
})

function videoActions({ backend = 'local', fallback = false, local, invidious } = {}) {
  const controller = new AbortController()
  const loading = { value: false }
  const failed = { value: false }
  const calls = []
  const emitted = []
  const store = {
    getters: { getBackendPreference: backend, getBackendFallback: fallback },
    dispatch: async (...args) => calls.push(args),
    commit: (...args) => calls.push(args)
  }
  const add = compileFunction(`${actions}\nreturn addVideo`, ['props', 'store', 'controller', 'loading', 'failed', 'getLocalHistoryMetadata', 'getInvidiousHistoryMetadata', 'parseHistoryRepairPlayer', 'emit', 'showToast', 't', 'console'])(
    { videoId: id }, store, controller, loading, failed,
    local ?? (async () => ({ videoDetails: { videoId: id, title: video.title, author: video.author, channelId: video.authorId, lengthSeconds: '120' } })),
    invidious ?? (async () => video), parseHistoryRepairPlayer,
    event => emitted.push(event), () => {}, key => key, { error() {} }
  )
  return { add, calls, emitted, failed, loading, controller }
}

test('local metadata queues the shared video without starting playback', async () => {
  const h = videoActions()
  await h.add('queue')
  assert.equal(h.calls[0][0], 'addVideoToWatchQueue')
  assert.equal(h.calls[0][1].video.videoId, id)
  assert.equal(h.calls[0][1].video.title, video.title)
  assert.equal(h.calls[0][1].video.lengthSeconds, 120)
  assert.deepEqual(h.emitted, ['close'])
})

test('Invidious metadata opens the existing playlist picker', async () => {
  const h = videoActions({ backend: 'invidious', local: () => assert.fail('Local API must not run') })
  await h.add('playlist')
  assert.equal(h.calls[0][0], 'showAddToPlaylistPromptForManyVideos')
  assert.equal(h.calls[0][1].videos[0].videoId, id)
  assert.equal(h.calls[0][1].videos[0].published, 100000)
  assert.deepEqual(h.emitted, ['close'])
})

test('metadata failure leaves the dialog available and honors backend fallback', async () => {
  const local = async () => { throw new Error('Unavailable') }
  const failed = videoActions({ local })
  await failed.add('queue')
  assert.equal(failed.failed.value, true)
  assert.deepEqual(failed.calls, [])
  assert.deepEqual(failed.emitted, [])
  const fallback = videoActions({ local, fallback: true })
  await fallback.add('queue')
  assert.equal(fallback.calls.length, 1)
})

test('Invidious failure uses local metadata for both actions only when fallback is enabled', async () => {
  for (const action of ['queue', 'playlist']) {
    for (const fallback of [false, true]) {
      let localLoads = 0
      const h = videoActions({
        backend: 'invidious',
        fallback,
        invidious: async () => { throw new Error('Instance unavailable') },
        local: async () => {
          localLoads++
          return { videoDetails: { videoId: id, title: video.title, author: video.author, channelId: video.authorId, lengthSeconds: '120' } }
        }
      })
      await h.add(action)
      assert.equal(localLoads, fallback ? 1 : 0)
      assert.equal(h.failed.value, !fallback)
      assert.equal(h.calls.length, fallback ? 1 : 0)
      if (fallback) {
        const queuedVideo = action === 'queue' ? h.calls[0][1].video : h.calls[0][1].videos[0]
        assert.equal(queuedVideo.title, video.title)
        assert.equal(queuedVideo.lengthSeconds, 120)
        assert.deepEqual(h.emitted, ['close'])
      }
    }
  }
})

test('cancelled Invidious requests do not attempt a local fallback', async () => {
  const h = videoActions({
    backend: 'invidious',
    fallback: true,
    invidious: async () => {
      h.controller.abort()
      throw new Error('Cancelled')
    },
    local: () => assert.fail('Cancellation must not load another backend')
  })
  await h.add('queue')
  assert.deepEqual(h.calls, [])
  assert.equal(h.failed.value, false)
})

test('closing during metadata loading prevents later actions and duplicate taps', async () => {
  let resolve
  const pending = new Promise(done => { resolve = done })
  let loads = 0
  const h = videoActions({ backend: 'invidious', invidious: async () => { loads++; return pending } })
  const first = h.add('queue')
  await h.add('queue')
  h.controller.abort()
  resolve(video)
  await first
  assert.equal(loads, 1)
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.emitted, [])
  assert.equal(h.failed.value, false)
})
