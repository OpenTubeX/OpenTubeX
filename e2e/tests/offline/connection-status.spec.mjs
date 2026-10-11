import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, goTo, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'
import { createInternetProbe, INTERNET_CHECK_URL } from '../../../src/renderer/helpers/internetConnectivity.js'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { fetchSubscriptionsAutomatically: false, currentLocale: 'en-US' } } })

test.describe('full-window connection banner', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
        animationSpeed: 0,
        currentLocale: 'en-US',
      }
    }
  })

  for (const scale of [1, 1.25]) {
    test(`reconnecting banner spans full-window playback at UI scale ${scale}`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.locator('video.player').evaluate(video => video.pause())
      await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.route(INTERNET_CHECK_URL, route => route.abort('internetdisconnected'))
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
        window.dispatchEvent(new Event('offline'))
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
        window.dispatchEvent(new Event('online'))
      })
      const banner = page.locator('.connectionStatus')
      const player = page.locator('.ftVideoPlayer')
      await expect(banner).toHaveText('Connection lost. Trying to reconnect…')
      const toggleFullWindow = () => player.locator('.full-window-button').click()
      const expectPlayerAboveBanner = async () => {
        await expect(player).toBeVisible()
        await expect(banner).toBeVisible()
        await expect.poll(async () => {
          const videoBounds = await player.boundingBox()
          const statusBounds = await banner.boundingBox()
          if (!videoBounds || !statusBounds) return Infinity
          return Math.abs(videoBounds.y + videoBounds.height - statusBounds.y)
        }, { message: 'Full-window player must clear the visible connection banner' }).toBeLessThan(1)
      }
      const expectBounds = async (left, right, bottom) => {
        await expect.poll(() => banner.evaluate((element, { left, right, bottom }) => {
          const bounds = element.getBoundingClientRect()
          return Math.max(
            Math.abs(bounds.left - left),
            Math.abs(window.innerWidth - bounds.right - right),
            Math.abs(window.innerHeight - bounds.bottom - bottom)
          )
        }, { left, right, bottom })).toBeLessThan(1)
      }
      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(direction => { document.documentElement.dir = direction }, direction)
        for (const position of ['left', 'right', 'top', 'bottom']) {
          await page.evaluate(position => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            store.commit('setTabBarPosition', position)
            store.commit('setVerticalTabBarWidth', 280)
          }, position)
          const left = position === 'left' ? 280 : 0
          const right = position === 'right' ? 280 : 0
          const bottom = position === 'bottom' ? 34 : 0
          await expectBounds(left, right, bottom)
          await toggleFullWindow()
          await expect(player).toHaveClass(/fullWindow/)
          await expectBounds(0, 0, 0)
          await expectPlayerAboveBanner()
          await toggleFullWindow()
          await expect(player).not.toHaveClass(/fullWindow/)
          await expectBounds(left, right, bottom)
        }
      }
      // Wrapped translations and resizing must resize the reserved area too.
      await toggleFullWindow()
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setShowProgressBarToast', false)
        store.commit('setShowProgressBar', true)
      })
      await expect(page.locator('.app > .progressBar')).toBeVisible()
      for (const safeArea of ['0px', '24px']) {
        await page.evaluate(safeArea => document.documentElement.style.setProperty('--safe-area-inset-bottom', safeArea), safeArea)
        await expectPlayerAboveBanner()
      }
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('--safe-area-inset-bottom')
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setShowProgressBar', false)
      })
      await banner.evaluate(element => { element.style.fontSize = '28px' })
      await page.setViewportSize({ width: 480, height: 800 })
      await expectPlayerAboveBanner()
      await page.route(INTERNET_CHECK_URL, route => route.fulfill({ status: 204 }))
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await expect(banner).toHaveText('Back online')
      await expect(banner).toBeHidden()
      await expect.poll(() => player.evaluate(element => Math.abs(innerHeight - element.getBoundingClientRect().bottom))).toBeLessThan(1)
    })
  }
})

