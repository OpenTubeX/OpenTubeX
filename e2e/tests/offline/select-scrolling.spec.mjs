import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

async function commentsSort({ app, page }) {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await expect(page.locator('.comment').first()).toBeVisible()
  const select = page.locator('.commentHeader').getByRole('combobox', { name: 'Sort By' })
  await select.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  return select
}

async function expectScrollTether(select, scroll) {
  const dropdown = select.page().locator('.selectDropdown')
  const openingStyle = await dropdown.getAttribute('style')
  for (const delta of [24, -16, 32]) {
    const movement = await select.evaluate(async (button, { delta, scroll }) => {
      const menu = document.getElementById(button.getAttribute('aria-controls'))
      const buttonBefore = button.getBoundingClientRect()
      const menuBefore = menu.getBoundingClientRect()
      const scroller = scroll === 'page' ? window : button.closest('.quickSettingsScroll')
      scroller.scrollBy({ top: delta, behavior: 'instant' })
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        button: button.getBoundingClientRect().top - buttonBefore.top,
        menu: menu.getBoundingClientRect().top - menuBefore.top,
      }
    }, { delta, scroll })
    expect(Math.abs(movement.button)).toBeGreaterThan(1)
    expect(Math.abs(movement.menu - movement.button)).toBeLessThanOrEqual(1)
    await expect(dropdown).toHaveAttribute('style', openingStyle)
  }
}

for (const uiScale of [100, 125]) {
  test.describe(`select scroll positioning at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale, alwaysShowScrollbars: true, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

    test('keeps the comments sort dropdown attached without scroll handler updates', async ({ app, page }) => {
      const select = await commentsSort({ app, page })
      await select.click()
      await expect(page.locator('.selectDropdown')).toBeVisible()

      await expectScrollTether(select, 'page')
    })

    test('keeps the dropdown attached while its quick settings scroller moves', async ({ page }) => {
      await page.locator('.profileTrigger').click()
      const select = page.getByRole('dialog', { name: 'Quick settings' }).getByRole('combobox', { name: 'Base Theme' })
      await select.click()
      await expect(page.locator('.selectDropdown')).toBeVisible()
      await expectScrollTether(select, 'quickSettings')
    })

    test('fits the comments dropdown on opening and lets it scroll out of view', async ({ app, page }) => {
      const select = await commentsSort({ app, page })
      const dropdown = page.locator('.selectDropdown')
      for (const edge of ['bottom', 'top']) {
        await select.evaluate((button, edge) => {
          const bounds = button.getBoundingClientRect()
          const chromeBottom = Math.max(...Array.from(document.querySelectorAll('.topNav, .tabBar.position-top')).map(element => element.getBoundingClientRect().bottom))
          const target = edge === 'bottom' ? innerHeight - bounds.height - 24 : chromeBottom + 24
          window.scrollBy({ top: bounds.top - target, behavior: 'instant' })
        }, edge)
        await select.click()
        await expect.poll(() => dropdown.evaluate(menu => {
          const bounds = menu.getBoundingClientRect()
          const chromeBottom = Math.max(...Array.from(document.querySelectorAll('.topNav, .tabBar.position-top')).map(element => element.getBoundingClientRect().bottom))
          return bounds.top >= chromeBottom + 3 && bounds.bottom <= innerHeight - 7 && menu.scrollHeight <= menu.clientHeight + 1
        })).toBe(true)
        await expect.poll(() => select.evaluate((button, edge) => {
          const menu = document.getElementById(button.getAttribute('aria-controls')).getBoundingClientRect()
          const bounds = button.getBoundingClientRect()
          return Math.abs((edge === 'bottom' ? bounds.top - menu.bottom : menu.top - bounds.bottom) - 4)
        }, edge)).toBeLessThanOrEqual(1)

        const openingStyle = await dropdown.getAttribute('style')
        await select.evaluate((button, edge) => {
          const bounds = button.getBoundingClientRect()
          const target = edge === 'bottom' ? 8 : innerHeight - bounds.height - 8
          window.scrollBy({ top: bounds.top - target, behavior: 'instant' })
        }, edge)
        await expect.poll(() => dropdown.evaluate((menu, edge) => {
          const bounds = menu.getBoundingClientRect()
          return edge === 'bottom' ? bounds.top < 0 : bounds.bottom > innerHeight
        }, edge)).toBe(true)
        await expect(dropdown).toHaveAttribute('style', openingStyle)
        await select.press('Escape')
      }
    })

    test('clamps a long dropdown at its rendered end when resizing reduces its scroll range', async ({ app, page }) => {
      await page.locator('.profileTrigger').click()
      await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('combobox', { name: 'Base Theme' }).click()
      const dropdown = page.locator('.selectDropdown')
      const scrollbar = dropdown.locator('.os-scrollbar-vertical')
      await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
      for (const height of [650, 900]) {
        await dropdown.evaluate(menu => menu.scrollTo(0, menu.scrollHeight))
        await expect.poll(() => dropdown.evaluate(menu => Math.abs(
          menu.querySelector('.selectOption:last-of-type').getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(menu).paddingBottom) - menu.getBoundingClientRect().bottom
        ) * devicePixelRatio)).toBeLessThanOrEqual(2)
        await app.electronApp.evaluate(({ BrowserWindow }, height) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setBounds({ ...window.getBounds(), height })
        }, Math.round(height * uiScale / 100))
        await expect.poll(() => dropdown.evaluate(menu => {
          const bounds = menu.getBoundingClientRect()
          const trackElement = menu.querySelector('.os-scrollbar-vertical .os-scrollbar-track')
          const thumbElement = menu.querySelector('.os-scrollbar-vertical .os-scrollbar-handle')
          if (!trackElement || !thumbElement) return false
          const track = trackElement.getBoundingClientRect()
          const thumb = thumbElement.getBoundingClientRect()
          const contentEnd = menu.querySelector('.selectOption:last-of-type').getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(menu).paddingBottom)
          return bounds.bottom <= innerHeight - 7 &&
            menu.scrollTop <= Math.max(0, menu.scrollHeight - menu.clientHeight) + 1 &&
            contentEnd >= bounds.bottom - 2 / devicePixelRatio &&
            Math.abs(thumb.height / track.height - menu.clientHeight / menu.scrollHeight) < 0.02 &&
            thumb.bottom <= track.bottom + 1
        })).toBe(true)
        await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
      }
    })

    test('fits the opening dropdown when CSS anchors are unavailable', async ({ app, page }) => {
      await page.evaluate(() => {
        const supports = CSS.supports.bind(CSS)
        CSS.supports = (...args) => args[0] === 'position-anchor' ? false : supports(...args)
      })
      const select = await commentsSort({ app, page })
      await select.click()
      const dropdown = page.locator('.selectDropdown')
      await expect.poll(() => dropdown.evaluate(menu => {
        const bounds = menu.getBoundingClientRect()
        return bounds.top >= 8 && bounds.bottom <= innerHeight - 7
      })).toBe(true)
      const openingStyle = await dropdown.getAttribute('style')
      await page.evaluate(async () => {
        window.scrollBy({ top: 24, behavior: 'instant' })
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      await expect(dropdown).toHaveAttribute('style', openingStyle)
      await expect(dropdown).toBeVisible()
    })
  })
}
