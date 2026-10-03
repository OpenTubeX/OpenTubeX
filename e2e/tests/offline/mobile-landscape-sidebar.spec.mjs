import { test, expect, goTo } from '../../helpers/app.mjs'

for (const uiScale of [100, 125]) {
  test.describe(`landscape sidebar at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale } } })

    test('stays below the header while the page scrolls with a safe-area inset', async ({ app, page }, testInfo) => {
      await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
        BrowserWindow.getAllWindows()[0].setContentSize(Math.round(932 * scale), Math.round(430 * scale))
      }, uiScale / 100)
      await goTo(page, 'history')
      await page.evaluate(() => {
        const app = document.querySelector('.app')
        app.classList.remove('topTabs', 'bottomTabs', 'verticalTabs', 'verticalTabsLeft', 'verticalTabsRight')
        app.classList.add('capacitorTabs', 'capacitorPhoneLayout')
        document.querySelector('.tabBar').style.display = 'none'
        document.querySelector('.app > .routerView').style.minHeight = '3000px'
        document.activeElement?.blur()
        document.documentElement.style.setProperty('--safe-area-inset-left', '47px')
        document.documentElement.style.setProperty('--safe-area-inset-right', '10px')
      })

      const sidebar = page.locator('.sideNav')
      await expect(sidebar).toBeVisible()
      for (const inset of [0, 27]) {
        await page.evaluate(inset => {
          window.scrollTo(0, 0)
          document.documentElement.style.setProperty('--safe-area-inset-top', `${inset}px`)
        }, inset)
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
        const initialTop = await sidebar.evaluate(element => element.getBoundingClientRect().top)
        for (const top of [300, 900, 100, 0]) {
          await page.evaluate(top => window.scrollTo(0, top), top)
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(top)
          await expect.poll(async () => Math.abs(await sidebar.evaluate(element => element.getBoundingClientRect().top) - initialTop), {
            message: 'scrolling the page must not move the sidebar beneath the header'
          }).toBeLessThan(1)
          await expect.poll(() => page.evaluate(() => {
            const nav = document.querySelector('.sideNav').getBoundingClientRect()
            const header = document.querySelector('.topNav').getBoundingClientRect()
            return Math.abs(nav.top - header.bottom)
          })).toBeLessThan(1)
          await expect.poll(() => sidebar.evaluate(element => Math.abs(element.getBoundingClientRect().bottom - innerHeight))).toBeLessThan(1)
        }
      }

      // The sidebar still has its own themed scroll viewport in short landscapes.
      const inner = sidebar.locator('.inner')
      await inner.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => inner.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      await expect(inner.locator(':scope > .os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
      await inner.evaluate(element => { element.scrollTop = 0 })
      await testInfo.attach('landscape sidebar', { body: await page.screenshot(), contentType: 'image/png' })

      await inner.evaluate(element => { element.scrollTop = element.scrollHeight })
      await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
        BrowserWindow.getAllWindows()[0].setContentSize(Math.round(932 * scale), Math.round(600 * scale))
      }, uiScale / 100)
      await expect.poll(() => inner.evaluate(element => element.scrollTop)).toBe(0)
      await expect(inner.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
      await expect.poll(() => sidebar.evaluate(element => Math.abs(element.getBoundingClientRect().bottom - innerHeight))).toBeLessThan(1)
    })
  })
}
