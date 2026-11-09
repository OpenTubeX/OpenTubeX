import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
function method(name, next) {
  return source.slice(source.indexOf(`    ${name}:`), source.indexOf(`    ${next}`))
}

for (const [android, backend, mode] of [[false, 'Local', 'video'], [true, 'Invidious', 'audio']]) {
  test(`${android ? 'Android' : 'Electron'} ${backend} plays downloaded ${mode} without waiting for metadata`, async () => {
    let requests = 0
    const pendingMetadata = () => { requests++; return new Promise(() => {}) }
    const methods = runInNewContext(`({
      ${method('applyDownloadedPlaybackSource', 'cacheOnlinePlaybackSource')}
      ${method('finishDownloadedPlaybackWithoutMetadata', 'onMountedDependOnLocalStateLoading()')}
      ${method('getVideoInformationLocal', 'getVideoInformationInvidious')}
      ${method('getVideoInformationInvidious', 'async runIpBlockRecoveryScriptAndReload()')}
    })`, {
      process: { env: { IS_CAPACITOR: android } },
      Capacitor: { convertFileSrc: path => path.replace('content:/', 'https://localhost/_capacitor_content_') },
      DOWNLOADED_MEDIA_MIME_TYPES: { mp4: 'video/mp4' },
      getConnectionState: () => 'offline',
      initializeNetworkRecovery: () => ({ ready: Promise.resolve(false) }),
      getLocalVideoInfo: pendingMetadata,
      invidiousGetVideoInformation: pendingMetadata,
    })
    const watch = {
      ...methods,
      firstLoad: true,
      isLoading: true,
      videoLoadGeneration: 0,
      videoId: 'downloaded1',
      tabRoute: { params: { id: 'downloaded1' }, query: { downloadId: '1' } },
      $store: { getters: { getYtDlpDownloads: { 1: {
        id: 1, videoId: 'downloaded1', title: 'Offline video', status: 'completed', mode,
        files: [{ path: android ? 'content://downloads/document/1' : '/downloads/video.mp4', videoId: 'downloaded1', extension: 'mp4', duration: 42 }],
      } } } },
      playbackSourceKey: 0,
      isCurrentVideoLoad(generation) { return generation === this.videoLoadGeneration },
      cacheOnlinePlaybackSource() {},
      updateTitle() {},
      initializePlaybackRate() {},
      initializeVideoQuality() {},
      t: key => key,
    }
    await watch[`getVideoInformation${backend}`]()
    assert.equal(watch.isLoading, false, 'local playback must not wait for a metadata request that stays queued offline')
    assert.equal(watch.localFilePlayback, true)
    assert.equal(watch.videoTitle, 'Offline video')
    assert.equal(watch.videoLengthSeconds, 42)
    const url = mode === 'audio' ? watch.manifestSrc : watch.legacyFormats[0].url
    assert.equal(url, android ? 'https://localhost/_capacitor_content_/downloads/document/1' : 'downloadmedia://file/1/downloaded1')
    assert.equal(requests, 0)
  })
}

