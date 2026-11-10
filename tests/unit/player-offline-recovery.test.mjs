import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { isRecoverableNetworkError } from '../../src/renderer/helpers/networkRecovery.js'
import { getGoogleVideoProbeUrl } from '../../src/renderer/helpers/player/googleVideoFallback.js'

const watchSource = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const start = watchSource.indexOf('    handlePlayerError: async function (error) {')
const end = watchSource.indexOf('\n    /**', start)
const playerSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')

test('offline HTTP failure preserves the stream for Failed to fetch', async () => {
  const handle = vm.runInNewContext(`({${watchSource.slice(start, end)}}).handlePlayerError`, {
    navigator: { onLine: false }, shaka: { util: { Error: { Code: { HTTP_ERROR: 1002 } } } }
  })
  let retries = 0
  const view = {
    isLoading: false,
    isAndroidTransientHttpRecoveryEnabled: () => true,
    retryAndroidTransientHttpError: async () => { retries++; return true }
  }
  const error = { code: 1002, data: ['https://example.invalid/segment', { message: 'Failed to fetch' }] }
  await handle.call(view, error)
  await handle.call(view, error)
  assert.equal(retries, 0, 'offline errors must not spend the transient retry or reach format fallback')
})

test('online HTTP failures that are not lost connections still use the bounded transient recovery', async () => {
  const handle = vm.runInNewContext(`({${watchSource.slice(start, end)}}).handlePlayerError`, {
    navigator: { onLine: true }, shaka: { util: { Error: { Code: { HTTP_ERROR: 1002 } } } }, isRecoverableNetworkError
  })
  let retries = 0
  let waits = 0
  await handle.call({
    isLoading: false,
    retryStreamWhenReachable: async () => { waits++; return true },
    isAndroidTransientHttpRecoveryEnabled: () => true,
    retryAndroidTransientHttpError: async () => { retries++; return true }
  }, { code: 1002, data: ['https://example.invalid/segment', new Error('Incomplete segment, missing MEDIA_END part')] })
  assert.deepEqual({ waits, retries }, { waits: 0, retries: 1 })
})

function createUnreachableStreamView() {
  const methodsStart = watchSource.indexOf('    async retryStreamWhenReachable(error, onlyIfUnreachable = false) {')
  const methodsEnd = watchSource.indexOf('\n    isAndroidTransientHttpRecoveryEnabled', methodsStart)
  const waits = []
  const methods = vm.runInNewContext(`({${watchSource.slice(start, end)}${watchSource.slice(methodsStart, methodsEnd)}})`, {
    navigator: { onLine: true },
    shaka: { util: { Error: { Code: { HTTP_ERROR: 1002, BAD_HTTP_STATUS: 1001, VIDEO_ERROR: 3016, TIMEOUT: 1003 } } } },
    isRecoverableNetworkError,
    getGoogleVideoProbeUrl,
    AbortController,
    URL,
    console: { warn () {} },
    // Resolves once the test makes the server reachable again
    waitUntilReachable: (url, signal) => new Promise((resolve, reject) => {
      waits.push({ url, resolve, reject })
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })
  })
  const player = {
    retries: 0,
    retryStreaming () { this.retries++; return true },
    getSabrReloadState: () => ({}),
    // A SABR redirect moved the stream from the server in the watch page's data
    getSabrUrl: () => 'https://rr1---sn-abc.googlevideo.com/videoplayback?mn=sn-abc,sn-def&fvip=2'
  }
  const view = {
    ...methods,
    isLoading: false,
    videoId: 'video',
    activePlaybackEngine: 'built-in',
    activeFormat: 'dash',
    sabrData: { url: 'https://rr4---sn-original.googlevideo.com/videoplayback' },
    $refs: { player },
    playbackNetworkRetryPending: false,
    sabrErrorRecoveryAttempts: 0,
    reloads: [],
    videoLoadGeneration: 0,
    tabRoute: { params: { id: 'video' } },
    isCurrentVideoLoad (loadGeneration, videoId) {
      return loadGeneration === this.videoLoadGeneration && videoId === this.tabRoute.params.id
    },
    isSabrVideoStream: () => true,
    isAndroidTransientHttpRecoveryEnabled: () => true,
    retryAndroidTransientHttpError: async () => assert.fail('the quick Android retry must not delay recovery'),
    async reloadSabrStream (payload, message) {
      this.reloads.push(message)
      this.sabrErrorRecoveryAttempts++
      this.isLoading = true
      return true
    }
  }
  return { view, player, waits }
}