for (const scale of [1, 1.25]) {
  test(`connection banner reserves page and settings space at UI scale ${scale}`, async ({ page }) => {
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setTabBarPosition', 'left')
      const content = document.createElement('div')
      content.dataset.connectionLayoutContent = ''
      content.style.height = '1600px'
      document.querySelector('.tabContent[aria-hidden="false"] .routerView').append(content)
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    const banner = page.locator('.connectionStatus')
    await expect(banner).toBeVisible()
    await banner.evaluate(element => {
      element.style.fontSize = '28px'
      element.textContent = 'Connection lost. Trying to reconnect…'
    })
    const expectValidScrollEnd = async (maximumBeforeResize = Infinity) => {
      await expect.poll(() => page.evaluate(maximumBeforeResize => {
        const root = document.documentElement
        const maximum = root.scrollHeight - root.clientHeight
        const handle = document.querySelector('body > .os-scrollbar-vertical .os-scrollbar-handle')
        const fraction = Number(getComputedStyle(handle).getPropertyValue('--os-viewport-percent'))
        return Math.max(
          maximum <= maximumBeforeResize
            ? Math.abs(maximum - root.scrollTop)
            : Math.max(0, -root.scrollTop, root.scrollTop - maximum),
          Math.abs(root.clientHeight / fraction - root.scrollHeight)
        ) * devicePixelRatio
      }, maximumBeforeResize)).toBeLessThanOrEqual(2)
    }
    await page.setViewportSize({ width: 1600, height: 800 })
    await expect.poll(() => banner.evaluate(element => Math.abs(
      element.getBoundingClientRect().height -
      parseFloat(getComputedStyle(document.body).getPropertyValue('--connection-status-height'))
    ))).toBeLessThan(1)
    for (const width of [1600, 480, 1600]) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await expect.poll(async () => {
        const content = await page.locator('[data-connection-layout-content]').boundingBox()
        const status = await banner.boundingBox()
        if (!content || !status) return -Infinity
        return status.y - content.y - content.height
      }).toBeGreaterThanOrEqual(0)
      const maximumBeforeResize = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)
      await page.setViewportSize({ width, height: 800 })
      await expect.poll(() => banner.evaluate(element => Math.abs(
        element.getBoundingClientRect().height -
        parseFloat(getComputedStyle(document.body).getPropertyValue('--connection-status-height'))
      ))).toBeLessThan(1)
      // Responsive content may grow even when the banner unwraps. Require
      // the bottom only when the actual scroll range stays the same or shrinks.
      await expectValidScrollEnd(maximumBeforeResize)
      if (width === 1600) {
        await expect.poll(async () => {
          const sidebar = await page.locator('.sideNav').boundingBox()
          const status = await banner.boundingBox()
          if (!sidebar || !status) return -Infinity
          return status.y - sidebar.y - sidebar.height
        }).toBeGreaterThanOrEqual(-1)
      }
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await banner.evaluate(element => { element.style.fontSize = '' })
    await expectValidScrollEnd()
    // Restore the narrow header's full width and reveal its quick settings.
    await page.evaluate(() => {
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setTabBarPosition', 'top')
      window.scrollTo(0, 0)
    })
    await page.setViewportSize({ width: 480, height: 800 })
    await goTo(page, 'settings')
    await expect(page.locator('.settingsWindow')).toHaveClass(/maximized/)
    await expect.poll(async () => {
      const settings = await page.locator('.settingsWindow').boundingBox()
      const status = await banner.boundingBox()
      if (!settings || !status) return Infinity
      return Math.abs(settings.y + settings.height - status.y)
    }).toBeLessThan(1)
    await page.locator('.settingsWindowHeader').getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      window.dispatchEvent(new Event('online'))
    })
    await expect(banner).toBeHidden()
    await expectValidScrollEnd()
  })
}

