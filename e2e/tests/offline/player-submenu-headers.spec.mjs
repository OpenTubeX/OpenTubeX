import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

/**
 * Distances from the title's center to the menu's top edge and to the divider below the header.
 * @param {import('@playwright/test').Locator} submenu
 */
function titleSpacing(submenu) {
  return submenu.evaluate(element => {
    const header = element.querySelector(':scope > .shaka-back-to-overflow-button')
    const menu = element.closest('.shaka-overflow-menu')
    const title = header.querySelector(':scope > span').getBoundingClientRect()
    const titleCenter = title.top + title.height / 2
    const menuTop = menu.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(menu).borderTopWidth)
    const divider = header.getBoundingClientRect().bottom - Number.parseFloat(getComputedStyle(header).borderBottomWidth)
    return { above: titleCenter - menuTop, below: divider - titleCenter }
  })
}

for (const usePlayerMenuGrid of [true, false]) {
  test.describe(`submenu headers in ${usePlayerMenuGrid ? 'grid' : 'list'} menus`, () => {
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

    test('center their title between the menu edge and the divider @scale', async ({ app, page, attachScreenshot }) => {
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      const player = page.locator('.ftVideoPlayer')
      await player.hover()
      // Keep the controls shown, they can fade out before the clicks on slow machines
      await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
      await player.getByRole('button', { name: 'More settings' }).click()
      const overflowMenu = player.locator('.shaka-overflow-menu')

      /**
       * @param {import('@playwright/test').Locator} submenu
       */
      async function expectCenteredTitle(submenu) {
        await expect(submenu).toBeVisible()
        const { above, below } = await titleSpacing(submenu)
        expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
      }

      await overflowMenu.getByRole('button', { name: 'Playback speed' }).click()
      await expectCenteredTitle(player.locator('.shaka-playback-rates'))
      await player.locator('.shaka-playback-rates > .shaka-back-to-overflow-button').click()

      await overflowMenu.getByRole('button', { name: 'Captions' }).click()
      const captionsMenu = player.locator('.shaka-text-languages')
      await expectCenteredTitle(captionsMenu)
      for (const [entry, selector] of [
        ['Options', '.ft-caption-appearance-menu'],
        ['Auto-translate', '.ft-caption-translation-menu'],
        ['Adjust timing…', '.ft-caption-timing-menu'],
      ]) {
        await captionsMenu.getByRole('button', { name: entry, exact: true }).click()
        const submenu = player.locator(selector)
        await expectCenteredTitle(submenu)
        await attachScreenshot(`${entry} header`)
        await submenu.locator(':scope > .shaka-back-to-overflow-button').click()
        await expect(captionsMenu).toBeVisible()
      }
    })
  })
}
