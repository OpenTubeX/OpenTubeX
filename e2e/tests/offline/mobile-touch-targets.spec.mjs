import { test, expect, setPlayerFullscreen } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

for (const uiScale of [100, 125]) {
  test(`player settings and PiP retain 56px touch targets at ${uiScale}% scale`, async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale / 100), uiScale)
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
}

test('player pill hover clears after a touch moves away', async ({ app, page }) => {
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.locator('video').evaluate(video => video.pause())

  const player = page.locator('.ftVideoPlayer')
  const time = player.locator('.ft-time-display-group')
  const glass = time.locator('.ft-control-glass')
  const normalBackground = await glass.evaluate(element => getComputedStyle(element).backgroundImage)
  expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true)
  await time.hover()
  await expect(glass).toHaveCSS('background-image', normalBackground)

  await page.setViewportSize({ width: 740, height: 375 })
  await player.locator('.shaka-controls-button-panel').evaluate(panel => {
    const chapter = document.createElement('button')
    chapter.className = 'ft-chapters-button'
    chapter.innerHTML = '<span class="ft-control-glass" aria-hidden="true"></span>Introduction'
    panel.append(chapter)
  })
  const chapter = player.locator('.shaka-controls-button-panel > .ft-chapters-button')
  await expect(chapter).toBeVisible()
  const chapterGlass = chapter.locator('.ft-control-glass')
  const normalChapterBackground = await chapterGlass.evaluate(element => getComputedStyle(element).backgroundImage)
  await chapter.hover()
  await expect(chapterGlass).toHaveCSS('background-image', normalChapterBackground)

  const tap = async (x, y) => {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const timeBounds = await time.boundingBox()
  const playerBounds = await player.boundingBox()
  await tap(timeBounds.x + timeBounds.width / 2, timeBounds.y + timeBounds.height / 2)
  await tap(playerBounds.x + playerBounds.width / 2, playerBounds.y + 30)
  await expect.poll(() => glass.evaluate(element => getComputedStyle(element).backgroundImage)).toBe(normalBackground)
  await session.detach()
})

test('long toast actions wrap below readable text on a phone and after resize', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('opentubex:preview-managed-tools-update')))
  await expect(page.locator('.toast')).toBeVisible()
  await page.evaluate(() => {
    const seen = new Set()
    let toast
    const visit = vnode => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      if (vnode.component) {
        if (vnode.component.type?.__name === 'FtToastItem') toast = vnode.component.props.toast
        visit(vnode.component.subTree)
      }
      if (Array.isArray(vnode.children)) vnode.children.forEach(visit)
      if (Array.isArray(vnode.dynamicChildren)) vnode.dynamicChildren.forEach(visit)
    }
    visit(document.querySelector('#app')._vnode)
    if (!toast) throw new Error('Toast item was not mounted')
    toast.message = 'Version 0.34.1-nightly-1444 ist jetzt verfügbar.'
    toast.verticalButtons = true
    toast.buttons[0].label = 'Ausblenden'
    toast.buttons[1].label = 'Änderungen ansehen und aktualisieren'
  })
  const toast = page.locator('.toast', { hasText: 'Version 0.34.1' })
  await expect(toast).toBeVisible()
  for (const width of [375, 740, 320]) {
    await page.setViewportSize({ width, height: 812 })
    await expect.poll(() => toast.evaluate((el, viewportWidth) => {
      const message = el.querySelector('.message').getBoundingClientRect()
      const actions = el.querySelector('.toastActions').getBoundingClientRect()
      const actionsFit = viewportWidth <= 375
        ? actions.top >= message.bottom - 1
        : actions.left >= message.right - 1
      return message.width > 180 && actionsFit && el.scrollWidth <= el.clientWidth + 1
    }, width)).toBe(true)
  }
  await toast.getByRole('button', { name: 'Ausblenden', exact: true }).click()
  await expect(toast).toHaveCount(0)
})
