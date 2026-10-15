import { test, expect, setPlayerFullscreen } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

async function expectRightControlBackgroundAligned(panel) {
  await expect.poll(() => panel.evaluate(element => {
    const buttons = [...element.querySelectorAll(':scope > .shaka-spacer ~ button:not(.shaka-hidden)')]
      .filter(button => button.getClientRects().length > 0)
    const glassElement = element.querySelector(':scope > .ft-right-control-glass')
    const speedBarElement = element.querySelector(':scope > .ft-quick-playback-rate-bar')
    if (!glassElement || !speedBarElement || buttons.length === 0) return Infinity
    const glass = glassElement.getBoundingClientRect()
    const speedBar = speedBarElement.getBoundingClientRect()
    const first = buttons[0].getBoundingClientRect()
    const last = buttons.at(-1).getBoundingClientRect()
    const scale = element.getBoundingClientRect().width / element.clientWidth
    return Math.max(
      Math.abs(glass.left - first.left),
      Math.abs(glass.right - last.right),
      Math.max(0, 7 * scale - (glass.left - speedBar.right))
    ) / scale
  }), { timeout: 3000 }).toBeLessThan(1)
}

test.describe('player control roundness', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
        useFrostedGlassPlayerUi: true,
        useQuickPlaybackSpeedBar: true,
        showPlaybackRateAdjustedTimestamp: true,
        baseTheme: 'system',
        systemDarkTheme: 'dark',
        systemLightTheme: 'light',
        mainColor: 'Red',
        secColor: 'Blue'
      }
    }
  })

  test('all glass control surfaces follow UI roundness', async ({ app, page, uiScale }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveClass(/\bdark\b/)
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    const player = page.locator('.ftVideoPlayer')
    await player.locator('.full-window-button').evaluate(element => element.click())
    await expect(player).toHaveClass(/fullWindow/)
    const panel = player.locator('.shaka-controls-button-panel')
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
    await expect(panel.locator('.ft-right-control-glass')).toBeVisible()
    await expect(panel.locator('.ft-volume-control-group > .ft-control-glass')).toBeVisible()
    await expect(panel.locator('.ft-time-display-group > .ft-control-glass')).toBeVisible()
    await expect(panel.locator('.ft-quick-playback-rate-bar')).toBeVisible()

    for (const width of [1600, 480]) {
      await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 900 }), width)
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeCloseTo(width * 100 / uiScale, 0)
      for (const roundness of [0, 50, 100, 200]) {
        await page.evaluate(value => window.$store.dispatch('updateUiRoundness', value), roundness)
        await expect(page.locator('body')).toHaveCSS('--ui-roundness', String(roundness / 100))
        const radii = await panel.locator('.ft-control-glass, .ft-right-control-glass').evaluateAll(elements => elements.map(element => Number.parseFloat(getComputedStyle(element).borderRadius)))
        expect(radii, `${width}px, roundness ${roundness}%`).toEqual(radii.map(() => 17 * roundness / 100))

        // The expanded volume surface uses the same radius for its reveal clip.
        await panel.locator('.shaka-mute-button').hover()
        await expect(panel.locator('.shaka-volume-bar-container')).toBeVisible()
        await expect(panel.locator('.ft-volume-control-group > .ft-control-glass')).toHaveCSS('border-radius', `${17 * roundness / 100}px`, { timeout: 1000 })
        await page.mouse.move(0, 0)

        if (width === 1600 && uiScale === 100 && [0, 100].includes(roundness)) {
          await expectRightControlBackgroundAligned(panel)
          const screenshot = testInfo.outputPath(`player-controls-roundness-${roundness}.png`)
          await player.locator('.shaka-bottom-controls').screenshot({ path: screenshot })
          await testInfo.attach(`Player controls at ${roundness}% roundness`, { path: screenshot, contentType: 'image/png' })
        }
      }
    }
  })

  test('right control background preserves the speed bar gap when presentation and control sizes change', async ({ app, page, uiScale }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    const player = page.locator('.ftVideoPlayer')
    const panel = player.locator('.shaka-controls-button-panel')
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
    await expect(panel.locator('.ft-right-control-glass')).toBeVisible()
    await expect(panel.locator('.ft-quick-playback-rate-bar')).toBeVisible()

    for (const fullWindow of [true, false, true]) {
      await player.locator('.full-window-button').evaluate(element => element.click())
      await expect(player).toHaveClass(fullWindow ? /fullWindow/ : /^(?!.*fullWindow)/)
      await expectRightControlBackgroundAligned(panel)
    }
    // CSS can hide a right-hand action without resizing the panel or changing
    // its class, as presentation and responsive styles do.
    const pip = panel.locator(':scope > .shaka-pip-button')
    await pip.evaluate(element => { element.style.display = 'none' })
    await expectRightControlBackgroundAligned(panel)
    await pip.evaluate(element => { element.style.display = '' })
    await expectRightControlBackgroundAligned(panel)
    for (const width of [900, 1600]) {
      await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 900 }), width)
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeCloseTo(width * 100 / uiScale, 0)
      await expectRightControlBackgroundAligned(panel)
      await panel.locator('.shaka-mute-button').hover()
      await expect(panel.locator('.shaka-volume-bar-container')).toBeVisible()
      await expectRightControlBackgroundAligned(panel)
      await page.mouse.move(0, 0)
      await expect(panel.locator('.shaka-volume-bar-container')).toHaveCSS('width', '0px')
      await expectRightControlBackgroundAligned(panel)
    }
    await player.locator('.full-window-button').evaluate(element => element.click())
    await expect(player).not.toHaveClass(/fullWindow/)
    await expectRightControlBackgroundAligned(panel)
    await setPlayerFullscreen(page, true)
    await expectRightControlBackgroundAligned(panel)
    await setPlayerFullscreen(page, false)
    await expectRightControlBackgroundAligned(panel)
  })
})
