import { writeFile } from 'node:fs/promises'

import { test, expect, expectScrollAtRenderedEnd, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { measureFullscreenDockToggle } from '../../helpers/fullscreen-docks.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

for (const { layout, width, height, uiScale, cpuThrottle = 1 } of [
  { layout: 'desktop', width: 1600, height: 900, uiScale: 100 },
  { layout: 'desktop', width: 1600, height: 900, uiScale: 125 },
  { layout: 'desktop with 4x CPU throttling', width: 1600, height: 900, uiScale: 100, cpuThrottle: 4 },
  { layout: 'phone portrait', width: 420, height: 800, uiScale: 100 },
  { layout: 'phone landscape', width: 900, height: 450, uiScale: 125 },
]) {
  test.describe(`${layout} at ${uiScale}% scale`, () => {
    test.use({
      seed: {
        settings: {
          videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, uiScale,
        }
      }
    })

    test('fullscreen docks animate without laying out the player every frame', async ({ app, page }, testInfo) => {
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      if (!layout.startsWith('desktop')) {
        await setWindowSize(app, page, { width, height })
        await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs', 'capacitorPhoneLayout'))
      }
      await setPlayerFullscreen(page, true)
      const player = page.locator('.ftVideoPlayer')
      const video = player.locator('video')
      await expect(player).not.toHaveClass(/presentationModeChanging/)
      expect(await video.evaluate(element => getComputedStyle(element).transform)).toBe('none')
      const fade = await player.locator('.ft-control-glass').first().evaluate(element => {
        const style = getComputedStyle(element)
        return { property: style.transitionProperty, duration: style.transitionDuration }
      })
      expect(fade.property).toContain('opacity')
      expect(parseFloat(fade.duration)).toBeGreaterThan(0)
      if (cpuThrottle !== 1) {
        const session = await page.context().newCDPSession(page)
        await session.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle })
      }
      const watch = await page.evaluateHandle(findWatchComponent)
      try {
        const initialWidth = await video.evaluate(element => element.clientWidth)
        for (const open of [true, false]) {
          const samples = await measureFullscreenDockToggle(watch, open)
          await testInfo.attach(open ? 'opening' : 'closing', { body: JSON.stringify(samples), contentType: 'application/json' })
          expect(samples.widths.length, 'Video layout must not change on every animation frame').toBeLessThanOrEqual(2)
          expect(samples.controlWidths.length, 'Controls must not reflow on every animation frame').toBeLessThanOrEqual(2)
          expect(samples.animationKeyframes.length, 'The fitted video uses a compositor animation').toBe(2)
          expect(samples.animationKeyframes[0].scale).not.toBe(samples.animationKeyframes[1].scale)
          if (open) {
            await expect(player.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
            expect(samples.widths.at(-1)).toBeLessThan(initialWidth)
            const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
              (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
            await writeFile(testInfo.outputPath('open-dock.png'), Buffer.from(screenshot, 'base64'))
          } else {
            await expect(player).not.toHaveClass(/fullscreenDockLayoutOpen/)
            expect(samples.widths.at(-1)).toBe(initialWidth)
          }
          expect(await video.evaluate(element => element.getAnimations().length)).toBe(0)
        }
        expect(errors).toEqual([])
      } finally {
        await watch.dispose()
      }
    })
  })
}

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, uiScale: 125,
    }
  }
})

