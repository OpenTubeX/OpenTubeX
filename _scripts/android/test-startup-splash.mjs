import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'
import { DEFAULT_CUSTOM_THEME } from '../../src/customTheme.js'

// Acquire the Android lab device lock and install the current debug APK first.
const serial = process.argv[2]
assert.ok(serial, 'Pass the locked emulator/device serial')
const artifacts = process.argv[3] ?? '/tmp/opentubex-startup-splash'
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
const app = 'org.opentubex.app.dev'
const rotationSettings = ['accelerometer_rotation', 'user_rotation'].map(key => [key, adb('shell', 'settings', 'get', 'system', key)])
let browser
let port

try {
  await mkdir(artifacts, { recursive: true })
  adb('shell', 'am', 'start', '--user', '0', '-n', `${app}/org.opentubex.app.MainActivity`)
  const pid = adb('shell', 'pidof', app)
  port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
  let page
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
      page = browser.contexts()[0].pages()[0]
      if (page) break
      await browser.close()
    } catch { /* The WebView may still be starting. */ }
    await delay(100)
  }
  assert.ok(page, 'Android WebView is available')
  const ready = async () => {
    await expect(page.locator('.topNav')).toBeVisible({ timeout: 30000 })
    await expect(page.locator('#startup-splash')).toHaveCount(0)
    await expect(page.locator('#app')).not.toHaveAttribute('inert')
  }
  await ready()
  const debuggerSession = await page.context().newCDPSession(page)
  await debuggerSession.send('Debugger.enable')
  await debuggerSession.send('Debugger.setBreakpointByUrl', { urlRegex: '/web\\.js$', lineNumber: 0 })
  const pauseRenderer = async () => {
    let timeout
    const paused = new Promise((resolve, reject) => {
      debuggerSession.once('Debugger.paused', resolve)
      timeout = setTimeout(() => reject(new Error('Renderer breakpoint was not reached')), 30000)
    })
    let event
    try {
      const reload = page.reload({ waitUntil: 'commit' })
      event = await paused
      await reload
    } finally {
      clearTimeout(timeout)
    }
    return async expression => {
      const result = await debuggerSession.send('Debugger.evaluateOnCallFrame', {
        callFrameId: event.callFrames[0].callFrameId, expression, returnByValue: true
      })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
  }
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateLandingPage', 'history')
    await store.dispatch('updateHideStartupSplash', false)
    await store.dispatch('updateBaseTheme', 'system')
    await store.dispatch('updateSystemLightTheme', 'light')
    await store.dispatch('updateSystemDarkTheme', 'dark')
    await store.dispatch('updateMainColor', 'Red')
    await store.dispatch('updateSecColor', 'Blue')
  })

  for (const [theme, color, reducedMotion, rotation, colorScheme, capture] of [
    ['system', 'rgb(15, 15, 15)', false, 0, 'dark', 'system-dark'],
    ['system', 'rgb(241, 241, 241)', false, 0, 'light', 'system-light'],
    ['dark', 'rgb(15, 15, 15)', true, 0, 'light', 'dark-reduced-motion'],
    ['dark', 'rgb(15, 15, 15)', false, 1, 'light', 'dark-landscape']
  ]) {
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', String(rotation))
    await expect.poll(() => page.evaluate(() => innerWidth > innerHeight)).toBe(rotation === 1)
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference', colorScheme })
    await page.evaluate(theme => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', theme), theme)
    const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('opentubex-startup-appearance')))
    if (theme === 'system') {
      assert.equal(cached.light.background, '#f1f1f1')
      assert.equal(cached.dark.background, '#0f0f0f')
    } else {
      assert.equal(cached.light.background, '#0f0f0f', 'A fixed theme keeps its palette even in the opposite system mode')
      assert.equal(cached.dark.background, '#0f0f0f')
    }
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme === 'system' ? colorScheme : theme}\\b`))
    const inspect = await pauseRenderer()
    try {
      const geometry = await inspect(`(() => {
        const splash = document.querySelector('#startup-splash')
        const bounds = splash.getBoundingClientRect()
        const logo = splash.querySelector('.startupLogo').getBoundingClientRect()
        return {
          width: bounds.width, height: bounds.height,
          viewportWidth: innerWidth, viewportHeight: innerHeight,
          logoX: logo.x + logo.width / 2, logoY: logo.y + logo.height / 2,
          background: getComputedStyle(splash.querySelector('.startupCurtain')).backgroundColor,
          inert: document.querySelector('#app').hasAttribute('inert'),
          shell: !!document.querySelector('.topNav')
        }
      })()`)
      assert.equal(geometry.background, color)
      assert.ok(geometry.inert)
      assert.equal(geometry.shell, false)
      assert.ok(Math.abs(geometry.width - geometry.viewportWidth) <= 1)
      assert.ok(Math.abs(geometry.height - geometry.viewportHeight) <= 1)
      assert.ok(Math.abs(geometry.logoX - geometry.width / 2) <= 1)
      assert.ok(Math.abs(geometry.logoY - geometry.height / 2) <= 1)
      const screenshot = await debuggerSession.send('Page.captureScreenshot', { format: 'png' })
      await writeFile(`${artifacts}/${capture}.png`, Buffer.from(screenshot.data, 'base64'))
      await inspect(`(() => {
        const splash = document.querySelector('#startup-splash')
        window.__startupReveal = null
        new MutationObserver(() => {
          if (splash.dataset.revealing && !window.__startupReveal) {
            window.__startupReveal = {
              presented: !!document.querySelector('.tabContent[aria-hidden="false"] > .routerView'),
              painted: !splash.querySelector('.startupFabric').hidden
            }
          }
        }).observe(document.body, { attributes: true, childList: true, subtree: true })
      })()`)
      await debuggerSession.send('Debugger.resume')
      await ready()
      const reveal = await page.evaluate(() => window.__startupReveal)
      assert.ok(reveal?.presented, 'The initial tab is presented before revealing')
      assert.equal(reveal.painted, !reducedMotion, 'Reduced motion skips the fabric animation')
    } finally {
      await debuggerSession.send('Debugger.resume').catch(() => {})
    }
  }

  const originalThemes = await page.evaluate(() => localStorage.getItem('opentubex-custom-theme'))
  try {
    for (const selection of ['custom:splash-regression', 'system']) {
      const theme = { ...DEFAULT_CUSTOM_THEME, id: 'splash-regression', colors: { ...DEFAULT_CUSTOM_THEME.colors, background: '#123456' } }
      const lightTheme = { ...DEFAULT_CUSTOM_THEME, id: 'splash-regression-light', isDark: false, basedOn: 'light', colors: { ...DEFAULT_CUSTOM_THEME.colors, background: '#fff8ee' } }
      await page.evaluate(async ({ theme, lightTheme, selection }) => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        localStorage.setItem('opentubex-custom-theme', JSON.stringify([theme, lightTheme]))
        await store.dispatch('updateCustomThemes', [theme, lightTheme])
        await store.dispatch('updateSystemLightTheme', `custom:${lightTheme.id}`)
        await store.dispatch('updateSystemDarkTheme', `custom:${theme.id}`)
        await store.dispatch('updateBaseTheme', selection)
      }, { theme, lightTheme, selection })
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opentubex-startup-appearance')).light.background)).toBe(selection === 'system' ? '#fff8ee' : '#123456')
      theme.colors.background = '#345678'
      lightTheme.colors.background = '#faf0dd'
      await page.evaluate(async themes => {
        localStorage.setItem('opentubex-custom-theme', JSON.stringify(themes))
        await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCustomThemes', themes)
      }, [theme, lightTheme])
      for (const mode of ['light', 'dark']) {
        await expect.poll(() => page.evaluate(mode => JSON.parse(localStorage.getItem('opentubex-startup-appearance'))[mode].background, mode)).toBe(selection === 'system' && mode === 'light' ? '#faf0dd' : '#345678')
      }
      const inspect = await pauseRenderer()
      try {
        assert.equal(await inspect("getComputedStyle(document.querySelector('.startupCurtain')).backgroundColor"), selection === 'system' ? 'rgb(250, 240, 221)' : 'rgb(52, 86, 120)')
        await debuggerSession.send('Debugger.resume')
        await ready()
      } finally {
        await debuggerSession.send('Debugger.resume').catch(() => {})
      }
    }
  } finally {
    await page.evaluate(async original => {
      if (original === null) localStorage.removeItem('opentubex-custom-theme')
      else localStorage.setItem('opentubex-custom-theme', original)
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateBaseTheme', 'dark')
      await store.dispatch('updateSystemLightTheme', 'light')
      await store.dispatch('updateSystemDarkTheme', 'dark')
      await store.dispatch('updateCustomThemes', original === null ? [] : JSON.parse(original))
    }, originalThemes)
  }

  if (await page.locator('.tutorialOverlay').isVisible()) {
    await page.locator('.tutorialActions button').first().click()
    await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
  }
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('showSettingsWindow')
  })
  await page.locator('.settingsMenu [data-section="focus"]').click()
  const toggle = page.locator('[data-setting-key="hideStartupSplash"] input')
  await expect(toggle).toBeAttached()
  await toggle.check({ force: true })
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opentubex-startup-appearance')).hideSplash)).toBe(true)
  const inspect = await pauseRenderer()
  try {
    const state = await inspect(`({
      splash: !!document.querySelector('#startup-splash'),
      inert: document.querySelector('#app').hasAttribute('inert'),
      shell: !!document.querySelector('.topNav')
    })`)
    assert.equal(state.splash, false)
    assert.equal(state.inert, false)
    assert.equal(state.shell, false)
    await debuggerSession.send('Debugger.resume')
    await ready()
  } finally {
    await debuggerSession.send('Debugger.resume').catch(() => {})
  }
  console.log('PASS: Android early splash, saved light/dark appearance, custom theme edits, ready tab reveal, reduced motion, and hide setting')
} finally {
  if (browser) await browser.close()
  if (port) adb('forward', '--remove', `tcp:${port}`)
  for (const [key, value] of rotationSettings) {
    if (value === 'null') adb('shell', 'settings', 'delete', 'system', key)
    else adb('shell', 'settings', 'put', 'system', key, value)
  }
}
