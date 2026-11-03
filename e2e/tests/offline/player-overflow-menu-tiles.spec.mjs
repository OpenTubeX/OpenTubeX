import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo, openPlayerOptions } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: { ...WATCH_PAGE_SEED, videoPlaybackRateInterval: 0.25, maxVideoPlaybackRate: 3 } } })

/**
 * Whether the overflow grid highlights the tile, compared with a tile that is
 * neither pressed nor marked active.
 * @param {import('@playwright/test').Locator} tile
 */
function isHighlighted(tile) {
  return tile.evaluate(button => {
    const menu = button.closest('.shaka-overflow-menu')
    const reference = Array.from(menu.querySelectorAll(':scope > button'))
      .find(other => other !== button && other.getAttribute('aria-pressed') !== 'true' && !other.classList.contains('ft-active'))
    return getComputedStyle(button).backgroundColor !== getComputedStyle(reference).backgroundColor
  })
}

/**
 * @param {import('@playwright/test').Locator} player
 * @param {import('@playwright/test').Locator} tile
 */
async function openOverflowMenuWith(player, tile) {
  // The hover below restarts Shaka's idle timer, which hides the controls a few
  // seconds after the menu closes while playing, and nothing shows them again
  // for the next call. Paused, Shaka keeps them shown.
  await player.locator('video').evaluate(video => video.pause())
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
  await openPlayerOptions(player)
  await expect(tile).toBeVisible()
  // Keep the pointer off the tile, whose hover background would mask the highlight.
  await player.hover({ position: { x: 5, y: 5 } })
}

/**
 * @param {import('@playwright/test').Locator} player
 */
function closePlayerMenus(player) {
  return player.evaluate(element => element.ui.getControls().hideSettingsMenus())
}

test('playback speed presets offer every interval step up to the maximum', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const presets = player.locator('.shaka-playback-rates .shaka-playback-rate-preset-btn')
  const openPlaybackRateMenu = async () => {
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
    await openPlayerOptions(player)
    await player.locator('.shaka-playbackrate-button').click()
  }
  const presetRates = () => presets.evaluateAll(buttons => buttons.map(button => Number(button.dataset.rate)))

  await openPlaybackRateMenu()
  expect(await presetRates()).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3])

  await player.evaluate(element => element.ui.getControls().hideSettingsMenus())
  await page.evaluate(async () => {
    await window.$store.dispatch('updateVideoPlaybackRateInterval', 0.5)
    await window.$store.dispatch('updateMaxVideoPlaybackRate', 4)
  })
  await openPlaybackRateMenu()
  expect(await presetRates()).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])

  await presets.filter({ hasText: '3.5' }).click()
  await expect.poll(() => player.locator('video').evaluate(element => element.playbackRate)).toBe(3.5)
})

for (const usePlayerMenuGrid of [true, false]) {
  test.describe(`${usePlayerMenuGrid ? 'grid' : 'list'} menu`, () => {
    test.use({ seed: { settings: { ...WATCH_PAGE_SEED, videoPlaybackRateInterval: 0.25, maxVideoPlaybackRate: 3, usePlayerMenuGrid } } })

    test('moving between the menu and a submenu zooms only the new view in', { tag: '@scale' }, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      const menu = player.locator('.shaka-overflow-menu')
      const tile = menu.locator(':scope > .shaka-playbackrate-button')
      const submenu = menu.locator(':scope > .shaka-playback-rates')

      // Recorded as they start, since they finish within a few frames.
      await menu.evaluate((element) => {
        window.__menuZooms = []
        element.addEventListener('animationstart', ({ animationName, target }) => {
          if (!animationName.startsWith('ft-menu-zoom')) return
          window.__menuZooms.push({
            zoom: animationName.startsWith('ft-menu-zoom-in') ? 'in' : 'out',
            view: target.parentElement.classList.contains('shaka-playback-rates') ? 'submenu' : 'menu',
          })
        })
      })
      const takeZooms = () => page.evaluate(() => window.__menuZooms.splice(0))
      const afterFrames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const expectZooms = async (zoom, view) => {
        await expect.poll(() => menu.evaluate(element => element.querySelector('[data-ft-menu-transition]') === null &&
          !element.hasAttribute('data-ft-menu-transition'))).toBe(true)
        const zooms = await takeZooms()
        expect(zooms.length).toBeGreaterThan(0)
        expect(new Set(zooms.map(entry => `${entry.zoom} ${entry.view}`))).toEqual(new Set([`${zoom} ${view}`]))
      }

      await openOverflowMenuWith(player, tile)
      await afterFrames()
      expect(await takeZooms()).toEqual([])

      await tile.click()
      await expect(submenu).toBeVisible()
      await expectZooms('in', 'submenu')

      await submenu.locator('.shaka-back-to-overflow-button').click()
      await expect(tile).toBeVisible()
      await expectZooms('out', 'menu')

      // Going back before the submenu has zoomed in still zooms the tiles all the way.
      const returnZooms = await menu.evaluate(async (element) => {
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
        const outcomes = { animationend: 0, animationcancel: 0 }
        const count = ({ type, animationName, target }) => {
          if (animationName.startsWith('ft-menu-zoom-out') && target.parentElement === element) outcomes[type]++
        }
        element.addEventListener('animationend', count)
        element.addEventListener('animationcancel', count)
        const zoomingIn = new Promise((resolve) => {
          element.addEventListener('animationstart', ({ animationName }) => {
            if (animationName.startsWith('ft-menu-zoom-in')) resolve()
          })
        })
        element.querySelector(':scope > .shaka-playbackrate-button').click()
        await zoomingIn
        await frame()
        element.querySelector(':scope > .shaka-playback-rates > .shaka-back-to-overflow-button').click()
        await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
        await frame()
        await frame()
        return outcomes
      })
      expect(returnZooms.animationend).toBeGreaterThan(0)
      expect(returnZooms.animationcancel).toBe(0)
      await takeZooms()

      // Closing the menu over a submenu and opening it again doesn't zoom the tiles.
      await tile.click()
      await expectZooms('in', 'submenu')
      await closePlayerMenus(player)
      await openOverflowMenuWith(player, tile)
      await afterFrames()
      expect(await takeZooms()).toEqual([])
    })
  })
}

