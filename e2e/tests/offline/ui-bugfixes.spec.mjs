import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, repoRoot } from '../../helpers/app.mjs'

function historyEntry(videoId, title, timeWatched) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    published: Date.now() - 86_400_000,
    description: 'Test description',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 10,
    isWatched: false,
    timeWatched,
    isLive: false,
    type: 'video'
  }
}

test('update banners have equal top and bottom spacing', async ({ page }) => {
  await page.evaluate(() => {
    const routerView = document.querySelector('.routerView')
    const banner = document.createElement('div')
    banner.className = 'banner'
    banner.textContent = 'Update available'
    for (const attribute of routerView.attributes) {
      if (attribute.name.startsWith('data-v-')) {
        banner.setAttribute(attribute.name, '')
      }
    }
    routerView.prepend(banner)
  })

  const banner = page.locator('.banner', { hasText: 'Update available' })
  await expect(banner).toHaveCSS('margin-top', '40px')
  await expect(banner).toHaveCSS('margin-bottom', '40px')
})

test('collapsed description paints the More control above its text', async ({ page }) => {
  await page.addStyleTag({
    path: path.join(
      repoRoot,
      'src/renderer/components/WatchVideoDescription/WatchVideoDescription.css'
    )
  })
  await page.evaluate(() => {
    const card = document.createElement('div')
    const more = document.createElement('span')
    const scroll = document.createElement('div')
    const description = document.createElement('div')

    card.className = 'videoDescription short'
    card.style.backgroundColor = 'var(--card-bg-color)'
    card.style.inset = '300px auto auto 300px'
    card.style.padding = '16px'
    card.style.position = 'fixed'
    card.style.width = '300px'
    card.style.zIndex = '10000'
    more.className = 'descriptionStatus'
    more.textContent = 'More'
    scroll.className = 'descriptionScroll'
    description.className = 'description'
    description.textContent = Array.from(
      { length: 20 },
      (_, index) => `Long description segment ${index + 1}`
    ).join(' ')

    scroll.append(description)
    card.append(more, scroll)
    document.body.append(card)
  })

  const description = page.locator('.videoDescription.short').first()
  const more = description.locator('.descriptionStatus')
  await expect(more).toBeVisible()
  await expect.poll(async () => more.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2
    ) === element
  })).toBe(true)
})

test('full-window player shows the title overlay', async ({ page }) => {
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  await page.addStyleTag({
    content: playerStyles.replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })
  await page.evaluate(() => {
    const player = document.createElement('div')
    const title = document.createElement('h1')
    player.className = 'ftVideoPlayer'
    title.className = 'playerFullscreenTitleOverlay'
    title.textContent = 'Test video title'
    player.append(title)
    document.body.append(player)
  })

  const player = page.locator('.ftVideoPlayer')
  const title = player.locator('.playerFullscreenTitleOverlay')
  await expect(title).toHaveCSS('display', 'none')
  await player.evaluate(element => element.classList.add('fullWindow'))
  await expect(title).toHaveCSS('display', 'block')
})

