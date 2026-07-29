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

test('Shorts top controls stay visible over white video content', async ({ page }) => {
  await goTo(page, 'history')
  await page.addStyleTag({
    path: path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    )
  })
  await page.evaluate(() => {
    const player = document.createElement('div')
    const control = document.createElement('button')
    const volume = document.createElement('div')
    const volumeButton = document.createElement('button')
    const volumeSlider = document.createElement('input')

    player.className = 'ftVideoPlayer shortsPlayer'
    player.style.backgroundColor = '#fff'
    player.style.inset = '300px auto auto 300px'
    player.style.padding = '16px'
    player.style.position = 'fixed'
    player.style.zIndex = '10000'
    control.className = 'shortsTopControl'
    control.textContent = '⋮'
    volume.className = 'shortsVolumeControl'
    volumeButton.className = 'shortsTopControl'
    volumeButton.textContent = '🔊'
    volumeSlider.className = 'shortsVolumeSlider'
    volumeSlider.type = 'range'
    volume.append(volumeButton, volumeSlider)
    player.append(control, volume)
    document.body.append(player)
  })

  const control = page.locator('.shortsTopControl').first()
  await expect(control).toHaveCSS('backdrop-filter', /blur\(8px\)/)
  await control.evaluate(element => element.classList.add('active'))
  await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.68)')

  const volume = page.locator('.shortsVolumeControl')
  const volumeButton = volume.locator('.shortsTopControl')
  const volumeSlider = volume.locator('.shortsVolumeSlider')
  await expect(volumeSlider).toHaveCSS('inline-size', '0px')
  await expect(volumeSlider).toHaveCSS('opacity', '0')
  await volumeButton.focus()
  await expect(volume).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.58)')
  await expect(volumeButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(volumeButton).toHaveCSS('backdrop-filter', 'none')
  await expect(volumeSlider).toHaveCSS('inline-size', '96px')
  await expect(volumeSlider).toHaveCSS('opacity', '1')
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
  })

  test('centers the autosized Delete Old History dialog in the viewport', async ({ page }) => {
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
