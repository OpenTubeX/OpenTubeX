import { test, expect, goToSettingsSection, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

for (const { uiScale, width, height, colorScheme } of [
  { uiScale: 100, width: 1100, height: 800, colorScheme: 'dark' },
  { uiScale: 125, width: 420, height: 800, colorScheme: 'light' },
]) {
  test.describe(`fullscreen actions at ${uiScale}% scale`, () => {
    test.use({ seed: { settings: { uiScale, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

    test('customizes, persists and uses the selected fullscreen actions', async ({ app, page }, testInfo) => {
      await setWindowSize(app, page, { width, height })
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Customize fullscreen actions', exact: true }).click()
      const rows = page.locator('.selectedAction')
      await expect(rows).toHaveCount(9)
      await page.locator('.settingsSubpageContent').screenshot({ path: testInfo.outputPath(`customizer-${colorScheme}.png`) })
      while (await rows.count()) {
        await rows.last().getByRole('button', { name: /^Remove / }).click()
      }
      await expect(page.getByText('No fullscreen actions selected', { exact: true })).toBeVisible()
      for (const name of ['Share Video', 'Comments']) {
        await page.getByRole('button', { name: 'Add action', exact: true }).click()
        const menu = page.getByRole('menu', { name: 'Add action', exact: true })
        await menu.getByRole('menuitem', { name, exact: true }).click()
        await menu.getByRole('menuitem').first().press('Escape')
      }
      await page.getByRole('button', { name: 'Move Comments up', exact: true }).click()
      const selectedIds = () => rows.evaluateAll(elements => elements.map(element => element.dataset.fullscreenActionId))
      await expect.poll(selectedIds).toEqual(['comments', 'share'])
      await page.reload()
      const reloadedAppearance = await goToSettingsSection(page, 'appearance')
      await reloadedAppearance.getByRole('button', { name: 'Customize fullscreen actions', exact: true }).click()
      await expect.poll(selectedIds).toEqual(['comments', 'share'])
      await page.locator('.settingsCloseButton').click()

      await mockPlayableWatchPage(app, page)
      if (await page.getByRole('button', { name: 'Open Search Container', exact: true }).isVisible()) {
        await page.getByRole('button', { name: 'Open Search Container', exact: true }).click()
      }
      await openMockedVideo(page)
      await setPlayerFullscreen(page, true)
      const player = page.locator('.ftVideoPlayer')
      await player.locator('video').evaluate(element => element.pause())
      const dock = player.locator('.fullscreenActions')
      await expect(dock).toBeVisible()
      await expect.poll(() => dock.locator('.fullscreenActionsContent > *').evaluateAll(elements => elements.map(element => (
        element.classList.contains('fullscreenCommentsToggle') ? 'comments' : 'share'
      )))).toEqual(['comments', 'share'])
      await player.hover({ position: { x: 20, y: 20 } })
      await dock.getByRole('button', { name: 'Comments', exact: true }).click()
      await expect(player.locator('.fullscreenCommentsOverlay.open')).toBeVisible()
      await dock.getByRole('button', { name: 'Comments', exact: true }).click()
      await expect(player.locator('.fullscreenCommentsOverlay.open')).toHaveCount(0)
      await dock.screenshot({ path: testInfo.outputPath(`actions-${colorScheme}.png`) })
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateFullscreenActions', ['liveChat'])
      })
      await expect(dock).toHaveCount(0)
      await expect(player).toHaveAttribute('data-action-dock-visible', 'false')
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateFullscreenActions', [])
      })
      await expect(dock).toHaveCount(0)
      await setPlayerFullscreen(page, false)
      await expect(page.locator('.watchVideoInfo .shareButton')).toBeVisible()
    })

    test('clamps customization scrolling after removal and responsive resize', async ({ app, page }) => {
      await setWindowSize(app, page, { width: 375, height: 600 })
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Customize fullscreen actions', exact: true }).click()
      const rows = page.locator('.selectedAction')
      const scroller = page.locator('.settingsSubpageScroll')
      const expectAtContentEnd = async () => {
        await expect.poll(() => scroller.evaluate(element => {
          const content = element.querySelector('.settingsSubpageContent')
          const contentEnd = content.getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(element).paddingBottom)
          const viewportEnd = element.getBoundingClientRect().bottom
          return Math.abs(Math.max(-element.scrollTop, contentEnd - viewportEnd)) * devicePixelRatio
        })).toBeLessThanOrEqual(2)
      }
      const scrollToBottom = async () => {
        await scroller.hover()
        await page.mouse.wheel(0, 10000)
        await expectAtContentEnd()
      }
      const expectValidScroll = async () => {
        await expect.poll(() => scroller.evaluate(element => {
          const content = element.querySelector('.settingsSubpageContent')
          const contentEnd = content.getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(element).paddingBottom)
          const viewportEnd = element.getBoundingClientRect().bottom
          const maximum = Math.max(0, contentEnd - viewportEnd + element.scrollTop)
          const tolerance = 2 / devicePixelRatio
          const hasOverflow = maximum > tolerance
          const thumbVisible = element.querySelector(':scope > .os-scrollbar-vertical').classList.contains('os-scrollbar-visible')
          return element.scrollTop >= 0 && element.scrollTop <= maximum + tolerance && thumbVisible === hasOverflow
        })).toBe(true)
      }
      await scrollToBottom()
      await setWindowSize(app, page, { width: 900, height: 650 })
      await expectValidScroll()
      await setWindowSize(app, page, { width: 375, height: 600 })
      while (await rows.count()) {
        await scrollToBottom()
        await rows.last().getByRole('button', { name: /^Remove / }).click()
        await expectValidScroll()
      }
      await expect(page.getByText('No fullscreen actions selected', { exact: true })).toBeVisible()
    })
  })
}
