import { test, expect, expectScrollAtRenderedEnd, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

for (const zoomFactor of [1, 1.25]) {
  test(`transcript languages stay compact and scroll at ${zoomFactor * 100}% UI scale`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await page.evaluate(factor => window.ftElectron.setZoomFactor(factor), zoomFactor)
    const watch = await watchViewHandle(page)
    await watch.evaluate(vm => {
      vm.captions = Array.from({ length: 30 }, (_, index) => ({
        url: 'https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=en&fmt=vtt',
        label: `Language ${index + 1}`,
        language: 'en'
      }))
      vm.showTranscript = true
    })
    const languageButton = page.getByRole('button', { name: 'Transcript language', exact: true })
    await languageButton.click()
    const menu = page.locator('.transcriptLanguageMenu')
    await expect(menu.getByRole('button')).toHaveCount(30)
    await expect.poll(() => menu.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(334)
    await expect.poll(() => menu.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
    await expect(menu.locator('.os-scrollbar-vertical')).toHaveCount(1)

    const scrollToEnd = async () => {
      await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expectScrollAtRenderedEnd(menu)
      await expect(menu.locator('.os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
    }
    await scrollToEnd()
    await menu.getByRole('button', { name: 'Language 30', exact: true }).click()
    await expect(menu).toHaveCount(0)
    await languageButton.click()
    await expect(menu.getByRole('button', { name: 'Language 30', exact: true })).toHaveClass(/selected/)

    for (const size of [{ width: 1400, height: 550 }, { width: 1600, height: 1000 }, { width: 480, height: 800 }]) {
      await scrollToEnd()
      await setWindowSize(app, page, size)
      // Responsive layout can remount the transcript into the phone panel.
      if (!await menu.count()) {
        await page.getByRole('button', { name: 'Show transcript', exact: true }).click()
        await languageButton.click()
      }
      await expect.poll(() => menu.evaluate(element =>
        element.clientHeight <= Math.min(320, window.innerHeight / 2) + 12
      )).toBe(true)
      await expect.poll(() => menu.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const contentEnd = element.querySelector('.transcriptLanguages').getBoundingClientRect().bottom +
          Number.parseFloat(style.paddingBottom)
        return element.scrollTop <= element.scrollHeight - element.clientHeight + 1 &&
          contentEnd >= bounds.bottom - Number.parseFloat(style.borderBottomWidth) - 2
      })).toBe(true)
      await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expectScrollAtRenderedEnd(menu)
      await expect(menu.locator('.os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
    }

    await scrollToEnd()
    await watch.evaluate(vm => { vm.captions.splice(15) })
    await expect(menu.getByRole('button')).toHaveCount(15)
    await expectScrollAtRenderedEnd(menu)
    await expect(menu.locator('.os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)

    await scrollToEnd()
    await watch.evaluate(vm => { vm.captions = vm.captions.slice(0, 2) })
    await expect(menu.getByRole('button')).toHaveCount(2)
    await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBe(0)
    await expect.poll(() => menu.evaluate(element => element.scrollHeight - element.clientHeight)).toBe(0)
    await expect(menu.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
    await expect(menu.getByRole('button').last()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await watch.dispose()
  })
}
