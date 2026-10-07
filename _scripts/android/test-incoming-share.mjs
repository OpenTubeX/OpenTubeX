// Hold the Android lab lock and install the current debug APK before running.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'

const serial = process.argv[2]
assert.ok(serial, 'Pass the exclusively owned emulator serial')
const screenshotDir = process.argv[3]
const app = 'org.opentubex.app.dev'
const component = `${app}/org.opentubex.app.MainActivity`
const id = 'abcdefghijk'
const url = `https://youtu.be/${id}?t=42&list=PL-share-test`
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
const originalNight = adb('shell', 'cmd', 'uimode', 'night').split(': ').at(-1)
const originalDisplaySettings = Object.fromEntries(['accelerometer_rotation', 'user_rotation', 'font_scale'].map(key => [key, adb('shell', 'settings', 'get', 'system', key)]))
let browser
let port
let page
let originalSettings
let originalQueue
let originalInstance

async function disconnect() {
  await browser?.close()
  browser = null
  if (port) adb('forward', '--remove', `tcp:${port}`)
  port = null
}

async function connect() {
  await disconnect()
  let lastError
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const pid = adb('shell', 'pidof', app)
      if (!port) port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
      page = browser.contexts()[0].pages()[0]
      if (page) {
        await page.waitForFunction(() => !!document.querySelector('#app')?.__vue_app__ && !!document.querySelector('.topNav'))
        return
      }
      await browser.close()
    } catch (error) { lastError = error }
    await delay(100)
  }
  throw new Error('Android renderer did not become ready', { cause: lastError })
}

async function settings(values) {
  await page.evaluate(async updates => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    for (const [key, value] of Object.entries(updates)) await store.dispatch(`update${key}`, value)
  }, values)
}

async function openSubscriptions() {
  // Use the app's router link, which also updates its logical tab session.
  await page.locator('.sideNav a[href$="/subscriptions"]').first().evaluate(element => element.click())
  // The native tab session restores its own route on launch.
  await page.waitForFunction(() => {
    const session = JSON.parse(localStorage.getItem('opentubex-capacitor-tabs'))
    return session?.tabs?.find(tab => tab.id === session.activeTabId)?.route.fullPath === '/subscriptions'
  })
}

function share(text = `A shared video\n${url}`) {
  // Quote for the device shell as well as the host's execFile argument boundary.
  const quoted = `'${text.replaceAll("'", "'\\''")}'`
  adb('shell', 'am', 'start', '--user', '0', '-n', component,
    '-a', 'android.intent.action.SEND', '-t', 'text/plain', '--es', 'android.intent.extra.TEXT', quoted)
}

const dialog = () => page.getByRole('dialog', { name: 'Shared YouTube link' })

async function metadataFixtures({ fail = false, failLocal = fail, failInvidious = fail, slow = false, timeoutInvidious = false } = {}) {
  // Exercise both real API adapters with deterministic metadata; keep native
  // intent reception and renderer dispatch unchanged.
  await page.evaluate(({ id, failLocal, failInvidious, slow, timeoutInvidious }) => {
    window.shareTestOriginalFetch ??= window.fetch
    window.shareTestOriginalNativePromise ??= window.Capacitor.nativePromise
    window.shareTestMetadataFinished = false
    const pending = slow ? new Promise(resolve => { window.shareTestReleaseMetadata = resolve }) : null
    const metadata = { videoId: id, title: 'Shared video', author: 'Test channel', authorId: 'UC-share-test', lengthSeconds: 120, published: 1700000000, liveNow: false, isUpcoming: false }
    window.fetch = async (input, init) => {
      if (String(input?.url ?? input).startsWith('https://share-fixture.invalid/api/v1/videos/')) {
        if (timeoutInvidious) {
          return new Promise((_resolve, reject) => {
            init.signal.throwIfAborted()
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
          })
        }
        if (pending) await pending
        window.shareTestMetadataFinished = true
        return new Response(JSON.stringify(failInvidious ? { error: 'Unavailable' } : metadata), { status: failInvidious ? 503 : 200 })
      }
      return window.shareTestOriginalFetch(input, init)
    }
    window.Capacitor.nativePromise = async (plugin, method, options) => {
      if (plugin === 'CapacitorHttp' && method === 'request' && options.url.includes('/youtubei/v1/player')) {
        if (pending) await pending
        window.shareTestMetadataFinished = true
        return {
          status: failLocal ? 503 : 200,
          headers: { 'content-type': 'application/json' },
          url: options.url,
          data: JSON.stringify({ videoDetails: { videoId: id, title: metadata.title, author: metadata.author, channelId: metadata.authorId, lengthSeconds: '120' } })
        }
      }
      return window.shareTestOriginalNativePromise(plugin, method, options)
    }
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setCurrentInvidiousInstance', 'https://share-fixture.invalid')
  }, { id, failLocal, failInvidious, slow, timeoutInvidious })
}

