import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { test, expect } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo, openCaptionLanguages, openPlayerOptions } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

// The path Shaka draws for its replay icon
const SHAKA_REPLAY_ICON = readFileSync(createRequire(import.meta.url).resolve('shaka-player/ui/enums.js'), 'utf8')
  .match(/'REPLAY': '([^']+)'/)[1]

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      showPlaybackRateAdjustedTimestamp: true
    }
  }
})

test('download options fit horizontally and its Cancel button retains a border', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.locator('.videoOptions').getByRole('button', { name: 'Download Video', exact: true }).click()
  const prompt = page.locator('.downloadPromptCard')
  await expect(prompt).toBeVisible()
  const advanced = prompt.locator('.advancedDownloadOptions')
  if (!await advanced.evaluate(element => element.open)) await advanced.locator('summary').click()
  const scroller = prompt.locator('.downloadOptions')
  expect.soft(await scroller.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const clipped = await scroller.evaluate(element => {
    const viewport = element.getBoundingClientRect()
    return Array.from(element.querySelectorAll('.switch-label, .ft-input, .inputIndicators, .select-text'))
      .map(control => ({ className: control.className, text: control.textContent.trim(), right: control.getBoundingClientRect().right - viewport.right }))
      .filter(control => control.right > 1)
  })
  expect.soft(clipped).toEqual([])
  const cancel = prompt.getByRole('button', { name: 'Cancel', exact: true })
  expect.soft(await cancel.evaluate(element => getComputedStyle(element).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)')
})

test('changing fonts remeasures paused controls and clipped menu labels without resizing', async ({ app, page }) => {
  // The threshold searches wait for well over a hundred frames at two zoom levels,
  // which takes 45-60 seconds on CI runners.
  test.slow()
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => {
    element.playbackRate = 2
    element.pause()
  })
  const player = page.locator('.ftVideoPlayer')
  const panel = player.locator('.shaka-controls-button-panel')
  const setFont = async font => {
    await page.evaluate(async value => {
      await window.$store.dispatch('updateAppFont', value)
      // Force styles to resolve before waiting for the selected bundled font.
      document.querySelector('.ftVideoPlayer').getBoundingClientRect()
      await document.fonts.ready
    }, font)
  }

  for (const scale of [1, 1.25]) {
    await app.electronApp.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), scale)
    // Resizing moves the controls under a resting pointer, and a hovered volume
    // group expands, which would make the thresholds depend on the pointer instead of the font.
    await page.mouse.move(1, 1)
    await player.evaluate(element => { element.style.width = '1600px' })
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
    const widths = []
    for (const font of ['Source Sans 3 Variable', 'Plus Jakarta Sans Variable']) {
      await setFont(font)
      // Locate each font's compact-layout threshold by resizing before the regression.
      let compactWidth = 300
      let fullWidth = 1200
      for (let step = 0; step < 10; step++) {
        const width = (compactWidth + fullWidth) / 2
        const compact = await player.evaluate(async (element, value) => {
          element.style.width = `${value}px`
          for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame)
          return element.querySelector('.shaka-controls-button-panel').classList.contains('ft-controls-compact-chapters')
        }, width)
        if (compact) compactWidth = width
        else fullWidth = width
      }
      widths.push({ font, width: fullWidth })
    }
    widths.sort((a, b) => a.width - b.width)
    const [narrow, wide] = widths
    expect(wide.width - narrow.width).toBeGreaterThan(2)
    await setFont(wide.font)
    await player.evaluate((element, width) => { element.style.width = `${width}px` }, (wide.width + narrow.width) / 2)
    await expect(panel).toHaveClass(/ft-controls-compact-chapters/)
    await setFont(narrow.font)
    await expect(panel).not.toHaveClass(/ft-controls-compact-chapters/)
    await setFont(wide.font)
    await expect(panel).toHaveClass(/ft-controls-compact-chapters/)

    await openPlayerOptions(player)
    const menuLabel = player.locator('.shaka-overflow-menu .shaka-playbackrate-button .shaka-overflow-button-label > span:not(.shaka-current-selection-span)').first()
    const labelText = (await menuLabel.textContent()).trim()
    const labelWidths = []
    for (const font of [narrow.font, wide.font]) {
      await setFont(font)
      labelWidths.push(await menuLabel.evaluate(element => {
        const style = getComputedStyle(element)
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        return context.measureText(element.textContent).width
      }))
    }
    expect(labelWidths[1] - labelWidths[0]).toBeGreaterThan(1)
    await menuLabel.evaluate((element, width) => {
      element.style.inlineSize = `${width}px`
      element.style.whiteSpace = 'nowrap'
      // Shaka's text mutations start the initial measurement.
      element.textContent = element.textContent.trim()
    }, (labelWidths[0] + labelWidths[1]) / 2)
    await expect(menuLabel).toHaveAttribute('title', labelText)
    await setFont(narrow.font)
    await expect(menuLabel).not.toHaveAttribute('title')
    await setFont(wide.font)
    await expect(menuLabel).toHaveAttribute('title', labelText)
    await panel.locator('.shaka-overflow-menu-button').click()
  }
})

