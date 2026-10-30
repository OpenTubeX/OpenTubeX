import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo, openCaptionLanguages } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

/** @param {import('@playwright/test').Locator} locator */
async function getVisibleBounds(locator) {
  const bounds = await locator.boundingBox()
  expect(bounds, `Expected visible bounds for ${locator}`).not.toBeNull()
  return bounds
}

/** @param {string} locale */
function setTestLocale(locale) {
  const app = document.querySelector('#app').__vue_app__
  app._context.provides[app.__VUE_I18N_SYMBOL__].global.locale.value = locale
}

/** @param {HTMLElement} element */
function validTimingScroll(element) {
  const content = element.querySelector('.ft-caption-timing-content').getBoundingClientRect()
  const viewport = element.getBoundingClientRect()
  const viewportEnd = viewport.bottom - Number.parseFloat(getComputedStyle(element).borderBottomWidth)
  const maximum = Math.max(0, element.scrollTop + content.bottom - viewportEnd)
  const unusable = element.querySelector(':scope > .os-scrollbar-vertical').classList.contains('os-scrollbar-unusable')
  return element.scrollTop >= 0 && element.scrollTop <= maximum + 1 &&
    (maximum <= 1 ? element.scrollTop <= 1 : content.bottom >= viewportEnd - 1) &&
    unusable === (maximum <= 1)
}