test('paid promotion badge follows the full-window title visibility', async ({ page }) => {
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  await page.addStyleTag({
    content: playerStyles.replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })
  await page.evaluate(() => {
    const player = document.createElement('div')
    const badge = document.createElement('button')
    const controls = document.createElement('div')
    player.className = 'ftVideoPlayer fullWindow'
    badge.className = 'paidPromotionOverlay'
    controls.className = 'shaka-controls-container'
    controls.setAttribute('shown', 'true')
    player.append(badge, controls)
    document.body.append(player)
  })

  const player = page.locator('.ftVideoPlayer')
  const badge = player.locator('.paidPromotionOverlay')
  const controls = player.locator('.shaka-controls-container')
  await expect(badge).toHaveCSS('top', '65px')
  await expect(badge).toHaveCSS('transition-delay', '0s, 0s')
  const [playerBounds, visibleTitleBadgeBounds] = await Promise.all([
    player.boundingBox(),
    badge.boundingBox(),
  ])
  expect(playerBounds).not.toBeNull()
  expect(visibleTitleBadgeBounds).not.toBeNull()
  expect(visibleTitleBadgeBounds.y - playerBounds.y).toBeCloseTo(65, 0)

  await controls.evaluate(element => element.setAttribute('shown', 'false'))
  await expect(badge).toHaveCSS('transition-delay', '0s, 0.45s')
  await page.waitForTimeout(300)
  const fadingTitleBadgeBounds = await badge.boundingBox()
  expect(fadingTitleBadgeBounds.y).toBeCloseTo(visibleTitleBadgeBounds.y, 0)
  await expect.poll(async () => {
    const bounds = await badge.boundingBox()
    return bounds ? bounds.y - playerBounds.y : null
  }).toBeCloseTo(12, 0)

  await player.evaluate((element) => {
    element.classList.remove('fullWindow')
    element.classList.add('presentationModeChanging')
  })
  await controls.evaluate(element => element.setAttribute('shown', 'true'))
  await player.evaluate(element => element.classList.add('fullWindow'))
  await expect(badge).toHaveCSS('top', '65px')
  await expect(badge).toHaveCSS('transition-property', 'opacity')
})

