import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { expect } from '@playwright/test'
import { connectAndroidApp, measureNativeTouchOrigin } from '../helpers/android-webview.mjs'

// Run against an already installed debug APK on a locked device. Unlike CDP
// touch injection, Android's native input reproduces the Pixel's missing click.
// ANDROID_ADB_HOST optionally routes ADB through an SSH host.
// ANDROID_WEBVIEW_TOP overrides the WebView's physical top inset, which the
// test otherwise measures with a canceled native touch.
const enabled = process.env.ANDROID_CDP_URL && process.env.ANDROID_SERIAL
const exec = promisify(execFile)

test('the first native Android tap after pulling the organizer selects its card', { skip: !enabled }, async () => {
  const serial = process.env.ANDROID_SERIAL
  assert.match(serial, /^[\w.:-]+$/)
  const host = process.env.ANDROID_ADB_HOST
  if (host) assert.match(host, /^[\w.-]+$/)
  const { browser, page } = await connectAndroidApp()
  const keepAlive = setTimeout(() => {}, 120_000)
  const dialog = page.locator('#capacitor-phone-tab-dialog')
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  const wasOpen = await dialog.count() > 0
  const traceName = '__organizerNativeTapTest'
  let savedTabs
  const shell = async command => host
    ? (await exec('ssh', ['-o', 'BatchMode=yes', host, `adb -s ${serial} shell '${command}'`])).stdout
    : (await exec('adb', ['-s', serial, 'shell', command])).stdout
  try {
    if (wasOpen) await close.click()
    // Tabs left by earlier tests can push the active card under the
    // organizer's bottom actions, where a tap cannot reach it.
    savedTabs = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const tabs = JSON.parse(JSON.stringify(store.state.tabs))
      store.commit('setTabsState', { ...store.state.tabs, tabs: [store.getters.getPresentedTab] })
      return tabs
    })
    const ratio = await page.evaluate(() => devicePixelRatio)
    const inset = process.env.ANDROID_WEBVIEW_TOP
      ? Number(process.env.ANDROID_WEBVIEW_TOP)
      : (await measureNativeTouchOrigin(page, shell)).y
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
      await shell(command)
      const events = await page.evaluate(name => window[name].events, traceName)
      assert.ok(events.some(event => event.type === 'pointerdown' && event.card && event.moving),
        `native tap must reach the card during settlement: ${JSON.stringify(events)}`)
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
    if (savedTabs) {
      await page.evaluate(tabs => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setTabsState', tabs)
        store.commit('setPresentedTab', tabs.presentedTabId)
      }, savedTabs)
    }
    if (wasOpen) await page.locator('.capacitorPhoneTabSwitcherButton').click()
    await browser.close()
    clearTimeout(keepAlive)
  }
})
