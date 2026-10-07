import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { CompositeBuffer, UmpWriter } from 'googlevideo/ump'
import { MediaHeader, NextRequestPolicy, UMPPartId, VideoPlaybackAbrRequest } from 'googlevideo/protos'
import { concatenateChunks } from 'googlevideo/utils'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Requires a locked emulator, a current debug APK and ffmpeg. SABR receives
// UMP fixtures through native HTTP; the Android media service and lifecycle
// remain real. The debugger disconnects while the app is backgrounded.
const enabled = Boolean(process.env.ANDROID_CDP_URL && process.env.ANDROID_SERIAL?.startsWith('emulator-'))
const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, ...args], { encoding: 'utf8' })
const launch = () => adb('shell', 'am', 'start', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity')

function umpResponse(data, format, isInit, sequenceNumber = 1) {
  const buffer = new CompositeBuffer([])
  const writer = new UmpWriter(buffer)
  if (!data) {
    writer.write(UMPPartId.NEXT_REQUEST_POLICY, NextRequestPolicy.encode({ backoffTimeMs: 20000 }).finish())
  } else {
    writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
      headerId: 1, formatId: { itag: format.itag, lastModified: '0' },
      isInitSeg: isInit, sequenceNumber, contentLength: data.length,
    }).finish())
    writer.write(UMPPartId.MEDIA, Uint8Array.from([1, ...data]))
    writer.write(UMPPartId.MEDIA_END, Uint8Array.of(1))
  }
  return concatenateChunks(buffer.chunks)
}

async function mediaFixture(directory, audio) {
  const path = join(directory, audio ? 'audio.mp4' : 'video.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-f', 'lavfi', '-i',
    audio ? 'sine=frequency=440:sample_rate=44100' : 'testsrc2=size=320x180:rate=24',
    '-t', '20', ...(audio ? ['-c:a', 'aac'] : ['-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-g', '120']),
    '-movflags', 'dash+global_sidx', '-frag_duration', '5000000', path])
  const bytes = await readFile(path)
  let offset = 0
  while (bytes.toString('ascii', offset + 4, offset + 8) !== 'sidx') offset += bytes.readUInt32BE(offset)
  const indexEnd = offset + bytes.readUInt32BE(offset)
  const version = bytes[offset + 8]
  const timescale = bytes.readUInt32BE(offset + 16)
  const firstOffset = version === 0 ? bytes.readUInt32BE(offset + 24) : Number(bytes.readBigUInt64BE(offset + 28))
  const referencesOffset = offset + (version === 0 ? 30 : 38)
  const count = bytes.readUInt16BE(referencesOffset)
  let startByte = indexEnd + firstOffset
  let startTimeMs = 0
  const segments = []
  for (let i = 0; i < count; i++) {
    const position = referencesOffset + 2 + i * 12
    const size = bytes.readUInt32BE(position) & 0x7fffffff
    segments.push({ startTimeMs, data: bytes.subarray(startByte, startByte + size) })
    startTimeMs += bytes.readUInt32BE(position + 4) / timescale * 1000
    startByte += size
  }
  return {
    init: bytes.subarray(0, indexEnd), segments,
    format: {
      itag: audio ? 140 : 137, lastModified: '0', bitrate: audio ? 128000 : 500000,
      mimeType: audio ? 'audio/mp4; codecs="mp4a.40.2"' : 'video/mp4; codecs="avc1.64000c"',
      initRange: { start: 0, end: offset - 1 }, indexRange: { start: offset, end: indexEnd - 1 },
      ...(audio ? { audioSampleRate: 44100, audioChannels: 1, isOriginal: true } : { width: 320, height: 180, frameRate: 24 }),
    },
  }
}