test('Shorts top controls stay visible over white video content', async ({ page }) => {
  await goTo(page, 'history')
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  const captionsButtonSource = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/player-components/CaptionToggleButton.js'
    ),
    'utf8'
  )
  const outlinedCaptionsIcon = captionsButtonSource.match(
    /export const CLOSED_CAPTIONS_OUTLINED = '([^']+)'/
  )?.[1]
  expect(outlinedCaptionsIcon?.length).toBeGreaterThan(100)
  await page.addStyleTag({
    content: playerStyles.replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })
  await page.evaluate((captionsIconPath) => {
    const player = document.createElement('div')
    const topControls = document.createElement('div')
    const group = document.createElement('div')
    const control = document.createElement('button')
    const volume = document.createElement('div')
    const volumeButton = document.createElement('button')
    const volumeSlider = document.createElement('input')
    const captions = document.createElement('button')
    const captionsIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const captionsPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const captionsSlash = document.createElement('span')
    const shakaControls = document.createElement('div')
    const seekBar = document.createElement('div')
    const seekInput = document.createElement('input')

    player.className = 'ftVideoPlayer shortsPlayer shortsPaused'
    player.style.backgroundColor = '#fff'
    player.style.borderRadius = '16px'
    player.style.inset = '300px auto auto 300px'
    player.style.position = 'fixed'
    player.style.width = '360px'
    player.style.height = '640px'
    player.style.zIndex = '10000'
    player.style.setProperty('--ui-roundness', '1')
    topControls.className = 'shortsTopControls'
    group.className = 'shortsTopControlsGroup'
    control.className = 'shortsTopControl'
    control.textContent = '⋮'
    volume.className = 'shortsVolumeControl'
    volumeButton.className = 'shortsTopControl'
    volumeButton.textContent = '🔊'
    volumeSlider.className = 'shortsVolumeSlider'
    volumeSlider.type = 'range'
    captions.className = 'shortsTopControl shortsCaptionsControl'
    captionsIcon.classList.add('shortsCaptionsControlIcon')
    captionsPath.setAttribute('d', captionsIconPath)
    captionsSlash.className = 'shortsCaptionsControlSlash'
    captionsIcon.append(captionsPath)
    captions.append(captionsIcon, captionsSlash)
    volume.append(volumeButton, volumeSlider)
    group.append(control, volume, captions)
    topControls.append(group)
    shakaControls.className = 'shaka-controls-container'
    seekBar.className = 'shaka-seek-bar-container'
    seekInput.className = 'shaka-range-element'
    seekInput.type = 'range'
    seekBar.append(seekInput)
    shakaControls.append(seekBar)
    player.append(topControls, shakaControls)
    document.body.append(player)
  }, outlinedCaptionsIcon)

  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  const topControls = player.locator('.shortsTopControls')
  const control = page.locator('.shortsTopControl').first()
  await expect(topControls).toHaveCSS('opacity', '1')
  await expect(topControls).toHaveCSS('border-top-left-radius', '16px')
  await expect(topControls).toHaveCSS('border-top-right-radius', '16px')
  await expect(topControls).toHaveCSS('transition-duration', '0.15s')
  await expect(control).toHaveCSS('backdrop-filter', /blur\(8px\)/)
  await control.evaluate(element => element.classList.add('active'))
  await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.52)')

  const volume = page.locator('.shortsVolumeControl')
  const volumeButton = volume.locator('.shortsTopControl')
  const volumeSlider = volume.locator('.shortsVolumeSlider')
  await expect(volumeSlider).toHaveCSS('inline-size', '0px')
  await expect(volumeSlider).toHaveCSS('opacity', '0')
  await volumeButton.focus()
  await expect(volume).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.44)')
  await expect(volumeButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(volumeButton).toHaveCSS('backdrop-filter', 'none')
  await expect(volumeSlider).toHaveCSS('inline-size', '96px')
  await expect(volumeSlider).toHaveCSS('opacity', '1')

  const captions = player.locator('.shortsCaptionsControl')
  expect((await captions.locator('path').getAttribute('d')).length).toBeGreaterThan(100)
  await expect(captions.locator('.shortsCaptionsControlIcon')).toHaveCSS('width', '28px')
  await expect(captions.locator('.shortsCaptionsControlIcon')).toHaveCSS('height', '28px')
  await expect(captions.locator('.shortsCaptionsControlSlash')).toHaveCSS(
    'transform',
    /matrix\([^)]*0\.707107/
  )
  await captions.evaluate(element => element.classList.add('active'))
  await expect(captions.locator('.shortsCaptionsControlSlash')).toHaveCSS(
    'transform',
    /matrix\(0, 0, -0\.707107, 0\.707107/
  )

  const seekBar = player.locator('.shaka-seek-bar-container')
  await expect(seekBar).toHaveCSS('height', '3px')
  await expect(seekBar).toHaveCSS('bottom', '-2px')
  await expect(seekBar).toHaveCSS('left', '12px')
  await expect(seekBar).toHaveCSS('right', '12px')
  await expect(seekBar).toHaveCSS('opacity', '1')
  const seekThumbRules = await page.evaluate(() => {
    return [...document.styleSheets]
      .flatMap(styleSheet => [...styleSheet.cssRules])
      .filter(rule => rule.selectorText?.includes(
        '.shaka-range-element::-webkit-slider-thumb'
      ))
      .map(rule => ({
        selector: rule.selectorText,
        opacity: rule.style.opacity,
        transform: rule.style.transform,
        transition: rule.style.transition,
      }))
  })
  expect(seekThumbRules).toEqual(expect.arrayContaining([
    expect.objectContaining({
      opacity: '0',
      transform: 'scale(0)',
      transition: expect.stringContaining('120ms'),
    }),
    expect.objectContaining({ opacity: '1', transform: 'scale(1)' }),
  ]))
  const [playerBounds, seekBounds] = await Promise.all([
    player.boundingBox(),
    seekBar.boundingBox(),
  ])
  expect(seekBounds.y + seekBounds.height).toBeGreaterThan(playerBounds.y + playerBounds.height)

  await player.evaluate(element => element.classList.remove('shortsPaused'))
  await expect(topControls).toHaveCSS('opacity', '0')
  await expect(topControls).toHaveCSS('transition-duration', '0.6s, 0s')

  await player.evaluate(element => {
    const actionDock = document.createElement('div')
    actionDock.className = 'fullscreenActions'
    element.classList.add('fullWindow')
    element.append(actionDock)
  })
  const actionDock = player.locator('.fullscreenActions')
  await expect(actionDock).toHaveCSS('display', 'flex')
  await expect(actionDock).toHaveCSS('opacity', '1')
  await expect(actionDock).toHaveCSS('pointer-events', 'auto')
})

