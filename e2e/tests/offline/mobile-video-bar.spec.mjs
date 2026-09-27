import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      uiScale: 125
    }
  }
})

test('mobile video bar follows hidden navigation and stays above the connection banner', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.play())
  const player = page.locator('.ftVideoPlayer')
  await player.evaluate(element => {
    const rect = element.getBoundingClientRect()
    window.scrollTo(0, window.scrollY + rect.bottom)
  })
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  await setWindowSize(app, page, { width: 480, height: 850 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => {
    document.querySelector('.app').classList.add('capacitorTabs', 'capacitorPhoneLayout')
    const player = document.querySelector('.ftVideoPlayer')
    new MutationObserver(() => {
      if (!player.classList.contains('mobileMiniBar')) player.classList.add('mobileMiniBar')
    })
      .observe(player, { attributes: true, attributeFilter: ['class'] })
    player.classList.add('mobileMiniBar')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
  })

  const banner = page.locator('.connection-status-holder')
  await expect(banner).toBeVisible()
  await expect(page.locator('.mobileMiniBar')).toBeVisible()
  const barGap = target => page.evaluate(target => {
    const bar = document.querySelector('.mobileMiniBar').getBoundingClientRect()
    const targetTop = target === 'viewport'
      ? innerHeight
      : document.querySelector(target).getBoundingClientRect().top
    return Math.abs(bar.bottom - targetTop)
  }, target)

  await expect.poll(() => barGap('.connection-status-holder')).toBeLessThan(1)
  await page.locator('.sideNav').evaluate(element => element.classList.add('scrollHidden'))
  await expect.poll(() => barGap('.connection-status-holder')).toBeLessThan(1)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(banner).toHaveCount(0)
  await expect.poll(() => barGap('viewport')).toBeLessThan(1)
  await page.locator('.sideNav').evaluate(element => element.classList.remove('scrollHidden'))
  await expect.poll(() => barGap('.sideNav')).toBeLessThan(1)
  await page.evaluate(() => { location.hash = '#/home' })
  await expect(page).toHaveURL(/#\/home$/)
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs', 'capacitorPhoneLayout'))
  await setWindowSize(app, page, { width: 900, height: 1100 })
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(680)
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(768)
  await expect.poll(() => barGap('viewport')).toBeLessThan(1)
})