for (const scale of [1, 1.25]) {
  for (const surface of ['sidebar', 'settings']) {
    test(`${surface} nested scrollers clear the connection banner at UI scale ${scale}`, async ({ app, page }) => {
      await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const resize = async (width, height) => {
        await app.electronApp.evaluate(({ BrowserWindow }, bounds) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setBounds({ ...window.getBounds(), ...bounds })
        }, { width: Math.round(width * scale), height: Math.round(height * scale) })
        await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
      }
      await resize(1600, 700)
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
        window.dispatchEvent(new Event('offline'))
      })
      const banner = page.locator('.connection-status-holder .connectionStatus')
      await expect(banner).toBeVisible()
      await banner.evaluate(element => {
        element.style.fontSize = '40px'
        element.textContent = 'Connection lost. Trying to reconnect…'
      })
      if (surface === 'settings') {
        await goToSettingsSection(page, 'general')
        await page.locator('.settingsWindow').getByRole('button', { name: 'Maximize', exact: true }).click()
      }
      const scrollers = surface === 'sidebar'
        ? [page.locator('.sideNav .inner')]
        : [page.locator('.settingsMenu'), page.locator('.settingsContent')]
      for (const scroller of scrollers) {
        await scroller.evaluate(element => {
          const content = element.querySelector(':scope > .section') ?? element
          const end = document.createElement(element.matches('menu') ? 'li' : 'div')
          end.dataset.connectionScrollEnd = ''
          end.style.height = '1200px'
          end.style.flexShrink = '0'
          content.append(end)
        })
      }
      const expectNestedEnd = async (scroller, maximumBefore = Infinity) => {
        const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
        await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
        await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
        await expect.poll(() => scroller.evaluate((element, maximumBefore) => {
          const content = element.querySelector(':scope > .section, [data-connection-scroll-end]')
          const trackElement = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-track')
          const thumbElement = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-handle')
          if (!content || !trackElement || !thumbElement) return Infinity
          const style = getComputedStyle(element)
          const contentEnd = content.getBoundingClientRect().bottom +
            Number.parseFloat(getComputedStyle(content).marginBottom) + Number.parseFloat(style.paddingBottom)
          const viewportEnd = element.getBoundingClientRect().bottom - Number.parseFloat(style.borderBottomWidth)
          const maximum = element.scrollHeight - element.clientHeight
          const track = trackElement.getBoundingClientRect()
          const thumb = thumbElement.getBoundingClientRect()
          return Math.max(
            Math.max(0, -element.scrollTop, element.scrollTop - maximum),
            maximum <= maximumBefore ? Math.abs(contentEnd - viewportEnd) : Math.max(0, viewportEnd - contentEnd),
            Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) * track.height,
            maximum <= maximumBefore ? Math.abs(track.bottom - thumb.bottom) : 0
          ) * devicePixelRatio
        }, maximumBefore)).toBeLessThanOrEqual(2)
      }
      const triggers = [
        () => resize(surface === 'sidebar' ? 720 : 1200, 700),
        () => resize(1600, 900),
        () => banner.evaluate(element => { element.style.fontSize = '' }),
        async () => {
          await page.evaluate(() => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
            window.dispatchEvent(new Event('online'))
          })
          await expect(banner).toBeHidden()
        }
      ]
      for (const trigger of triggers) {
        const maximums = []
        for (const scroller of scrollers) {
          await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
          await expectNestedEnd(scroller)
          maximums.push(await scroller.evaluate(element => element.scrollHeight - element.clientHeight))
        }
        await trigger()
        for (const [index, scroller] of scrollers.entries()) {
          await expectNestedEnd(scroller, maximums[index])
        }
      }
    })
  }
}

test('sync connection status does not reserve global banner space', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 })
  const section = await goToSettingsSection(page, 'general')
  await section.evaluate(element => {
    // SyncSettings uses this same class while connected and online.
    const status = document.createElement('p')
    status.className = 'connectionStatus'
    status.textContent = 'Connected as test user'
    element.append(status)
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setShowProgressBarToast', false)
    store.commit('setShowProgressBar', true)
  })
  await expect(page.locator('.app > .progressBar')).toBeVisible()
  await expect(page.locator('.connection-status-holder .connectionStatus')).toBeHidden()
  await expect.poll(() => page.locator('.settingsWindow').evaluate(element =>
    Math.abs(innerHeight - element.getBoundingClientRect().bottom)
  )).toBeLessThan(1)
})

test('internet probe works with browser web security enabled', async ({ app }) => {
  let probeRequests = 0
  await app.electronApp.context().route(INTERNET_CHECK_URL, route => {
    if (route.request().frame().url() === 'about:blank') probeRequests++
    return route.fulfill({ status: 204 })
  })
  const reachable = await app.electronApp.evaluate(async ({ BrowserWindow }, { probeSource, url }) => {
    // Explicitly enforce the fetch restrictions that also apply to WebView,
    // independently of the app window configuration.
    const window = new BrowserWindow({ show: false, webPreferences: { webSecurity: true } })
    try {
      await window.loadURL('about:blank')
      return await window.webContents.executeJavaScript(`
        const INTERNET_CHECK_URL = ${JSON.stringify(url)};
        (${probeSource})(fetch)(new AbortController().signal)
      `)
    } finally {
      window.destroy()
    }
  }, { probeSource: createInternetProbe.toString(), url: INTERNET_CHECK_URL })
  expect(reachable).toBe(true)
  expect(probeRequests).toBe(1)
})

