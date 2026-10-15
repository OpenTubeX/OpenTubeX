import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import test from 'node:test'
import { chromium, expect } from '@playwright/test'
import { goToSettingsSection } from '../../e2e/helpers/app.mjs'

const run = promisify(execFile)

// Install the current debug APK, hold the emulator's lab and port locks, and
// forward its WebView. Start with ACCESS_LOCAL_NETWORK revoked and its
// user-set/user-fixed permission flags cleared, outside the app process.
test('Android 17 denies LAN sync until consent and retries successfully after a grant', {
  skip: !process.env.ANDROID_CDP_URL || !process.env.ANDROID_NETWORK_SERIAL,
  timeout: 180000,
}, async () => {
  const serial = process.env.ANDROID_NETWORK_SERIAL
  assert.match(serial, /^emulator-\d+$/)
  const adb = async (...args) => (await run('adb', ['-s', serial, ...args], {
    timeout: 20000, maxBuffer: 8 * 1024 * 1024,
  })).stdout
  assert.equal((await adb('shell', 'getprop', 'ro.build.version.sdk')).trim(), '37')
  const requests = []
  const server = createServer((request, response) => {
    requests.push(request.url)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ capabilities: { encrypted_sync: 1, live_sync: 1 } }))
  })
  let browser
  let page
  let saved
  async function answerPermission (button) {
    let bounds
    await expect.poll(async () => {
      await adb('shell', 'uiautomator', 'dump', '/sdcard/opentubex-permission.xml')
      const xml = await adb('shell', 'cat', '/sdcard/opentubex-permission.xml')
      bounds = xml.match(new RegExp(`resource-id="com.android.permissioncontroller:id/permission_${button}_button"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`))
      return !!bounds
    }, { timeout: 30000 }).toBe(true)
    if (button === 'allow' && process.env.ANDROID_NETWORK_SCREENSHOT) {
      const shot = await run('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
        encoding: 'buffer', maxBuffer: 16 * 1024 * 1024,
      })
      await writeFile(process.env.ANDROID_NETWORK_SCREENSHOT, shot.stdout)
    }
    await adb('shell', 'input', 'tap',
      String((Number(bounds[1]) + Number(bounds[3])) / 2),
      String((Number(bounds[2]) + Number(bounds[4])) / 2))
  }
  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '0.0.0.0', resolve))
    const url = `http://10.0.2.2:${server.address().port}`
    browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    page = browser.contexts()[0].pages()[0]
    await page.locator('.profileTrigger').waitFor()
    const permission = await page.evaluate(() => window.Capacitor.nativePromise('AndroidLocalNetwork', 'checkPermissions', {}))
    assert.notEqual(permission.localNetwork, 'granted', 'Revoke ACCESS_LOCAL_NETWORK and clear its flags outside the app, then restart and forward its WebView before this test')
    saved = await page.evaluate(url => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        SyncServerEnabled: true,
        SyncServerAutoSync: false,
        SyncServerUrl: url,
        SyncServerToken: '',
        CurrentLocale: 'en-US'
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      return saved
    }, url)
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) {
      const back = tutorial.getByRole('button', { name: 'Back', exact: true })
      while (await back.isVisible()) await back.click()
      const skip = tutorial.getByRole('button', { name: 'Skip', exact: true })
      if (await skip.isVisible()) await skip.click()
      else await tutorial.locator('.tutorialActions').getByRole('button').last().click()
      await expect(tutorial).toBeHidden()
    }
    const content = await goToSettingsSection(page, 'sync')
    await answerPermission('deny')
    await expect(content.getByRole('alert')).toBeVisible()
    assert.equal(requests.length, 0, 'A denied LAN request must never reach the server')
    await expect(content.getByRole('textbox', { name: 'Username', exact: true })).toBeDisabled()

    await content.getByRole('textbox', { name: 'Sync server URL', exact: true }).fill(`${url}/retry`)
    await answerPermission('allow')
    await expect(content.getByRole('textbox', { name: 'Username', exact: true })).toBeEnabled()
    assert.ok(requests.includes('/retry/health'), 'Granted LAN sync must use the real native HTTP transport')
    await expect(content.getByRole('alert')).toHaveCount(0)
  } finally {
    try {
      if (saved) {
        await page.evaluate(saved => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          for (const [key, value] of Object.entries(saved)) store.commit('set' + key, value)
        }, saved)
      }
    } finally {
      server.closeAllConnections()
      const cleanup = await Promise.allSettled([
        adb('shell', 'rm', '-f', '/sdcard/opentubex-permission.xml'),
        browser?.close(),
        new Promise(resolve => server.close(resolve)),
      ])
      for (const result of cleanup) {
        if (result.status === 'rejected') console.error('Permission test cleanup failed', result.reason)
      }
    }
  }
})
