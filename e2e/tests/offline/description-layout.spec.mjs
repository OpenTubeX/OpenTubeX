import { test, expect, goTo } from '../../helpers/app.mjs'
import { mockUnplayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'

for (const scale of [100, 125]) {
  test.describe(`description layout at ${scale}% UI scale`, () => {
    test.use({
      seed: {
        settings: { uiScale: scale, currentLocale: 'en-US', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
        history: [watchHistoryEntry]
      }
    })

    test('short descriptions fit their content with centered text and copy control', async ({ app, page }, testInfo) => {
      await mockUnplayableWatchPage(app, page)
      await goTo(page, 'history')
      await page.getByText(watchHistoryEntry.title, { exact: true }).click()
      await expect(page.locator('.videoDescription:visible')).toBeVisible()
      const view = await watchViewHandle(page)
      await view.evaluate(async component => {
        component.isLoading = true
        await component.$nextTick()
        component.videoDescription = 'A short description.'
        component.videoDescriptionHtml = ''
        component.videoTags = []
        component.videoGames = []
        component.license = null
        component.contentDisclosures = []
        component.isLoading = false
        await component.$nextTick()
      })
      const card = page.locator('.videoDescription:visible')
      await expect(card.locator('.description')).toHaveText('A short description.')
      await expect(card.locator('.descriptionStatus')).toHaveCount(0)

      for (const lines of [1, 2, 4, 1]) {
        await view.evaluate((component, count) => {
          component.videoDescription = Array(count).fill('A short description.').join('\n')
        }, lines)
        await expect.poll(() => card.evaluate(element => {
          const card = element.getBoundingClientRect()
          const text = element.querySelector('.description').getBoundingClientRect()
          return Math.abs((text.top - card.top) - (card.bottom - text.bottom))
        }), { message: 'Description text has equal space above and below it' }).toBeLessThanOrEqual(1)
      }

      await expect.poll(() => card.evaluate(element => {
        const card = element.getBoundingClientRect()
        const copy = element.querySelector('.descriptionCopyButton').getBoundingClientRect()
        return Math.abs((copy.top + copy.bottom - card.top - card.bottom) / 2)
      }), { message: 'Copy control is vertically centered in the one-line card' }).toBeLessThanOrEqual(1)
      await expect.poll(() => card.evaluate(element => {
        const text = element.querySelector('.description').getBoundingClientRect()
        const style = getComputedStyle(element)
        const padding = Number.parseFloat(style.paddingBlockStart) + Number.parseFloat(style.paddingBlockEnd)
        return Math.abs(element.getBoundingClientRect().height - text.height - padding)
      }), { message: 'Card reserves only its normal vertical padding' }).toBeLessThanOrEqual(1)

      await page.mouse.move(0, 0)
      for (const theme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: theme })
        await expect(page.locator('body')).toContainClass(theme)
        await testInfo.attach(`one-line description ${theme}`, {
          body: await card.screenshot(), contentType: 'image/png'
        })
      }
    })
  })
}
