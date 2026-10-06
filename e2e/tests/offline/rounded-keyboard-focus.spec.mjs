import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

async function expectStableKeyboardShape(page, control) {
  const shape = element => {
    const style = getComputedStyle(element)
    return {
      corners: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius],
      width: style.width,
      height: style.height
    }
  }
  await control.blur()
  const before = await control.evaluate(shape)
  await control.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(control).toBeFocused()
  expect(await control.evaluate(element => element.matches(':focus-visible'))).toBe(true)
  expect(await control.evaluate(shape)).toEqual(before)
  await expect(control).toHaveCSS('outline-style', 'solid')
}

for (const uiScale of [100, 95, 125]) {
  test.describe(`rounded keyboard focus at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          currentLocale: 'en-US',
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue',
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true
        }
      }
    })

    test('preserves circular button corners when tabbing into them', async ({ page }) => {
      const button = page.locator('.topNav .navButton').first()
      const radius = await button.evaluate(element => getComputedStyle(element).borderRadius)
      expect(radius).toBe('50%')
      await button.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(button).toBeFocused()
      expect(await button.evaluate(element => element.matches(':focus-visible'))).toBe(true)
      await expect(button).toHaveCSS('border-radius', radius)
      await expect(button).toHaveCSS('outline-style', 'solid')
    })

    test('preserves profile, shortcut, and channel-tile shapes during keyboard focus', async ({ page }, testInfo) => {
      await page.route('https://images.test/avatar.svg', route => fulfillVisualFixture(route, 'avatar'))
      // Profile tiles and subscription tiles exercise rounded rectangles as
      // well as the circular header and quick-settings controls.
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateProfile', {
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Test Channel', thumbnail: 'https://images.test/avatar.svg' }]
        })
      })
      const profile = page.locator('.profileTrigger')
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
        await expectStableKeyboardShape(page, profile)
        await profile.press('Enter')
        await expect(page.locator('.quickSettingsMenu')).toBeVisible()
        for (const shortcut of await page.locator('.quickSettingsShortcut:visible').all()) {
          await expectStableKeyboardShape(page, shortcut)
        }
        await page.keyboard.press('Escape')
      }

      await profile.click()
      await page.locator('.profileSummary').click()
      await page.locator('.profilePanelHeader').getByRole('button', { name: 'Profile', exact: true }).click()
      const profileTile = page.locator('.profileSettingsContent > .card .profileList .bubblePadding').first()
      await expectStableKeyboardShape(page, profileTile)
      await profileTile.press('Enter')
      await page.getByRole('tab', { name: 'Manage profile subscriptions', exact: true }).click()
      const channelTile = page.locator('.profileSettingsContent .bubblePadding').filter({ has: page.locator('.channelName') }).first()
      await expect(channelTile).toBeVisible()
      await expectImagesLoaded(channelTile.locator('img'))
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
        for (const roundness of [0, 100, 200]) {
          await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiRoundness', value), roundness)
          await expectStableKeyboardShape(page, channelTile)
        }
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiRoundness', 100))
        await expectStableKeyboardShape(page, channelTile)
        const screenshot = testInfo.outputPath(`channel-tile-keyboard-focus-${colorScheme}.png`)
        await channelTile.screenshot({ path: screenshot })
        await testInfo.attach(`channel tile keyboard focus ${colorScheme}`, { path: screenshot, contentType: 'image/png' })
      }
    })

    test('preserves the rounded player controls during keyboard focus', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateDisplayVideoPlayButton', true))
      await openMockedVideo(page)
      const player = page.locator('.ftVideoPlayer').first()
      await player.locator('video').evaluate(video => video.pause())
      await player.hover()
      const controls = player.locator('.shaka-big-buttons-container > button:visible')
      await expect(controls.first()).toBeVisible()
      for (const control of await controls.all()) {
        await expectStableKeyboardShape(page, control)
      }
      const info = page.locator('.watchVideoInfo').first()
      for (const control of await info.locator('.iconButton:visible').all()) {
        await expectStableKeyboardShape(page, control)
      }
    })

    test('keeps the avatar focus ring circular and outside its image', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await page.route(/yt3\.(ggpht|googleusercontent)\.com/, route => fulfillVisualFixture(route, 'avatar'))
      await openMockedVideo(page)
      const info = page.locator('.watchVideoInfo').first()
      const image = info.locator('img.channelThumbnail').first()
      await expectImagesLoaded(image)
      const avatar = info.locator('a:has(img.channelThumbnail)')
      const name = info.locator('a.channelName')

      for (const width of [1600, 480]) {
        if (width === 480) await setWindowSize(app, page, { width, height: 800 })
        for (const colorScheme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme })
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
          await name.focus()
          await page.keyboard.press('Shift+Tab')
          await expect(avatar).toBeFocused()
          expect(await avatar.evaluate(element => element.matches(':focus-visible'))).toBe(true)
          const row = await info.locator('.profileRow').boundingBox()
          const screenshot = testInfo.outputPath(`avatar-focus-${width}-${colorScheme}.png`)
          await page.screenshot({
            path: screenshot,
            clip: { x: row.x - 6, y: row.y - 6, width: row.width + 12, height: row.height + 12 }
          })
          await testInfo.attach(`avatar focus ${width} ${colorScheme}`, {
            path: screenshot,
            contentType: 'image/png'
          })

          const geometry = await avatar.evaluate(element => {
            const image = element.querySelector('img')
            const bounds = element.getBoundingClientRect()
            const imageBounds = image.getBoundingClientRect()
            const style = getComputedStyle(element)
            return {
              widthDifference: bounds.width - imageBounds.width,
              heightDifference: bounds.height - imageBounds.height,
              leftDifference: bounds.left - imageBounds.left,
              topDifference: bounds.top - imageBounds.top,
              radius: style.borderRadius,
              outlineWidth: Number.parseFloat(style.outlineWidth),
              outlineStyle: style.outlineStyle,
              outlineOffset: Number.parseFloat(style.outlineOffset)
            }
          })
          expect(geometry.widthDifference).toBeCloseTo(0, 1)
          expect(geometry.heightDifference).toBeCloseTo(0, 1)
          expect(geometry.leftDifference).toBeCloseTo(0, 1)
          expect(geometry.topDifference).toBeCloseTo(0, 1)
          expect(geometry.radius).toBe('50%')
          // Chromium snaps stroke widths to physical pixels at fractional zoom.
          expect(geometry.outlineWidth).toBeGreaterThan(0)
          expect(geometry.outlineStyle).toBe('solid')
          expect(geometry.outlineOffset).toBeGreaterThanOrEqual(0)
          await page.keyboard.press('Tab')
          await expect(name).toBeFocused()
          await expect(avatar).toHaveCSS('outline-style', 'none')
        }
      }
    })
  })
}
