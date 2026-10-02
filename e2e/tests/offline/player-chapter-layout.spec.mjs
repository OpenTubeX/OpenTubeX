import { test, expect, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      useQuickPlaybackSpeedBar: true,
      showPlaybackRateAdjustedTimestamp: true,
      quickPlaybackSpeedBarOptions: JSON.stringify([0.5, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3].map(speed => ({ speed }))),
      reducedMotion: 'off'
    }
  }
})

test('mobile quick speeds stay no wider than their presets', async ({ app, page }) => {
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateQuickPlaybackSpeedBarOptions', JSON.stringify([1, 1.5, 2].map(speed => ({ speed })))))
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await setWindowSize(app, page, { width: 1100, height: 700 })
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs', 'capacitorTabletLayout'))
  const player = page.locator('.ftVideoPlayer')
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  const bar = player.locator('.shaka-controls-button-panel > .ft-quick-playback-rate-bar')

  for (const scale of [1, 1.25]) {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale), scale)
    for (const frosted of [true, false]) {
      await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseFrostedGlassPlayerUi', value), frosted)
      await expect.poll(() => bar.evaluate(element => {
        const style = getComputedStyle(element)
        const buttons = [...element.children].filter(child => getComputedStyle(child).display !== 'none')
        const contentWidth = buttons.reduce((width, child) => width + child.getBoundingClientRect().width, 0) +
          Math.max(0, buttons.length - 1) * Number.parseFloat(style.columnGap) +
          Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
        return element.getBoundingClientRect().width - contentWidth
      })).toBeLessThan(1)
    }
  }
})