for (const { continuePlayback, seekBeforeBackoff, backoffWhileHidden = false } of [
  { continuePlayback: true, seekBeforeBackoff: false },
  { continuePlayback: false, seekBeforeBackoff: false },
  { continuePlayback: true, seekBeforeBackoff: true },
  { continuePlayback: false, seekBeforeBackoff: false, backoffWhileHidden: true },
  { continuePlayback: true, seekBeforeBackoff: false, backoffWhileHidden: true },
]) test(`SABR backoff honors background playback ${continuePlayback ? 'enabled' : 'disabled'}${seekBeforeBackoff ? ' after a startup seek' : ''}${backoffWhileHidden ? ' with a late background response' : ''}`, { skip: !enabled }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'otx-sabr-background-'))
  let browser, page, settings, route, server, port, releaseBackoff
  try {
    const backoffReady = new Promise(resolve => { releaseBackoff = resolve })
    if (!seekBeforeBackoff && !backoffWhileHidden) releaseBackoff()
    const fixtures = await Promise.all([mediaFixture(directory, true), mediaFixture(directory, false)])
    const requests = []
    const delayed = new Set()
    launch()
    let socket
    await expect.poll(() => {
      const pid = adb('shell', 'pidof', 'org.opentubex.app.dev').trim()
      socket = `webview_devtools_remote_${pid}`
      return Boolean(pid && adb('shell', 'cat', '/proc/net/unix').includes(socket))
    }, { timeout: 15000 }).toBe(true)
    adb('forward', `tcp:${new URL(process.env.ANDROID_CDP_URL).port}`, `localabstract:${socket}`)
    browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    page = browser.contexts()[0].pages()[0]
    server = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = VideoPlaybackAbrRequest.decode(Buffer.from(Buffer.concat(chunks).toString(), 'base64'))
      const fixture = fixtures[body.clientAbrState.enabledTrackTypesBitfield === 1 ? 0 : 1]
      const media = { ...fixture, format: { ...fixture.format, itag: (body.clientAbrState.enabledTrackTypesBitfield === 1 ? body.preferredAudioFormatIds : body.preferredVideoFormatIds)[0].itag } }
      const isInit = body.selectedFormatIds.length === 0
      requests.push({ isInit, itag: media.format.itag })
      let data
      if (isInit && !delayed.has(media.format.itag)) {
        delayed.add(media.format.itag)
        await backoffReady
        data = umpResponse(null)
      } else {
        const time = Number(body.clientAbrState.playerTimeMs)
        const index = Math.max(0, media.segments.findLastIndex(segment => segment.startTimeMs <= time + 1))
        data = umpResponse(isInit ? media.init : media.segments[index].data, media.format, isInit, index + 1)
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ requestId: String(requests.length), body: Buffer.from(data).toString('base64') }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    port = server.address().port
    adb('reverse', `tcp:${port}`, `tcp:${port}`)
    await page.waitForSelector('#app .app')
    const skip = page.getByRole('button', { name: 'Skip', exact: true })
    if (await skip.isVisible()) await skip.click()
    route = await page.evaluate(() => location.hash)
    settings = await page.evaluate(({ port, continuePlayback }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = { AutoplayVideos: true, VideoPlaybackEngine: 'built-in', UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false, KeepPlayingOnNavigation: false, AndroidAutoPictureInPicture: false,
        RememberHistory: false, WatchedProgressSavingMode: 'never', ContinuePlaybackWhenScreenIsLocked: continuePlayback }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, store.getters['get' + key]]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      const responses = new Map()
      const nativePromise = window.__sabrBackgroundNativePromise ?? window.Capacitor.nativePromise
      const originalFetch = window.__sabrBackgroundFetch ?? window.fetch
      window.__sabrBackgroundNativePromise = nativePromise
      window.Capacitor.nativePromise = (plugin, method, options) => {
        if (plugin === 'SabrHttp' && method === 'prepare') return nativePromise('CapacitorHttp', 'request', {
          url: `http://127.0.0.1:${port}/sabr`, method: 'POST', data: options.body, headers: { 'Content-Type': 'text/plain' }, responseType: 'json',
        }).then(({ data: { requestId, body } }) => {
          responses.set(requestId, body)
          return { requestId }
        })
        if (plugin === 'SabrHttp' && method === 'abort') return Promise.resolve()
        return nativePromise(plugin, method, options)
      }
      window.__sabrBackgroundFetch = originalFetch
      window.fetch = (url, options) => {
        if (String(url).startsWith('/_opentubex_sabr/')) {
          const body = responses.get(String(url).split('/').at(-1))
          return Promise.resolve(new Response(Uint8Array.from(atob(body), char => char.charCodeAt(0))))
        }
        return String(url).startsWith('https://localhost/')
          ? originalFetch(url, options) : Promise.reject(new Error('Local SABR test'))
      }
      location.hash = '#/home'
      return saved
    }, { port, continuePlayback })
    await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)
    await page.evaluate(() => { location.hash = '#/watch/abcdefghijk' })
    await expect.poll(async () => {
      const watch = await page.evaluateHandle(findWatchComponent)
      try { return await watch.evaluate(c => c?.proxy.onMountedRun && c.proxy.preparingVideoLoadGeneration === null) }
      finally { await watch.dispose() }
    }).toBe(true)
    const watch = await page.evaluateHandle(findWatchComponent)
    await watch.evaluate((component, { formats }) => {
      const view = component.proxy
      view.videoLoadGeneration++
      const scheme = 'sabrbackground'
      Object.assign(view, {
        isLoading: false, ytDlpStreamsPending: false, errorMessage: null, isUpcoming: false, isLive: false,
        videoTitle: 'SABR background start regression', channelName: 'Local test', videoLengthSeconds: 20,
        activeFormat: 'dash', playabilityStatus: 'OK',
        sabrData: { scheme, url: 'https://fixture.googlevideo.com/videoplayback', poToken: '', ustreamerConfig: '', clientInfo: {} },
        manifestMimeType: 'application/sabr+json',
        manifestSrc: 'data:application/sabr+json,' + encodeURIComponent(JSON.stringify({
          scheme, duration: 20, formats, captions: [], storyboards: [], chapters: [],
        })),
      })
    }, { formats: [fixtures[0].format, fixtures[1].format, { ...fixtures[1].format, itag: 136, bitrate: 250000 }] })
    if (seekBeforeBackoff) {
      await expect.poll(() => requests.length).toBeGreaterThan(0)
      await expect.poll(() => watch.evaluate(component => {
        const player = component.proxy.$refs.player
        if (!player) return false
        player.setCurrentTime(2)
        return player.hasPlaybackPosition
      })).toBe(true)
      releaseBackoff()
    }
    await watch.dispose()
    if (backoffWhileHidden) {
      await expect.poll(() => requests.length).toBeGreaterThan(0)
      await expect.poll(() => adb('shell', 'dumpsys', 'activity', 'services', 'org.opentubex.app.dev')).toMatch(/isForeground=true/)
      await expect.poll(() => adb('shell', 'dumpsys', 'media_session')).toMatch(/PlaybackState \{state=(?:3|PLAYING\(3\)),/)
      adb('shell', 'am', 'start', '-a', 'android.settings.SETTINGS')
      // Keep CDP attached until this late response is processed, so renderer
      // suspension cannot mask the activity's 250 ms pause sweep being missed.
      await expect.poll(() => page.evaluate(() => window.Capacitor.nativePromise('App', 'getState'))).toMatchObject({ isActive: false })
      await new Promise(resolve => setTimeout(resolve, 1000))
      if (continuePlayback) {
        assert.equal(await page.locator('.ftVideoPlayer video').evaluate(video => video.paused && video.played.length === 0), true, 'leave before the first SABR response')
        await browser.close()
        browser = null
      }
      releaseBackoff()
    }
    if (browser) {
      await expect(page.locator('.countdownOverlay')).toBeVisible()
      if (backoffWhileHidden) {
        assert.equal(await page.locator('.ftVideoPlayer video').evaluate(video => video.paused && !video.autoplay), true, 'a late background response must cancel disabled autoplay')
        await expect.poll(() => adb('shell', 'dumpsys', 'media_session')).toMatch(/PlaybackState \{state=(?:2|PAUSED\(2\)),/)
      } else {
        await expect.poll(() => adb('shell', 'dumpsys', 'activity', 'services', 'org.opentubex.app.dev')).toMatch(/isForeground=true/)
      }
      assert.equal(await page.locator('.ftVideoPlayer video').evaluate(video => video.paused && video.played.length === 0), true, 'leave while autoplay is still waiting')
      await browser.close()
      browser = null
      if (!backoffWhileHidden) adb('shell', 'am', 'start', '-a', 'android.settings.SETTINGS')
    }
    // Avoid polling the WebView during the wait: CDP evaluation can wake a
    // frozen renderer and mask the lifecycle failure this test should catch.
    if (continuePlayback) {
      await expect.poll(() => {
        const state = adb('shell', 'dumpsys', 'media_session').match(/PlaybackState \{state=(?:3|PLAYING\(3\)), position=(\d+),/)
        // PLAYING is published during backoff; require a real position update
        // beyond the startup seek before reconnecting the debugger.
        return requests.some(request => !request.isInit) &&
          Number(state?.[1]) > (seekBeforeBackoff ? 2000 : 0) + 250
      }, { timeout: 60000 }).toBe(true)
    } else {
      await new Promise(resolve => setTimeout(resolve, 25000))
    }
    if (continuePlayback) {
      assert.ok(requests.some(request => !request.isInit), 'the background player must request media after its backoff')
      assert.match(adb('shell', 'dumpsys', 'media_session'), /PlaybackState \{state=(?:3|PLAYING\(3\)),/, 'native playback must be active before reconnecting the debugger')
      if (process.env.ANDROID_EVIDENCE_PATH) {
        adb('shell', 'cmd', 'statusbar', 'expand-notifications')
        await new Promise(resolve => setTimeout(resolve, 1000))
        await writeFile(process.env.ANDROID_EVIDENCE_PATH, execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap', '-p']))
        adb('shell', 'cmd', 'statusbar', 'collapse')
      }
    }
    browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    page = browser.contexts()[0].pages()[0]
    const state = await page.locator('.ftVideoPlayer video').evaluate(video => ({ paused: video.paused, time: video.currentTime }))
    assert.equal(state.paused, !continuePlayback, 'respect the background playback preference')
    if (continuePlayback) assert.ok(state.time > 0, 'background playback must advance')
    else assert.ok(state.time < 0.25, `disabled background playback must not advance past the first sample: ${state.time}`)
  } finally {
    releaseBackoff?.()
    launch()
    if (!browser && page) {
      browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
      page = browser.contexts()[0].pages()[0]
    }
    if (page && settings) await page.evaluate(({ settings, route }) => {
      document.querySelector('.ftVideoPlayer video')?.pause()
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      location.hash = route
      for (const [key, value] of Object.entries(settings)) store.commit('set' + key, value)
      window.fetch = window.__sabrBackgroundFetch
      delete window.__sabrBackgroundFetch
      window.Capacitor.nativePromise = window.__sabrBackgroundNativePromise
      delete window.__sabrBackgroundNativePromise
    }, { settings, route }).catch(() => {})
    await browser?.close()
    if (port) adb('reverse', '--remove', `tcp:${port}`)
    if (server) await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
