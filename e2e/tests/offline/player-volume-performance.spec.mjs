import { test, expect, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  trace: 'off',
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      useQuickPlaybackSpeedBar: true,
      reducedMotion: 'off'
    }
  }
})

test('volume slide supports narrow windows, keyboard input and reduced motion', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await setWindowSize(app, page, { width: 450, height: 700 })
  const group = page.locator('.ft-volume-control-group')
  const slider = group.locator('.shaka-volume-bar')
  await group.locator('.shaka-mute-button').hover()
  await expect(group.locator('.shaka-volume-bar-container')).toHaveCSS('width', '50px')
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', 'on'))
  await page.keyboard.press('Tab')
  await slider.focus()
  await page.mouse.move(1, 1)
  await expect(group.locator('.shaka-volume-bar-container')).toHaveCSS('width', '50px')
  const volumeBefore = Number(await slider.inputValue())
  await page.keyboard.press('ArrowLeft')
  await expect(slider).toHaveValue(String(volumeBefore - 1))
  await expect(group.locator('.shaka-volume-bar-container')).toHaveCSS('animation-name', 'none')
  expect(await group.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0)
})

test('volume hover keeps its slide without animating layout under CPU load in both player themes and UI scales', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await setWindowSize(app, page, { width: 1920, height: 1080 })
  await setPlayerFullscreen(page, true)
  await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  const group = page.locator('.ft-volume-control-group')
  const slider = group.locator('.shaka-volume-bar-container')
  const timeGroup = page.locator('.ft-time-display-group')
  const speedBar = page.locator('.shaka-controls-button-panel > .shaka-spacer ~ .ft-quick-playback-rate-bar')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))
  const measurements = []
  try {
    for (const scale of [1, 1.25]) {
      await app.electronApp.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), scale)
      for (const frosted of [true, false]) {
        await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseFrostedGlassPlayerUi', value), frosted)
        await page.mouse.move(1, 1)
        await expect.poll(() => slider.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(1)
        const muteBounds = await group.locator('.shaka-mute-button').boundingBox()
        const timeBefore = (await timeGroup.boundingBox()).x
        // With spare width, the flex spacer absorbs expansion and keeps right controls fixed.
        await expect.poll(() => page.locator('.shaka-controls-button-panel > .shaka-spacer').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(100)
        const speedBefore = (await speedBar.boundingBox()).x
        await group.evaluate(element => {
          delete element.dataset.hoverMotion
          element.addEventListener('pointerenter', () => {
            const started = performance.now()
            const time = element.parentElement.querySelector('.ft-time-display-group')
            const bar = element.querySelector('.shaka-volume-bar-container')
            const speeds = element.parentElement.querySelector('.ft-quick-playback-rate-bar')
            const frames = []
            let animatedProperties
            function sample(now) {
              animatedProperties ??= bar.getAnimations().flatMap(animation =>
                animation.effect.getKeyframes().flatMap(frame => Object.keys(frame)))
              frames.push({ elapsedMs: now - started, timeLeft: time.getBoundingClientRect().left, speedLeft: speeds.getBoundingClientRect().left })
              if (now - started < 350) {
                requestAnimationFrame(sample)
              } else {
                element.dataset.hoverMotion = JSON.stringify({ frames, animatedProperties })
              }
            }
            requestAnimationFrame(sample)
          }, { once: true })
        })
        // Let unrelated theme/zoom transitions settle before measuring hover.
        await page.waitForTimeout(700)
        const before = await metrics()
        await page.mouse.move(muteBounds.x + muteBounds.width / 2, muteBounds.y + muteBounds.height / 2)
        await expect.poll(() => group.getAttribute('data-hover-motion')).not.toBeNull()
        const motion = JSON.parse(await group.getAttribute('data-hover-motion'))
        const after = await metrics()
        const measurement = {
          scale,
          frosted,
          ...motion,
          layouts: after.LayoutCount - before.LayoutCount,
          layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
          styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000
        }
        measurements.push(measurement)
        const timeAfter = (await timeGroup.boundingBox()).x
        expect(motion.frames.some(frame => frame.timeLeft > timeBefore + 0.5 && frame.timeLeft < timeAfter - 0.5), JSON.stringify(measurement)).toBe(true)
        expect(Math.max(...motion.frames.map(frame => Math.abs(frame.speedLeft - speedBefore))), JSON.stringify(measurement)).toBeLessThan(1)
        expect(motion.animatedProperties).toContain('transform')
        expect(motion.animatedProperties).toContain('clipPath')
        expect(motion.animatedProperties).not.toContain('width')
        expect(motion.animatedProperties).not.toContain('inlineSize')
        await expect(slider).toHaveCSS('width', '100px')
      }
    }
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await cdp.detach()
    await testInfo.attach('volume-hover-performance', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  }
})