for (const backend of ['Local', 'Invidious']) {
  test(`${backend} keeps online metadata and switches to the download if the connection fails`, async () => {
    let resolveMetadata
    let metadataStarted
    const started = new Promise(resolve => { metadataStarted = resolve })
    let requests = 0
    const pendingMetadata = () => { requests++; metadataStarted(); return new Promise(resolve => { resolveMetadata = resolve }) }
    const methods = runInNewContext(`({
      ${method('getVideoInformationLocal', 'getVideoInformationInvidious')}
      ${method('getVideoInformationInvidious', 'async runIpBlockRecoveryScriptAndReload()')}
      ${source.slice(source.indexOf('    handleDownloadConnectionChange('), source.indexOf('    handleUpcomingPlaylistVideosChange('))}
    })`, {
      getConnectionState: () => 'online',
      initializeNetworkRecovery: () => ({ ready: Promise.resolve(true) }),
      getLocalVideoInfo: pendingMetadata,
      invidiousGetVideoInformation: pendingMetadata,
    })
    let localLoads = 0
    const watch = {
      ...methods,
      abortAutoplayCountdown() {},
      firstLoad: true,
      isLoading: true,
      videoLoadGeneration: 0,
      tabRoute: { params: { id: 'downloaded1' } },
      finishDownloadedPlaybackWithoutMetadata() { localLoads++; this.isLoading = false; this.localFilePlayback = true; return true },
      isCurrentVideoLoad(generation) { return generation === this.videoLoadGeneration },
      scheduleDownloadedPlaybackFallback() {},
      settleDownloadedPlaybackFallback: () => false,
    }
    watch[`getVideoInformation${backend}`]()
    await started
    assert.equal(requests, 1, 'online downloads retain their normal metadata request')
    assert.equal(localLoads, 0)
    watch.handleDownloadConnectionChange({ detail: 'offline' })
    assert.equal(localLoads, 1)
    assert.equal(watch.isLoading, false)
    assert.equal(watch.localFilePlayback, true)
    assert.equal(watch.videoLoadGeneration, 2, 'the pending metadata load can no longer replace local playback')
    resolveMetadata({})
    for (let i = 0; i < 5; i++) await Promise.resolve()
    assert.equal(localLoads, 1)
    watch.handleDownloadConnectionChange({ detail: 'offline' })
    assert.equal(localLoads, 1, 'connection updates do not restart an already playing file')
  })
}

for (const backend of ['Local', 'Invidious']) {
  test(`${backend} plays the download while online metadata keeps retrying`, async () => {
    let rejectMetadata
    let metadataStarted
    const started = new Promise(resolve => { metadataStarted = resolve })
    const pendingMetadata = () => { metadataStarted(); return new Promise((resolve, reject) => { rejectMetadata = reject }) }
    const timers = new Map()
    const methods = runInNewContext(`({
      ${method('getVideoInformationLocal', 'getVideoInformationInvidious')}
      ${method('getVideoInformationInvidious', 'async runIpBlockRecoveryScriptAndReload()')}
      ${method('scheduleDownloadedPlaybackFallback', 'onMountedDependOnLocalStateLoading()')}
    })`, {
      DOWNLOADED_PLAYBACK_METADATA_TIMEOUT_MS: 3000,
      setTimeout: (callback, delay) => { const id = timers.size + 1; timers.set(id, { callback, delay }); return id },
      clearTimeout: id => timers.delete(id),
      getConnectionState: () => 'online',
      initializeNetworkRecovery: () => ({ ready: Promise.resolve(true) }),
      getLocalVideoInfo: pendingMetadata,
      invidiousGetVideoInformation: pendingMetadata,
      process: { env: { SUPPORTS_LOCAL_API: true } },
      usesInvidiousApi: () => backend === 'Invidious',
      console: { error() {} },
    })
    let localLoads = 0
    const watch = {
      ...methods,
      firstLoad: true,
      isLoading: true,
      videoLoadGeneration: 1,
      tabRoute: { params: { id: 'downloaded1' }, query: { downloadId: '1' } },
      backendPreference: backend.toLowerCase(),
      customShortsPlayerActive: false,
      finishDownloadedPlaybackWithoutMetadata() {
        localLoads++
        this.isLoading = false
        this.localFilePlayback = true
        this.downloadedPlaybackWithoutMetadata = true
        return true
      },
      isCurrentVideoLoad(generation) { return generation === this.videoLoadGeneration },
      runIpBlockRecoveryScriptAndReload: async () => false,
      getRestrictedPlaybackErrorType: () => null,
    }
    const load = watch[`getVideoInformation${backend}`](1)
    await started
    assert.deepEqual([...timers.values()].map(timer => timer.delay), [3000])
    assert.equal(localLoads, 0, 'metadata that arrives in time keeps its normal load')
    for (const { callback } of timers.values()) callback()
    assert.equal(localLoads, 1)
    assert.equal(watch.isLoading, false)
    assert.equal(watch.videoLoadGeneration, 1, 'the pending request can still fill in the metadata')
    rejectMetadata(new Error('Video unavailable'))
    await load
    assert.equal(localLoads, 1, 'a late metadata failure must not reload the playing file')
    assert.equal(watch.errorMessage, undefined)
    assert.equal(timers.size, 0)
  })
}

