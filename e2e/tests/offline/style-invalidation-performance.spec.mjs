import { test, expect, goTo } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

test.use({ seed: { settings: { currentLocale: 'en-US' } } })

/**
 * Applies a change to an element and reverts it, then checks that Chromium
 * restyled only a few elements instead of the element's subtree.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {string} selector
 * @param {{ class: string } | { viewportToken: [string, string] } | { properties: string[] }} change
 * @param {number} [maxRestyled]
 */
async function expectLocalRestyle(page, name, selector, change, maxRestyled = 10) {
  const session = await page.context().newCDPSession(page)
  const events = []
  session.on('Tracing.dataCollected', ({ value }) => events.push(...value))
  await session.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' })
  const subtreeSize = await page.locator(selector).evaluate((element, { name, change }) => {
    const apply = () => {
      if (change.class) {
        element.classList.add(change.class)
        return () => element.classList.remove(change.class)
      }
      if (change.viewportToken) {
        // OverlayScrollbars rewrites this whenever a scroller's size, content,
        // or overflow changes.
        const attribute = 'data-overlayscrollbars-viewport'
        const [from, to] = change.viewportToken
        const value = element.getAttribute(attribute)
        const tokens = value.split(' ').filter(token => token !== from)
        element.setAttribute(attribute, [...tokens, to].join(' '))
        return () => element.setAttribute(attribute, value)
      }
      const values = change.properties.map(property => [property, element.style.getPropertyValue(property)])
      for (const [property] of values) element.style.setProperty(property, '123px')
      return () => {
        for (const [property, value] of values) element.style.setProperty(property, value)
      }
    }
    // Reading a computed value flushes pending style work.
    const flushStyles = () => getComputedStyle(element).getPropertyValue('color')
    flushStyles()
    console.timeStamp(`${name} start`)
    const revert = apply()
    flushStyles()
    revert()
    flushStyles()
    console.timeStamp(`${name} end`)
    return element.querySelectorAll('*').length
  }, { name, change })
  const complete = new Promise(resolve => session.once('Tracing.tracingComplete', resolve))
  await session.send('Tracing.end')
  await complete
  await session.detach()

  const stamp = message => events.find(event => event.name === 'TimeStamp' && event.args?.data?.message === message)
  const start = stamp(`${name} start`)
  const end = stamp(`${name} end`)
  const restyled = events
    .filter(event => event.name === 'UpdateLayoutTree' && event.tid === start.tid && event.ts >= start.ts && event.ts <= end.ts)
    .reduce((total, event) => total + (event.args?.elementCount ?? 0), 0)
  console.log(`The ${name} restyled ${restyled} of ${subtreeSize} descendants`)
  expect(subtreeSize, `the ${name} needs a large subtree`).toBeGreaterThan(500)
  expect.soft(restyled, `the ${name} restyled the subtree`).toBeLessThan(maxRestyled)
}

async function openSettings(page) {
  await page.evaluate(() => window.$store.dispatch('showSettingsWindow'))
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.locator('.settingsWindow')).not.toHaveClass(/settings-window-enter-active/)
}

// A selector keyed on the class attribute that ends in a universal descendant
// makes Chromium restyle the whole subtree of every element whose class
// changes, such as the body or a window that toggles its transition classes.
test('class changes restyle only the changed element', async ({ page }) => {
  await openSettings(page)
  const change = { class: 'styleInvalidationProbe' }
  await expectLocalRestyle(page, 'body class', 'body', change)
  await expectLocalRestyle(page, 'settings window class', '.settingsWindow', change)
})

// Inherited overflow properties, or a rule that hides the children while the
// viewport attribute holds a token, restyle all of the content on each update.
test('scroller state changes restyle only the scroller', async ({ page }) => {
  await openSettings(page)
  const viewport = '.settingsContent[data-overlayscrollbars-viewport~="overflowYScroll"]'
  // The scrollbars beside the viewport restyle with it.
  await expectLocalRestyle(page, 'overflow change', viewport, { viewportToken: ['overflowYScroll', 'overflowYHidden'] }, 30)
  await expectLocalRestyle(page, 'measuring state', viewport, { viewportToken: ['', 'measuring'] }, 30)
})

test.describe('thumbnail grid', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US' },
      history: Array.from({ length: 30 }, (_, index) => ({
        _id: `gridVideo${String(index).padStart(2, '0')}a`,
        videoId: `gridVideo${String(index).padStart(2, '0')}a`,
        title: `Grid video ${index}`,
        author: 'Grid Channel',
        authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
        published: Date.now() - 86400000 * (index + 1),
        lengthSeconds: 60,
        timeWatched: Date.now() - index * 60000,
        type: 'video'
      }))
    }
  })

  // The grid writes its column sizes whenever its width changes, such as on
  // every frame of the side navigation animation.
  test('column size changes restyle only the grid', async ({ page }) => {
    // Loading placeholders animate, so they restyle on every flush.
    await page.route(/^https:\/\/i\.ytimg\.com\/vi\//, route => fulfillVisualFixture(route, 'video-thumbnail'))
    await goTo(page, 'history')
    const grid = '.autoGrid.grid.thumbnailSizeReady'
    await expect(page.locator(`${grid} > *`)).toHaveCount(30)
    await expectImagesLoaded(page.locator(`${grid} .thumbnailImage`))
    // A changed custom property still restyles the direct children, about two
    // elements per card and change, but not the cards' contents.
    await expectLocalRestyle(page, 'grid column size', grid, {
      properties: ['--thumbnail-grid-size', '--thumbnail-grid-stretch', '--shorts-thumbnail-grid-min-size']
    }, 200)
  })
})
