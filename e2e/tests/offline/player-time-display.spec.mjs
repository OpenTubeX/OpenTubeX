import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      showPlaybackRateAdjustedTimestamp: true
    }
  }
})

test('player controls share pill surfaces and the time display toggles together', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => {
    element.playbackRate = 2
    element.pause()
  })

  const group = page.locator('.ft-time-display-group')
  const regular = group.locator('.shaka-current-time:not(.ft-playback-adjusted-time)')
  const adjusted = group.locator('.ft-playback-adjusted-time')
  await expect(adjusted).toBeVisible()
  await expect(group.locator('button')).toHaveCount(1)
  await expect(group.locator('.ft-control-glass')).toHaveCSS('backdrop-filter', /blur\(10px\)/)
  await expect(page.locator('.shaka-scrim-container')).toHaveCSS('background-image', 'none')

  const background = await group.evaluate(element => getComputedStyle(element).backgroundImage)
  expect(background).not.toBe('none')
  await adjusted.hover()
  await expect.poll(() => group.evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe(background)

  const initial = await regular.textContent()
  const initialAdjusted = await adjusted.textContent()
  await adjusted.click()
  await expect(regular).not.toHaveText(initial)
  await expect(adjusted).not.toHaveText(initialAdjusted)

  await regular.click()
  await expect(regular).toHaveText(initial)
  await expect(adjusted).toHaveText(initialAdjusted)
  await group.click({ position: { x: 3, y: 24 } })
  await expect(regular).not.toHaveText(initial)
  await regular.click()
  await expect(regular).toHaveText(initial)
  await page.mouse.move(1, 1)
  await expect.poll(() => group.evaluate(element => getComputedStyle(element).backgroundImage), { timeout: 3000 }).toBe(background)
  await page.keyboard.press('Tab')
  await regular.focus()
  await expect.poll(() => regular.evaluate(element => element.matches(':focus-visible'))).toBe(true)
  await expect.poll(() => group.evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe(background)
  await regular.evaluate(element => element.blur())

  const volumeGroup = page.locator('.ft-volume-control-group')
  const collapsedVolume = await volumeGroup.evaluate(element => {
    const group = element.getBoundingClientRect()
    const icon = element.querySelector('.shaka-mute-button .shaka-ui-icon').getBoundingClientRect()
    return {
      width: group.width,
      iconCenterOffset: (icon.left + icon.right - group.left - group.right) / 2
    }
  })
  const playWidth = await page.locator('.shaka-controls-button-panel > .shaka-play-button').evaluate(element => element.getBoundingClientRect().width)
  expect(Math.abs(collapsedVolume.width - playWidth)).toBeLessThan(1)
  expect(Math.abs(collapsedVolume.iconCenterOffset)).toBeLessThan(1)
  const volumeIconWidth = await volumeGroup.locator('.shaka-mute-button > .shaka-ui-icon').evaluate(element => element.getBoundingClientRect().width)
  for (const playIcon of await page.locator('.shaka-controls-button-panel > .shaka-play-button > .shaka-ui-icon').all()) {
    const iconWidth = await playIcon.evaluate(element => element.getBoundingClientRect().width)
    expect(Math.abs(iconWidth - volumeIconWidth)).toBeLessThan(1)
  }
  await page.locator('.shaka-mute-button').hover()
  await expect(volumeGroup.locator('.shaka-volume-bar-container')).toBeVisible()
  await expect.poll(() => volumeGroup.evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe('none')
  const volumeIconGap = await volumeGroup.evaluate(element => {
    const icon = element.querySelector('.shaka-mute-button .shaka-ui-icon').getBoundingClientRect()
    const slider = element.querySelector('.shaka-volume-bar-container').getBoundingClientRect()
    return slider.left - icon.right
  })
  expect(volumeIconGap).toBeLessThanOrEqual(12.5)
  const volumePillEndGap = await volumeGroup.evaluate(element => {
    const group = element.getBoundingClientRect()
    const slider = element.querySelector('.shaka-volume-bar-container').getBoundingClientRect()
    return group.right - 7 - slider.right
  })
  expect(volumePillEndGap).toBeGreaterThanOrEqual(10)

  await page.locator('.shaka-controls-button-panel > .autoplay-toggle').hover()
  await expect.poll(() => volumeGroup.locator('.shaka-volume-bar-container').evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(1)
  const rightHoverColors = await page.locator('.shaka-controls-button-panel > .shaka-spacer ~ button:not(.shaka-hidden)').evaluateAll(buttons =>
    buttons.map(button => getComputedStyle(button).getPropertyValue('--ft-control-item-hover-color').trim())
  )
  expect(rightHoverColors.length).toBeGreaterThan(1)
  expect(rightHoverColors[0]).not.toBe(rightHoverColors[1])
  expect(new Set(rightHoverColors.slice(1)).size).toBe(1)
  const rightHoverPillSize = /^17px 34px, calc\(100% - 34px\) 34px, 17px 34px, /
  await expect(page.locator('.shaka-controls-button-panel > .autoplay-toggle')).toHaveCSS('background-size', rightHoverPillSize)
  const rightBaseColors = await page.locator('.shaka-controls-button-panel > .shaka-spacer ~ button:not(.shaka-hidden)').evaluateAll(buttons =>
    buttons.map(button => getComputedStyle(button).getPropertyValue('--ft-control-pill-color').trim())
  )
  expect(new Set(rightBaseColors).size).toBe(1)
  const rightGlass = page.locator('.ft-right-control-glass')
  await expect(rightGlass).toBeVisible()
  await expect(rightGlass).toHaveCSS('backdrop-filter', /blur\(10px\)/)
  await expect(page.locator('.shaka-controls-button-panel > .shaka-spacer ~ button:not(.shaka-hidden) > .ft-control-glass')).toHaveCount(rightHoverColors.length)
  await expect(page.locator('.autoplay-toggle > .ft-control-glass')).toHaveCSS('opacity', '1')
  await expect(page.locator('.shaka-overflow-menu-button > .ft-control-glass')).toHaveCSS('opacity', '0')
  const measureRightGlassAlignment = () => rightGlass.evaluate(element => {
    const buttons = [...element.parentElement.querySelectorAll(':scope > .shaka-spacer ~ button:not(.shaka-hidden)')]
    const glass = element.getBoundingClientRect()
    return {
      start: glass.left - buttons[0].getBoundingClientRect().left,
      end: glass.right - buttons[buttons.length - 1].getBoundingClientRect().right
    }
  })
  const rightGlassAlignment = await measureRightGlassAlignment()
  expect(Math.abs(rightGlassAlignment.start)).toBeLessThan(1)
  expect(Math.abs(rightGlassAlignment.end)).toBeLessThan(1)
  await page.locator('.shaka-controls-button-panel > .shaka-overflow-menu-button').hover()
  const settingsHoverColors = await page.locator('.shaka-controls-button-panel > .shaka-spacer ~ button:not(.shaka-hidden)').evaluateAll(buttons =>
    buttons.map(button => getComputedStyle(button).getPropertyValue('--ft-control-item-hover-color').trim())
  )
  expect(settingsHoverColors[1]).not.toBe(settingsHoverColors[0])
  expect(new Set(settingsHoverColors.filter((_, index) => index !== 1)).size).toBe(1)
  await expect(page.locator('.shaka-overflow-menu-button > .ft-control-glass')).toHaveCSS('opacity', '1')
  await expect(page.locator('.shaka-controls-button-panel > .shaka-overflow-menu-button')).toHaveCSS('background-size', rightHoverPillSize)
  await expect(page.locator('.shaka-controls-button-panel > .shaka-fullscreen-button')).toHaveCSS('background-size', rightHoverPillSize)
  const rightPillOpacitiesOnHover = await page.locator('.shaka-controls-button-panel > .shaka-spacer ~ button:not(.shaka-hidden)').evaluateAll(buttons =>
    buttons.map(button => getComputedStyle(button).opacity)
  )
  expect(new Set(rightPillOpacitiesOnHover).size).toBe(1)

  await page.mouse.move(1, 1)
  const timePillColor = await group.evaluate(element => getComputedStyle(element).getPropertyValue('--ft-control-pill-color').trim())
  const rightPillColor = await page.locator('.shaka-controls-button-panel > .autoplay-toggle').evaluate(element =>
    getComputedStyle(element).getPropertyValue('--ft-control-pill-color').trim()
  )
  expect(timePillColor).toBe(rightPillColor)

  const autoplayToggle = page.locator('.shaka-controls-button-panel > .autoplay-toggle')
  const autoplayTrack = autoplayToggle.locator('.ft-autoplay-switch')
  const rightPillOpacity = await page.locator('.shaka-controls-button-panel > .shaka-spacer ~ button:not(.shaka-hidden)').evaluateAll(buttons =>
    buttons.map(button => getComputedStyle(button).opacity)
  )
  expect(new Set(rightPillOpacity).size).toBe(1)
  expect(rightPillOpacity[0]).toBe(await group.evaluate(element => getComputedStyle(element).opacity))
  await expect(autoplayTrack).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const autoplayWasEnabled = await autoplayToggle.getAttribute('aria-pressed') === 'true'
  await autoplayToggle.click()
  await expect(autoplayToggle).toHaveAttribute('aria-pressed', String(!autoplayWasEnabled))
  await expect(autoplayTrack).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
  await expect.poll(async () => {
    const alignment = await measureRightGlassAlignment()
    return Math.max(Math.abs(alignment.start), Math.abs(alignment.end))
  }).toBeLessThan(1)
})

test('volume pill collapses after dragging its slider and leaving', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  const volumeGroup = page.locator('.ft-volume-control-group')
  await volumeGroup.locator('.shaka-mute-button').hover()
  const sliderBounds = await volumeGroup.locator('.shaka-volume-bar').boundingBox()
  await page.mouse.move(sliderBounds.x + sliderBounds.width * 0.25, sliderBounds.y + sliderBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(sliderBounds.x + sliderBounds.width * 0.75, sliderBounds.y + sliderBounds.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.locator('.shaka-controls-button-panel > .autoplay-toggle').hover()
  await expect.poll(() => volumeGroup.locator('.shaka-volume-bar-container').evaluate(element => element.getBoundingClientRect().width), { timeout: 3000 }).toBeLessThan(1)

  await volumeGroup.locator('.shaka-mute-button').hover()
  await expect.poll(() => volumeGroup.locator('.shaka-volume-bar-container').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(90)
  const expandedGroup = await volumeGroup.boundingBox()
  await page.mouse.move(sliderBounds.x + sliderBounds.width * 0.5, sliderBounds.y + sliderBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(expandedGroup.x + expandedGroup.width + 20, sliderBounds.y + sliderBounds.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => volumeGroup.locator('.shaka-volume-bar-container').evaluate(element => element.getBoundingClientRect().width), { timeout: 3000 }).toBeLessThan(1)

  await page.keyboard.press('Tab')
  await volumeGroup.locator('.shaka-volume-bar').focus()
  await expect.poll(() => volumeGroup.locator('.shaka-volume-bar').evaluate(element => element.matches(':focus-visible'))).toBe(true)
  await page.mouse.move(1, 1)
  await expect.poll(() => volumeGroup.locator('.shaka-volume-bar-container').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(90)
})
