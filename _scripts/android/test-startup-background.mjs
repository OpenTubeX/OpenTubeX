// Run against an exclusively owned emulator with the current debug APK installed.
// Unlike ActivityScenario, this checks the OS window before MainActivity.onCreate.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'

const serial = process.argv[2]
assert.ok(serial, 'Pass the exclusively owned emulator serial')
const app = 'org.opentubex.app.dev'
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
const originalNight = adb('shell', 'cmd', 'uimode', 'night').split(': ').at(-1)
const launcher = adb('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', app).split('\n').at(-1)
let browser
let port
let originalSettings

async function disconnect() {
  try {
    if (browser) await browser.close()
  } finally {
    browser = undefined
    if (port) adb('forward', '--remove', `tcp:${port}`)
    port = undefined
  }
}

async function connect() {
  await disconnect()
  let lastError
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const pid = adb('shell', 'pidof', app)
      if (!port) port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
      const page = browser.contexts()[0].pages()[0]
      if (page) {
        await page.waitForFunction(() => !!document.querySelector('#app')?.__vue_app__ && !!document.querySelector('.topNav'))
        return page
      }
      await browser.close()
    } catch (error) { lastError = error }
    await delay(100)
  }
  throw new Error('The launched renderer did not become ready', { cause: lastError })
}

async function settings(page, values) {
  await page.evaluate(async (updates) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    for (const [key, value] of Object.entries(updates)) await store.dispatch(`update${key}`, value)
  }, values)
}

function mismatchedPixelRatio(dark) {
  const frame = execFileSync('adb', ['-s', serial, 'exec-out', 'screencap'], { maxBuffer: 32 * 1024 * 1024 })
  const width = frame.readUInt32LE(0)
  const height = frame.readUInt32LE(4)
  assert.equal(frame.readUInt32LE(8), 1, 'The emulator screenshot must be RGBA8888')
  const offset = frame.length - width * height * 4
  let mismatched = 0
  let sampled = 0
  // Exclude system bars and screen edges; an icon or text cannot dominate this area.
  for (let y = Math.floor(height * 0.2); y < height * 0.8; y += 10) {
    for (let x = Math.floor(width * 0.2); x < width * 0.8; x += 10) {
      const index = offset + (y * width + x) * 4
      const channels = [frame[index], frame[index + 1], frame[index + 2]]
      const neutral = Math.max(...channels) - Math.min(...channels) <= 1
      if (neutral && (dark ? channels.every(channel => channel > 230) : channels.every(channel => channel < 30))) mismatched++
      sampled++
    }
  }
  return mismatched / sampled
}

try {
  adb('shell', 'am', 'start', '--user', '0', '-n', launcher)
  let page = await connect()
  originalSettings = await page.evaluate(() => {
    const getters = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters
    return {
      BaseTheme: getters.getBaseTheme,
      HideStartupSplash: getters.getHideStartupSplash,
      SystemDarkTheme: getters.getSystemDarkTheme,
      SystemLightTheme: getters.getSystemLightTheme
    }
  })
  await settings(page, { SystemDarkTheme: 'dark', SystemLightTheme: 'light' })
  for (const appearance of [
    { theme: 'dark', night: 'no', dark: true },
    { theme: 'light', night: 'yes', dark: false },
    { theme: 'system', night: 'no', dark: false },
    { theme: 'system', night: 'yes', dark: true },
  ]) {
    adb('shell', 'cmd', 'uimode', 'night', appearance.night)
    await settings(page, { HideStartupSplash: true, BaseTheme: appearance.theme })
    await page.waitForFunction(dark => document.body.classList.contains(dark ? 'dark' : 'light'), appearance.dark)
    await delay(1000) // Allow the native color and per-app configuration to persist.
    await disconnect()
    adb('shell', 'am', 'force-stop', app)
    adb('shell', 'am', 'start', '--user', '0', '-n', launcher)
    let worstMismatchRatio = 0
    let samples = 0
    const deadline = Date.now() + 3500
    while (Date.now() < deadline || samples < 4) {
      worstMismatchRatio = Math.max(worstMismatchRatio, mismatchedPixelRatio(appearance.dark))
      samples++
    }
    page = await connect()
    assert.ok(worstMismatchRatio < 0.85,
      `${appearance.theme} with OS night=${appearance.night}: a launch frame has ${(worstMismatchRatio * 100).toFixed(1)}% opposite-theme pixels`)
    await page.waitForFunction(dark => document.body.classList.contains(dark ? 'dark' : 'light'), appearance.dark)
    console.log(`PASS: ${appearance.theme} with OS night=${appearance.night}: ${samples} native frames, no opposite-theme flash`)
  }
} finally {
  try {
    adb('shell', 'cmd', 'uimode', 'night', originalNight)
    if (originalSettings) await settings(await connect(), originalSettings)
  } finally {
    await disconnect()
  }
}