test('compact chapters button marks its open state', async ({ page }) => {
  await goTo(page, 'history')
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  // The component scopes these rules with :deep(), which the browser cannot parse on its own
  await page.addStyleTag({
    content: playerStyles.replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })
  await page.evaluate(() => {
    const panel = document.createElement('div')
    const button = document.createElement('button')
    const icon = document.createElement('span')

    panel.className = 'shaka-controls-button-panel ft-controls-compact-chapters'
    panel.style.inset = '300px auto auto 300px'
    panel.style.position = 'fixed'
    panel.style.zIndex = '10000'
    button.className = 'ft-chapters-button'
    icon.className = 'ft-chapters-icon'
    button.append(icon)
    panel.append(button)
    document.body.append(panel)
  })

  const button = page.locator('.ft-controls-compact-chapters > .ft-chapters-button')
  const highlightColor = () => button.evaluate((element) => {
    return getComputedStyle(element, '::before').backgroundColor
  })

  await expect(button).toBeVisible()
  await expect.poll(highlightColor).toBe('rgba(0, 0, 0, 0)')
  await button.evaluate(element => element.classList.add('open'))
  await expect.poll(highlightColor).toBe('rgba(255, 255, 255, 0.2)')
})

test.describe('autosized prompts', () => {
  test.use({
    seed: {
      history: [historyEntry('aaaaaaaaaaa', 'History entry', Date.now())]
    }
  })

  test('centers the Delete Old History dialog in the viewport', async ({ page }) => {
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Delete Old History' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Math.abs(bounds.left + bounds.width / 2 - window.innerWidth / 2)
    })).toBeLessThanOrEqual(1)
    await expect.poll(() => dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2)
    })).toBeLessThanOrEqual(1)
  })
})