try {
  adb('shell', 'am', 'start', '--user', '0', '-n', component)
  await connect()
  if (await page.locator('.tutorialOverlay').isVisible()) await page.getByRole('button', { name: 'Skip', exact: true }).click()
  const saved = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const getters = store.getters
    return {
      settings: Object.fromEntries(['CurrentLocale', 'BaseTheme', 'SystemDarkTheme', 'SystemLightTheme', 'MainColor', 'SecColor', 'BackendPreference', 'BackendFallback', 'EnableDownloads', 'IconPack', 'UiScale', 'HideStartupSplash', 'DefaultInvidiousInstance', 'ReducedMotion'].map(key => [key, getters[`get${key}`]])),
      queue: store.getters.getWatchQueue,
      instance: store.getters.getCurrentInvidiousInstance
    }
  })
  originalSettings = saved.settings
  originalQueue = saved.queue
  originalInstance = saved.instance
  await settings({ CurrentLocale: 'en-US', BaseTheme: 'system', SystemDarkTheme: 'dark', SystemLightTheme: 'light', MainColor: 'Red', SecColor: 'Blue', EnableDownloads: true, UiScale: 100, HideStartupSplash: true, BackendFallback: false })
  await openSubscriptions()
  await disconnect()
  adb('shell', 'am', 'force-stop', app)
  share()
  await connect()
  await expect(dialog()).toBeVisible()
  await expect(dialog().getByRole('button')).toHaveCount(5)
  await expect(dialog()).toContainText(url)
  // The shell and share dialog can render before the restored tab is projected.
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.currentRoute.value.path === '/subscriptions')
  console.log('PASS cold-start share presents all four actions before playback')

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    window.shareTestOriginalDispatch = store.dispatch
    store.dispatch = (type, payload, ...rest) => type === 'getYoutubeUrlInfo' && payload === 'https://youtu.be/12345678901'
      ? Promise.reject(new Error('URL resolution failed'))
      : window.shareTestOriginalDispatch(type, payload, ...rest)
  })
  try {
    share('https://youtu.be/12345678901')
    await expect(page.getByText('The shared text does not contain a supported YouTube link.', { exact: true })).toBeVisible()
    await expect(dialog()).toHaveCount(0)
  } finally {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.dispatch = window.shareTestOriginalDispatch
      delete window.shareTestOriginalDispatch
    })
  }
  share()
  await expect(dialog()).toBeVisible()
  console.log('PASS URL resolution failure dismisses the previous prompt and shows feedback')

  await expect(page.getByText('The shared text does not contain a supported YouTube link.', { exact: true })).toHaveCount(0, { timeout: 10_000 })
  share('https://youtu.be/invalid')
  await expect(dialog()).toHaveCount(0)
  await expect(page.getByText('The shared text does not contain a supported YouTube link.', { exact: true })).toBeVisible()
  share()
  await expect(dialog()).toBeVisible()
  console.log('PASS malformed short links show feedback without channel actions')

  await settings({ BackendPreference: 'invidious', BackendFallback: true })
  await metadataFixtures({ timeoutInvidious: true })
  const beforeTimeout = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueueLength)
  await dialog().getByRole('button', { name: 'Add to Queue', exact: true }).click()
  await page.waitForFunction(length => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueueLength === length + 1, beforeTimeout, { timeout: 30_000 })
  await expect(dialog()).toHaveCount(0)
  share()
  await expect(dialog()).toBeVisible()
  console.log('PASS an Invidious timeout falls back to local metadata with a fresh deadline')

  for (const [backend, fallback] of [['local', false], ['invidious', false], ['local', true], ['invidious', true]]) {
    await settings({ BackendPreference: backend, BackendFallback: fallback })
    await metadataFixtures({ failLocal: fallback && backend === 'local', failInvidious: fallback && backend === 'invidious' })
    const length = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueueLength)
    await dialog().getByRole('button', { name: 'Add to Queue', exact: true }).click()
    await expect(dialog()).toHaveCount(0)
    await page.waitForFunction(length => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueueLength === length + 1, length)
    assert.equal(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueue.at(-1).title), 'Shared video')
    share()
    await dialog().getByRole('button', { name: 'Add to Playlist', exact: true }).click()
    await expect(page.locator('.playlistPromptHeading')).toBeVisible()
    await page.locator('.prompt').filter({ has: page.locator('.playlistPromptHeading') }).getByRole('button', { name: 'Cancel', exact: true }).click()
    share()
    console.log(`PASS ${backend}${fallback ? ' fallback' : ''} metadata supports queue and playlist actions`)
  }
  await settings({ BackendFallback: false })
  await metadataFixtures()

  await dialog().getByRole('button', { name: 'Download', exact: true }).click()
  await expect(page.locator('.downloadPromptCard')).toBeVisible()
  await expect(page.locator('.downloadVideoTitle')).toHaveText(url)
  await page.locator('.downloadPromptCard').getByRole('button', { name: 'Cancel', exact: true }).click()
  console.log('PASS Download opens existing options without playback')

  share()
  await metadataFixtures({ fail: true })
  await dialog().getByRole('button', { name: 'Add to Queue', exact: true }).click()
  await expect(dialog().getByRole('alert')).toContainText('Could not load video information')
  await expect(dialog().getByRole('button', { name: 'Open in player' })).toBeEnabled()
  await dialog().getByRole('button', { name: 'Cancel', exact: true }).click()
  share()
  await metadataFixtures({ slow: true })
  await dialog().getByRole('button', { name: 'Add to Queue', exact: true }).click()
  await expect(dialog().getByRole('status')).toBeVisible()
  const queueLength = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueueLength)
  await dialog().getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => window.shareTestReleaseMetadata())
  await page.waitForFunction(() => window.shareTestMetadataFinished)
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))
  assert.equal(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueueLength), queueLength)
  console.log('PASS failed and cancelled metadata requests do not add videos')

  share()
  await expect(dialog()).toBeVisible()
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
  await expect(dialog()).toHaveCount(0)
  share()
  await expect(dialog()).toBeVisible()
  share()
  await expect(dialog()).toBeVisible()
  await dialog().getByRole('button', { name: 'Cancel', exact: true }).click()
  share('An unrelated link: https://example.com/watch?v=abcdefghijk')
  await expect(page.getByText('The shared text does not contain a supported YouTube link.', { exact: true })).toBeVisible()
  await expect(dialog()).toHaveCount(0)
  console.log('PASS Back, repeated warm shares and invalid text')

  share()
  await settings({ EnableDownloads: false })
  await expect(dialog().getByRole('button', { name: 'Download', exact: true })).toHaveCount(0)
  await settings({ EnableDownloads: true, ReducedMotion: 'enabled' })
  for (const scale of [80, 125, 150]) {
    await settings({ UiScale: scale })
    await expect(dialog().getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
    assert.ok(await dialog().evaluate(element => element.getBoundingClientRect().right <= innerWidth + 1))
    assert.ok(await dialog().evaluate(element => {
      const content = element.querySelector('.promptContentScroller').getBoundingClientRect()
      return [...element.querySelectorAll('.sharedLinkActions .btn')].every(button => {
        const bounds = button.getBoundingClientRect()
        return bounds.left >= content.left - 1 && bounds.right <= content.right + 1
      })
    }), 'Action buttons must fit inside their content viewport')
  }
  await settings({ UiScale: 100, ReducedMotion: 'system' })
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '1')
  await page.waitForFunction(() => innerWidth > innerHeight)
  await settings({ UiScale: 125 })
  await expect(dialog().getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
  await dialog().getByRole('button', { name: 'Download', exact: true }).scrollIntoViewIfNeeded()
  await expect(dialog().getByRole('button', { name: 'Download', exact: true })).toBeInViewport()
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
  await page.waitForFunction(() => innerWidth < innerHeight)
  await disconnect()
  adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3')
  adb('shell', 'am', 'force-stop', app)
  share()
  await connect()
  await expect(dialog().getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
  await disconnect()
  adb('shell', 'settings', 'put', 'system', 'font_scale', originalDisplaySettings.font_scale === 'null' ? '1.0' : originalDisplaySettings.font_scale)
  adb('shell', 'am', 'force-stop', app)
  share()
  await connect()
  await settings({ UiScale: 100 })
  for (const pack of ['material', 'remix']) {
    await settings({ IconPack: pack })
    await expect(dialog().locator('.sharedLinkActions svg')).toHaveCount(4)
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true })
      for (const theme of ['dark', 'light']) {
        adb('shell', 'cmd', 'uimode', 'night', theme === 'dark' ? 'yes' : 'no')
        await page.emulateMedia({ colorScheme: theme })
        await page.waitForFunction(theme => document.body.classList.contains(theme), theme)
        await dialog().screenshot({ path: resolve(screenshotDir, `android-share-${pack}-${theme}.png`) })
      }
    }
  }
  console.log('PASS download preference, fractional UI scales, landscape, larger text and both icon packs')

  await metadataFixtures()
  await dialog().getByRole('button', { name: 'Open in player' }).click()
  await page.waitForFunction(id => document.querySelector('#app').__vue_app__.config.globalProperties.$router.currentRoute.value.path === `/watch/${id}`, id)
  const query = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.currentRoute.value.query)
  assert.equal(String(query.timestamp), '42')
  assert.equal(query.playlistId, 'PL-share-test')
  await expect(dialog()).toHaveCount(0)
  console.log('PASS Open preserves timestamp and playlist context')
  console.log(adb('shell', 'getprop', 'ro.build.version.sdk'))
  console.log(adb('shell', 'dumpsys', 'webviewupdate').split('\n').find(line => line.includes('Current WebView package')))
} finally {
  if (page && originalSettings) {
    await settings(originalSettings).catch(console.error)
    await page.evaluate(({ queue, instance }) => {
      if (window.shareTestOriginalFetch) window.fetch = window.shareTestOriginalFetch
      if (window.shareTestOriginalNativePromise) window.Capacitor.nativePromise = window.shareTestOriginalNativePromise
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.state.watchQueue.items = queue
      store.commit('setCurrentInvidiousInstance', instance)
    }, { queue: originalQueue, instance: originalInstance }).catch(console.error)
    await openSubscriptions().catch(console.error)
  }
  adb('shell', 'cmd', 'uimode', 'night', originalNight)
  for (const [key, value] of Object.entries(originalDisplaySettings)) {
    adb('shell', 'settings', value === 'null' ? 'delete' : 'put', 'system', key, ...(value === 'null' ? [] : [value]))
  }
  await disconnect()
}
