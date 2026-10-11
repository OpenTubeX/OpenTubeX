import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'

// Requires an owned emulator, current debug APK, app-local demo-audio.mp3
// and an app-local MP3 at least 20 seconds long for the initial track.
// Disconnect CDP while locked: debugger activity can keep WebView awake and
// hide failures between media files. Observe playback through Android instead.
const sameDownload = Boolean(process.env.ANDROID_QUEUE_SAME_DOWNLOAD)
const sameVideo = sameDownload || Boolean(process.env.ANDROID_QUEUE_SAME_VIDEO)
const enabled = Boolean(process.env.ANDROID_CDP_URL && process.env.ANDROID_SERIAL?.startsWith('emulator-'))
const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, ...args], { encoding: 'utf8' })
const launch = () => adb('shell', 'am', 'start', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity')

for (const browseDownloads of [false, true]) for (const autoplayVideos of [true, false]) test(`offline audio queue advances across downloads while locked${sameDownload ? ' replaying the same download' : sameVideo ? ' across copies of one video' : ''}${browseDownloads ? ' from Downloads' : ''} with autoplay ${autoplayVideos ? 'enabled' : 'disabled'}`, { skip: !enabled }, async () => {
  assert.ok(process.env.ANDROID_OFFLINE_MEDIA_PATH, 'Set ANDROID_OFFLINE_MEDIA_PATH to app-local demo-audio.mp3')
  assert.ok(process.env.ANDROID_OFFLINE_FIRST_MEDIA_PATH, 'Set ANDROID_OFFLINE_FIRST_MEDIA_PATH to an app-local MP3 at least 20 seconds long')
  let browser, page, saved
  const ids = [Date.now(), Date.now() + 1, Date.now() + 2]
  const videoIds = ids.map((id, index) => 'qa' + id.toString(36) + index)
  if (sameVideo) videoIds[1] = videoIds[0]
  if (sameDownload) ids[1] = ids[0]
  try {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
    adb('shell', 'wm', 'dismiss-keyguard')
    // Fresh setup avoids attaching to a retained WebView from an earlier case.
    // The app remains untouched during the locked-screen durability check.
    adb('shell', 'am', 'force-stop', 'org.opentubex.app.dev')
    launch()
    let pid
    await expect.poll(() => {
      pid = adb('shell', 'pidof', 'org.opentubex.app.dev').trim()
      return Boolean(pid && adb('shell', 'cat', '/proc/net/unix').includes(`webview_devtools_remote_${pid}`))
    }, { timeout: 15000 }).toBe(true)
    adb('forward', `tcp:${new URL(process.env.ANDROID_CDP_URL).port}`, `localabstract:webview_devtools_remote_${pid}`)
    browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    page = browser.contexts()[0].pages()[0]
    await page.locator('.profileTrigger').waitFor()
    const skip = page.getByRole('button', { name: 'Skip', exact: true })
    if (await skip.isVisible()) await skip.click()
    saved = await page.evaluate(({ ids, videoIds, mediaPath, firstMediaPath, autoplayVideos, sameDownload }) => {
      const app = document.querySelector('#app').__vue_app__.config.globalProperties
      const store = app.$store
      const values = { AutoplayVideos: autoplayVideos, ContinuePlaybackWhenScreenIsLocked: true,
        VideoPlaybackEngine: 'built-in', UseSponsorBlock: false, UseReturnYouTubeDislikes: false,
        InternetConnectivityChecks: false, RememberHistory: false, WatchedProgressSavingMode: 'never',
        AndroidAutoPictureInPicture: false, MusicVisualizer: false, KeepPlayingOnNavigation: true }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, store.getters['get' + key]]))
      const queue = JSON.parse(JSON.stringify(store.getters.getWatchQueue))
      const route = store.getters.getActiveTab.route.fullPath
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__offlineQueueOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine')
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
      window.__offlineQueueFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__offlineQueueFetch(url, options) : Promise.reject(new Error('Offline queue test'))
      window.__offlineQueueNativePromise = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = function(plugin, method, options, ...rest) {
        if (plugin === 'CapacitorHttp' && method === 'request') return Promise.reject(new Error('Offline queue test'))
        return window.__offlineQueueNativePromise.call(this, plugin, method, options, ...rest)
      }
      window.__offlineQueuePlayed = []
      window.__offlineQueueEnds = 0
      window.__offlineQueueEnd = event => { if (event.target.tagName === 'VIDEO') window.__offlineQueueEnds++ }
      document.addEventListener('ended', window.__offlineQueueEnd, true)
      window.__offlineQueuePlay = event => {
        if (event.target.tagName !== 'VIDEO') return
        const id = Number(store.getters.getActiveTab.route.query.downloadId)
        const key = id + ':' + window.__offlineQueueEnds
        if (ids.includes(id) && window.__offlineQueueLastPlay !== key) {
          window.__offlineQueuePlayed.push(id)
          window.__offlineQueueLastPlay = key
        }
      }
      document.addEventListener('play', window.__offlineQueuePlay, true)
      store.commit('clearWatchQueue')
      for (const [index, id] of ids.entries()) {
        const videoId = videoIds[index]
        const title = 'Offline queue track ' + (index + 1)
        if (!sameDownload || index !== 1) store.commit('upsertYtDlpDownload', { id, videoId, title, status: 'completed', mode: 'audio',
          files: [{ videoId, path: index ? mediaPath : firstMediaPath, extension: 'mp3', duration: index ? 4 : 24 }] })
        if (index) store.commit('addVideoToWatchQueue', { video: {
          videoId, title, route: { path: '/watch/' + videoId, query: { downloadId: String(id) } },
        } })
      }
      app.$router.push({ path: '/watch/' + videoIds[0], query: { downloadId: String(ids[0]), ...(sameDownload ? { timestamp: '0.25' } : {}) } })
      return { settings, queue, route }
    }, { ids, videoIds, autoplayVideos, sameDownload, mediaPath: process.env.ANDROID_OFFLINE_MEDIA_PATH, firstMediaPath: process.env.ANDROID_OFFLINE_FIRST_MEDIA_PATH })
    await expect.poll(() => page.locator('video').evaluate(video => video.readyState), { timeout: 20000 }).toBe(4)
    if (sameDownload) assert.equal(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveTab.route.query.timestamp), '0.25', 'Android retains the initial timestamp query')
    assert.ok(await page.locator('video').evaluate(video => video.duration >= 20), 'first track lasts beyond Android’s startup allowance')
    await page.locator('video').evaluate(video => { video.currentTime = 0; return video.play() })
    await expect.poll(() => adb('shell', 'dumpsys', 'media_session'), { timeout: 20000 }).toMatch(/Offline queue track 1/)
    await expect.poll(() => page.locator('video').evaluate(video => !video.paused && video.currentTime > 0.1)).toBe(true)
    if (browseDownloads) {
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/downloads'))
      await expect(page.locator('.ftVideoPlayer')).toHaveClass(/mobileMiniBar/)
      await expect(page.locator('.ftVideoPlayer')).not.toHaveAttribute('data-mobile-mini-morph')
    }
    assert.ok(await page.locator('video').evaluate(video => !video.paused && video.duration - video.currentTime > 10), 'first track still has time to play after locking')
    await browser.close()
    browser = null
    adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP')
    const lockedState = adb('shell', 'dumpsys', 'media_session')
    assert.match(lockedState, /Offline queue track 1/, 'first track is still active after locking')
    assert.match(lockedState, /PlaybackState \{state=(?:3|PLAYING\(3\)),/, 'first track is playing while locked')
    for (const number of sameVideo ? [3] : [2, 3]) {
      await expect.poll(() => {
        const state = adb('shell', 'dumpsys', 'media_session')
        return state.includes(`Offline queue track ${number}`) && /PlaybackState \{state=(?:3|PLAYING\(3\)), position=[1-9]/.test(state)
      }, { timeout: sameDownload ? 60000 : 35000, intervals: [200] }).toBe(true)
      assert.match(adb('shell', 'dumpsys', 'power'), /mWakefulness=Asleep/, 'screen stays locked')
    }
    await expect.poll(() => adb('shell', 'dumpsys', 'activity', 'services', 'org.opentubex.app.dev'), { timeout: 15000 }).not.toMatch(/AndroidMediaSessionService/)
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
    adb('shell', 'wm', 'dismiss-keyguard')
    launch()
    browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    page = browser.contexts()[0].pages()[0]
    assert.deepEqual(await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return { path: store.getters.getActiveTab.route.path, queue: store.getters.getWatchQueueLength,
        ended: document.querySelector('video').ended }
    }), { path: '/watch/' + videoIds[2], queue: 0, ended: true })
    assert.deepEqual(await page.evaluate(() => window.__offlineQueuePlayed), ids, 'every queued source actually played')
    assert.equal(await page.locator('video').evaluate(video => video.autoplay), autoplayVideos, 'consumed queue requests preserve the autoplay preference')
  } catch (error) {
    // Reconnect only after the locked-screen verdict to retain diagnostics
    // without letting debugger activity make a failing queue advance.
    if (saved && !browser) {
      browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
      page = browser.contexts()[0].pages()[0]
      console.error('Offline queue failure state:', await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        const video = document.querySelector('video')
        return { route: store.getters.getActiveTab.route.fullPath, queue: store.getters.getWatchQueueLength,
          played: window.__offlineQueuePlayed, ended: window.__offlineQueueEnds,
          position: video?.currentTime, paused: video?.paused, readyState: video?.readyState }
      }))
    }
    throw error
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
    adb('shell', 'wm', 'dismiss-keyguard')
    launch()
    if (!browser && page) {
      browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
      page = browser.contexts()[0].pages()[0]
    }
    if (saved) await page.evaluate(({ saved, ids }) => {
      document.removeEventListener('ended', window.__offlineQueueEnd, true)
      delete window.__offlineQueueEnd
      delete window.__offlineQueueEnds
      delete window.__offlineQueueLastPlay
      document.removeEventListener('play', window.__offlineQueuePlay, true)
      delete window.__offlineQueuePlay
      delete window.__offlineQueuePlayed
      document.querySelector('video')?.pause()
      const app = document.querySelector('#app').__vue_app__.config.globalProperties
      app.$router.push(saved.route)
      app.$store.commit('clearWatchQueue')
      for (const video of saved.queue) app.$store.commit('addVideoToWatchQueue', { video })
      for (const id of ids) app.$store.commit('removeYtDlpDownload', id)
      for (const [key, value] of Object.entries(saved.settings)) app.$store.commit('set' + key, value)
      if (window.__offlineQueueOnline) Object.defineProperty(navigator, 'onLine', window.__offlineQueueOnline)
      else delete navigator.onLine
      window.dispatchEvent(new Event(navigator.onLine ? 'online' : 'offline'))
      window.fetch = window.__offlineQueueFetch
      window.Capacitor.nativePromise = window.__offlineQueueNativePromise
      delete window.__offlineQueueOnline
      delete window.__offlineQueueFetch
      delete window.__offlineQueueNativePromise
    }, { saved, ids })
    await browser?.close()
  }
})