for (const usePlayerMenuGrid of [true, false]) {
  test.describe(`caption timing in ${usePlayerMenuGrid ? 'grid' : 'list'} menus`, () => {
    test.use({
      seed: {
        settings: {
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          enableSubtitlesByDefault: true,
          usePlayerMenuGrid
        }
      }
    })

    test('shifts displayed cues immediately and resets for the next video', async ({ app, page }, testInfo) => {
      test.setTimeout(120_000)
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      await page.route('https://www.youtube.com/api/timedtext**', route => {
        const translated = new URL(route.request().url()).searchParams.get('fmt') === 'srt'
        return route.fulfill({
          status: 200,
          contentType: translated ? 'application/x-subrip' : 'text/vtt',
          body: translated
            ? '1\n00:00:05,000 --> 00:00:07,000\nTranslated timing test caption\n'
            : 'WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nTiming test caption\n'
        })
      })
      let video = await openMockedVideo(page)
      await video.evaluate(element => {
        element.pause()
        element.currentTime = 6
      })
      const player = page.locator('.ftVideoPlayer')
      const caption = player.locator('.shaka-text-container [translate="no"]')
      await expect(caption).toHaveText('Timing test caption')
      await player.hover()
      await player.getByRole('button', { name: 'More settings' }).click()
      await player.locator('.shaka-overflow-menu').screenshot({ path: testInfo.outputPath('caption-timing-settings-entry.png') })
      await openCaptionLanguages(player)
      const timingRow = player.getByRole('button', { name: 'Adjust timing…', exact: true })
      const languageMenu = player.locator('.shaka-text-languages')
      for (const iconPack of ['material', 'remix']) {
        await page.evaluate(value => window.$store.dispatch('updateIconPack', value), iconPack)
        const menuBounds = await getVisibleBounds(languageMenu)
        // The timing row shares the bottom rows with the subtitle file row
        const rowBounds = await getVisibleBounds(languageMenu.locator(':scope > .ft-caption-actions'))
        expect(rowBounds.width).toBeGreaterThanOrEqual(menuBounds.width - 16)
        const choices = languageMenu.locator(':scope > button:not(.shaka-back-to-overflow-button)')
        for (const choice of await choices.all()) {
          const choiceBounds = await getVisibleBounds(choice)
          expect(choiceBounds.y + choiceBounds.height).toBeLessThanOrEqual(rowBounds.y + 1)
        }
        const iconBounds = await getVisibleBounds(timingRow.locator('.ft-icon__glyph'))
        const labelBounds = await getVisibleBounds(timingRow.locator(':scope > span:last-child'))
        expect(iconBounds.x + iconBounds.width).toBeLessThan(labelBounds.x)
        expect(Math.abs(iconBounds.y + iconBounds.height / 2 - labelBounds.y - labelBounds.height / 2)).toBeLessThanOrEqual(1)
        await languageMenu.screenshot({ path: testInfo.outputPath(`caption-timing-row-${iconPack}.png`) })
      }
      await player.locator('.shaka-text-languages').screenshot({ path: testInfo.outputPath('caption-timing-captions-entry.png') })
      await timingRow.click()
      const menu = player.locator('.ft-caption-timing-menu')
      const scroller = menu.locator('.ft-caption-timing-controls')
      const input = menu.getByRole('spinbutton', { name: 'Offset (seconds)' })
      const timingWatch = await page.evaluateHandle(findWatchComponent)
      const offset = () => timingWatch.evaluate(component => component.proxy.$refs.player.getSabrReloadState().captionTimingOffset)
      await expect(input).toHaveValue('0')
      const header = menu.locator(':scope > .shaka-back-to-overflow-button')
      await expect(header.locator('.shaka-ui-icon')).toHaveCount(1)
      if (usePlayerMenuGrid) {
        const headerBounds = await getVisibleBounds(header)
        const titleBounds = await getVisibleBounds(header.locator(':scope > span'))
        expect(Math.abs(titleBounds.x + titleBounds.width / 2 - headerBounds.x - headerBounds.width / 2)).toBeLessThanOrEqual(1)
      }
      await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
      await player.screenshot({ path: testInfo.outputPath('timing-0-original.png') })

      await input.fill('2')
      await expect.poll(offset).toBe(2)
      await expect(caption).toHaveCount(0)
      await player.screenshot({ path: testInfo.outputPath('timing-1-delayed.png') })
      expect(await video.evaluate(element => element.currentTime)).toBe(6)
      await video.evaluate(element => { element.currentTime = 8 })
      await expect(caption).toHaveText('Timing test caption')
      await player.screenshot({ path: testInfo.outputPath('timing-2-later.png') })

      await input.fill('-2')
      await expect.poll(offset).toBe(-2)
      await expect(caption).toHaveCount(0)
      await player.screenshot({ path: testInfo.outputPath('timing-3-earlier.png') })
      await video.evaluate(element => { element.currentTime = 4 })
      await expect(caption).toHaveText('Timing test caption')
      await player.screenshot({ path: testInfo.outputPath('timing-4-advanced.png') })
      await menu.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(input).toHaveValue('0')
      await expect.poll(offset).toBe(0)
      await expect(caption).toHaveCount(0)
      await player.screenshot({ path: testInfo.outputPath('timing-5-reset.png') })

      await menu.getByRole('button', { name: 'Earlier', exact: true }).click()
      await expect(input).toHaveValue('-0.1')
      await menu.getByRole('button', { name: 'Later', exact: true }).click()
      await expect(input).toHaveValue('0')
      await input.focus()
      await input.press('ArrowUp')
      await expect.poll(offset).toBe(0.1)
      expect(await video.evaluate(element => element.currentTime)).toBe(4)
      await menu.getByRole('button', { name: 'Reset', exact: true }).click()
      await input.fill('')
      await expect(input).toHaveAttribute('aria-invalid', 'true')
      await expect.poll(offset).toBe(0)
      await input.fill('1.25')
      await expect.poll(offset).toBe(1.25)
      await input.press('Tab')
      await expect(input).toHaveValue('1.25')

      // Editing timing keeps playback running and survives caption track changes.
      await video.evaluate(element => element.play())
      await input.fill('1.5')
      expect(await video.evaluate(element => element.paused)).toBe(false)
      await video.evaluate(element => element.pause())
      // Like in Shaka's submenus, a click beside the controls goes back
      await menu.locator('.ft-caption-timing-content > p').click()
      await expect(menu).toBeHidden()
      await expect(languageMenu).toBeVisible()
      await timingRow.click()
      await expect(input).toHaveValue('1.5')
      await menu.getByRole('button', { name: 'Back', exact: true }).click()
      const captionsMenu = player.locator('.shaka-text-languages')
      await captionsMenu.getByRole('button', { name: 'Off', exact: true }).click()
      await expect.poll(offset).toBe(1.5)
      await openCaptionLanguages(player)
      await captionsMenu.getByRole('button', { name: 'Auto-translate', exact: true }).click()
      await player.locator('.ft-caption-translation-menu').getByRole('button', { name: 'German', exact: true }).click()
      await expect.poll(offset).toBe(1.5)
      await video.evaluate(element => { element.currentTime = 7 })
      await expect(caption).toHaveText('Translated timing test caption')
      await captionsMenu.getByRole('menuitemradio', { name: 'English (auto-generated)', exact: true }).click()
      await expect.poll(offset).toBe(1.5)
      const watch = await page.evaluateHandle(findWatchComponent)
      let oldVideo
      try {
        const state = await watch.evaluate(component => component.proxy.$refs.player.getSabrReloadState())
        expect(state.captionTimingOffset).toBe(1.5)
        await watch.evaluate((component, value) => component.proxy.setPlayerReloadState(value), state)
        expect(await watch.evaluate(component => component.proxy.sabrReloadState.captionTimingOffset)).toBe(1.5)
        oldVideo = await video.elementHandle()
        await watch.evaluate(component => { component.proxy.playerLoadGeneration++ })
        await expect.poll(() => oldVideo.evaluate(element => element.isConnected)).toBe(false)
        await expect.poll(offset).toBe(1.5)
        await expect.poll(() => video.evaluate(element => element.ui?.getControls()?.getPlayer()?.getTextTracks().length ?? 0)).toBeGreaterThan(0)
      } finally {
        await oldVideo?.dispose()
        await watch.dispose()
      }

      // Reopening refreshes the input; the compact controls fit narrow and zoomed layouts.
      await video.evaluate(element => {
        element.pause()
        element.currentTime = 7
      })
      await player.hover()
      await player.getByRole('button', { name: 'More settings' }).click()
      await openCaptionLanguages(player)
      await timingRow.click()
      await expect(input).toHaveValue('1.5')
      for (const iconPack of ['material', 'remix']) {
        await page.evaluate(value => window.$store.dispatch('updateIconPack', value), iconPack)
        await expect(menu.locator('.ft-icon__glyph')).toHaveCount(3)
        await menu.screenshot({ path: testInfo.outputPath(`caption-timing-${iconPack}.png`) })
      }
      for (const [scale, width, height] of [[1, 420, 450], [1.25, 430, 910], [2, 440, 920]]) {
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await app.electronApp.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), scale)
        await setWindowSize(app, page, { width, height })
        // Wait for the compact controls to replace the desktop configuration.
        await expect(player.locator('.shaka-controls-button-panel .full-window-button')).toHaveCount(0)
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        // Responsive control rebuilds return an open menu to its main view.
        if (!await menu.isVisible()) {
          if (!await player.locator('.shaka-overflow-menu').isVisible()) {
            await player.hover()
            await player.getByRole('button', { name: 'More settings' }).click()
          }
          await openCaptionLanguages(player)
          // Fractional zoom can introduce tiny floating-point differences.
          expect((await getVisibleBounds(timingRow)).height).toBeGreaterThanOrEqual(48 - 0.01)
          await timingRow.click()
        }
        await expect(input).toBeVisible()
        expect((await getVisibleBounds(input)).height).toBeGreaterThanOrEqual(48 - 0.01)
        for (const action of await menu.locator('.ft-caption-timing-controls button').all()) {
          expect((await getVisibleBounds(action)).height).toBeGreaterThanOrEqual(48 - 0.01)
        }
        const bounds = await getVisibleBounds(menu)
        const viewportWidth = await page.evaluate(() => innerWidth)
        expect(bounds.x).toBeGreaterThanOrEqual(-1)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewportWidth + 1)
        const inputBounds = await getVisibleBounds(input)
        expect(inputBounds.x).toBeGreaterThanOrEqual(bounds.x - 1)
        expect(inputBounds.x + inputBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
        await expect.poll(() => scroller.evaluate(validTimingScroll)).toBe(true)
        // The phone dialog shows the submenu header above its own viewport.
        const headerBounds = await getVisibleBounds(menu.locator(':scope > .shaka-back-to-overflow-button')
          .or(player.locator('.phonePlayerOptions[open] > .shaka-back-to-overflow-button'))
          .filter({ visible: true }))
        const scrollBounds = await getVisibleBounds(scroller)
        expect(scrollBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height - 1)
        await menu.getByRole('button', { name: 'Later', exact: true }).click()
      }
      await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
      await setWindowSize(app, page, { width: 1600, height: 900 })
      video = await openMockedVideo(page, 'aqz-KE-bpKQ')
      await expect.poll(offset).toBe(0)
      await timingWatch.dispose()
    })

    test('clamps rendered timing content after localization and viewport growth', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      const player = page.locator('.ftVideoPlayer')
      await player.hover()
      await player.getByRole('button', { name: 'Full window (s)', exact: true }).click()
      await expect(player).toHaveClass(/fullWindow/)
      await setWindowSize(app, page, { width: 420, height: 910 })
      await player.hover()
      await player.getByRole('button', { name: 'More settings' }).click()
      await openCaptionLanguages(player)
      await player.getByRole('button', { name: 'Adjust timing…', exact: true }).click()
      const menu = player.locator('.ft-caption-timing-menu')
      const scroller = menu.locator('.ft-caption-timing-controls')
      const originalScroller = await scroller.elementHandle()
      const hint = menu.locator('.ft-caption-timing-content > p')
      await menu.locator('.ft-caption-timing-content').screenshot({ path: testInfo.outputPath('caption-timing-phone-controls.png') })
      const longHint = 'A longer localized explanation of caption timing. '.repeat(80)
      await page.evaluate(text => {
        const app = document.querySelector('#app').__vue_app__
        const i18n = app._context.provides[app.__VUE_I18N_SYMBOL__].global
        i18n.mergeLocaleMessage('de-DE', { Video: { Player: { 'Caption Timing': { Hint: text } } } })
        i18n.locale.value = 'de-DE'
      }, longHint)
      await expect(hint).toHaveText(longHint)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect.poll(() => scroller.evaluate(validTimingScroll)).toBe(true)
      await page.evaluate(setTestLocale, 'en-US')
      await expect(hint).not.toHaveText(longHint)
      await expect.poll(() => scroller.evaluate(validTimingScroll)).toBe(true)

      // Keep phone layout active at every height so the same controls stay open.
      await page.evaluate(setTestLocale, 'de-DE')
      await expect(hint).toHaveText(longHint)
      const expandedHeight = await scroller.evaluate(element => element.clientHeight)
      await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ height: 400 }))
      await expect.poll(() => scroller.evaluate(element => element.clientHeight)).toBeLessThan(expandedHeight)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      const compactHeight = await scroller.evaluate(element => element.clientHeight)
      await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ height: 900 }))
      await expect.poll(() => scroller.evaluate(element => element.clientHeight)).toBeGreaterThan(compactHeight)
      await expect.poll(() => scroller.evaluate(validTimingScroll)).toBe(true)
      expect(await originalScroller.evaluate(element => element.isConnected)).toBe(true)
      await originalScroller.dispose()
    })

    if (usePlayerMenuGrid) {
      test('keeps the timing row at the bottom of the captions grid @scale', async ({ app, page }, testInfo) => {
        await mockPlayableWatchPage(app, page, { captionTranslations: true })
        const video = await openMockedVideo(page)
        await video.evaluate(element => element.pause())
        const player = page.locator('.ftVideoPlayer')
        // Folding the control bar into the menu makes it taller than the captions submenu.
        await setWindowSize(app, page, { width: 600, height: 800 })
        await player.hover()
        await player.getByRole('button', { name: 'More settings' }).click()
        await openCaptionLanguages(player)
        const languageMenu = player.locator('.shaka-text-languages')
        const timingRow = languageMenu.locator(':scope > .ft-caption-actions > .ft-caption-timing-button')
        await expect(timingRow).toBeVisible()
        await languageMenu.screenshot({ path: testInfo.outputPath('caption-timing-grid-row.png') })
        const menuBounds = await getVisibleBounds(languageMenu)
        const rowBounds = await getVisibleBounds(timingRow)
        // A taller idle menu leaves free space, which belongs above the row rather than below it.
        expect(menuBounds.height).toBeGreaterThan(rowBounds.height * 3)
        expect(menuBounds.y + menuBounds.height - rowBounds.y - rowBounds.height).toBeLessThanOrEqual(1)
        const choices = languageMenu.locator(':scope > button:not(.shaka-back-to-overflow-button)')
        for (const choice of await choices.all()) {
          const choiceBounds = await getVisibleBounds(choice)
          expect(choiceBounds.y + choiceBounds.height).toBeLessThanOrEqual(rowBounds.y + 1)
        }
      })
    }
  })
}

