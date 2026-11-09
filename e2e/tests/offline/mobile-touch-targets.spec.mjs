import { test, expect, setPlayerFullscreen } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

test('player settings and PiP retain 56px touch targets', { tag: '@scale' }, async ({ app, page }) => {
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.setViewportSize({ width: 375, height: 812 })
  const panel = page.locator('.shaka-controls-button-panel')
  await page.locator('video').evaluate(video => video.pause())
  await expect(panel.locator('.shaka-overflow-menu-button')).toBeVisible()
  await expect.poll(() => panel.locator(':scope > button:enabled:visible').evaluateAll(buttons => buttons.map(button => {
    const bounds = button.getBoundingClientRect()
    return { width: bounds.width, height: bounds.height, minimum: button.matches('.shaka-overflow-menu-button, .shaka-pip-button') ? 55.75 : 47.75 }
  }).every(bounds => bounds.width >= bounds.minimum && bounds.height >= bounds.minimum))).toBe(true)
  const time = panel.locator('.ft-time-display-group > .shaka-current-time').first()
  await expect(time).toHaveCSS('white-space', 'nowrap')
  const bounds = await panel.boundingBox()
  await expect.poll(() => panel.locator(':scope > button:enabled:visible').evaluateAll((buttons, right) => buttons.every(button => button.getBoundingClientRect().right <= right + 1), bounds.x + bounds.width)).toBe(true)
  await panel.locator('.shaka-overflow-menu-button').click({ position: { x: 4, y: 28 } })
  await expect(page.locator('.shaka-overflow-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 740, height: 375 })
  await setPlayerFullscreen(page, true)
  await expect.poll(() => panel.locator(':scope > button:enabled:visible').evaluateAll(buttons => buttons.every(button => {
    const rect = button.getBoundingClientRect()
    const minimum = button.matches('.shaka-overflow-menu-button, .shaka-pip-button') ? 55.75 : 47.75
    return rect.width >= minimum && rect.height >= minimum
  }))).toBe(true)
  await panel.locator('.shaka-overflow-menu-button').click({ position: { x: 4, y: 28 } })
  await expect(page.locator('.shaka-overflow-menu')).toBeVisible()
  await session.detach()
})
