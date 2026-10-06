import { test, expect } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ trace: 'off' })

for (const usePlayerMenuGrid of [true, false]) {
  test.describe(`player options ${usePlayerMenuGrid ? 'grid' : 'list'}`, () => {
    test.use({
      seed: {
        settings: {
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          usePlayerMenuGrid
        }
      }
    })

    test('refreshes translation actions without rebuilding caption tracks', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      await expect.poll(() => video.evaluate(element => element.ui.getControls().getPlayer().getTextTracks().length)).toBeGreaterThan(0)
      await page.waitForTimeout(1000)
      const player = page.locator('.ftVideoPlayer')
      await player.hover()
      await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
      const watch = await page.evaluateHandle(findWatchComponent)
      const translations = await watch.evaluate(component => component.proxy.captionTranslations.slice(0, 2))
      expect(translations).toHaveLength(2)
      const captionsMenu = player.locator('.shaka-text-languages')
      const rows = await captionsMenu.evaluateHandle(element => [...element.querySelectorAll(':scope > button:not(.ft-caption-auto-translate-button)')])
      const overflowMenu = player.locator('.shaka-overflow-menu')
      try {
        await player.getByRole('button', { name: 'More settings' }).click()
        for (const choices of [[], translations.slice(0, 1), translations.slice(1)]) {
          // Change only the reactive props, without a Shaka caption event.
          await watch.evaluate(async (component, value) => {
            component.proxy.captionTranslations = value
            await component.proxy.$nextTick()
          }, choices)
          await overflowMenu.locator(':scope > .shaka-caption-button').click()
          await expect(captionsMenu).toBeVisible()
          const autoTranslate = captionsMenu.getByRole('button', { name: 'Auto-translate', exact: true })
          await expect(autoTranslate).toHaveCount(choices.length === 0 ? 0 : 1)
          if (choices.length > 0) {
            await autoTranslate.click()
            const translationMenu = player.locator('.ft-caption-translation-menu')
            await expect(translationMenu).toBeVisible()
            await expect(translationMenu.locator('.ft-caption-translation-options button')).toHaveText(choices.map(choice => choice.translationName))
            await translationMenu.locator(':scope > .shaka-back-to-overflow-button').click()
          }
          // The appearance and track controls survive each translation refresh.
          expect(await rows.evaluate(elements => elements.every(element => element.isConnected))).toBe(true)
          await captionsMenu.locator(':scope > .shaka-back-to-overflow-button').click()
        }
      } finally {
        await rows.dispose()
        await watch.dispose()
      }
    })

    test('reuses track choices under CPU load in both player themes and UI scales', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      const player = page.locator('.ftVideoPlayer')
      await player.hover()
      await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
      const button = player.getByRole('button', { name: 'More settings' })
      const menu = player.locator('.shaka-overflow-menu')
      await expect.poll(() => video.evaluate(element => element.ui.getControls().getPlayer().getTextTracks().length)).toBeGreaterThan(0)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')
      const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))
      const measurements = []
      try {
        for (const scale of [1, 1.25]) {
          await app.electronApp.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), scale)
          for (const frosted of [true, false]) {
            await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseFrostedGlassPlayerUi', value), frosted)
            // Let track loading, font and theme updates settle before measuring.
            await page.waitForTimeout(1000)
            const rows = await menu.evaluateHandle(element => [...element.querySelectorAll('.audio-tracks > button, .shaka-text-languages > button')])
            expect(await rows.evaluate(elements => elements.length)).toBeGreaterThan(2)
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
            try {
              for (let iteration = 0; iteration < 2; iteration++) {
                const before = await metrics()
                const opening = await button.evaluate(element => new Promise(resolve => {
                  const start = performance.now()
                  element.click()
                  const clickMs = performance.now() - start
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve({ clickMs, paintMs: performance.now() - start })))
                }))
                await expect(menu).toBeVisible()
                await page.waitForTimeout(300)
                const after = await metrics()
                measurements.push({
                  scale,
                  frosted,
                  iteration,
                  ...opening,
                  layouts: after.LayoutCount - before.LayoutCount,
                  layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
                  styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000
                })
                // Row identity catches rebuilding deterministically without a
                // wall-clock budget that would fail on a busy CI machine.
                expect(await rows.evaluate(elements => elements.every(element => element.isConnected))).toBe(true)
                await expect(menu.locator(':scope > .shaka-caption-button')).toBeVisible()
                await menu.getByRole('button', { name: 'Zoom', exact: true }).click()
                const zoomMenu = player.locator('.video-zoom-menu')
                await expect(zoomMenu).toBeVisible()
                await expect(menu.locator(':scope > .shaka-caption-button')).toBeHidden()
                await zoomMenu.locator('.shaka-back-to-overflow-button').click()
                await expect(zoomMenu).toBeHidden()
                await expect(menu.locator(':scope > .shaka-caption-button')).toBeVisible()
                expect(await rows.evaluate(elements => elements.every(element => element.isConnected))).toBe(true)
                await button.evaluate(element => element.click())
                await expect(menu).toBeHidden()
              }
            } finally {
              await rows.dispose()
              await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
            }
          }
        }
      } finally {
        await cdp.detach()
        await testInfo.attach('player-options-performance', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
      }
    })
  })
}
