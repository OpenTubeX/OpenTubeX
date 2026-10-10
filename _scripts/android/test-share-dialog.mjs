// Hold the Android lab lock and install the current debug APK before running.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'

const serial = process.argv[2]
assert.ok(serial, 'Pass the exclusively owned emulator serial')
const screenshotDir = process.argv[3]
const mode = process.argv[4]
const app = 'org.opentubex.app.dev'
const component = `${app}/org.opentubex.app.MainActivity`
const url = 'https://youtu.be/abcdefghijk'
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
const rotation = Object.fromEntries(['accelerometer_rotation', 'user_rotation'].map(key => [key, adb('shell', 'settings', 'get', 'system', key)]))
let browser
let page
let outgoingPage
let port
let savedSettings

async function settings(values) {
  await page.evaluate(async values => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    for (const [key, value] of Object.entries(values)) await store.dispatch(`update${key}`, value)
  }, values)
}

const dialog = () => page.getByRole('dialog', { name: 'Shared YouTube link' })

async function expectCenteredDialog() {
  await expect.poll(() => dialog().evaluate(element => {
    const card = element.getBoundingClientRect()
    const backdrop = element.closest('.prompt')
    const bounds = backdrop.getBoundingClientRect()
    const style = getComputedStyle(backdrop)
    const centerX = (bounds.left + parseFloat(style.paddingLeft) + bounds.right - parseFloat(style.paddingRight)) / 2
    const centerY = (bounds.top + parseFloat(style.paddingTop) + bounds.bottom - parseFloat(style.paddingBottom)) / 2
    return Math.max(Math.abs(card.left + card.width / 2 - centerX), Math.abs(card.top + card.height / 2 - centerY))
  }), { message: 'Shared link dialog must be centered in the available viewport', timeout: 3000 }).toBeLessThanOrEqual(1)
}

async function startOutgoingShare() {
  outgoingPage = page
  await page.evaluate(url => {
    window.shareDialogTestResult = null
    window.Capacitor.nativePromise('Share', 'share', { url }).then(
      result => { window.shareDialogTestResult = { result } },
      error => { window.shareDialogTestResult = { error: error.message } }
    )
  }, url)
}

