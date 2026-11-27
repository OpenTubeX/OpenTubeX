import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { androidAppId, connectAndroidApp } from '../helpers/android-webview.mjs'

// Run with _scripts/androidCastReceiverTest.mjs, which builds a debug sender
// that also trusts a temporary test root, gives unmodified openchromecast + mpv
// a device certificate from it, and generates MP4/DASH/HLS fixtures with
// ffmpeg. Only discovery and adb loopback topology are substituted;
// authentication, Cast commands, manifest rewriting and media streaming use
// the real backend.
const root = process.env.OPENTUBEX_CAST_RECEIVER_FIXTURES
const receiverPort = Number(process.env.OPENTUBEX_CAST_RECEIVER_PORT)
const serial = process.env.ANDROID_SERIAL
const execFileAsync = promisify(execFile)
test('Android casts MP4, DASH and HLS to the open source receiver', {
  skip: !root || !receiverPort || !serial || !process.env.ANDROID_CDP_URL, timeout: 330_000
}, async () => {
  const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' })
  const appId = androidAppId()
  // The instrumentation starts the app with the receiver among its devices,
  // which adb reverse connects to this host, and routes the fixture address
  // to this host's server, until the test marks itself finished.
  adb('shell', 'run-as', appId, 'rm', '-f', 'cache/cast-emulator-ready', 'cache/cast-emulator-finished')
  const instrumentation = execFileAsync('adb', ['-s', serial, 'shell', 'am', 'instrument', '-w',
    '-e', 'class', 'org.opentubex.app.ChromecastTest#prepareOpenSourceReceiverForUiTest',
    '-e', 'castEmulatorPort', String(receiverPort),
    `${appId}.test/androidx.test.runner.AndroidJUnitRunner`], { timeout: 330_000 })
  instrumentation.catch(() => {})
  await expect.poll(() => {
    try {
      adb('shell', 'run-as', appId, 'test', '-f', 'cache/cast-emulator-ready')
      return true
    } catch { return false }
  }, { timeout: 60_000, intervals: [500], message: 'The instrumentation starts the app with the receiver' }).toBe(true)
  const requests = []
  const server = createServer(async (req, res) => {
    try {
      const filename = new URL(req.url, 'http://localhost').pathname.slice(1)
      assert.ok(!filename.includes('/') && !filename.includes('..'))
      const data = await readFile(`${root}/${filename}`)
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
      const start = match ? Number(match[1]) : 0
      const end = match && match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1
      requests.push({ filename, range: req.headers.range })
      const type = filename.endsWith('.mpd') ? 'application/dash+xml' : filename.endsWith('.m3u8') ? 'application/x-mpegurl' : filename.endsWith('.ts') ? 'video/mp2t' : 'video/mp4'
      res.writeHead(match ? 206 : 200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': end - start + 1, ...(match ? { 'content-range': `bytes ${start}-${end}/${data.length}` } : {}) })
      res.end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1))
    } catch (e) { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve))
  // Instrumentation alone maps this public fixture address to the emulator host
  // after production destination validation; production DNS and trust stay intact.
  const upstream = `http://8.8.8.8:${server.address().port}`
  const forwarded = new Set()
  // The instrumentation restarted the app in its own process.
  const { browser, page } = await connectAndroidApp()
  page.setDefaultTimeout(15000)

  let watch, original
  try {
    await page.exposeFunction('__forwardCastRelay', async (port, castId) => {
      assert.match(castId, /^[a-f0-9-]{36}$/)
      await expect.poll(async () => {
        try {
          await execFileAsync('adb', ['-s', serial, 'shell', 'run-as', appId, 'test', '-f', `cache/cast-relay-${castId}`], { timeout: 1000 })
          return true
        } catch { return false }
      }, { timeout: 15_000, intervals: [100], message: 'Instrumentation installs the test-only relay socket mapping' }).toBe(true)
      // The relay rewrites DASH and HLS manifests with its own origin, so the
      // receiver on this host reaches it at the same port.
      adb('forward', `tcp:${port}`, `tcp:${port}`)
      forwarded.add(port)
      return `http://127.0.0.1:${port}`
    })
    original = await page.evaluate(receiverPort => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = { CurrentLocale: 'en-US', CastProtocols: ['googleCast'], VideoPlaybackEngine: 'built-in', AutoplayVideos: false, UseSponsorBlock: false, UseReturnYouTubeDislikes: false }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, JSON.parse(JSON.stringify(store.getters['get' + key]))]))
      for (const [key, value] of Object.entries(values))store.commit('set' + key, value)
      window.__testCastFetch = window.fetch
      window.fetch = (url, opts) => String(url).startsWith('https://localhost/') ? window.__testCastFetch(url, opts) : Promise.reject(Error('Offline receiver fixture'))
      window.__testNativePromise = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = async (plugin, method, options) => {
        if (plugin === 'Chromecast' && method === 'discover') return { devices: [{ id: 'open-source-emulator', name: 'OpenTubeX Test Receiver', address: '127.0.0.1', port: receiverPort }] }
        try {
          const result = await window.__testNativePromise(plugin, method, options)
          if (plugin === 'Chromecast' && method === 'openMedia')result.origin = await window.__forwardCastRelay(new URL(result.origin).port, options.castId)

          return result
        } catch (e) { console.error('NATIVE', plugin, method, String(e)); throw e }
      }
      const route = location.hash
      location.hash = '#/watch/jNQXAC9IVRw'
      return { saved, route }
    }, receiverPort)
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) {
      await tutorial.locator('.tutorialSkip button').click()
      await expect(tutorial).toBeHidden()
    }
    await expect.poll(async () => { const h = await page.evaluateHandle(findWatchComponent); try { return await h.evaluate(c => !!c && c.proxy.preparingVideoLoadGeneration === null) } finally { await h.dispose() } }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
    const media = (await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
    await watch.evaluate((c, media) => { const w = c.proxy; w.videoLoadGeneration++; Object.assign(w, { isLoading: false, ytDlpStreamsPending: false, errorMessage: null, manifestSrc: null, manifestMimeType: null, isUpcoming: false, isLive: false, localFilePlayback: false, activeFormat: 'legacy', videoTitle: 'Android Google Cast test', videoLengthSeconds: 30, author: 'Test channel', legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm', width: 640, height: 360, bitrate: 0, localFile: true, url: `data:video/webm;base64,${media}` }] }) }, media)
    const button = page.locator('.chromecastControl > button')
    await expect(button).toBeVisible()
    await expect(page.locator('.ftVideoPlayer video')).toBeVisible()
    const state = () => watch.evaluate(c => ({ status: c.proxy.chromecastStatus ?? {}, active: c.proxy.chromecastActive }))
    for (const [file, type] of [['video.mp4', 'video/mp4'], ['manifest.mpd', 'application/dash+xml'], ['manifest.m3u8', 'application/x-mpegurl']]) {
      const before = requests.length
      await watch.evaluate((c, { file, type, upstream }) => { c.proxy.legacyFormats = [c.proxy.legacyFormats[0], ...(type === 'video/mp4' ? [{ mimeType: 'video/mp4; codecs="avc1, mp4a.40.2"', url: `${upstream}/${file}`, height: 720 }] : [])]; c.proxy.manifestSrc = type === 'video/mp4' ? null : `${upstream}/${file}`; c.proxy.manifestMimeType = type === 'video/mp4' ? null : type; c.proxy.$refs.player.setCurrentTime(1) }, { file, type, upstream })
      await watch.evaluate(c => c.proxy.$refs.player.play())
      await expect.poll(() => watch.evaluate(c => c.proxy.$refs.player.isPaused())).toBe(false)
      await button.click()
      await page.getByRole('menuitem', { name: 'OpenTubeX Test Receiver', exact: true }).click()
      await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 })
      await expect.poll(async () => (await state()).status, { timeout: 20000 }).toMatchObject({ paused: false })
      await expect.poll(async () => (await state()).status.currentTime, { timeout: 20000 }).toBeGreaterThan(2)
      // The receiver can report the previous media's position before it loads
      // the new one, so wait for the segments it fetches.
      await expect.poll(() => requests.slice(before).some(request => type === 'video/mp4'
        ? request.filename === 'video.mp4'
        : type === 'application/dash+xml' ? request.filename.startsWith('chunk-') : request.filename.endsWith('.ts')),
      { timeout: 20000, message: `The receiver fetches the ${type} media` }).toBe(true)

      await button.click()
      if (process.env.ANDROID_CAST_RECEIVER_SCREENSHOT && type === 'video/mp4') {
        await page.screenshot({ path: process.env.ANDROID_CAST_RECEIVER_SCREENSHOT })
      }
      await page.getByRole('menuitem', { name: 'Pause', exact: true }).click()
      await expect.poll(async () => (await state()).status.paused).toBe(true)
      await button.click()
      await page.getByRole('menuitem', { name: 'Play', exact: true }).click()
      await expect.poll(async () => (await state()).status.paused).toBe(false)
      await button.click()
      await page.getByRole('menuitem', { name: 'Forward 10 seconds', exact: true }).click()
      await expect.poll(async () => (await state()).status.currentTime).toBeGreaterThan(10)
      const previousVolume = (await state()).status.volume
      await button.click()
      await page.getByRole('menuitem', { name: 'Decrease volume', exact: true }).click()
      await expect.poll(async () => (await state()).status.volume).toBeLessThan(previousVolume - 0.05)
      await button.click()
      await page.getByRole('menuitem', { name: 'Return to local playback', exact: true }).click()
      await expect(button).toHaveAttribute('aria-pressed', 'false')
      console.log(`Verified Android ${type}: fetch, playback, pause/resume, seek, volume, stop`)
    }
  } finally {
    await watch?.evaluate(c => c.proxy.$refs.player?.pause()).catch(() => {})
    await page.evaluate(({ saved, route }) => { const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store; for (const [k, v] of Object.entries(saved ?? {}))store.commit('set' + k, v); window.fetch = window.__testCastFetch ?? window.fetch; window.Capacitor.nativePromise = window.__testNativePromise ?? window.Capacitor.nativePromise; location.hash = route }, { saved: original?.saved, route: original?.route ?? '#/' }).catch(() => {})
    await watch?.dispose()
    await browser.close()
    server.closeAllConnections(); server.close()
    for (const port of forwarded) adb('forward', '--remove', `tcp:${port}`)
    adb('shell', 'run-as', appId, 'touch', 'cache/cast-emulator-finished')
  }
  const { stdout } = await instrumentation
  assert.match(stdout, /OK \(1 test\)/, stdout)
})
