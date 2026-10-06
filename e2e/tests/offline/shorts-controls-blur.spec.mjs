import { test, expect, setWindowSize, setPlayerFullscreen } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
    }
  }
})

async function openShort({ app, page }) {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(async component => {
    component.proxy.useCustomShortsPlayerForCurrentVideo = true
    component.proxy.updateShortsPlayerState(30, [{ width: 360, height: 640 }])
    await component.proxy.$nextTick()
  })
  await watch.dispose()
  await expect(page.locator('.ftVideoPlayer')).toHaveClass(/shortsPlayer/)
  // Entering Shorts replaces the original video element.
  await page.locator('.ftVideoPlayer video').evaluate(async element => {
    element.loop = true
    await element.play()
  })
  await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/shortsPaused/)
  await page.mouse.move(0, 0)
}

for (const layout of ['desktop', 'phone', 'fullWindow', 'fullscreen']) {
  test(`Shorts glass stays blurred during both fades in ${layout}`, async ({ app, page }, testInfo) => {
    await openShort({ app, page })
    const player = page.locator('.ftVideoPlayer')
    if (layout === 'phone') await setWindowSize(app, page, { width: 390, height: 800 })
    if (layout === 'fullWindow') {
      await player.locator('.full-window-button').evaluate(element => element.click())
      await expect(player).toHaveClass(/fullWindow/)
    }
    if (layout === 'fullscreen') await setPlayerFullscreen(page, true)
    await expect(player).not.toHaveClass(/presentationModeChanging/)
    // Fine stripes make a lost blur visible in the mid-transition screenshots.
    await player.evaluate(element => {
      element.style.backgroundImage = 'repeating-linear-gradient(90deg, #ddd 0 2px, #222 2px 4px)'
      element.querySelector('video').style.opacity = '0'
    })

    for (const zoom of [1, 1.25]) {
      await app.electronApp.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), zoom)
      const controls = player.locator('.shaka-controls-container')
      const row = player.locator('.shortsTopControls')
      await controls.evaluate(element => element.setAttribute('shown', 'true'))
      await expect(row).toBeVisible()
      await row.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))

      for (const shown of [false, true]) {
        const sample = await controls.evaluate(async (element, shown) => {
          const row = element.closest('.ftVideoPlayer').querySelector('.shortsTopControls')
          if (shown) element.setAttribute('shown', 'true')
          else element.removeAttribute('shown')
          row.getBoundingClientRect()
          await new Promise(requestAnimationFrame)
          const animation = row.getAnimations().find(animation => ['opacity', '--ft-controls-fade'].includes(animation.transitionProperty))
          if (!animation) throw new Error('Expected the Shorts controls to fade')
          animation.pause()
          animation.currentTime = Number(animation.effect.getTiming().duration) / 2
          const surfaces = Array.from(row.querySelectorAll('.shortsTopControlsGroup > .shortsTopControl, .shortsVolumeControl')).map(control => {
            const pseudo = getComputedStyle(control, '::before')
            const glass = pseudo.content === 'none' ? getComputedStyle(control) : pseudo
            return {
              parentOpacity: Number(getComputedStyle(control).opacity),
              opacity: Number(glass.opacity),
              blur: glass.backdropFilter,
            }
          })
          return {
            rowOpacity: Number(getComputedStyle(row).opacity),
            iconFade: getComputedStyle(row.querySelector('.shortsTopControl > *')).filter,
            surfaces,
          }
        }, shown)
        const screenshotPath = testInfo.outputPath(`${layout}-${zoom}-${shown ? 'fade-in' : 'fade-out'}.png`)
        await player.screenshot({ path: screenshotPath, animations: 'allow' })
        await testInfo.attach('Shorts controls mid-fade', { path: screenshotPath, contentType: 'image/png' })
        // An opacity below 1 on the row cuts the video off from descendant backdrop filters.
        expect(sample.rowOpacity).toBe(1)
        expect(sample.iconFade).toMatch(/opacity\(0\.[0-9]+\)/)
        for (const surface of sample.surfaces) {
          expect(surface.parentOpacity).toBe(1)
          expect(surface.opacity).toBeGreaterThan(0)
          expect(surface.opacity).toBeLessThan(1)
          expect(surface.blur).toContain('blur(10px)')
        }
        await row.evaluate(element => {
          for (const animation of element.getAnimations()) animation.finish()
        })
        await expect(row).toHaveCSS('visibility', shown ? 'visible' : 'hidden')
      }
    }
  })
}

test('reduced motion hides Shorts glass immediately and paused Shorts keep controls visible', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openShort({ app, page })
  const row = page.locator('.shortsTopControls')
  const controls = page.locator('.shaka-controls-container')
  await controls.evaluate(element => element.setAttribute('shown', 'true'))
  await expect(row).toBeVisible()
  await expect(row).toHaveCSS('transition-property', 'none')
  await controls.evaluate(element => element.removeAttribute('shown'))
  await expect(row).toBeHidden()
  await page.locator('.ftVideoPlayer video').evaluate(element => element.pause())
  await expect(row).toBeVisible()
})