test.describe('thumbnail watched progress', () => {
  test.use({
    seed: {
      settings: { uiRoundness: 200 },
      history: [historyEntry('aaaaaaaaaaa', 'Partially watched video', Date.now())]
    }
  })

  test('matches the configured thumbnail corner radius', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-item').filter({ hasText: 'Partially watched video' })
    const thumbnail = video.locator('.thumbnailLink')
    const progress = video.locator('.watchedProgressBar')

    await expect(thumbnail).toHaveCSS('border-radius', '16px')
    await expect(progress).toBeVisible()
    const progressPath = progress.locator('.embeddedProgressPath')
    const progressGeometry = await progressPath.evaluate(element => {
      const line = getComputedStyle(element)
      return {
        path: element.getAttribute('d'),
        pathLength: element.getTotalLength(),
        strokeDasharray: element.style.strokeDasharray,
        strokeLinecap: line.strokeLinecap,
        strokeWidth: line.strokeWidth,
      }
    })
    expect(progressGeometry).toMatchObject({
      strokeLinecap: 'round',
      strokeWidth: '3px',
    })
    expect(progressGeometry.path).toContain('A 14.5 14.5')
    const [visibleLength, gapLength] = progressGeometry.strokeDasharray
      .split(' ')
      .map(Number.parseFloat)
    expect(visibleLength / (gapLength / 2)).toBeCloseTo(0.167, 2)

    const thumbnailBounds = await thumbnail.boundingBox()
    const progressBounds = await progress.boundingBox()
    expect(Math.abs(progressBounds.y - thumbnailBounds.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(progressBounds.height - thumbnailBounds.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(progressBounds.width - thumbnailBounds.width)).toBeLessThanOrEqual(1)
    expect(progressGeometry.pathLength).toBeGreaterThan(thumbnailBounds.width - 20)

    const leftToRightPath = progressGeometry.path
    await page.evaluate(() => {
      document.body.dir = 'rtl'
    })
    await expect.poll(() => progressPath.getAttribute('d')).not.toBe(leftToRightPath)
  })
})

test.describe('toast timeout progress', () => {
  test.use({
    seed: {
      settings: {
        uiRoundness: 200,
        showToastTimeoutIndicator: true,
      }
    }
  })

  test('makes high-roundness timeout caps visible without scaling them', async ({ page }) => {
    await goTo(page, 'history')
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Rounded timeout progress', 10000)
    })

    const toast = page.locator('.toast', { hasText: 'Rounded timeout progress' })
    const track = toast.locator('..').locator('.timeout-indicator-track')
    const indicator = track.locator('.timeout-indicator')
    await expect(toast).toBeVisible()
    await toast.hover()
    await expect(track).toHaveCSS('border-radius', '24px')
    await expect(indicator).toHaveCSS('transform', 'none')
    const indicatorPath = indicator.locator('.embeddedProgressPath')
    const initialGeometry = await indicatorPath.evaluate(element => {
      const line = getComputedStyle(element)
      return {
        path: element.getAttribute('d'),
        strokeLinecap: line.strokeLinecap,
        strokeWidth: line.strokeWidth,
      }
    })
    expect(initialGeometry).toMatchObject({
      strokeLinecap: 'round',
      strokeWidth: '4px',
    })
    const [fullLength, gapLength] = await indicatorPath.evaluate(element => {
      return element.style.strokeDasharray.split(' ').map(Number.parseFloat)
    })
    expect(gapLength).toBeGreaterThan(fullLength)
    const arcRadius = Number.parseFloat(initialGeometry.path.match(/ A ([\d.]+)/)[1])
    expect(arcRadius).toBeGreaterThan(15)
    await page.waitForTimeout(100)
    expect(await indicatorPath.getAttribute('d')).toBe(initialGeometry.path)

    const [toastBounds, trackBounds, indicatorBounds] = await Promise.all([
      toast.boundingBox(),
      track.boundingBox(),
      indicator.boundingBox(),
    ])
    expect(Math.abs(trackBounds.x - toastBounds.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(trackBounds.y - toastBounds.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(trackBounds.width - toastBounds.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(trackBounds.height - toastBounds.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(indicatorBounds.y - toastBounds.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(indicatorBounds.height - toastBounds.height)).toBeLessThanOrEqual(1)
  })

  test('stays wrapped around both corners until the toast has animated in', async ({ page }) => {
    await goTo(page, 'history')
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Held timeout progress', 6000)
    })

    // Scoped to this toast's own slot: any other toast on screen would bring its
    // own indicator, and picking the first one would sample the wrong duration
    const indicatorPath = page.locator('.toast', { hasText: 'Held timeout progress' })
      .locator('..')
      .locator('.timeout-indicator .embeddedProgressPath')
    await indicatorPath.waitFor()

    // Pausing removes the wall clock from the picture, so the sampled lengths
    // below depend only on the delay/duration the stylesheet asks for
    const timing = await indicatorPath.evaluate(element => {
      const animation = element.getAnimations()
        .find(candidate => candidate.animationName?.startsWith('toast-timeout'))
      animation.pause()
      window.__toastTimeout = animation
      return animation.effect.getComputedTiming()
    })
    // The drain has to wait out the enter transition, then use up the rest of
    // the toast's lifetime so it empties exactly as the toast is dismissed
    expect(timing.delay).toBe(300)
    expect(timing.duration).toBe(5700)

    /** @returns {Promise<{ full: number, visible: number, offset: number }>} */
    const sampleAt = time => indicatorPath.evaluate(async (element, time) => {
      window.__toastTimeout.currentTime = time
      await window.__toastTimeout.ready
      const style = getComputedStyle(element)
      return {
        full: Number.parseFloat(element.style.strokeDasharray),
        visible: Number.parseFloat(style.strokeDasharray),
        offset: Number.parseFloat(style.strokeDashoffset),
      }
    }, time)

    // Both bottom corner arcs are only a few percent of the path, so any drain
    // during the enter transition already eats the trailing one
    for (const time of [0, 150, 299]) {
      const held = await sampleAt(time)
      expect(held.visible, `held at ${time}ms`).toBeCloseTo(held.full, 3)
      expect(held.offset, `held at ${time}ms`).toBe(0)
    }

    const midway = await sampleAt(300 + 5700 / 2)
    expect(midway.visible).toBeCloseTo(midway.full / 2, 1)

    const finished = await sampleAt(6000)
    expect(finished.visible).toBeCloseTo(0, 3)
  })
})

test.describe('history reorder animation', () => {
  test.use({
    seed: {
      history: [
        historyEntry('aaaaaaaaaaa', 'Alpha video', Date.now() - 1000),
        historyEntry('bbbbbbbbbbb', 'Bravo video', Date.now() - 2000),
        historyEntry('ccccccccccc', 'Charlie video', Date.now() - 3000)
      ]
    }
  })

  // A reorder must move the existing DOM nodes, which is what lets the
  // TransitionGroup run its FLIP move animation. Index-derived keys made Vue
  // destroy and recreate the elements instead, which is the choppy "jump".
  test('reuses the same DOM nodes when entries are reordered', async ({ page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Alpha video')).toBeVisible()

    // Tag every rendered item so we can tell reuse from recreation.
    const tagged = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.autoGrid > *'))
      items.forEach((element, index) => {
        element.dataset.ftReorderProbe = String(index)
      })
      return items.length
    })
    expect(tagged).toBe(3)

    // Reorder the list, the same path a re-watched entry moving to the top takes.
    await page.locator('.sortSelect select').selectOption('earliest_played_first')

    const items = page.locator('.autoGrid > *')
    await expect(items.first()).toContainText('Charlie video')

    // Every element still carries its probe, i.e. nothing was recreated.
    const probes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.autoGrid > *'))
        .map((element) => element.dataset.ftReorderProbe ?? null)
    )
    expect(probes).toHaveLength(3)
    expect(probes).not.toContain(null)
  })
})

