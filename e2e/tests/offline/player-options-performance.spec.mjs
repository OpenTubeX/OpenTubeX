import { test, expect } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo, openCaptionLanguages } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ trace: 'off' })

test.describe('player options grid', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
        usePlayerMenuGrid: true
      }
    }
  })

  test('refreshes translation actions without rebuilding caption tracks', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await expect.poll(() => video.evaluate(element => element.ui.getControls().getPlayer().getTextTracks().length)).toBeGreaterThan(0)
    // Late track loading rebuilds the menu rows without an observable signal.
    await page.waitForTimeout(1000)
    const player = page.locator('.ftVideoPlayer')
    await player.hover()
    await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
    const watch = await page.evaluateHandle(findWatchComponent)
    const translations = await watch.evaluate(component => component.proxy.captionTranslations.slice(0, 2))
    expect(translations).toHaveLength(2)
    const captionsMenu = player.locator('.shaka-text-languages')
    const rows = await captionsMenu.evaluateHandle(element => [...element.querySelectorAll(':scope > button:not(.ft-caption-auto-translate-button)')])
    try {
      await player.getByRole('button', { name: 'More settings' }).click()
      for (const choices of [[], translations.slice(0, 1), translations.slice(1)]) {
        // Change only the reactive props, without a Shaka caption event.
        await watch.evaluate(async (component, value) => {
          component.proxy.captionTranslations = value
          await component.proxy.$nextTick()
        }, choices)
        await openCaptionLanguages(player)
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
        // The track controls survive each translation refresh.
        expect(await rows.evaluate(elements => elements.every(element => element.isConnected))).toBe(true)
        await captionsMenu.locator(':scope > .shaka-back-to-overflow-button').click()
      }
    } finally {
      await rows.dispose()
      await watch.dispose()
    }
  })
})

test.describe('player options while seeking', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
      }
    }
  })

  test('scrubbing only refreshes the menu entries when it closes a menu', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    const player = page.locator('.ftVideoPlayer')
    // Shaka seeks 125 ms after the last input and hides the menus again then.
    // Wait for that seek so it cannot close a menu opened after this scrub.
    const countMenuClosesWhileScrubbing = () => player.evaluate(async (element) => {
      const controls = element.ui.getControls()
      const seekBar = element.querySelector('.shaka-seek-bar')
      const seeking = new Promise(resolve => element.querySelector('video').addEventListener('seeking', resolve, { once: true }))
      let closes = 0
      // Each submenu also announces once, with its container, whenever the
      // overflow menu hides. Count the controls' announcement, which the seek
      // bar requests on every input.
      const countClose = event => { if (!event.container) closes++ }
      controls.addEventListener('submenuclose', countClose)
      for (let step = 0; step < 10; step++) {
        seekBar.dispatchEvent(new Event('input'))
      }
      await seeking
      controls.removeEventListener('submenuclose', countClose)
      return closes
    })

    expect(await countMenuClosesWhileScrubbing()).toBe(0)

    await player.hover()
    await player.getByRole('button', { name: 'More settings' }).click()
    await expect(player.locator('.shaka-overflow-menu')).toBeVisible()
    expect(await countMenuClosesWhileScrubbing()).toBe(1)
    await expect(player.locator('.shaka-overflow-menu')).toBeHidden()
  })
})
