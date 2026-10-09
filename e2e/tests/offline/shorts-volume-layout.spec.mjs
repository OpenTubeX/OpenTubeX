import { test, expect, setWindowSize, updateInputWithoutScrolling } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

for (const uiScale of [100, 95, 125]) {
  test.describe(`Shorts volume at ${uiScale}% UI scale`, () => {
    test.use({
      launchArgs: ['--disable-gpu'],
      seed: {
        settings: {
          currentLocale: 'en-US',
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

    test('matches the regular volume track and supports pointer, mute, and keyboard input', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.locator('.ftVideoPlayer video').evaluate(video => {
        video.pause()
        video.volume = 0.4
        video.muted = false
      })
      const regularTrack = page.locator('.ft-volume-control-group .shaka-volume-bar-container')
      await expect(regularTrack).toHaveAttribute('style', /40%/)
      const regularStyle = await regularTrack.evaluate(element => ({
        height: getComputedStyle(element).height,
        background: getComputedStyle(element).backgroundImage,
      }))

      const watch = await page.evaluateHandle(findWatchComponent)
      await watch.evaluate(async component => {
        component.proxy.useCustomShortsPlayerForCurrentVideo = true
        component.proxy.updateShortsPlayerState(30, [{ width: 360, height: 640 }])
        await component.proxy.$nextTick()
      })
      await watch.dispose()
      const player = page.locator('.ftVideoPlayer.shortsPlayer')
      await expect(player).toBeVisible()
      // Shorts replace the video; wait until initial volume restoration finishes.
      const video = await waitForPlayback(page)
      await video.evaluate(element => {
        element.pause()
        element.volume = 0.4
        element.muted = false
      })
      const group = player.locator('.shortsVolumeControl')
      const button = group.locator('button')
      const track = group.locator('.shortsVolumeSlider')
      const slider = group.locator('.shortsVolumeSlider input[type="range"]')
      // Fractional UI scales can quantize computed CSS pixels slightly.
      const expectWidth = width => expect.poll(() => track.evaluate(element => Number.parseFloat(getComputedStyle(element).width))).toBeCloseTo(width, 1)
      // Cover the network test's native volume-change assertion without the API.
      await video.evaluate(element => { element.volume = 0.37 })
      await expect(slider).toHaveValue('37')
      await updateInputWithoutScrolling(slider, '40')

      for (const width of [1280, 390]) {
        await setWindowSize(app, page, { width, height: width === 390 ? 700 : 800 })
        await button.hover()
        await expectWidth(96)
        await expect(slider).toHaveCSS('appearance', 'none')
        await expect(track).toHaveCSS('height', regularStyle.height)
        await expect(track).toHaveCSS('background-image', regularStyle.background)
        await expect(slider).toHaveValue('40')
        for (const pack of ['material', 'remix']) {
          await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', value), pack)
          await button.focus()
          await expectWidth(96)
          await group.screenshot({ path: testInfo.outputPath(`volume-${width}-${pack}.png`) })
        }
        // Exercise the real range's pointer and keyboard handlers.
        await button.focus()
        await expectWidth(96)
        const bounds = await slider.boundingBox()
        await slider.click({ position: { x: bounds.width * 0.75, y: bounds.height / 2 } })
        await expect.poll(() => video.evaluate(element => element.volume)).toBeGreaterThan(0.7)
        await slider.press('Home')
        await expect.poll(() => video.evaluate(element => element.volume)).toBe(0)
        await slider.press('End')
        await expect.poll(() => video.evaluate(element => element.volume)).toBe(1)
        await expect.poll(() => video.evaluate(element => element.muted)).toBe(false)
        await button.click()
        await expect(slider).toHaveValue('0')
        await expect(track).toHaveAttribute('style', /0%/)
        await updateInputWithoutScrolling(slider, '40')
        await slider.blur()
        await button.blur()
        await page.mouse.move(0, 0)
        await expectWidth(0)
        await button.focus()
        await expectWidth(96)
      }
    })
  })
}