test('the options menu grows in and fades out, but closes at once from a submenu', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const menu = player.locator('.shaka-overflow-menu')
  const tile = menu.locator(':scope > .shaka-playbackrate-button')

  await menu.evaluate((element) => {
    window.__menuMotion = []
    // Animation events wait for a rendered frame, which a loaded renderer may
    // not draw before the motion has ended, so look for it as the menu opens or closes.
    let hidden = element.classList.contains('shaka-hidden')
    new MutationObserver(() => {
      if (hidden === element.classList.contains('shaka-hidden')) return
      hidden = !hidden
      const animations = element.getAnimations()
      if (hidden
        ? animations.some(animation => animation instanceof CSSTransition && animation.transitionProperty === 'scale')
        : animations.some(animation => animation instanceof CSSAnimation && animation.animationName.startsWith('ft-menu-open'))) {
        window.__menuMotion.push(hidden ? 'close' : 'open')
      }
    }).observe(element, { attributes: true, attributeFilter: ['class'] })
  })
  const takeMotion = () => page.evaluate(() => window.__menuMotion.splice(0))
  const afterFrames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  await openOverflowMenuWith(player, tile)
  expect(await takeMotion()).toEqual(['open'])

  // Fading out, the menu stays displayed until it has faded.
  expect(await player.evaluate((element) => {
    element.ui.getControls().hideSettingsMenus()
    const overflowMenu = element.querySelector('.shaka-overflow-menu')
    return overflowMenu.classList.contains('shaka-hidden') && overflowMenu.checkVisibility()
  })).toBe(true)
  await expect(menu).toBeHidden()
  expect(await takeMotion()).toEqual(['close'])

  await openOverflowMenuWith(player, tile)
  await tile.click()
  await expect(menu.locator(':scope > .shaka-playback-rates')).toBeVisible()
  await takeMotion()
  await closePlayerMenus(player)
  await afterFrames()
  expect(await menu.evaluate(element => element.checkVisibility())).toBe(false)
  expect(await takeMotion()).toEqual([])

  // Hidden again, it fades the next time.
  await afterFrames()
  await openOverflowMenuWith(player, tile)
  await closePlayerMenus(player)
  await expect(menu).toBeHidden()
  expect(await takeMotion()).toEqual(['open', 'close'])
})