for (const scale of [1, 1.25]) {
  test(`connection banner excludes vertical tabs at UI scale ${scale}`, async ({ page }) => {
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    const banner = page.locator('.connectionStatus')
    await expect(banner).toBeVisible()
    for (const direction of ['ltr', 'rtl']) {
      await page.evaluate(direction => { document.documentElement.dir = direction }, direction)
      for (const position of ['left', 'right', 'top', 'bottom']) {
        for (const width of [220, 280]) {
          await page.evaluate(({ position, width }) => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            store.commit('setTabBarPosition', position)
            store.commit('setVerticalTabBarWidth', width)
          }, { position, width })
          await expect.poll(() => banner.evaluate((element, { position, width }) => {
            const bounds = element.getBoundingClientRect()
            return Math.max(
              Math.abs(bounds.left - (position === 'left' ? width : 0)),
              Math.abs(window.innerWidth - bounds.right - (position === 'right' ? width : 0))
            )
          }, { position, width })).toBeLessThan(1)
        }
      }
    }
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setTabBarPosition', 'left')
      document.querySelector('.app').requestFullscreen()
    })
    await expect(banner).toBeHidden()
    await page.evaluate(() => document.exitFullscreen())
    await expect(banner).toBeVisible()
    await goTo(page, 'settings')
    await page.getByRole('button', { name: 'Maximize', exact: true }).click()
    await expect(page.locator('.settingsWindow')).toHaveClass(/maximized/)
    await expect.poll(() => banner.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Math.max(Math.abs(bounds.left), Math.abs(window.innerWidth - bounds.right))
    })).toBeLessThan(1)
    await page.locator('.settingsWindowHeader').getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => banner.evaluate(element => element.getBoundingClientRect().left)).toBeCloseTo(280, 0)
  })

  test(`connection banner follows navbar coverage at UI scale ${scale}`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 })
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    const banner = page.locator('.connection-status-holder')
    await expect(banner).toBeVisible()
    const bottomGap = () => banner.evaluate(element => window.innerHeight - element.getBoundingClientRect().bottom)
    await expect.poll(bottomGap).toBeCloseTo(60, 0)
    await goTo(page, 'settings')
    await expect(page.locator('.settingsWindow')).toHaveClass(/maximized/)
    await expect.poll(bottomGap).toBeCloseTo(0, 0)
    await page.locator('.app').evaluate(element => element.classList.add('capacitorPhoneLayout'))
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px'))
    await expect.poll(bottomGap).toBeCloseTo(24, 0)
    await page.locator('.settingsWindowHeader').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await expect.poll(bottomGap).toBeCloseTo(84, 0)

    // The mobile sheet component is developed separately; exercise its DOM contract.
    await page.evaluate(() => {
      const sheet = document.createElement('dialog')
      sheet.className = 'mobileSheet'
      document.body.append(sheet)
    })
    const sheet = page.locator('dialog.mobileSheet')
    await expect.poll(bottomGap).toBeCloseTo(84, 0)
    await sheet.evaluate(element => element.show())
    await expect.poll(bottomGap).toBeCloseTo(24, 0)
    await sheet.evaluate(element => element.close())
    await expect.poll(bottomGap).toBeCloseTo(84, 0)
    await sheet.evaluate(element => element.remove())
  })

  test(`connection banner pauses requests and confirms recovery at UI scale ${scale}`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 })
    await page.locator('.app').evaluate(element => element.classList.add('capacitorPhoneLayout'))
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let requests = 0
    await page.route('https://connection.example/**', route => {
      requests++
      return route.fulfill({ status: 200, body: 'restored', headers: { 'access-control-allow-origin': '*' } })
    })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
      window.connectionTestRequests = Promise.all(Array.from({ length: 8 }, () => fetch('https://connection.example/status').then(response => response.text())))
    })
    const banner = page.locator('.connectionStatus')
    await expect(banner).toHaveText('Offline')
    await expect(banner).toBeVisible()
    expect(requests).toBe(0)
    await expect(page.locator('.toast-slot:not(.persistent-slot)')).toHaveCount(0)
    const geometry = await banner.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight }
    })
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(geometry.width)
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height - 60)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      window.dispatchEvent(new Event('online'))
    })
    expect(await page.evaluate(() => window.connectionTestRequests)).toEqual(Array(8).fill('restored'))
    expect(requests).toBe(8)
    await expect(banner).toHaveText('Back online')
    await expect(banner).toHaveCSS('background-color', 'rgb(33, 110, 57)')
    await expect(banner).toBeHidden({ timeout: 5000 })
  })
}