test.describe('select dropdown pixel grid', () => {
  // A fractional device pixel ratio is what makes the misalignment visible.
  test.use({
    launchArgs: ['--force-device-scale-factor=1.5'],
    seed: { settings: { uiScale: 95 } }
  })

  test('keeps option text in place when it gains a hover background', async ({ page }) => {
    await goTo(page, 'settings')

    await page.getByRole('combobox', { name: 'Default Landing Page' }).first().click()
    const dropdown = page.locator('.selectDropdown')
    await expect(dropdown).toBeVisible()
    // Scaling a menu rasterizes its labels at changing subpixel positions.
    // Keep the open/close animation opacity-only so text stays stable.
    await expect(dropdown).toHaveCSS('transform', 'none')

    const dpr = await page.evaluate(() => window.devicePixelRatio)
    expect(Math.abs(dpr - 1.425)).toBeLessThan(0.001)

    const options = dropdown.locator('.selectOption')
    const inactiveOptionIndex = await options.evaluateAll(optionElements => {
      const menuBounds = optionElements[0].parentElement.getBoundingClientRect()
      return optionElements.findIndex(option => {
        const bounds = option.getBoundingClientRect()
        return !option.classList.contains('active') &&
          bounds.top >= menuBounds.top && bounds.bottom <= menuBounds.bottom
      })
    })
    expect(inactiveOptionIndex).toBeGreaterThanOrEqual(0)
    const option = options.nth(inactiveOptionIndex)
    // The option label is a direct text node, so measure its rendered range.
    const textPosition = () => option.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const bounds = range.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y }
    })
    const beforeHover = await textPosition()

    await option.hover()
    await expect(option).toHaveClass(/active/)
    expect(await textPosition()).toEqual(beforeHover)

    const selectedOption = dropdown.locator('.selectOption[aria-selected="true"]')
    await selectedOption.hover()
    await expect(selectedOption).toHaveClass(/active/)
    const indicatorAppearance = await selectedOption.evaluate(element => {
      const hoverLayer = getComputedStyle(element, '::before')
      const selectedIndicator = getComputedStyle(element, '::after')
      return {
        hoverLayerZIndex: hoverLayer.zIndex,
        indicatorColor: selectedIndicator.backgroundColor,
        indicatorWidth: Number.parseFloat(selectedIndicator.width),
        indicatorZIndex: selectedIndicator.zIndex
      }
    })
    expect(indicatorAppearance).toMatchObject({
      hoverLayerZIndex: '-1',
      indicatorColor: 'rgb(33, 150, 243)',
      indicatorZIndex: '1'
    })
    expect(indicatorAppearance.indicatorWidth).toBeCloseTo(3, 1)

    // At arbitrary UI scales, fixed-height options cannot all start on device
    // pixels. Their stable paint layer must therefore prevent the hover
    // background itself from changing text rasterization.
  })
})