test('a view switch with reduced motion leaves no zoom for later', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const menu = player.locator('.shaka-overflow-menu')
  const tile = menu.locator(':scope > .shaka-playbackrate-button')
  const submenu = menu.locator(':scope > .shaka-playback-rates')
  const setReducedMotion = value => page.evaluate(value => window.$store.dispatch('updateReducedMotion', value), value)

  await menu.evaluate((element) => {
    window.__menuZooms = []
    element.addEventListener('animationstart', ({ animationName, target }) => {
      if (animationName.startsWith('ft-menu-zoom')) {
        window.__menuZooms.push(target.parentElement.classList.contains('shaka-playback-rates') ? 'submenu' : 'menu')
      }
    })
  })
  const takeZooms = () => page.evaluate(() => window.__menuZooms.splice(0))
  const afterFrames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  await setReducedMotion('on')
  await openOverflowMenuWith(player, tile)
  await tile.click()
  await expect(submenu).toBeVisible()
  await submenu.locator('.shaka-back-to-overflow-button').click()
  await expect(tile).toBeVisible()
  await closePlayerMenus(player)
  await expect(menu).toBeHidden()
  expect(await takeZooms()).toEqual([])

  await setReducedMotion('off')
  await openOverflowMenuWith(player, tile)
  await afterFrames()
  expect(await takeZooms()).toEqual([])

  // The next switch zooms as usual.
  await tile.click()
  await expect(submenu).toBeVisible()
  await expect.poll(takeZooms).toContain('submenu')
})

test.describe('phone options sheet', () => {
  test('fades in and out, but closes at once from a submenu', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 360, height: 760 })
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    const sheet = player.locator('.phonePlayerOptions')
    const menu = player.locator('.shaka-overflow-menu')
    const tile = sheet.locator('.shaka-playbackrate-button')

    // On the player, as the controls are rebuilt for the phone layout along with the sheet.
    await player.evaluate((element) => {
      window.__sheetMotion = []
      element.addEventListener('animationstart', ({ animationName, target }) => {
        if (target.matches('.phonePlayerOptions') && animationName.startsWith('ft-menu-fade-in')) window.__sheetMotion.push('fade in')
        if (target.matches('.phonePlayerOptions > .shaka-overflow-menu') && animationName.startsWith('ft-menu-open')) window.__sheetMotion.push('grow')
      })
      element.addEventListener('transitionrun', ({ propertyName, target }) => {
        if (target.matches('.phonePlayerOptions') && propertyName === 'opacity') window.__sheetMotion.push('fade out')
      })
    })
    const takeMotion = () => page.evaluate(() => window.__sheetMotion.splice(0).sort())
    const afterFrames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    // The sheet's own fades, and the menu's animations
    const settleSheet = () => sheet.evaluate(element => Promise.all(element.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.target === element || /^ft-menu-/.test(animation.animationName ?? ''))
      .map(animation => animation.finished.catch(() => {}))))
    const openSheet = async () => {
      await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
      await player.locator('.shaka-overflow-menu-button').click({ force: true })
      await expect(tile).toBeVisible()
    }

    await openSheet()
    await expect.poll(() => page.evaluate(() => window.__sheetMotion.length)).toBe(2)
    expect(await takeMotion()).toEqual(['fade in', 'grow'])
    await settleSheet()
    // Grown in, it fills the player and its menu isn't scaled.
    const layout = await sheet.evaluate((element) => {
      const sheetBox = element.getBoundingClientRect()
      const playerBox = element.closest('.ftVideoPlayer').getBoundingClientRect()
      const overflowMenu = element.querySelector('.shaka-overflow-menu')
      return {
        widthDifference: Math.abs(sheetBox.width - playerBox.width),
        heightDifference: Math.abs(sheetBox.height - playerBox.height),
        scale: overflowMenu.getBoundingClientRect().width / overflowMenu.offsetWidth,
        opacity: getComputedStyle(element).opacity,
      }
    })
    expect(layout.widthDifference).toBeLessThan(2)
    expect(layout.heightDifference).toBeLessThan(2)
    expect(layout.scale).toBeCloseTo(1, 2)
    expect(layout.opacity).toBe('1')

    // Fading out, the sheet keeps showing the menu until it has faded.
    expect(await sheet.evaluate((element) => {
      element.querySelector('.phonePlayerOptionsClose').click()
      const overflowMenu = element.querySelector('.shaka-overflow-menu')
      return element.open && overflowMenu?.classList.contains('shaka-hidden') && overflowMenu.checkVisibility()
    })).toBe(true)
    await expect(sheet).toBeHidden()
    await expect(menu).toBeHidden()
    expect(await sheet.evaluate(element => element.contains(element.ownerDocument.querySelector('.shaka-overflow-menu')))).toBe(false)
    expect(await takeMotion()).toEqual(['fade out'])

    // Reopened while it fades, it stays open.
    await openSheet()
    await sheet.evaluate((element) => {
      element.querySelector('.phonePlayerOptionsClose').click()
      element.closest('.ftVideoPlayer').querySelector('.shaka-overflow-menu-button').click()
    })
    await settleSheet()
    await afterFrames()
    expect(await sheet.evaluate(element => element.open && getComputedStyle(element).opacity === '1')).toBe(true)
    await expect(tile).toBeVisible()
    await takeMotion()

    // From a submenu, which Shaka resets to the tiles as it closes, it closes at once.
    await tile.click()
    await expect(sheet.locator('.shaka-playback-rates')).toBeVisible()
    await takeMotion()
    await sheet.evaluate(element => element.querySelector('.phonePlayerOptionsClose').click())
    await afterFrames()
    expect(await sheet.evaluate(element => element.open)).toBe(false)
    expect(await takeMotion()).toEqual([])

    // With reduced motion, it opens and closes without animating.
    await page.evaluate(() => window.$store.dispatch('updateReducedMotion', 'on'))
    await openSheet()
    expect(await sheet.evaluate(element => element.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.target === element || /^ft-menu-/.test(animation.animationName ?? '')).length)).toBe(0)
    await sheet.evaluate(element => element.querySelector('.phonePlayerOptionsClose').click())
    expect(await sheet.evaluate(element => element.open)).toBe(false)
    expect(await takeMotion()).toEqual([])
  })
})

