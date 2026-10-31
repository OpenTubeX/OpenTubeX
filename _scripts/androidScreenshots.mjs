import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { chromium, expect } from '@playwright/test'

import { goToSettingsSection } from '../e2e/helpers/app.mjs'
import { expectPausedFrame, openScreenshotSubscriptions, openScreenshotWatch, prepareAppScreenshot } from '../e2e/helpers/screenshots.mjs'

// Usage: node _scripts/androidScreenshots.mjs SERIAL
// See docs/screenshots/README.md. This clears the debug app's data on SERIAL.
const serial = process.argv[2]
assert.ok(serial, 'Pass the serial of an emulator or device that no one else is using')

const APP_ID = 'org.opentubex.app.dev'
const APK = fileURLToPath(new URL('../android/app/build/outputs/apk/debug/app-debug.apk', import.meta.url))
const DESTINATION = fileURLToPath(new URL('../docs/screenshots', import.meta.url))
// F-Droid and IzzyOnDroid read store screenshots from the fastlane metadata.
const FASTLANE_DESTINATION = fileURLToPath(new URL('../fastlane/metadata/android/en-US/images/phoneScreenshots', import.meta.url))
const SIZE = '1080x2340'
const DENSITY = '420'
const THEMES = ['dark', 'light']

const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
const demo = (command, extras = {}) => adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', command,
  ...Object.entries(extras).flatMap(([key, value]) => ['-e', key, value]))

const screencap = () => execFileSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 })

/** Capture once the screen is still, after system bars and Android's fading scrollbars settle. */
async function stableScreencap() {
  let previous = screencap()
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(250)
    const current = screencap()
    if (current.equals(previous)) return current
    previous = current
  }
  throw new Error('The screen did not settle')
}

/** Returns the override from `wm size` or `wm density` output, if any. */
function displayOverride(kind) {
  return adb('shell', 'wm', kind).match(/Override \w+: (\S+)/)?.[1] ?? null
}