const lostConnection = () => ({ code: 1002, data: ['sabr://video', new TypeError('network error'), 1] })

test('an unreachable stream server keeps the player and retries it in place without spending recovery budgets', async () => {
  const { view, player, waits } = createUnreachableStreamView()
  const handled = view.handlePlayerError(lostConnection())
  await Promise.resolve()
  assert.deepEqual(waits.map(wait => wait.url), ['https://rr1---sn-abc.googlevideo.com/generate_204'])
  assert.equal(view.playbackNetworkWaitOrigin, 'https://rr1---sn-abc.googlevideo.com')
  assert.deepEqual({ loading: view.isLoading, retries: player.retries, reloads: view.reloads, budget: view.sabrErrorRecoveryAttempts },
    { loading: false, retries: 0, reloads: [], budget: 0 }, 'waiting must neither reload nor retry the stream')

  waits[0].resolve()
  await handled
  assert.deepEqual({ retries: player.retries, reloads: view.reloads, budget: view.sabrErrorRecoveryAttempts, origin: view.playbackNetworkWaitOrigin },
    { retries: 1, reloads: [], budget: 0, origin: null })

  // The retried stream failed again before playing, so it needs fresh data
  await view.handlePlayerError(lostConnection())
  assert.equal(waits.length, 1)
  assert.deepEqual(view.reloads, ['Refreshing SABR stream after playback error: [PLAYER_ERROR: 1002]'])
})

test('a timeout waits for an unreachable stream server but reloads a stuck stream at once', async () => {
  const timeout = () => ({ code: 1003, data: ['sabr://video', 1] })
  const { view, player, waits } = createUnreachableStreamView()
  const handled = view.handlePlayerError(timeout())
  await Promise.resolve()
  assert.equal(waits.length, 1)
  assert.deepEqual(view.reloads, [], 'the wait must not spend the SABR recovery budget')
  waits[0].resolve(true)
  await handled
  assert.deepEqual({ retries: player.retries, reloads: view.reloads }, { retries: 1, reloads: [] })

  const stuck = createUnreachableStreamView()
  const stuckHandled = stuck.view.handlePlayerError(timeout())
  await Promise.resolve()
  stuck.waits[0].resolve(false)
  await stuckHandled
  assert.deepEqual({ retries: stuck.player.retries, reloads: stuck.view.reloads.length }, { retries: 0, reloads: 1 })
})

test('navigation during the wait neither retries nor reloads the outgoing stream', async () => {
  const { view, player, waits } = createUnreachableStreamView()
  const error = { code: 1003, data: ['sabr://video', 1] }
  const handled = view.handlePlayerError(error)
  await Promise.resolve()
  // The route changed and the new load awaits cleanup before it replaces the player
  view.videoLoadGeneration++
  view.tabRoute = { params: { id: 'next' } }
  waits[0].resolve(false)
  await handled
  assert.deepEqual({ retries: player.retries, reloads: view.reloads }, { retries: 0, reloads: [] })
  assert.equal(view.playbackNetworkWaitError, error, 'a retained Short must receive the error when navigation hands it over')
})

test('a stream whose in-place retry cannot start reloads once the server answers', async () => {
  const { view, player, waits } = createUnreachableStreamView()
  player.retryStreaming = () => false
  const handled = view.handlePlayerError(lostConnection())
  await Promise.resolve()
  assert.deepEqual(view.reloads, [])
  waits[0].resolve()
  await handled
  assert.deepEqual(view.reloads, ['Refreshing SABR stream after playback error: [PLAYER_ERROR: 1002]'])
})