test('an unavailable service retries quietly while another service remains usable', async ({ page }) => {
  let failedRequests = 0
  await page.route('https://unavailable.example/**', route => {
    failedRequests++
    return route.abort('connectionrefused')
  })
  await page.route('https://connection.example/**', route => route.fulfill({ status: 200, body: 'working' }))
  await page.evaluate(() => {
    window.connectionTestController = new AbortController()
    window.connectionTestPending = fetch('https://unavailable.example/status', {
      signal: window.connectionTestController.signal
    }).catch(error => error.name)
  })
  try {
    await expect.poll(() => failedRequests).toBeGreaterThanOrEqual(2)
    expect(await page.evaluate(() => fetch('https://connection.example/status').then(response => response.text()))).toBe('working')
    await expect(page.locator('.connectionStatus')).toBeHidden()
    await expect(page.locator('.toast-slot:not(.persistent-slot)')).toHaveCount(0)
  } finally {
    await page.evaluate(async () => {
      window.connectionTestController.abort()
      await window.connectionTestPending
    })
  }
})

for (const position of ['bottom-center', 'top-right']) {
  test.describe(position, () => {
    test.use({ seed: { settings: { fetchSubscriptionsAutomatically: false, toastPosition: position } } })
    for (const scale of [1, 1.25]) {
      test(`offline status and wrapped toasts do not overlap at UI scale ${scale} at ${position}`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 })
        await page.evaluate(scale => {
          window.ftElectron.setZoomFactor(scale)
          document.querySelector('.app').classList.add('capacitorPhoneLayout')
          Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
          window.dispatchEvent(new Event('offline'))
          window.ftElectron.showToastOnAllTabs('A separate notification with enough text to wrap onto several lines on a small phone.', 30000, ['fas', 'check'])
        }, scale)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const banner = page.locator('.connectionStatus')
        const toast = page.locator('.toast', { hasText: 'A separate notification' })
        await expect(banner).toBeVisible()
        await expect(toast).toBeVisible()
        // Exercise a longer translated status and enlarged text as well as
        // the notification wrapping independently above or below it.
        await banner.evaluate(element => {
          element.textContent = 'இணைய இணைப்பு இல்லை'
          element.style.fontSize = '28px'
        })
        for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }]) {
          await page.setViewportSize(viewport)
          await expect.poll(async () => {
            const status = await banner.boundingBox()
            const notification = await toast.boundingBox()
            return status.y - notification.y - notification.height
          }).toBeGreaterThanOrEqual(9)
          const bounds = await banner.boundingBox()
          const viewportWidth = await page.evaluate(() => window.innerWidth)
          expect(bounds.x).toBeCloseTo(0, 1)
          expect(bounds.width).toBeCloseTo(viewportWidth, 1)
        }
      })
    }
  })
}

test('connection status shares space with progress and hides offline in fullscreen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 480, height: 800 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => {
    window.ftElectron.setZoomFactor(1.25)
    document.querySelector('.app').classList.add('capacitorPhoneLayout')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setProgressBarMessage', 'A separate operation in progress')
    store.commit('setProgressBarIcon', ['fas', 'download'])
    store.commit('setShowProgressBar', true)
    window.ftElectron.showToastOnAllTabs('A separate notification', 30000, ['fas', 'check'])
  })
  const banner = page.locator('.connectionStatus')
  const progress = page.getByTestId('progress-toast')
  const toast = page.locator('.toast', { hasText: 'A separate notification' })
  await expect(progress).toBeVisible()
  await expect.poll(async () => {
    const notification = await toast.boundingBox()
    const status = await banner.boundingBox()
    const operation = await progress.boundingBox()
    return Math.min(status.y - notification.y - notification.height, status.y - operation.y - operation.height)
  }).toBeGreaterThanOrEqual(9)
  await page.screenshot({ path: testInfo.outputPath('offline-toast-spacing.png') })
  await page.evaluate(() => document.querySelector('.app').requestFullscreen())
  await expect(progress).toBeHidden()
  await expect(banner).toBeHidden()
  await expect(toast).toBeVisible()
  await page.evaluate(() => document.exitFullscreen())
  await expect(progress).toBeVisible()
  await expect(banner).toBeVisible()
  await page.evaluate(() => document.querySelector('.app').requestFullscreen())
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.locator(':fullscreen .connectionStatus')).toHaveText('Back online')
})

