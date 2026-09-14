import { readFileSync } from 'node:fs'
import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

for (const uiScale of [100, 125]) {
  test.describe(`lights off at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          uiScale,
        }
      }
    })

    test('is optional, follows the player, and restores only in its own tab', async ({ app, page, attachScreenshot }) => {
      await mockPlayableWatchPage(app, page)
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      const overlay = page.locator('.lightsOffOverlay')
      await expect(player.locator('.lights-off-button')).toHaveCount(0)
      await expect(overlay).toHaveCount(0)

      const setAvailable = value => page.evaluate(value => {
        return document.querySelector('#app').__vue_app__.config.globalProperties.$store
          .dispatch('updateShowLightsOffToggle', value)
      }, value)
      await setAvailable(true)
      await player.hover()
      await player.locator('.shaka-overflow-menu-button').click()
      const toggle = player.locator('.lights-off-button')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await expect(overlay).toBeVisible()

      for (const [pack, id] of [
        ['material', 'material-symbols:dark-mode-outline-rounded'],
        ['remix', 'ri:moon-line'],
      ]) {
        await page.evaluate(pack => {
          return document.querySelector('#app').__vue_app__.config.globalProperties.$store
            .dispatch('updateIconPack', pack)
        }, pack)
        const bundle = JSON.parse(readFileSync(new URL(`../../../src/renderer/icons/iconifyBundles/${pack}.json`, import.meta.url), 'utf8'))
        await expect(toggle.locator('.shaka-ui-icon path')).toHaveAttribute('d', bundle[id].body.match(/ d="([^"]+)"/)[1])
        await expect(toggle.locator('.shaka-ui-icon')).toHaveAttribute('viewBox', '0 0 24 24')
        await attachScreenshot(`lights off ${pack} moon`)
      }

      async function expectHoleMatchesPlayer() {
        await expect.poll(async () => {
          const hole = await overlay.locator('div').boundingBox()
          const box = await player.boundingBox()
          if (!hole || !box) return Infinity
          return Math.max(...['x', 'y', 'width', 'height'].map(key => Math.abs(hole[key] - box[key])))
        }).toBeLessThan(1)
      }
      await expectHoleMatchesPlayer()
      await attachScreenshot('lights off player options')
      // A stationary paused player must not keep polling its layout every frame.
      const idleMeasurements = await player.evaluate(async element => {
        await new Promise(resolve => setTimeout(resolve, 500))
        const original = element.getBoundingClientRect
        let measurements = 0
        element.getBoundingClientRect = function () {
          measurements++
          return original.call(this)
        }
        await new Promise(resolve => setTimeout(resolve, 250))
        element.getBoundingClientRect = original
        return measurements
      })
      expect(idleMeasurements).toBeLessThan(5)
      await setWindowSize(app, page, { width: 1400, height: 850 })
      await expectHoleMatchesPlayer()

      // The transparent cutout must follow the scroll mini player as well.
      await player.evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().bottom))
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expectHoleMatchesPlayer()

      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateScrollMiniPlayerEnabled', false)
        window.scrollTo(0, 120)
      })
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect.poll(async () => {
        const header = await page.locator('.topNav').boundingBox()
        const hole = await overlay.locator('div').boundingBox()
        return hole.y - (header.y + header.height)
      }).toBeGreaterThanOrEqual(-1)

      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight)
      })
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect.poll(() => overlay.locator('div').evaluate(element => {
        const rect = element.getBoundingClientRect()
        return rect.top === 0 && rect.height === 0
      })).toBe(true)
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateScrollMiniPlayerEnabled', true)
        window.scrollTo(0, 0)
      })
      await expectHoleMatchesPlayer()

      const firstTab = page.locator('.tabBar .tab').first()
      await page.locator('.tabBar .newTabButton').click()
      await expect(overlay).toHaveCount(0)
      await openMockedVideo(page)
      await expect(overlay).toHaveCount(0)
      await firstTab.click()
      await expect(overlay).toBeVisible()
      await expectHoleMatchesPlayer()

      await setAvailable(false)
      await expect(overlay).toHaveCount(0)
      await expect(player.locator('.lights-off-button')).toHaveCount(0)
      await setAvailable(true)
      await expect(overlay).toBeVisible()
      await player.hover()
      await player.locator('.shaka-overflow-menu-button').click()
      await player.locator('.lights-off-button').click()
      await expect(overlay).toHaveCount(0)

      await player.locator('.lights-off-button').click()
      await expect(overlay).toBeVisible()
      const closedTabId = await page.locator(activeTab).getAttribute('data-tab-id')
      await firstTab.click({ button: 'middle' })
      await expect(overlay).toHaveCount(0)
      await expect.poll(() => page.evaluate(tabId => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return Object.hasOwn(store.state.tabs.lightsOffByTabId, tabId)
      }, closedTabId)).toBe(false)
    })
    test('tracks full-window animations without CSS animation events', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
        .dispatch('updateShowLightsOffToggle', true))
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      await player.hover()
      await player.locator('.shaka-overflow-menu-button').click()
      await player.locator('.lights-off-button').click()
      await expect(page.locator('.lightsOffOverlay')).toBeVisible()
      for (let transition = 0; transition < 2; transition++) {
        const largestGap = await player.evaluate(async element => {
          element.querySelector('.full-window-button').click()
          await new Promise(resolve => setTimeout(resolve, 30))
          let largestGap = 0
          const started = performance.now()
          while (performance.now() - started < 120) {
            await new Promise(resolve => requestAnimationFrame(() => queueMicrotask(resolve)))
            const rect = element.getBoundingClientRect()
            const hole = document.querySelector('.lightsOffOverlay > div').getBoundingClientRect()
            largestGap = Math.max(largestGap, Math.abs(rect.left - hole.left), Math.abs(rect.width - hole.width))
          }
          return largestGap
        })
        expect(largestGap).toBeLessThan(2)
        await expect(player).not.toHaveClass(/presentationModeChanging/)
        await expect.poll(() => player.evaluate(element => element.getAnimations().filter(animation =>
          animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)
        ).length)).toBe(0)
      }
    })
  })
}