test.describe('native caption timing', () => {
  test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, enableSubtitlesByDefault: true } } })

  test('advances unseen native captions and restores their original timing', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw'] })
    await page.route('https://www.youtube.com/api/timedtext**', route => route.fulfill({
      status: 200,
      contentType: 'text/vtt',
      body: 'WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nNative timing caption\n'
    }))
    const video = await openMockedVideo(page)
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 1
    })
    await expect.poll(() => video.evaluate(element => element.ui.getControls().getPlayer().getLoadMode())).toBe(3)
    const player = page.locator('.ftVideoPlayer')
    const caption = player.locator('.shaka-text-container [translate="no"]')
    await expect(caption).toHaveCount(0)
    await player.hover()
    await player.getByRole('button', { name: 'More settings' }).click()
    await openCaptionLanguages(player)
    await player.getByRole('button', { name: 'Adjust timing…', exact: true }).click()
    const menu = player.locator('.ft-caption-timing-menu')
    await menu.getByRole('spinbutton', { name: 'Offset (seconds)' }).fill('-2')
    await video.evaluate(element => { element.currentTime = 4 })
    await expect(caption).toHaveText('Native timing caption')
    await menu.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(caption).toHaveCount(0)
    await video.evaluate(element => { element.currentTime = 6 })
    await expect(caption).toHaveText('Native timing caption')
    await menu.getByRole('spinbutton', { name: 'Offset (seconds)' }).fill('2')
    await expect(caption).toHaveCount(0)
    await video.evaluate(element => { element.currentTime = 8 })
    await expect(caption).toHaveText('Native timing caption')
  })

  test('preserves caption timing when built-in playback recovers from HTTP 403', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw'] })
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    const player = page.locator('.ftVideoPlayer')
    await player.hover()
    await player.getByRole('button', { name: 'More settings' }).click()
    await openCaptionLanguages(player)
    await player.getByRole('button', { name: 'Adjust timing…', exact: true }).click()
    await player.getByRole('spinbutton', { name: 'Offset (seconds)' }).fill('1.5')
    const watch = await page.evaluateHandle(findWatchComponent)
    const offset = () => watch.evaluate(component => component.proxy.$refs.player?.getSabrReloadState().captionTimingOffset)
    await expect.poll(offset).toBe(1.5)
    const oldVideo = await video.elementHandle()
    try {
      await watch.evaluate(component => component.proxy.handlePlayerError({
        code: 1001, category: 1, severity: 2, data: ['https://media.test/expired-stream', 403]
      }))
      await expect.poll(() => oldVideo.evaluate(element => element.isConnected)).toBe(false)
      await expect.poll(offset).toBe(1.5)
      await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
    } finally {
      await oldVideo.dispose()
      await watch.dispose()
    }
  })

  test('applies the offset when native captions finish loading while paused', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw'] })
    let releaseCaptions
    const captionsReady = new Promise(resolve => { releaseCaptions = resolve })
    await page.route('https://www.youtube.com/api/timedtext**', async route => {
      await captionsReady
      await route.fulfill({
        status: 200,
        contentType: 'text/vtt',
        body: 'WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nLate-loaded timing caption\n'
      })
    })
    try {
      const video = await openMockedVideo(page)
      await video.evaluate(element => {
        element.pause()
        element.currentTime = 4
      })
      await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false)
      await expect.poll(() => video.evaluate(element => Array.from(element.querySelectorAll('track'))
        .some(track => track.readyState === HTMLTrackElement.LOADING))).toBe(true)
      const player = page.locator('.ftVideoPlayer')
      const caption = player.locator('.shaka-text-container [translate="no"]')
      await expect(caption).toHaveCount(0)
      await player.hover()
      await player.getByRole('button', { name: 'More settings' }).click()
      await openCaptionLanguages(player)
      await player.getByRole('button', { name: 'Adjust timing…', exact: true }).click()
      await player.getByRole('spinbutton', { name: 'Offset (seconds)' }).fill('-2')
      releaseCaptions()
      await expect(caption).toHaveText('Late-loaded timing caption')
      expect(await video.evaluate(element => element.paused)).toBe(true)
      expect(await video.evaluate(element => element.currentTime)).toBe(4)
    } finally {
      releaseCaptions()
    }
  })
})