test('a download waits for its metadata while only family friendly videos are allowed', () => {
  const timers = []
  const methods = runInNewContext(`({ ${method('scheduleDownloadedPlaybackFallback', 'onMountedDependOnLocalStateLoading()')} })`, {
    DOWNLOADED_PLAYBACK_METADATA_TIMEOUT_MS: 3000,
    setTimeout: callback => timers.push(callback),
    clearTimeout() {},
  })
  for (const showFamilyFriendlyOnly of [true, false]) {
    const watch = { ...methods, showFamilyFriendlyOnly, tabRoute: { query: { downloadId: '1' } } }
    watch.scheduleDownloadedPlaybackFallback(1, 'downloaded1')
  }
  assert.equal(timers.length, 1, 'only the unrestricted page plays the download before its metadata')
})

test('a download keeps waiting when family friendly mode is turned on during the timeout', () => {
  let fallback
  let played = false
  const methods = runInNewContext(`({ ${method('scheduleDownloadedPlaybackFallback', 'onMountedDependOnLocalStateLoading()')} })`, {
    DOWNLOADED_PLAYBACK_METADATA_TIMEOUT_MS: 3000,
    setTimeout: callback => { fallback = callback },
    clearTimeout() {},
  })
  const watch = {
    ...methods,
    showFamilyFriendlyOnly: false,
    isLoading: true,
    localFilePlayback: false,
    tabRoute: { query: { downloadId: '1' } },
    isCurrentVideoLoad: () => true,
    finishDownloadedPlaybackWithoutMetadata() { played = true },
  }
  watch.scheduleDownloadedPlaybackFallback(1, 'downloaded1')
  watch.showFamilyFriendlyOnly = true
  fallback()
  assert.equal(played, false)
})

test('metadata that arrives after a download started playing is cached', () => {
  const methods = runInNewContext(`({ ${method('finishMetadataLoad', 'settleDownloadedPlaybackFallback')} })`)
  for (const [downloadedPlaybackWithoutMetadata, isLoading, expected] of [[true, false, 1], [false, true, 0]]) {
    let cached = 0
    const watch = { ...methods, downloadedPlaybackWithoutMetadata, isLoading, updateVideoMetadataCache() { cached++ } }
    watch.finishMetadataLoad()
    assert.deepEqual([cached, watch.isLoading, watch.downloadedPlaybackWithoutMetadata], [expected, false, false])
  }
})

test('history keeps its stored metadata while a download plays without metadata', () => {
  const saved = []
  const methods = runInNewContext(`({ ${method('addToHistory', 'keepHistoryEntryAlive(')} })`, { Date })
  const watch = {
    ...methods,
    localFilePlayback: true,
    downloadedPlaybackWithoutMetadata: true,
    // The fallback takes the channel from the history entry.
    channelId: 'channel',
    videoTitle: 'Offline download',
    videoDescription: '',
    videoViewCount: null,
    historyEntry: { videoId: 'downloaded1', title: 'Stored title', authorId: 'channel', description: 'Stored description', viewCount: 42 },
    videoId: 'downloaded1',
    updateHistory: record => saved.push(record),
  }
  watch.addToHistory(10, false)
  assert.deepEqual([saved[0].title, saved[0].description, saved[0].viewCount], ['Stored title', 'Stored description', 42])
})

