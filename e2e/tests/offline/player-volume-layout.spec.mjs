import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

for (const uiScale of [100, 95, 125]) {
  test.describe(`volume icon at ${uiScale}% UI scale`, () => {
    test.use({
      // Keep Xvfb geometry checks independent of the host GPU.
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
          secColor: 'Blue'
        }
      }
    })

    test('centers the volume icon in its circle and expanded pill', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await page.locator('.topNav input[type="search"]').fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
      await page.locator('.topNav input[type="search"]').press('Enter')
      const video = page.locator('.tabContent[aria-hidden="false"] video')
      await expect(page.locator('.ft-volume-control-group')).toBeVisible()
      await video.evaluate(element => element.pause())
      await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
      const group = page.locator('.ft-volume-control-group')
      const button = group.locator('.shaka-mute-button')
      const slider = group.locator('.shaka-volume-bar-container')

      for (const width of [1280, 450]) {
        await setWindowSize(app, page, { width, height: width === 450 ? 700 : 800 })
        for (const pack of ['material', 'remix']) {
          await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', value), pack)
          for (const frosted of [true, false]) {
            await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseFrostedGlassPlayerUi', value), frosted)
            for (const expanded of [false, true]) {
              await button.blur()
              if (expanded) {
                await button.hover()
                await expect(slider).toHaveCSS('width', width === 450 ? '50px' : '100px')
              } else {
                await page.mouse.move(1, 1)
                await expect(slider).toHaveCSS('width', '0px')
              }
              for (const muted of [false, true]) {
                await video.evaluate((element, value) => { element.muted = value }, muted)
                await expect(button).toHaveAttribute('data-ft-muted', String(muted))
                const geometry = await button.evaluate(element => {
                  const glyph = element.querySelector('.shaka-ui-icon').getBoundingClientRect()
                  const target = element.getBoundingClientRect()
                  const glass = element.parentElement.querySelector('.ft-control-glass').getBoundingClientRect()
                  return {
                    horizontalOffset: glyph.left + glyph.width / 2 - target.left - target.width / 2,
                    verticalOffset: glyph.top + glyph.height / 2 - target.top - target.height / 2,
                    glassHorizontalOffset: glass.height > 0
                      ? glyph.left + glyph.width / 2 - glass.left - glass.height / 2
                      : 0,
                    glassVerticalOffset: glass.height > 0
                      ? glyph.top + glyph.height / 2 - glass.top - glass.height / 2
                      : 0
                  }
                })
                const context = JSON.stringify({ width, pack, frosted, expanded, muted, geometry })
                expect(Math.abs(geometry.horizontalOffset), context).toBeLessThanOrEqual(0.6)
                expect(Math.abs(geometry.verticalOffset), context).toBeLessThanOrEqual(0.6)
                expect(Math.abs(geometry.glassHorizontalOffset), context).toBeLessThanOrEqual(0.6)
                expect(Math.abs(geometry.glassVerticalOffset), context).toBeLessThanOrEqual(0.6)
              }
            }
          }
        }
      }
    })
  })
}