test('full-window docks preserve zoom, stacked panel controls and rapid toggles', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const player = page.locator('.ftVideoPlayer')
  const video = player.locator('video')
  const clickPlayerControl = async selector => {
    await player.hover({ position: { x: 20, y: 20 } })
    await expect(player.locator('.shaka-controls-container')).toHaveAttribute('shown', 'true')
    await player.locator(selector).click()
  }
  await clickPlayerControl('.full-window-button')
  await expect(player).toHaveClass(/fullWindow/)
  await expect(player).not.toHaveClass(/presentationModeChanging/)
  const watch = await page.evaluateHandle(findWatchComponent)
  try {
    // Keep active-chapter auto-scroll from competing with bottom-position checks.
    await video.evaluate(element => element.pause())
    await watch.evaluate(component => {
      component.proxy.videoChapters = Array.from({ length: 50 }, (_, index) => ({
        title: `Chapter ${index}`, startSeconds: index, endSeconds: index + 1, timestamp: `0:${index}`,
      }))
    })
    await video.evaluate(element => {
      element.style.transform = 'scale(2) translate(10%, -5%)'
      return Promise.all(element.getAnimations().map(animation => animation.finished))
    })
    const zoomTransform = await video.evaluate(element => element.style.transform)
    const continuity = await watch.evaluate(async component => {
      const video = document.querySelector('.ftVideoPlayer video')
      const geometry = () => {
        const bounds = video.getBoundingClientRect()
        return {
          width: video.videoWidth * Math.min(bounds.width / video.videoWidth, bounds.height / video.videoHeight),
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        }
      }
      const before = geometry()
      component.proxy.$refs.player.setFullscreenMetadata(true)
      await component.proxy.$nextTick()
      await component.proxy.$nextTick()
      const animation = video.getAnimations().find(animation => animation.effect.getKeyframes().some(frame => frame.scale != null))
      if (!animation) throw new Error('Dock video animation is missing')
      animation.pause()
      animation.currentTime = 0
      const firstFrame = geometry()
      animation.play()
      await animation.finished
      return { before, firstFrame }
    })
    expect(continuity.firstFrame.width).toBeCloseTo(continuity.before.width, 2)
    expect(continuity.firstFrame.x).toBeCloseTo(continuity.before.x, 2)
    expect(continuity.firstFrame.y).toBeCloseTo(continuity.before.y, 2)
    await measureFullscreenDockToggle(watch, false)
    const samples = await measureFullscreenDockToggle(watch, true)
    expect(samples.widths.length).toBe(2)
    expect(samples.animationKeyframes.length).toBe(2)
    expect(await video.evaluate(element => element.style.transform)).toBe(zoomTransform)

    await clickPlayerControl('.shaka-controls-button-panel .ft-chapters-button')
    const metadata = player.locator('.fullscreenMetadataOverlay.open')
    const chapters = player.locator('.chapterOverlay')
    await expect(chapters).toBeVisible()
    const scroller = chapters.locator('.chaptersWrapper')
    await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
    const scrollToBottom = async () => {
      await scroller.hover()
      await page.mouse.wheel(0, 10000)
      await expectScrollAtRenderedEnd(scroller)
    }
    const expectValidScrollbar = async () => {
      await expectScrollAtRenderedEnd(scroller)
      await expect.poll(() => scroller.evaluate(element => {
        const hasOverflow = element.scrollHeight > element.clientHeight + 1
        const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
        return scrollbar.classList.contains('os-scrollbar-visible') === hasOverflow
      })).toBe(true)
    }
    await scrollToBottom()
    const height = await metadata.evaluate(element => element.clientHeight)
    const header = metadata.locator('.fullscreenMetadataHeader')
    await header.dblclick()
    await expect.poll(() => metadata.evaluate(element => element.clientHeight)).toBeLessThan(height / 2)
    await expectValidScrollbar()
    await header.dblclick()
    await expect.poll(() => metadata.evaluate(element => element.clientHeight)).toBe(height)
    const handle = metadata.locator('.fullscreenDockResizeHandle')
    await scrollToBottom()
    await handle.press('ArrowUp')
    await expect.poll(() => metadata.evaluate(element => element.clientHeight)).toBeLessThan(height)
    await expectValidScrollbar()
    await handle.dblclick()
    await expect.poll(() => metadata.evaluate(element => element.clientHeight)).toBe(height)
    await scrollToBottom()
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await watch.evaluate(component => component.proxy.$refs.player.closeChaptersOverlay())

    // Reverse in-flight movement, including a pending delayed close.
    await watch.evaluate(async component => {
      const player = component.proxy.$refs.player
      player.setFullscreenMetadata(false)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      player.setFullscreenMetadata(true)
      await new Promise(resolve => requestAnimationFrame(resolve))
      player.setFullscreenMetadata(false)
    })
    await expect(player).not.toHaveClass(/fullscreenDockLayoutOpen/)
    await expect.poll(() => video.evaluate(element => element.getAnimations().length)).toBe(0)
    expect(await video.evaluate(element => element.style.transform)).toBe(zoomTransform)

    await page.evaluate(async () => {
      await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', 'on')
    })
    const reduced = await measureFullscreenDockToggle(watch, true)
    expect(reduced.animationKeyframes).toEqual([])
    expect(reduced.widths.length).toBe(2)
    await clickPlayerControl('.full-window-button')
    await expect(player).not.toHaveClass(/fullWindow/)
    await expect.poll(() => video.evaluate(element => element.getAnimations().length)).toBe(0)
  } finally {
    await watch.dispose()
  }
})
