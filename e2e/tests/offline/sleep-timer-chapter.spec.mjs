import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { animationSpeed: 0, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

test('sleep timer offers the current chapter and stops before the next one', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())

  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => { vm.videoChapters = [] })
  const chapterEnd = await video.evaluate(element => element.currentTime + 3)
  const chapterOption = page.locator('.sleep-timer-menu button').filter({ hasText: 'End of current chapter' })

  await page.locator('.shaka-overflow-menu-button').click()
  await page.locator('.sleep-timer-button').click()
  await expect(chapterOption).toHaveClass(/shaka-hidden/)

  await watch.evaluate((vm, endSeconds) => {
    vm.videoChapters = [
      { title: 'Current', startSeconds: 0, endSeconds, source: 'description' },
      { title: 'Next', startSeconds: endSeconds, endSeconds: 30, source: 'description' },
    ]
  }, chapterEnd)
  await page.locator('.shaka-overflow-menu-button').click()
  await page.locator('.sleep-timer-button').click()
  await expect(chapterOption).toBeVisible()
  await chapterOption.click()
  await video.evaluate(element => element.play())

  await expect.poll(() => video.evaluate(element => element.paused), { timeout: 10_000 }).toBe(true)
  expect(await video.evaluate(element => element.currentTime)).toBeLessThan(chapterEnd)
})

test('sleep timer clamps its scrolled menu when the chapter option disappears', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.videoChapters = [
      { title: 'First', startSeconds: 0, endSeconds: 10 },
      { title: 'Second', startSeconds: 15, endSeconds: 30 },
    ]
  })
  await page.locator('.shaka-overflow-menu-button').click()
  await page.locator('.sleep-timer-button').click()

  const menu = page.locator('.ftVideoPlayer .shaka-overflow-menu')
  const chapterOption = menu.locator('.sleep-timer-menu button').filter({ hasText: 'End of current chapter' })
  await expect(chapterOption).toBeVisible()
  await menu.evaluate(element => {
    element.style.inlineSize = '200px'
    element.style.maxBlockSize = '130px'
    element.style.minBlockSize = '0'
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const originalOffset = await menu.evaluate(element => element.scrollTop)

  await video.evaluate(element => { element.currentTime = 12 })
  await expect(chapterOption).toHaveClass(/shaka-hidden/)
  await expect.poll(() => menu.evaluate((element, originalOffset) => {
    const buttons = [...element.querySelector('.sleep-timer-menu').children]
      .filter(button => button instanceof HTMLButtonElement && !button.classList.contains('shaka-hidden'))
    const lastButton = buttons.at(-1)
    const contentEnd = lastButton.getBoundingClientRect().bottom - element.getBoundingClientRect().top +
      element.scrollTop + Number.parseFloat(getComputedStyle(element).paddingBottom)
    const realMaximum = Math.max(0, contentEnd - element.clientHeight)
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    const thumb = scrollbar?.querySelector('.os-scrollbar-handle')?.getBoundingClientRect()
    const track = scrollbar?.querySelector('.os-scrollbar-track')?.getBoundingClientRect()
    const scrollbarMatches = realMaximum <= 1
      ? scrollbar?.classList.contains('os-scrollbar-unusable')
      : thumb && track && Math.abs(thumb.bottom - track.bottom) <= 2
    return {
      clamped: element.scrollTop <= realMaximum + 2 && element.scrollTop < originalOffset,
      scrollbarMatches: Boolean(scrollbarMatches),
    }
  }, originalOffset)).toEqual({ clamped: true, scrollbarMatches: true })
})
