import { test, expect, setWindowSize, setPlayerFullscreen } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

for (const uiScale of [100, 125]) {
  test.describe(`Shorts loading corners at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue',
        }
      }
    })

    test('clips the loading poster to UI roundness without clipping the seek thumb', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(page.locator('body')).toHaveClass(/\bdark\b/)
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await openMockedVideo(page)

      // Replacing the regular player with Shorts creates a fresh loading poster.
      let releaseMedia
      const mediaHeld = new Promise(resolve => { releaseMedia = resolve })
      await page.route(/googlevideo\.com\/videoplayback/, async route => {
        await mediaHeld
        await route.fallback()
      })
      try {
        const watch = await page.evaluateHandle(findWatchComponent)
        await watch.evaluate(async component => {
          component.proxy.useCustomShortsPlayerForCurrentVideo = true
          component.proxy.updateShortsPlayerState(30, [{ width: 360, height: 640 }])
          await component.proxy.$nextTick()
        })
        await watch.dispose()
        const player = page.locator('.ftVideoPlayer.shortsPlayer')
        const poster = player.locator('.countdownPoster')
        await expect(poster).toBeVisible()
        await expectImagesLoaded(poster.locator('img'))
        await expect(player.locator('.shaka-spinner-container')).toBeVisible()
        await expect(player.locator('.shaka-spinner-container')).toHaveCSS('opacity', '1')

        for (const width of [1100, 390]) {
          await setWindowSize(app, page, { width, height: width === 390 ? 800 : 850 })
          for (const roundness of [100, 0, 50, 200]) {
            await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiRoundness', value), roundness)
            await expect(page.locator('body')).toHaveCSS('--ui-roundness', String(roundness / 100))
            // Hit testing checks the actual painted crop, including descendants.
            const crop = await poster.evaluate(element => {
              const previous = element.style.pointerEvents
              element.style.pointerEvents = 'auto'
              const image = element.querySelector('img')
              const box = element.getBoundingClientRect()
              const hitsImage = (x, y) => document.elementsFromPoint(x, y).includes(image)
              // Stay outside the antialiased edge even at fractional positions.
              const corners = [
                [box.left + 0.25, box.top + 0.25], [box.right - 0.25, box.top + 0.25],
                [box.left + 0.25, box.bottom - 0.25], [box.right - 0.25, box.bottom - 0.25]
              ].map(([x, y]) => hitsImage(x, y))
              const center = hitsImage(box.left + box.width / 2, box.top + box.height / 2)
              element.style.pointerEvents = previous
              return { center, corners, radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) }
            })
            expect(crop.center).toBe(true)
            expect(crop.radius).toBeCloseTo(12 * roundness / 100, 1)
            expect(crop.corners, `${width}px, roundness ${roundness}`).toEqual(Array(4).fill(roundness === 0))
            await expect(player).toHaveCSS('overflow', 'visible')
            if (roundness === 200) {
              for (const colorScheme of ['dark', 'light']) {
                await page.emulateMedia({ colorScheme })
                await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
                const screenshot = testInfo.outputPath(`loading-${width}-${colorScheme}.png`)
                const box = await player.boundingBox()
                await page.screenshot({
                  path: screenshot,
                  clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 }
                })
                await testInfo.attach('Rounded Shorts loading poster', { path: screenshot, contentType: 'image/png' })
              }
              await page.emulateMedia({ colorScheme: 'dark' })
            }
          }
        }

        await player.locator('.full-window-button').evaluate(element => element.click())
        await expect(player).toHaveClass(/fullWindow/)
        await expect(poster).toHaveCSS('border-radius', '0px')
        await player.locator('.full-window-button').evaluate(element => element.click())
        await expect(player).not.toHaveClass(/fullWindow/)
        await setPlayerFullscreen(page, true)
        await expect(poster).toHaveCSS('border-radius', '0px')
        await setPlayerFullscreen(page, false)
      } finally {
        releaseMedia()
      }
      await waitForPlayback(page)
      await expect(page.locator('.ftVideoPlayer.shortsPlayer .countdownPoster')).toBeHidden()
    })
  })
}
