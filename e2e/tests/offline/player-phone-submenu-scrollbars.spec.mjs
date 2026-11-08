import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo, openPlayerOptions, settleMenuZoom } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: { ...WATCH_PAGE_SEED, reducedMotion: 'on' } } })

for (const [width, height] of [[844, 390], [390, 844], [932, 430]]) {
  test(`phone slider submenus fit without a stray horizontal scrollbar at ${width}×${height} @scale`, async ({ app, page, uiScale, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await setWindowSize(app, page, { width: Math.round(width * uiScale / 100), height: Math.round(height * uiScale / 100) })
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    await page.keyboard.press('s')
    await expect(player).toHaveClass(/fullWindow/)
    await openPlayerOptions(player)
    const sheet = player.locator('.phonePlayerOptions[open]')
    const back = sheet.locator(':scope > .shaka-back-to-overflow-button')

    for (const [entry, selector] of [
      ['.shaka-playbackrate-button', '.shaka-playback-rates'],
      ['.shaka-caption-size-button', '.ft-caption-font-sizes'],
      ['.shaka-caption-background-opacity-button', '.ft-caption-background-opacities'],
    ]) {
      if (entry !== '.shaka-playbackrate-button') {
        await sheet.locator('.shaka-overflow-menu > .shaka-caption-button').click()
        await sheet.locator('.ft-caption-options-button').click()
      }
      await sheet.locator(entry).click()
      const submenu = sheet.locator(selector)
      await expect(submenu.getByRole('slider')).toBeVisible()

      await settleMenuZoom(player)
      await expect.poll(() => submenu.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await expect.poll(() => sheet.locator('.os-scrollbar-horizontal').evaluateAll(elements => elements
        .filter(element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        .map(element => element.parentElement.className))).toEqual([])
      // Every preset remains within the submenu, including padding on the row.
      expect(await submenu.locator('.shaka-playback-rate-presets').evaluate(element => {
        const parent = element.parentElement.getBoundingClientRect()
        return [...element.children].every(child => {
          const box = child.getBoundingClientRect()
          return box.left >= parent.left - 1 && box.right <= parent.right + 1
        })
      })).toBe(true)
      await attachScreenshot(`${selector} without a horizontal scrollbar`)
      await back.click()
      if (entry !== '.shaka-playbackrate-button') {
        await back.click()
        await back.click()
      }
    }
  })
}