test('a save channel setting dropdown clears the fullscreen dock content', async ({ page }) => {
  await goTo(page, 'history')
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  // The dropdown's own placement lives in FtIconButton's stylesheet, and it is
  // what puts the fly-out over the dock edge in the first place.
  const { compile } = await import('sass')
  const buttonStyles = compile(
    path.join(repoRoot, 'src/renderer/components/FtIconButton/FtIconButton.scss')
  ).css
  await page.addStyleTag({
    content: [playerStyles, buttonStyles]
      .join('\n')
      .replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })

  // The dock stacks the video info card and the description as siblings and
  // clips whatever leaves its box. The button the dropdown hangs off sits at
  // the dock's start edge, and the dropdown drops over the description below.
  await page.evaluate(() => {
    const dock = document.createElement('div')
    const info = document.createElement('div')
    const buttons = document.createElement('div')
    const options = document.createElement('div')
    const iconButton = document.createElement('div')
    const dropdown = document.createElement('div')
    const description = document.createElement('div')

    dock.className = 'fullscreenMetadataTarget'
    dock.style.cssText = 'position:fixed;inset:100px auto auto 400px;width:420px;height:420px;z-index:10000;background:#222'
    info.className = 'watchVideo watchVideoInfo'
    buttons.className = 'videoButtons'
    options.className = 'videoOptions'
    iconButton.className = 'iconButton'
    iconButton.style.cssText = 'position:relative;inline-size:30px;block-size:30px'
    dropdown.className = 'iconDropdown left bottom'
    dropdown.textContent = 'Save video quality'
    dropdown.style.inlineSize = '220px'
    dropdown.style.blockSize = '120px'
    description.className = 'watchVideo videoDescription'
    description.textContent = 'Description text that follows the info card'
    description.style.cssText = 'block-size:200px;background:#111'

    iconButton.append(dropdown)
    options.append(iconButton)
    buttons.append(options)
    info.append(buttons)
    dock.append(info, description)
    document.body.append(dock)
  })

  const dropdown = page.locator('.fullscreenMetadataTarget .iconDropdown')
  await expect(dropdown).toBeVisible()

  await expect.poll(() => dropdown.evaluate((element) => {
    const dock = element.closest('.fullscreenMetadataTarget')
    const bounds = element.getBoundingClientRect()
    const dockBounds = dock.getBoundingClientRect()
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.bottom - 8
    )
    return {
      // Not cut off by the dock, which clips its inline axis
      insideDock: bounds.left >= dockBounds.left && bounds.right <= dockBounds.right,
      // Not painted over by the description card that follows
      onTop: hit === element || element.contains(hit)
    }
  })).toEqual({ insideDock: true, onTop: true })
})