test.describe('caption actions in the frosted grid menu', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
        enableSubtitlesByDefault: true,
        usePlayerMenuGrid: true,
        useFrostedGlassPlayerUi: true
      }
    }
  })

  test('keeps the action backgrounds inside the rounded menu corners', async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    const player = page.locator('.ftVideoPlayer')
    await player.hover()
    await player.getByRole('button', { name: 'More settings' }).click()
    await openCaptionLanguages(player)
    const languageMenu = player.locator('.shaka-text-languages')
    const timingRow = languageMenu.locator(':scope > .ft-caption-actions > .ft-caption-timing-button')
    await expect(timingRow).toBeVisible()

    for (const roundness of [100, 200]) {
      await page.evaluate(value => window.$store.dispatch('updateUiRoundness', value), roundness)
      await expect(page.locator('body')).toHaveCSS('--ui-roundness', String(roundness / 100))
      const outside = await languageMenu.evaluate((menu) => {
        const outer = menu.closest('.shaka-overflow-menu')
        const bounds = outer.getBoundingClientRect()
        const outerStyle = getComputedStyle(outer)
        const insideMenu = (x, y) => {
          for (const [radius, cx, cy] of [
            [outerStyle.borderBottomLeftRadius, bounds.left, bounds.bottom],
            [outerStyle.borderBottomRightRadius, bounds.right, bounds.bottom]
          ]) {
            const r = Number.parseFloat(radius)
            const centerX = cx === bounds.left ? cx + r : cx - r
            const centerY = cy - r
            const inCorner = (cx === bounds.left ? x < centerX : x > centerX) && y > centerY
            if (inCorner && Math.hypot(x - centerX, y - centerY) > r + 0.5) return false
          }
          return x >= bounds.left - 0.5 && x <= bounds.right + 0.5 && y <= bounds.bottom + 0.5
        }
        const points = []
        for (const button of menu.querySelectorAll(':scope > .ft-caption-actions > button')) {
          const rect = button.getBoundingClientRect()
          const style = getComputedStyle(button)
          for (const [radius, side] of [[style.borderBottomLeftRadius, -1], [style.borderBottomRightRadius, 1]]) {
            const r = Math.min(Number.parseFloat(radius), rect.width / 2, rect.height / 2)
            const centerX = side < 0 ? rect.left + r : rect.right - r
            const centerY = rect.bottom - r
            for (let step = 0; step <= 8; step++) {
              const angle = (step / 8) * Math.PI / 2
              const x = centerX + side * r * Math.sin(angle)
              const y = centerY + r * Math.cos(angle)
              if (!insideMenu(x, y)) points.push({ button: button.className, x, y })
            }
          }
        }
        return points
      })
      expect(outside, `roundness ${roundness}%`).toEqual([])
      await timingRow.hover()
      await player.locator('.shaka-overflow-menu').screenshot({ path: testInfo.outputPath(`caption-actions-roundness-${roundness}.png`) })
    }
  })
})
