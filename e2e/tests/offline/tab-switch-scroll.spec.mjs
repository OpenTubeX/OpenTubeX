import { test, expect, sel, abortUnmockedRequest } from '../../helpers/app.mjs'

for (const currentLocale of ['en-US', 'ar']) {
  test.describe(`desktop tab switching in ${currentLocale}`, { tag: '@scale' }, () => {
    test.use({
      seed: {
        settings: {
          currentLocale,
          reducedMotion: 'on',
          showTabPreviews: false,
          fetchSubscriptionsAutomatically: false
        }
      }
    })

    test('restores tab scroll positions and clamps reduced scroll ranges', async ({ page }) => {
      await page.route(/^https?:\/\//, abortUnmockedRequest)
      const ids = []
      for (const route of ['/history', '/about']) {
        const tab = await page.evaluate(route => window.ftElectron.tabs.create({ route, makeActive: true }), route)
        ids.push(tab.id)
        const content = page.locator(`.tabContent[data-tab-id="${tab.id}"]`)
        await expect(content).toBeVisible()
        await content.evaluate((element, index) => {
          const overflow = document.createElement('div')
          overflow.dataset.tabSwitchOverflow = ''
          overflow.style.height = `${2000 + index * 1000}px`
          element.append(overflow)
        }, ids.length)
      }

      const savedOffsets = new Map(ids.map(id => [id, 0]))
      for (const id of [...ids, ...ids]) {
        await page.locator(`.tab[data-tab-id="${id}"]`).click()
        await expect(page.locator(`.tabContent[data-tab-id="${id}"]`)).toHaveAttribute('aria-hidden', 'false')
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(savedOffsets.get(id), 0)
        await page.evaluate(() => window.scrollTo({ top: 350, behavior: 'instant' }))
        savedOffsets.set(id, await page.evaluate(() => window.scrollY))
        await expect.poll(() => page.evaluate(() => {
          const maximum = document.documentElement.scrollHeight - window.innerHeight
          const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
          const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
          const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
          const expected = window.scrollY / maximum * (track.height - thumb.height)
          return !scrollbar.classList.contains('os-scrollbar-unusable') &&
            Math.abs(thumb.top - track.top - expected) <= 2 / devicePixelRatio
        })).toBe(true)
      }
      await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', ids.at(-1))

      // Start at the long page's end before reducing the range to zero.
      await scrollPageToBottom(page)
      await page.locator(`.tabContent[data-tab-id="${ids[0]}"] [data-tab-switch-overflow]`).evaluate(element => element.remove())
      await page.locator(`.tab[data-tab-id="${ids[0]}"]`).click()
      await expect(page.locator(`.tabContent[data-tab-id="${ids[0]}"]`)).toBeVisible()
      await expect.poll(() => page.evaluate(() => ({
        offset: window.scrollY,
        range: document.documentElement.scrollHeight - window.innerHeight,
        unusable: document.querySelector('body > .os-scrollbar-vertical').classList.contains('os-scrollbar-unusable')
      }))).toEqual({ offset: 0, range: 0, unusable: true })

      // Growing the viewport must also clamp a formerly valid end offset.
      await page.locator(`.tab[data-tab-id="${ids[1]}"]`).click()
      await expect(page.locator(`.tabContent[data-tab-id="${ids[1]}"]`)).toBeVisible()
      await scrollPageToBottom(page)
      const previousRange = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
      await page.setViewportSize({ width: 1600, height: 1200 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThan(previousRange)
      await expectPageScrollbarAtEnd(page)
    })
  })
}

async function scrollPageToBottom(page) {
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  await expectPageScrollbarAtEnd(page)
}

async function expectPageScrollbarAtEnd(page) {
  await expect.poll(() => page.evaluate(() => {
    const maximum = document.documentElement.scrollHeight - window.innerHeight
    const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
    const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
    const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
    const content = document.querySelector('.app > .routerView')
    const renderedBottom = content.getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(content).marginBottom)
    const tolerance = 2 / devicePixelRatio
    return window.scrollY > 0 && Math.abs(window.scrollY - maximum) <= tolerance &&
      Math.abs(renderedBottom - window.innerHeight) <= tolerance &&
      !scrollbar.classList.contains('os-scrollbar-unusable') &&
      Math.abs(thumb.bottom - track.bottom) <= tolerance
  })).toBe(true)
}