test('a connected router without internet pauses requests and recovers without an OS network event', async ({ page }) => {
  let reachable = false
  let requests = 0
  await page.route(INTERNET_CHECK_URL, route => reachable ? route.fulfill({ status: 204 }) : route.abort('internetdisconnected'))
  await page.route('https://wan.example/**', route => {
    requests++
    return reachable ? route.fulfill({ status: 200, body: 'recovered' }) : route.abort('internetdisconnected')
  })
  await page.evaluate(() => {
    window.wanRequest = fetch('https://wan.example/data').then(response => response.text())
  })
  const banner = page.locator('.connectionStatus')
  await expect(banner).toHaveText('Connection lost. Trying to reconnect…')
  expect(await page.evaluate(() => navigator.onLine)).toBe(true)
  expect(requests).toBe(1)
  await expect(page.locator('.toast-slot:not(.persistent-slot)')).toHaveCount(0)
  reachable = true
  expect(await page.evaluate(() => window.wanRequest)).toBe('recovered')
  await expect(banner).toHaveText('Back online')
  expect(requests).toBe(2)
})

test('startup recognises WAN loss and later recovery without an OS network event', async ({ page }) => {
  let reachable = false
  await page.route(INTERNET_CHECK_URL, route => reachable ? route.fulfill({ status: 204 }) : route.abort('internetdisconnected'))
  await page.reload()
  const banner = page.locator('.connectionStatus')
  await expect(banner).toHaveText('Connection lost. Trying to reconnect…')
  expect(await page.evaluate(() => navigator.onLine)).toBe(true)
  await expect(page.locator('.toast-slot:not(.persistent-slot)')).toHaveCount(0)
  reachable = true
  await expect(banner).toHaveText('Back online')
  await expect(banner).toBeHidden()
})

test.describe('internet check privacy setting', () => {
  test.use({ seed: { settings: { fetchSubscriptionsAutomatically: false, internetConnectivityChecks: false } } })

  test('opt-out persists, skips startup probes, and can be toggled without restarting', async ({ app, page }) => {
    let requests = 0
    await page.route(INTERNET_CHECK_URL, route => {
      requests++
      return route.fulfill({ status: 204 })
    })
    await page.reload()
    await goToSettingsSection(page, 'privacy')
    const toggle = page.getByRole('checkbox', { name: 'Internet connectivity checks' })
    const label = page.locator('label.switch-label').filter({ hasText: 'Internet connectivity checks' })
    await expect(toggle).not.toBeChecked()
    expect(requests).toBe(0)
    await label.click()
    await expect(toggle).toBeChecked()
    await expect.poll(() => requests).toBe(1)
    const saved = async () => latestSettings(await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')).internetConnectivityChecks
    await expect.poll(saved).toBe(true)
    await label.click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(saved).toBe(false)
    await page.reload()
    await goToSettingsSection(page, 'privacy')
    await expect(toggle).not.toBeChecked()
    expect(requests).toBe(1)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      window.dispatchEvent(new Event('online'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Back online')
    expect(requests).toBe(1)
  })
})

test('only internet recovery animates the full-width banner and reduced motion is respected', async ({ page }) => {
  await page.route(INTERNET_CHECK_URL, route => route.abort('internetdisconnected'))
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
  })
  const banner = page.locator('.connectionStatus')
  await expect(banner).toHaveText('Offline')
  await expect(banner).not.toHaveClass(/reconnecting/)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(banner).toHaveClass(/reconnecting/)
  await expect.poll(() => banner.evaluate(element => getComputedStyle(element, '::after').animationName)).toMatch(/^connection-sweep/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => banner.evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('none')
})

test('the full-width banner clears navigation and notifications in narrow desktop windows', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 })
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
    window.ftElectron.showToastOnAllTabs('A separate notification', 30000, ['fas', 'check'])
  })
  const banner = page.locator('.connectionStatus')
  const toast = page.locator('.toast', { hasText: 'A separate notification' })
  await expect(banner).toBeVisible()
  await expect(toast).toBeVisible()
  await expect.poll(async () => {
    const status = await banner.boundingBox()
    const navigation = await page.locator('.sideNav').boundingBox()
    const notification = await toast.boundingBox()
    return Math.min(navigation.y - status.y - status.height, status.y - notification.y - notification.height)
  }).toBeGreaterThanOrEqual(0)
})