test('playback speed tile is highlighted exactly while the speed is not 1x', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const tile = player.locator('.shaka-overflow-menu .shaka-playbackrate-button')
  const highlighted = () => isHighlighted(tile)
  const openOverflowMenu = () => openOverflowMenuWith(player, tile)
  const closeMenus = () => closePlayerMenus(player)

  await openOverflowMenu()
  expect(await highlighted()).toBe(false)

  // Leaving the submenu open while the overflow menu closes must not keep the tile highlighted.
  await tile.click()
  await expect(player.locator('.shaka-playback-rates')).toBeVisible()
  await closeMenus()
  await openOverflowMenu()
  expect(await highlighted()).toBe(false)

  await tile.click()
  await player.locator('.shaka-playback-rates .shaka-playback-rate-preset-btn[data-rate="1.5"]').click()
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
  await closeMenus()
  await openOverflowMenu()
  expect(await highlighted()).toBe(true)

  // Speed changes outside the menu update the tile too.
  await closeMenus()
  await page.locator('body').press('g')
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1)
  await openOverflowMenu()
  expect(await highlighted()).toBe(false)

  await closeMenus()
  await page.locator('body').press('g')
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
  await openOverflowMenu()
  expect(await highlighted()).toBe(true)

  // Changing the speed settings rebuilds the controls.
  await closeMenus()
  await page.evaluate(() => window.$store.dispatch('updateMaxVideoPlaybackRate', 4))
  await openOverflowMenu()
  expect(await highlighted()).toBe(true)
})

test.describe('level and toggle tiles', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        showVolumeBoostToggle: true,
        controlBarButtons: ['autoplay', 'captions', 'menu', 'pictureInPicture', 'fullWindow', 'fullscreen'],
      }
    }
  })

  test('zoom, volume boost and theatre mode tiles are highlighted while not at their defaults', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    const overflowMenu = player.locator('.shaka-overflow-menu')
    const tiles = {
      zoom: overflowMenu.locator('.video-zoom-button'),
      boost: overflowMenu.locator('.volume-boost-button'),
      theatre: overflowMenu.locator('.theatre-button'),
    }
    const highlightedTiles = async () => {
      await openOverflowMenuWith(player, tiles.zoom)
      const result = {
        zoom: await isHighlighted(tiles.zoom),
        boost: await isHighlighted(tiles.boost),
        theatre: await isHighlighted(tiles.theatre),
      }
      await closePlayerMenus(player)
      return result
    }

    expect(await highlightedTiles()).toEqual({ zoom: false, boost: false, theatre: false })

    await page.locator('body').press('z')
    await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')
    expect(await highlightedTiles()).toEqual({ zoom: true, boost: false, theatre: false })

    await openOverflowMenuWith(player, tiles.boost)
    await tiles.boost.click()
    await player.locator('.volume-boost-menu').getByRole('button', { name: '150%' }).click()
    await closePlayerMenus(player)
    expect(await highlightedTiles()).toEqual({ zoom: true, boost: true, theatre: false })

    await openOverflowMenuWith(player, tiles.theatre)
    await tiles.theatre.click()
    await closePlayerMenus(player)
    expect(await highlightedTiles()).toEqual({ zoom: true, boost: true, theatre: true })

    await page.locator('body').press('Shift+Z')
    await expect(video).toHaveCSS('transform', 'none')
    expect(await highlightedTiles()).toEqual({ zoom: false, boost: true, theatre: true })
  })
})
