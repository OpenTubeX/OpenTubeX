import { test, expect, sel, setPlayerFullscreen } from '../../helpers/app.mjs'
import { findWatchComponent } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { uiScale: 125 } } })

for (const input of ['touch', 'mouse']) {
  test(`fullscreen recommendations context menu accepts ${input} input`, async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.locator('.ftVideoPlayer')).toBeVisible()
    const watch = await page.evaluateHandle(findWatchComponent)
    await watch.evaluate(component => {
      component.proxy.$store.commit('setFullscreenActions', ['recommendations'])
      component.proxy.recommendedVideos = [{
        videoId: 'related0001',
        title: 'Recommended video',
        author: 'Recommendation channel',
        authorId: 'UC-recommendation-test',
        type: 'video',
        lengthSeconds: 60,
        viewCount: 100,
      }]
    })
    await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenActions').getByRole('button', { name: 'Recommended videos', exact: true }).click()
    const card = page.locator('.fullscreenRecommendationsOverlay .ft-list-video').first()
    if (input === 'touch') {
      await card.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 100, clientY: 100 })
    } else {
      await card.click({ button: 'right' })
    }
    const menu = page.locator(input === 'touch' ? '.mobileLinkActions' : '.contextMenu')
    await expect(menu).toBeVisible()
    await expect.poll(() => menu.evaluate(element => {
      const button = element.querySelector('button:not([disabled])')
      const bounds = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
    })).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`fullscreen-${input}-menu.png`) })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
    if (input === 'touch') {
      await card.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, pointerId: 2, clientX: 100, clientY: 100 })
      await menu.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click()
      await expect(menu).toHaveCount(0)
      await expect.poll(() => watch.evaluate(component => component.proxy.$store.getters.getWatchQueue.some(video => video.videoId === 'related0001'))).toBe(true)
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
    }
    await watch.dispose()
  })
}
