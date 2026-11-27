import { test, expect, goTo } from '../../helpers/app.mjs'
import { mockCapacitorPhoneLayout } from '../../helpers/mobile.mjs'
import { openMockedVideo, openPlayerOptions } from '../../helpers/player.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { currentLocale: 'en-US' } } })

/**
 * Records Chromium's timeline while `run` runs, and returns the main thread's
 * events between the `${name} start` and `${name} end` time stamps.
 *
 * @template T
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {() => Promise<T>} run
 * @returns {Promise<{ result: T, events: any[] }>}
 */
async function traceBetweenStamps(page, name, run) {
  const session = await page.context().newCDPSession(page)
  const events = []
  session.on('Tracing.dataCollected', ({ value }) => events.push(...value))
  await session.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' })
  const result = await run()
  const complete = new Promise(resolve => session.once('Tracing.tracingComplete', resolve))
  await session.send('Tracing.end')
  await complete
  await session.detach()

  const stamp = message => events.find(event => event.name === 'TimeStamp' && event.args?.data?.message === message)
  const start = stamp(`${name} start`)
  const end = stamp(`${name} end`)
  return { result, events: events.filter(event => event.tid === start.tid && event.ts >= start.ts && event.ts <= end.ts) }
}

/** @param {any[]} events */
function countRestyled(events) {
  return events
    .filter(event => event.name === 'UpdateLayoutTree')
    .reduce((total, event) => total + (event.args?.elementCount ?? 0), 0)
}

/**
 * Applies a change to an element and reverts it, then checks that Chromium
 * restyled only a few elements instead of the element's subtree.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {string} selector
 * @param {{ class: string, target?: string } | { scrollbarState: true } | { properties: string[], target?: string }} change
 * @param {number} [maxRestyled]
 */