const original = {
  size: displayOverride('size'),
  density: displayOverride('density'),
  nightMode: adb('shell', 'cmd', 'uimode', 'night').replace('Night mode: ', ''),
  demoAllowed: adb('shell', 'settings', 'get', 'global', 'sysui_demo_allowed'),
}
const output = await mkdtemp(path.join(tmpdir(), 'opentubex-android-screenshots-'))
let browser
let port
try {
  adb('install', '-r', APK)
  // Like the desktop captures, start from a fresh profile with app defaults.
  adb('shell', 'pm', 'clear', APP_ID)
  adb('shell', 'pm', 'grant', APP_ID, 'android.permission.POST_NOTIFICATIONS')
  adb('shell', 'wm', 'size', SIZE)
  adb('shell', 'wm', 'density', DENSITY)

  adb('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1')
  demo('enter')
  demo('clock', { hhmm: '1200' })
  demo('battery', { level: '100', plugged: 'false' })
  demo('network', { wifi: 'show', level: '4', fully: 'true' })
  demo('network', { mobile: 'hide' })
  demo('notifications', { visible: 'false' })

  adb('shell', 'cmd', 'uimode', 'night', 'yes')
  adb('shell', 'am', 'start', '--user', '0', '-W', '-n', `${APP_ID}/org.opentubex.app.MainActivity`)
  let pid = ''
  for (let attempt = 0; attempt < 100 && !pid; attempt++) {
    try { pid = adb('shell', 'pidof', APP_ID) } catch { await delay(100) }
  }
  assert.ok(pid, 'The app process started')
  port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
  let page
  for (let attempt = 0; attempt < 100 && !page; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
      page = browser.contexts()[0].pages()[0]
      if (!page) await browser.close()
    } catch { /* The WebView may still be starting. */ }
    if (!page) await delay(100)
  }
  assert.ok(page, 'The app WebView is available')

  // The shared helpers read the store and router through these accessors.
  await page.evaluate(() => {
    for (const name of ['$store', '$router']) {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => document.querySelector('#app').__vue_app__.config.globalProperties[name]
      })
    }
  })
  assert.equal(await page.evaluate(() => navigator.language), 'en-US', 'The device language is English (United States)')
  // Clearing the app data restores the APK's bundled yt-dlp, so the startup
  // check can offer a newer release at any point during the captures.
  await page.addLocatorHandler(
    page.locator('[data-sonner-toast]', { hasText: 'An update is available for yt-dlp.' }),
    toast => toast.getByRole('button', { name: 'Cancel', exact: true }).click()
  )
  const tutorial = page.locator('.tutorialOverlay')
  await tutorial.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(tutorial).toBeHidden()
  await page.evaluate(() => {
    // Emulators report the host keyboard, which would add keyboard shortcut
    // buttons a phone does not show. The app is notified again on every
    // configuration change, including the theme switches below.
    const trigger = window.Capacitor.triggerEvent
    window.Capacitor.triggerEvent = (name, target, data) =>
      trigger(name, target, name === 'opentubex:hardware-keyboard' ? { ...data, attached: false } : data)
    window.Capacitor.triggerEvent('opentubex:hardware-keyboard', 'window', {})
  })
  // Settings opened from the app header have no minimize button.
  await page.evaluate(() => window.$store.dispatch('updateMoveSettingsToAppHeader', true))

  async function setTheme(theme) {
    // Exercise the default System theme without changing an app setting.
    adb('shell', 'cmd', 'uimode', 'night', theme === 'dark' ? 'yes' : 'no')
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
  }

  const captures = []
  async function capture(number, theme) {
    const view = { 1: 'subscriptions', 2: 'watch', 3: 'settings' }[number]
    await prepareAppScreenshot(page, view)
    const name = `OpenTubeX${number}-mobile-${theme}.png`
    await writeFile(path.join(output, name), await stableScreencap())
    if (view === 'watch') await expectPausedFrame(page)
    captures.push(name)
  }

  const content = await goToSettingsSection(page, 'general')
  for (const theme of THEMES) {
    await setTheme(theme)
    await expect(content.locator('.changedSettingIndicator')).toHaveCount(0)
    await expect(page.locator('.settingsWindow').getByRole('button', { name: /^Show keyboard shortcuts$/i })).toHaveCount(0)
    await capture(3, theme)
  }
  await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.settingsWindow')).toBeHidden()

  await openScreenshotSubscriptions(page)
  for (const theme of THEMES) {
    await setTheme(theme)
    await capture(1, theme)
  }

  // Clearing the app data restores the APK's bundled yt-dlp, which can be too
  // old for YouTube to serve its streams. Use the default engine instead.
  await page.evaluate(() => window.$store.dispatch('updateVideoPlaybackEngine', 'built-in'))
  await openScreenshotWatch(page)
  for (const theme of THEMES) {
    await setTheme(theme)
    await capture(2, theme)
  }

  // Only replace the committed images once every scene succeeded.
  for (const name of captures) await copyFile(path.join(output, name), path.join(DESTINATION, name))
  await mkdir(FASTLANE_DESTINATION, { recursive: true })
  for (const number of [1, 2, 3]) {
    await copyFile(path.join(output, `OpenTubeX${number}-mobile-dark.png`), path.join(FASTLANE_DESTINATION, `${number}.png`))
  }
  await rm(output, { recursive: true, force: true })
} catch (error) {
  await writeFile(path.join(output, 'failure.png'), screencap())
  console.error(`Captures from this attempt are kept in ${output}`)
  throw error
} finally {
  try {
    await browser?.close()
    if (port) adb('forward', '--remove', `tcp:${port}`)
  } finally {
    adb('shell', 'am', 'force-stop', APP_ID)
    demo('exit')
    adb('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', original.demoAllowed === 'null' ? '0' : original.demoAllowed)
    adb('shell', 'cmd', 'uimode', 'night', original.nightMode)
    adb('shell', 'wm', 'size', original.size ?? 'reset')
    adb('shell', 'wm', 'density', original.density ?? 'reset')
  }
}