for (const scale of [1, 1.25]) {
  test(`chapter controls narrow quick speeds first during playback at ${scale * 100}% scale`, async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await setWindowSize(app, page, { width: 1800, height: 1000 })
    await setPlayerFullscreen(page, true)
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale), scale)
    const player = page.locator('.ftVideoPlayer')
    const panel = player.locator('.shaka-controls-button-panel')
    const title = panel.locator('.ft-chapters-current-title')
    const bar = panel.locator('.ft-quick-playback-rate-bar')
    await panel.evaluate(element => { element.style.width = '1300px' })
    await title.evaluate(element => { element.textContent = 'MacPacker: zips all the way down' })
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))

    await video.evaluate(element => element.pause())
    await panel.locator('.shaka-mute-button').hover()
    await expect.poll(() => panel.locator('.shaka-volume-bar-container').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(90)
    await expect(panel).not.toHaveClass(/ft-controls-compact-chapters/)
    // Leave enough room for a usable speed strip, but not all presets.
    await panel.evaluate(element => {
      const controls = [...element.children].filter(child => {
        const style = getComputedStyle(child)
        return style.display !== 'none' && style.position !== 'absolute' && !child.classList.contains('shaka-spacer')
      })
      const fullWidth = controls.reduce((width, child) => {
        const style = getComputedStyle(child)
        return width + child.getBoundingClientRect().width + (Number.parseFloat(style.marginLeft) || 0) + (Number.parseFloat(style.marginRight) || 0)
      }, 0)
      element.style.width = `${fullWidth - element.querySelector('.ft-quick-playback-rate-bar').getBoundingClientRect().width + 200}px`
    })

    for (const paused of [true, false]) {
      await video.evaluate((element, paused) => paused ? element.pause() : element.play(), paused)
      await panel.locator('.shaka-mute-button').hover()
      await expect.poll(() => panel.locator('.shaka-volume-bar-container').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(90)
      await expect(panel).not.toHaveClass(/ft-controls-compact-chapters/)
      await expect(title).toBeVisible()
      await expect.poll(() => bar.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(20)
    }

    if (scale === 1) {
      await panel.screenshot({ path: testInfo.outputPath('playing-with-chapter-title.png') })
    }

    await panel.evaluate(element => { element.style.width = '700px' })
    await expect(panel).toHaveClass(/ft-controls-compact-chapters/)
    await expect(panel.locator('.ft-chapters-icon')).toBeVisible()
    await expect.poll(() => panel.locator('.ft-chapters-button').evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(48, 0)
  })
}

test('chapters animate between title and icon in both player themes', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await setPlayerFullscreen(page, true)
  const player = page.locator('.ftVideoPlayer')
  const panel = player.locator('.shaka-controls-button-panel')
  const button = panel.locator('.ft-chapters-button')
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))

  for (const frosted of [true, false]) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseFrostedGlassPlayerUi', value), frosted)
    await panel.evaluate(element => { element.style.width = '1300px' })
    await expect(panel).not.toHaveClass(/ft-controls-compact-chapters/)
    await button.locator('.ft-chapters-current-title').evaluate(element => { element.textContent = 'MacPacker: zips all the way down' })
    await expect.poll(() => button.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(150)

    for (const width of [700, 1300]) {
      const animation = await panel.evaluate(async (element, width) => {
        const button = element.querySelector(':scope > .ft-chapters-button')
        const measure = () => ({ width: button.getBoundingClientRect().width, titleOpacity: Number(getComputedStyle(button.querySelector('.ft-chapters-current-title')).opacity), iconOpacity: Number(getComputedStyle(button.querySelector('.ft-chapters-icon')).opacity) })
        const initial = measure()
        element.style.width = `${width}px`
        await new Promise(resolve => setTimeout(resolve, 40))
        // A control mutation remeasures the row during the transition.
        button.classList.toggle('open')
        await new Promise(resolve => setTimeout(resolve, 60))
        const middle = measure()
        await new Promise(resolve => setTimeout(resolve, 400))
        return { initial, middle, final: measure() }
      }, width)
      expect(animation.middle.width).toBeGreaterThan(Math.min(animation.initial.width, animation.final.width) + 1)
      expect(animation.middle.width).toBeLessThan(Math.max(animation.initial.width, animation.final.width) - 1)
      expect(animation.middle.titleOpacity).toBeGreaterThan(0)
      expect(animation.middle.titleOpacity).toBeLessThan(1)
      expect(animation.middle.iconOpacity).toBeGreaterThan(0)
      expect(animation.middle.iconOpacity).toBeLessThan(1)
    }
  }

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', 'system'))
  await panel.evaluate(element => { element.style.width = '700px' })
  await expect(panel).toHaveClass(/ft-controls-compact-chapters/)
  await expect(button).toHaveCSS('transition-property', 'none')
})

test('chapter animation keeps the right control glass aligned without quick speeds', async ({ app, page }) => {
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseQuickPlaybackSpeedBar', false))
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await setPlayerFullscreen(page, true)
  const player = page.locator('.ftVideoPlayer')
  const panel = player.locator('.shaka-controls-button-panel')
  const button = panel.locator('.ft-chapters-button')
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await button.locator('.ft-chapters-current-title').evaluate(element => { element.textContent = 'MacPacker: zips all the way down' })

  for (const scale of [1, 1.25]) {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale), scale)
    for (const width of [1300, 500, 1300]) {
      await panel.evaluate((element, width) => { element.style.width = `${width}px` }, width)
      await expect(panel).toHaveClass(width === 500 ? /ft-controls-compact-chapters/ : /^(?!.*ft-controls-compact-chapters)/)
      await expect.poll(() => button.evaluate(element => element.getAnimations().length)).toBe(0)
      await expect.poll(() => panel.evaluate(element => {
        const glass = element.querySelector('.ft-right-control-glass').getBoundingClientRect()
        const buttons = [...element.querySelectorAll(':scope > .shaka-spacer ~ button:not(.shaka-hidden)')].filter(button => button.getClientRects().length > 0)
        return Math.max(
          Math.abs(glass.left - buttons[0].getBoundingClientRect().left),
          Math.abs(glass.right - buttons.at(-1).getBoundingClientRect().right)
        )
      })).toBeLessThan(1)
    }
  }
})