async function chooseSelf() {
  let bounds
  await expect.poll(async () => {
    const error = await page.evaluate(() => window.shareDialogTestResult?.error)
    assert.equal(error, undefined, 'The native share picker must remain available after cancelling a self-share')
    adb('shell', 'uiautomator', 'dump', '/data/local/tmp/opentubex-share-dialog.xml')
    const xml = adb('shell', 'cat', '/data/local/tmp/opentubex-share-dialog.xml')
    bounds = xml.match(/<node\b[^>]*text="OpenTubeX Dev"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    return !!bounds
  }, { message: 'The native share picker offers OpenTubeX Dev', timeout: 10000 }).toBe(true)
  const [, left, top, right, bottom] = bounds.map(Number)
  adb('shell', 'input', 'tap', String((left + right) / 2), String((top + bottom) / 2))
  // Older Android choosers can return through a second WebView in the task.
  await expect.poll(async () => {
    for (const target of browser.contexts()[0].pages()) {
      if (await target.evaluate(() => document.visibilityState === 'visible' && !!document.querySelector('.sharedLinkPrompt'))) {
        page = target
        return true
      }
    }
    return false
  }, { timeout: 15000 }).toBe(true)
  await expect(dialog()).toBeVisible({ timeout: 15000 })
}

try {
  adb('shell', 'am', 'force-stop', app)
  adb('shell', 'am', 'start', '--user', '0', '-n', component)
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (!port) port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${adb('shell', 'pidof', app)}`)
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
      page = browser.contexts()[0].pages()[0]
      if (page) break
      await browser.close()
    } catch { /* Wait for the app's WebView. */ }
    await delay(100)
  }
  assert.ok(page, 'Android WebView is available')
  page.setDefaultTimeout(5000)
  await expect(page.locator('.topNav')).toBeVisible({ timeout: 30000 })
  savedSettings = await page.evaluate(() => {
    const getters = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters
    return Object.fromEntries(['CurrentLocale', 'BaseTheme', 'SystemDarkTheme', 'SystemLightTheme', 'MainColor', 'SecColor', 'UiScale', 'ReducedMotion', 'EnableDownloads'].map(key => [key, getters[`get${key}`]]))
  })
  await settings({ CurrentLocale: 'en-US', BaseTheme: 'system', SystemDarkTheme: 'dark', SystemLightTheme: 'light', MainColor: 'Red', SecColor: 'Blue', EnableDownloads: true, UiScale: 100, ReducedMotion: 'enabled' })
  if (await page.locator('.tutorialOverlay').isVisible()) {
    await page.locator('.tutorialOverlay').getByRole('button', { name: /^(Skip|Got it)$/ }).click()
  }
  if (await dialog().isVisible()) await dialog().getByRole('button', { name: 'Cancel', exact: true }).press('Enter')
  // Fresh installs can show a managed-tools download notification over Cancel.
  for (const toast of await page.locator('.toast-slot').all()) await toast.locator('..').press('Escape')

  if (mode !== 'self') {
    adb('shell', 'am', 'start', '--user', '0', '-n', component, '-a', 'android.intent.action.SEND', '-t', 'text/plain', '--es', 'android.intent.extra.TEXT', url)
    await expect(dialog()).toBeVisible()
    for (const landscape of [false, true]) {
      adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
      adb('shell', 'settings', 'put', 'system', 'user_rotation', landscape ? '1' : '0')
      await page.waitForFunction(landscape => (innerWidth > innerHeight) === landscape, landscape)
      for (const scale of [67, 80, 100, 125, 150]) {
        await settings({ UiScale: scale })
        await expectCenteredDialog()
        await expect(dialog().getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
        await dialog().getByRole('button', { name: 'Download', exact: true }).scrollIntoViewIfNeeded()
        await expect(dialog().getByRole('button', { name: 'Download', exact: true })).toBeInViewport()
      }
    }
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
    await page.waitForFunction(() => innerWidth < innerHeight)
    await settings({ UiScale: 80 })
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true })
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await page.waitForFunction(theme => document.body.classList.contains(theme), colorScheme)
        await expectCenteredDialog()
        await writeFile(resolve(screenshotDir, `android-share-centered-${colorScheme}.png`), execFileSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p']))
      }
    }
    await dialog().getByRole('button', { name: 'Cancel', exact: true }).click()
    console.log('PASS centered share dialog in portrait and landscape at 67%, 80%, 100%, 125% and 150% UI scales')
  }

  if (mode !== 'layout') {
    await settings({ UiScale: 100 })
    // Exercise the real outbound plugin, system picker, inbound intent and Cancel.
    for (let attempt = 0; attempt < 2; attempt++) {
      await startOutgoingShare()
      await chooseSelf()
      await dialog().getByRole('button', { name: 'Cancel', exact: true }).press('Enter')
      await expect(dialog()).toHaveCount(0)
      if (attempt === 1) {
        await expect.poll(() => outgoingPage.evaluate(() => window.shareDialogTestResult)).not.toBeNull()
        const result = await outgoingPage.evaluate(() => window.shareDialogTestResult)
        assert.equal(result.error, undefined, 'Sharing into the same app must complete successfully')
        assert.equal(result.result.activityType, app)
      }
    }
    await startOutgoingShare()
    await chooseSelf()
    await dialog().getByRole('button', { name: 'Cancel', exact: true }).press('Enter')
    await expect.poll(() => outgoingPage.evaluate(() => window.shareDialogTestResult)).not.toBeNull()
    assert.equal(await outgoingPage.evaluate(() => window.shareDialogTestResult.error), undefined)
    console.log('PASS cancelling a self-share allows repeated native sharing')
    await startOutgoingShare()
    await delay(500)
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    await expect.poll(() => page.evaluate(() => window.shareDialogTestResult?.error)).toBe('Share canceled')
    console.log('PASS dismissing the native picker still cancels the share')
  }
  console.log(`Android API ${adb('shell', 'getprop', 'ro.build.version.sdk')}`)
  console.log(adb('shell', 'dumpsys', 'webviewupdate').split('\n').find(line => line.includes('Current WebView package')))
} finally {
  if (page && await dialog().isVisible().catch(() => false)) await dialog().getByRole('button', { name: 'Cancel', exact: true }).press('Enter')
  if (page && savedSettings) await settings(savedSettings).catch(console.error)
  for (const [key, value] of Object.entries(rotation)) adb('shell', 'settings', value === 'null' ? 'delete' : 'put', 'system', key, ...(value === 'null' ? [] : [value]))
  await browser?.close()
  if (port) adb('forward', '--remove', `tcp:${port}`)
}