for (const android of [false]) {
  test(`${android ? 'Android' : 'Electron'} selects the requested path among duplicate downloaded video IDs`, () => {
    const methods = runInNewContext(`({ ${method('applyDownloadedPlaybackSource', 'cacheOnlinePlaybackSource')} })`, {
      process: { env: { IS_CAPACITOR: android } },
      Capacitor: { convertFileSrc: path => `native:${path}` },
      DOWNLOADED_MEDIA_MIME_TYPES: { webm: 'video/webm' },
    })
    const files = [
      { videoId: 'dupevideo01', path: '/downloads/First.webm', available: true, title: 'First local take', author: 'First Channel', authorId: 'first-channel' },
      { videoId: 'dupevideo01', path: '/downloads/Later #2.webm', available: true, title: 'Later local take', author: 'Later Channel', authorId: 'later-channel' },
    ]
    const watch = {
      ...methods, videoId: 'dupevideo01', tabRoute: { query: { downloadId: '43', downloadFilePath: files[1].path } },
      $store: { getters: { getYtDlpDownloads: { 43: { status: 'completed', mode: 'video', files } } } },
      downloadedPlaybackWithoutMetadata: true, videoTitle: files[0].title, channelName: files[0].author, channelId: files[0].authorId,
      initializePlaybackRate() {}, initializeVideoQuality() {}, updateTitle() {},
      cacheOnlinePlaybackSource() {}, playbackSourceKey: 0, t: key => key,
    }
    assert.equal(watch.applyDownloadedPlaybackSource(), files[1])
    assert.equal(watch.legacyFormats[0].url, android
      ? `native:${files[1].path}`
      : `downloadmedia://file/43/dupevideo01?path=${encodeURIComponent(files[1].path)}`)
    assert.equal(watch.videoTitle, files[1].title)
    assert.equal(watch.channelName, files[1].author)
    assert.equal(watch.channelId, files[1].authorId)
    watch.tabRoute.query.downloadFilePath = files[0].path
    assert.equal(watch.applyDownloadedPlaybackSource(), files[0])
    assert.equal(watch.videoTitle, files[0].title)
    assert.equal(watch.channelName, files[0].author)
    watch.videoTitle = 'Logical video metadata'
    watch.applyDownloadedPlaybackSource(43, null)
    assert.equal(watch.videoTitle, 'Logical video metadata', 'Format controls preserve the video metadata')
    watch.tabRoute.query.downloadFilePath = '/downloads/Missing.webm'
    assert.equal(watch.applyDownloadedPlaybackSource(), false, 'An explicit missing path must not select a different copy')
  })
}

test('Electron protocol lookup accepts only the requested file recorded in the download', async () => {
  const mainSource = await readFile(new URL('../../src/main/ytDlpDownloads.js', import.meta.url), 'utf8')
  const start = mainSource.indexOf('export async function getYtDlpDownloadFile(')
  const files = [
    { videoId: 'dupevideo01', path: '/downloads/First.webm' },
    { videoId: 'dupevideo01', path: '/downloads/Later #2.webm' },
  ]
  const existing = new Set([...files.map(file => file.path), '/private/unrecorded.webm'])
  const lookup = runInNewContext(`${mainSource.slice(start, mainSource.indexOf('\n/**', start)).replace('export ', '')}\ngetYtDlpDownloadFile`, {
    ID_REGEX: /^[\w-]{11}$/, loadDownloadRecords: async () => {},
    downloadRecords: new Map([[43, { status: 'completed', mode: 'video', files }]]),
    getDownloadFiles: record => record.files, existsSync: path => existing.has(path),
  })
  assert.equal((await lookup(43, 'dupevideo01', files[1].path)).path, files[1].path)
  assert.equal((await lookup(43, 'dupevideo01')).path, files[0].path, 'Existing routes keep their first-file behavior')
  assert.equal(await lookup(43, 'dupevideo01', '/private/unrecorded.webm'), null)
  existing.delete(files[1].path)
  assert.equal(await lookup(43, 'dupevideo01', files[1].path), null, 'A deleted selected file must not fall back to the first copy')
})