test('a wait that fails without being cancelled falls back to the reload', async () => {
  const { view, player, waits } = createUnreachableStreamView()
  view.isAndroidTransientHttpRecoveryEnabled = () => false
  const handled = view.handlePlayerError(lostConnection())
  await Promise.resolve()
  waits[0].reject(new Error('certificate rejected'))
  await handled
  assert.deepEqual({ retries: player.retries, reloads: view.reloads, origin: view.playbackNetworkWaitOrigin },
    { retries: 0, reloads: ['Refreshing SABR stream after playback error: [PLAYER_ERROR: 1002]'], origin: null })
})

test('a replaced player ends the wait without retrying or reloading', async () => {
  const { view, player, waits } = createUnreachableStreamView()
  const handled = view.handlePlayerError(lostConnection())
  await Promise.resolve()
  view.playbackNetworkWaitController.abort()
  view.$refs.player = { retryStreaming: () => assert.fail('the new player must not be retried') }
  await handled
  assert.deepEqual({ waits: waits.length, retries: player.retries, reloads: view.reloads, origin: view.playbackNetworkWaitOrigin },
    { waits: 1, retries: 0, reloads: [], origin: null })
})

test('playback errors that need fresh streaming data do not wait for the network', async () => {
  const { view, waits } = createUnreachableStreamView()
  view.isAndroidTransientHttpRecoveryEnabled = () => false
  await view.handlePlayerError({ code: 1002, data: ['sabr://video', new Error('Invalid PO token'), 1] })
  assert.equal(waits.length, 0)
  assert.equal(view.reloads.length, 1)
})

test('offline errors do not suppress later failures from the retained player', () => {
  const start = playerSource.indexOf('    function handleError(error, context, details) {')
  const source = playerSource.slice(start, playerSource.indexOf('    // #region seek bar markers', start))
  const Code = { HTTP_ERROR: 1002, BAD_HTTP_STATUS: 1001 }
  const Category = { NETWORK: 1, TEXT: 2 }
  const emitted = []
  const context = {
    navigator: { onLine: false },
    ignoreErrors: false,
    shortsNavigationSuspended: { value: false },
    ErrorCode: Code,
    ErrorCategory: Category,
    ErrorSeverity: { RECOVERABLE: 1 },
    shaka: { util: { Error: { Code, Category } } },
    logShakaError () {},
    props: { videoId: 'test' },
    emit: (...args) => emitted.push(args),
    tabMediaCoordinator: { setPlaybackState () {} },
    mediaTabId: 'test',
    process: { env: {} }
  }
  const handle = vm.runInNewContext(`${source}\nhandleError`, context)
  const error = { code: 1002, severity: 2, category: 1, data: ['https://example.invalid/segment', new TypeError('Load failed')] }
  handle(error, 'shaka error handler')
  assert.equal(emitted.length, 0, 'offline failure must not trigger watch-page fallback')
  assert.equal(context.ignoreErrors, false)
  context.navigator.onLine = true
  handle(error, 'shaka error handler')
  assert.equal(emitted.length, 1, 'later online failures must remain actionable')
  assert.equal(context.ignoreErrors, true)
})

for (const requestedVideoId of ['current-video', 'next-video']) {
  test(`stream recovery preserves player state only for its own video: ${requestedVideoId}`, async () => {
    const recoveryStart = watchSource.indexOf('    reloadAfterStreamErrorOnce: async function')
    const recoveryEnd = watchSource.indexOf('\n    isAndroidTransientHttpRecoveryEnabled', recoveryStart)
    const reload = vm.runInNewContext(`({${watchSource.slice(recoveryStart, recoveryEnd)}}).reloadAfterStreamErrorOnce`)
    const saved = []
    const reloads = []
    const state = { captionTimingOffset: 1.5 }
    const sameVideo = requestedVideoId === 'current-video'
    await reload.call({
      videoId: 'current-video',
      tabRoute: { params: { id: requestedVideoId } },
      beginStreamErrorRecoveryOnce: () => true,
      $refs: { player: { getSabrReloadState: () => state } },
      setPlayerReloadState: payload => saved.push(payload),
      reloadView: async options => reloads.push(options.preserveTitle)
    }, '[PLAYER_ERROR: 403]')
    assert.deepEqual(saved, sameVideo ? [state] : [])
    assert.deepEqual(reloads, [sameVideo])
  })
}