test('portrait mobile controls keep captions and PiP in settings when the row is crowded', async ({ app, page }) => {
  await page.locator('.app').evaluate(element => {
    const applyMobileClasses = () => {
      if (!element.classList.contains('capacitorTabs')) element.classList.add('capacitorTabs')
      if (!element.classList.contains('capacitorPhoneLayout')) element.classList.add('capacitorPhoneLayout')
    }
    new MutationObserver(applyMobileClasses).observe(element, { attributeFilter: ['class'] })
    applyMobileClasses()
  })
  await page.evaluate(() => window.$store.dispatch('updateUseQuickPlaybackSpeedBar', true))
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const player = page.locator('.ftVideoPlayer')
  const panel = player.locator('.shaka-controls-button-panel')

  for (const scale of [1, 1.25]) {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale), scale)
    await player.evaluate(element => { element.style.width = '360px' })
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
    await expect(panel.locator('.caption-toggle-button')).toHaveCount(1)
    await expect(panel).toHaveClass(/ft-controls-overflow-captions/)
    await expect(panel.locator('.caption-toggle-button')).toBeHidden()
    await expect(panel.locator('.shaka-pip-button')).toBeHidden()
    await expect(panel.locator('.shaka-fullscreen-button')).toBeVisible()
    await expect.poll(() => panel.locator('.shaka-spacer').evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(1)
    await openPlayerOptions(player)
    const menu = player.locator('.shaka-overflow-menu')
    await expect(menu.getByRole('button', { name: 'Captions' })).toBeVisible()
    await expect(menu.locator('.shaka-pip-button')).toBeVisible()
    await openCaptionLanguages(player)
    await expect(player.locator('.shaka-text-languages')).toBeVisible()
    await expect(menu.locator('.shaka-pip-button')).toBeHidden()
    await player.locator('.shaka-text-languages .shaka-back-to-overflow-button').click()
    await panel.locator('.shaka-overflow-menu-button').click()

    const rateBar = panel.locator('.ft-quick-playback-rate-bar')
    const endOffset = await rateBar.evaluate(element => {
      element.scrollLeft = element.scrollWidth
      return element.scrollLeft
    })
    expect(endOffset).toBeGreaterThan(0)
    await player.evaluate(element => { element.style.width = '1600px' })
    await expect(panel).not.toHaveClass(/ft-controls-overflow-(pip|captions)/)
    await expect(panel.locator('.caption-toggle-button')).toBeVisible()
    await expect(panel.locator('.shaka-pip-button')).toBeVisible()
    // Wide layouts leave surplus space after the content-sized speed presets.
    await expect.poll(() => panel.locator('.shaka-spacer').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(0)
    await expect.poll(() => panel.evaluate(element => Math.abs(element.getBoundingClientRect().right - element.querySelector('.shaka-fullscreen-button').getBoundingClientRect().right))).toBeLessThan(1)
    await expect.poll(() => rateBar.evaluate(element => element.scrollLeft)).toBe(0)
    await expect.poll(() => rateBar.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
  }
})

for (const shorterSeekRange of [false, true]) {
  test(`paused video shows replay after seeking to the end with End${shorterSeekRange ? ' before the media duration' : ''}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    const watch = await page.evaluateHandle(findWatchComponent)
    const replayPath = SHAKA_REPLAY_ICON
    const playButton = page.locator('.ftVideoPlayer .shaka-controls-button-panel > .shaka-play-button')
    const replayIcon = playButton.locator(':scope > .shaka-ui-icon:not(.ft-play-pause-morph-icon)')
    const morphIcon = playButton.locator('.ft-play-pause-morph-icon')

    if (shorterSeekRange) {
      // Adaptive streams can have a seek range ending before the media duration.
      // Use Shaka's real range configuration to reproduce that state offline.
      await video.evaluate(element => element.ui.getControls().getPlayer().configure({ playRangeEnd: Math.floor(element.duration) - 0.25 }))
    }

    for (const frosted of [true, false]) {
      await watch.evaluate((component, value) => component.proxy.$store.dispatch('updateUseFrostedGlassPlayerUi', value), frosted)
      await video.evaluate(element => element.pause())
      await expect(video).toHaveJSProperty('paused', true)

      await page.keyboard.press('End')
      await expect.poll(() => video.evaluate(element => element.ui.getControls().getPlayer().isEnded())).toBe(true)
      await expect(video).toHaveJSProperty('ended', !shorterSeekRange)
      await expect(playButton).toHaveAccessibleName('Replay')
      await expect(playButton).toHaveAttribute('data-ft-play-pause-state', 'replay')
      await expect(replayIcon).toHaveCSS('opacity', '1')
      await expect(replayIcon.locator('path')).toHaveAttribute('d', replayPath)
      await expect(morphIcon).toHaveCSS('opacity', '0')

      await page.keyboard.press('Home')
      await expect(playButton).toHaveAttribute('data-ft-play-pause-state', 'play')
      await expect(replayIcon).toHaveCSS('opacity', '0')
      await expect(morphIcon).toHaveCSS('opacity', '1')

      await page.keyboard.press('End')
      await expect(playButton).toHaveAttribute('data-ft-play-pause-state', 'replay')
      await expect(replayIcon).toHaveCSS('opacity', '1')
      await expect(replayIcon.locator('path')).toHaveAttribute('d', replayPath)
      await playButton.click({ force: true })
      await expect(video).toHaveJSProperty('paused', false)
      await expect.poll(() => video.evaluate(element => element.currentTime)).toBeLessThan(5)
      await expect(playButton).toHaveAttribute('data-ft-play-pause-state', 'pause')
      await expect(replayIcon).toHaveCSS('opacity', '0')
      await expect(morphIcon).toHaveCSS('opacity', '1')
    }
    await watch.dispose()
  })
}

test('player controls share pill surfaces and the time display toggles together', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => {
    element.playbackRate = 2
    element.pause()
  })
  await expect(page.locator('.shaka-controls-button-panel > .shaka-play-button > .shaka-ui-icon:not(.ft-play-pause-morph-icon)')).toHaveCSS('opacity', '0')
  await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
  // Pill colors inherit the controls' animated fade, so compare them once it finishes.
  await expect.poll(() => page.locator('.shaka-controls-button-panel').evaluate(element => getComputedStyle(element).getPropertyValue('--ft-controls-fade').trim())).toBe('1')

  const group = page.locator('.ft-time-display-group')
  const regular = group.locator('.shaka-current-time:not(.ft-playback-adjusted-time)')
  const adjusted = group.locator('.ft-playback-adjusted-time')
  await expect(adjusted).toBeVisible()
  const regularType = await regular.evaluate(element => {
    const style = getComputedStyle(element)
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, numeric: style.fontVariantNumeric, rendering: style.textRendering }
  })
  const adjustedType = await adjusted.evaluate(element => {
    const style = getComputedStyle(element)
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, numeric: style.fontVariantNumeric, rendering: style.textRendering }
  })
  expect(adjustedType).toEqual(regularType)
  expect(regularType.numeric).toBe('lining-nums tabular-nums')
  expect(regularType.rendering).toBe('geometricprecision')
  await expect(group.locator('button')).toHaveCount(1)
  await expect(group.locator('.ft-control-glass')).toHaveCSS('backdrop-filter', /blur\(10px\)/)
  await expect(page.locator('.shaka-scrim-container')).toHaveCSS('background-image', 'none')

  const background = await group.evaluate(element => getComputedStyle(element).backgroundImage)
  const glassBackground = await group.locator('.ft-control-glass').evaluate(element => getComputedStyle(element).backgroundImage)
  expect(background).toBe('none')
  expect(glassBackground).not.toBe('none')
  await adjusted.hover()
  await expect.poll(() => group.locator('.ft-control-glass').evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe(glassBackground)
  const hoveredPillColor = await group.evaluate(element => getComputedStyle(element).getPropertyValue('--ft-control-pill-color').trim())
  const rightPillColorOnHover = await page.locator('.shaka-controls-button-panel > .autoplay-toggle').evaluate(element => getComputedStyle(element).getPropertyValue('--ft-control-pill-color').trim())
  expect(hoveredPillColor).toBe(rightPillColorOnHover)

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
  await expect.poll(() => group.locator('.ft-control-glass').evaluate(element => getComputedStyle(element).backgroundImage), { timeout: 3000 }).toBe(glassBackground)
  await page.keyboard.press('Tab')
  await regular.focus()
  await expect.poll(() => regular.evaluate(element => element.matches(':focus-visible'))).toBe(true)
  await expect.poll(() => group.locator('.ft-control-glass').evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe(glassBackground)
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
  const volumeGlyphOffset = await volumeGroup.evaluate(element => {
    const svg = element.querySelector('.shaka-mute-button > .shaka-ui-icon')
    const pill = element.getBoundingClientRect()
    const icon = svg.getBoundingClientRect()
    const glyph = svg.getBBox()
    const viewBox = svg.viewBox.baseVal
    return icon.left + (glyph.x + glyph.width / 2 - viewBox.x) * icon.width / viewBox.width - pill.left - 24
  })
  expect(Math.abs(volumeGlyphOffset)).toBeLessThan(1)
  await page.locator('.shaka-mute-button').hover()
  await expect(volumeGroup.locator('.shaka-volume-bar-container')).toBeVisible()
  const expandedIconOffset = await volumeGroup.evaluate(element => {
    const group = element.getBoundingClientRect()
    const icon = element.querySelector('.shaka-mute-button > .shaka-ui-icon').getBoundingClientRect()
    return (icon.left + icon.right) / 2 - group.left - 24
  })
  expect(Math.abs(expandedIconOffset)).toBeLessThan(1)
  await expect.poll(() => volumeGroup.locator('.ft-control-glass').evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe('none')
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
  await expect(page.locator('.autoplay-toggle > .ft-control-glass')).toHaveCSS('border-radius', '17px')
  await expect(page.locator('.autoplay-toggle > .ft-control-glass')).toHaveCSS('height', '34px')
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
  await expect(page.locator('.shaka-overflow-menu-button > .ft-control-glass')).toHaveCSS('border-radius', '17px')
  await expect(page.locator('.shaka-fullscreen-button > .ft-control-glass')).toHaveCSS('height', '34px')
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

test('hiding a shorter stacked timestamp restores the full layout', { tag: '@scale' }, async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => {
    element.pause()
    element.playbackRate = 10
  })
  const panel = page.locator('.shaka-controls-button-panel')
  await panel.evaluate(element => {
    // Model a long video whose regular timestamp is wider than its
    // speed-adjusted timestamp, without depending on the fixture duration.
    const regular = element.querySelector('.shaka-current-time:not(.ft-playback-adjusted-time)')
    const adjusted = element.querySelector('.ft-playback-adjusted-time')
    regular.style.inlineSize = '240px'
    adjusted.style.inlineSize = '120px'
  })

  const setWidth = width => panel.evaluate(async (element, width) => {
    element.style.width = `${width}px`
    // Let resize observation and the scheduled layout finish even under load.
    for (let frame = 0; frame < 3; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    return element.classList.contains('ft-controls-stack-times')
  }, width)
  let compactWidth = 100
  let fullWidth = 2000
  for (let index = 0; index < 12; index++) {
    const width = (compactWidth + fullWidth) / 2
    if (await setWidth(width)) compactWidth = width
    else fullWidth = width
  }
  // Avoid landing on the fractional-pixel boundary found by the search.
  await setWidth(compactWidth - 4)
  await expect(panel).toHaveClass(/ft-controls-stack-times/)
  await page.evaluate(() => window.$store.dispatch('updateShowPlaybackRateAdjustedTimestamp', false))
  await expect(panel.locator('.ft-playback-adjusted-time')).toHaveClass(/shaka-hidden/)
  await expect(panel).not.toHaveClass(/ft-controls-stack-times/)
})

test('volume pill collapses after dragging its slider and leaving', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))

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

test('wrapped volume button keeps its tooltip on hover and keyboard focus', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))

  const mute = page.locator('.ft-volume-control-group > .shaka-mute-button')
  await expect(page.locator('.shaka-controls-button-panel')).toHaveClass(/shaka-tooltips-on/)
  const expectTooltip = async () => {
    const readTooltip = () => mute.evaluate(element => {
      const style = getComputedStyle(element, '::after')
      return {
        label: element.getAttribute('aria-label'),
        content: style.content,
        position: style.position,
        background: style.backgroundColor
      }
    })
    await expect.poll(async () => (await readTooltip()).content).toContain(await mute.getAttribute('aria-label'))
    const tooltip = await readTooltip()
    expect(tooltip.content).toContain(tooltip.label)
    expect(tooltip.position).toBe('absolute')
    expect(tooltip.background).not.toBe('rgba(0, 0, 0, 0)')
  }

  await mute.hover()
  await expectTooltip()
  await page.mouse.move(1, 1)
  await expect.poll(() => mute.evaluate(element => element.matches(':hover'))).toBe(false)
  await page.keyboard.press('Tab')
  await mute.focus()
  await expect.poll(() => mute.evaluate(element => element.matches(':focus-visible'))).toBe(true)
  await expectTooltip()
})
