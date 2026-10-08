import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { chromium, expect } from '@playwright/test'

// Run against an already installed debug APK on a locked device. Unlike CDP
// touch injection, Android's native input reproduces the Pixel's missing click.
// ANDROID_ADB_HOST optionally routes ADB through an SSH host. Set
// ANDROID_WEBVIEW_TOP to the WebView's physical top inset (0 for edge-to-edge).
const enabled = process.env.ANDROID_CDP_URL && process.env.ANDROID_SERIAL
const exec = promisify(execFile)

test('the first native Android tap after pulling the organizer selects its card', { skip: !enabled }, async () => {
  const serial = process.env.ANDROID_SERIAL
  assert.match(serial, /^[\w.:-]+$/)
  const host = process.env.ANDROID_ADB_HOST
  if (host) assert.match(host, /^[\w.-]+$/)
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const keepAlive = setTimeout(() => {}, 120_000)
  const dialog = page.locator('#capacitor-phone-tab-dialog')
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  const wasOpen = await dialog.count() > 0
  const traceName = '__organizerNativeTapTest'
  try {
    if (wasOpen) await close.click()
    const ratio = await page.evaluate(() => devicePixelRatio)
    const inset = Number(process.env.ANDROID_WEBVIEW_TOP || 0)
    const center = async selector => {
      const rect = await page.locator(selector).boundingBox()
      assert.ok(rect)
      return {
        x: Math.round((rect.x + rect.width / 2) * ratio),
        y: Math.round((rect.y + rect.height / 2) * ratio + inset),
      }
    }
    await page.evaluate(name => {
      const state = { events: [] }
      state.listener = event => state.events.push({
        type: event.type,
        time: performance.now(),
        header: !!event.target.closest?.('.topNav'),
        card: !!event.target.closest?.('.capacitorPhoneTabTarget'),
        moving: !!document.querySelector('.organizerSwipePage'),
      })
      window[name] = state
      for (const type of ['pointerdown', 'pointerup']) document.addEventListener(type, state.listener, true)
    }, traceName)
    for (const target of ['.capacitorTabPreview', '.capacitorPhoneTabTitle', '.capacitorTabPreview']) {
      await page.locator('.capacitorPhoneTabSwitcherButton').click()
      const card = await center(`.capacitorPhoneTabTarget[aria-selected="true"] ${target}`)
      await close.click()
      await expect(dialog).toHaveCount(0)
      const start = await center('.capacitorPhoneTabSwitcherButton')
      await page.evaluate(name => { window[name].events = [] }, traceName)
      const command = `input swipe ${start.x} ${start.y} ${start.x - Math.round(45 * ratio)} ${start.y + Math.round(225 * ratio)} 180; input tap ${card.x} ${card.y}`
      if (host) await exec('ssh', ['-o', 'BatchMode=yes', host, `adb -s ${serial} shell '${command}'`])
      else await exec('adb', ['-s', serial, 'shell', command])
      const events = await page.evaluate(name => window[name].events, traceName)
      assert.ok(events.some(event => event.type === 'pointerdown' && event.card && event.moving),
        'native tap must reach the card during settlement, not after a test-induced wait')
      await expect(dialog, 'one native tap must close the organizer without a second tap').toHaveCount(0)
    }
  } finally {
    await page.evaluate(name => {
      const state = window[name]
      if (!state) return
      for (const type of ['pointerdown', 'pointerup']) document.removeEventListener(type, state.listener, true)
      delete window[name]
    }, traceName)
    if (await close.isVisible()) await close.click()
    if (wasOpen) await page.locator('.capacitorPhoneTabSwitcherButton').click()
    await browser.close()
    clearTimeout(keepAlive)
  }
})
