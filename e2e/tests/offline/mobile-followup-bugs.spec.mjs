import { test, expect, goTo } from '../../helpers/app.mjs'

test.use({ seed: { settings: { ytDlpFfmpegSource: 'managed', backendPreference: 'invidious', defaultInvidiousInstance: 'https://invidious.test' } } })

for (const { width, uiScale } of [{ width: 740, uiScale: 100 }, { width: 900, uiScale: 100 }, { width: 1000, uiScale: 125 }]) {
  test.describe(`landscape at ${uiScale}% scale`, () => {
    test.use({ seed: { settings: { uiScale } } })
    test(`forced phone pages stay beside the sidebar in landscape at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 400 })
      for (const route of ['userplaylists', 'history', 'subscribedchannels', 'stats']) {
        await goTo(page, route)
        await page.locator('.app').evaluate(element => {
          element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
          element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
        })
        const main = await page.locator('.app > .routerView').boundingBox()
        const nav = await page.locator('.sideNav').boundingBox()
        expect(main.y, route).toBeLessThan(130)
        expect(main.x, route).toBeGreaterThanOrEqual(nav.x + nav.width)
        expect(main.x + main.width, route).toBeLessThanOrEqual(width)
      }
    })
  })
}