async function expectLocalRestyle(page, name, selector, change, maxRestyled = 10) {
  const { result: subtreeSize, events } = await traceBetweenStamps(page, name, () => page.locator(selector).evaluate((element, { name, change }) => {
    const apply = () => {
      if (change.class) {
        const target = change.target ? element.querySelector(change.target) : element
        target.classList.add(change.class)
        return () => target.classList.remove(change.class)
      }
      if (change.scrollbarState) {
        // The scrollbar helper writes these whenever a scroller's size,
        // content, or overflow changes.
        const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
        const viewportPercent = scrollbar.style.getPropertyValue('--os-viewport-percent')
        const toggle = () => {
          scrollbar.classList.toggle('os-scrollbar-visible')
          scrollbar.classList.toggle('os-scrollbar-unusable')
        }
        toggle()
        scrollbar.style.setProperty('--os-viewport-percent', '0.5')
        return () => {
          toggle()
          scrollbar.style.setProperty('--os-viewport-percent', viewportPercent)
        }
      }
      const target = change.target ? element.querySelector(change.target) : element
      const values = change.properties.map(property => [property, target.style.getPropertyValue(property)])
      for (const [property] of values) target.style.setProperty(property, '123px')
      return () => {
        for (const [property, value] of values) target.style.setProperty(property, value)
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
  }, { name, change }))
  const restyled = countRestyled(events)
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

// A rule that matches content through a scrollbar's state, or state kept on
// the scroller itself, would restyle all of the content on each update.
test('scroller state changes restyle only the scroller', async ({ page }) => {
  await openSettings(page)
  const viewport = '.settingsContent[data-overlayscrollbars-viewport]'
  await expect(page.locator(`${viewport} > .os-scrollbar-vertical`)).toHaveClass(/os-scrollbar-visible/)
  await expectLocalRestyle(page, 'scrollbar state', viewport, { scrollbarState: true }, 30)
})

// The first Watch page of a session loads the player's styles. Custom
// properties they declared on the root would restyle every element of the
// page that Watch opens from, twice.
test('loading the player styles does not restyle the page', async ({ page }) => {
  await openSettings(page)
  const { result: documentSize, events } = await traceBetweenStamps(page, 'player styles', () => page.evaluate(async () => {
    const flushStyles = () => getComputedStyle(document.body).getPropertyValue('color')
    flushStyles()
    console.timeStamp('player styles start')
    // The lazy Watch view resolves once its styles have loaded.
    await window.$router.resolve('/watch/aaaaaaaaaaa').matched.at(-1).components.default.__asyncLoader()
    flushStyles()
    console.timeStamp('player styles end')
    return document.body.querySelectorAll('*').length
  }))
  const restyled = countRestyled(events)
  console.log(`Loading the player styles restyled ${restyled} of ${documentSize} elements`)
  expect(documentSize, 'the page needs many elements').toBeGreaterThan(500)
  expect(restyled, 'loading the player styles restyled the page').toBeLessThan(documentSize / 10)
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

test.describe('player', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US', videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true }
    }
  })

  // Shaka moves the seek bar preview with inline styles on every pointer move.
  // A `:has()` that matches inline styles makes Chromium check every `:has()`
  // on the page again, restyling the watch page on each move.
  test('seek bar preview moves restyle only the preview', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    const player = page.locator('.ftVideoPlayer')
    await player.hover()
    const bar = await player.locator('.shaka-seek-bar').boundingBox()
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2)
    await expect(player.locator('.shaka-player-ui-thumbnail-container')).toHaveCSS('visibility', 'visible')
    await expectLocalRestyle(page, 'seek bar preview position', '.videoLayout', {
      properties: ['left'],
      target: '.shaka-player-ui-thumbnail-container'
    }, 20)
  })

  // Shaka switches the options menu's views with a class, and the pointer and
  // focus move between its entries. A `:has()` that checks such a state on an
  // ancestor that it doesn't style itself makes Chromium restyle the
  // ancestor's descendants that any such rule could style, on every change:
  // much of the player, or the watch page from the page layout.
  test('options menu changes restyle only the menu', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    const player = page.locator('.ftVideoPlayer')
    await player.hover()
    await openPlayerOptions(player)
    // The entry and the scrollbars of the menu, which hides them while one of
    // its submenus scrolls by itself, restyle: about 25 elements.
    await expectLocalRestyle(page, 'options menu entry visibility', '.videoLayout', {
      class: 'shaka-hidden',
      target: '.shaka-overflow-menu > .loop-button'
    }, 35)
    // Phones style the player's buttons and fullscreen dock by its state too.
    await mockCapacitorPhoneLayout(page)
    await expectLocalRestyle(page, 'phone options menu entry visibility', '.videoLayout', {
      class: 'shaka-hidden',
      target: '.shaka-overflow-menu > .loop-button'
    }, 35)
  })

  // Shaka refreshes the seek bar eight times a second, also while paused. Each
  // layout it causes draws a frame, which keeps an idle phone busy.
  test('a paused player does not lay out on each seek bar refresh', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    // Avatars that fail to load swap in their fallbacks, which lays out too.
    await page.route('https://yt3.ggpht.com/**', route => fulfillVisualFixture(route, 'avatar'))
    const video = await openMockedVideo(page)
    await expectImagesLoaded(page.locator('img:is(.channelThumbnail, .tabAvatar)'))
    await video.evaluate(element => element.pause())
    await page.locator('.ftVideoPlayer').hover()
    await expect(page.locator('.shaka-controls-container')).toHaveAttribute('shown', 'true')
    // The controls fade in, which lays out on its own. Wait for animations
    // that end; scroll-driven ones only end at the end of their scroller.
    await page.evaluate(() => Promise.all(document.getAnimations()
      .filter(animation => animation.playState === 'running' && animation.timeline === document.timeline &&
        animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {}))))
    const { events } = await traceBetweenStamps(page, 'seek bar refreshes', () => video.evaluate(element => new Promise(resolve => {
      const controls = element.ui.getControls()
      const seekBar = element.closest('.ftVideoPlayer').querySelector('.shaka-seek-bar')
      let refreshes = 0
      const refreshed = () => {
        // Reading geometry runs any layout the refresh left pending.
        seekBar.getBoundingClientRect()
        if (++refreshes === 1) console.timeStamp('seek bar refreshes start')
        if (refreshes < 9) return
        console.timeStamp('seek bar refreshes end')
        controls.removeEventListener('timeandseekrangeupdated', refreshed)
        resolve()
      }
      controls.addEventListener('timeandseekrangeupdated', refreshed)
    })))
    const layouts = events.filter(event => event.name === 'Layout')
    expect(layouts.length, 'layouts during eight paused seek bar refreshes').toBe(0)
  })
})
