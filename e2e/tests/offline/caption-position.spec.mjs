import { goTo, setPlayerFullscreen, test, expect } from '../../helpers/app.mjs'
import { openCaptionStyleMenu, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      enableSubtitlesByDefault: true,
    }
  }
})

test('applies UI roundness to the player and caption backgrounds', async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:start position:0%' })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())

  const player = page.locator('.ftVideoPlayer')
  const caption = player.locator('.shaka-text-container [translate="no"]')
  await expect(caption).toBeVisible()

  for (const roundness of [0, 100, 200]) {
    await page.evaluate(value => {
      const store = window.$store
      return store.dispatch('updateUiRoundness', value)
    }, roundness)
    await expect(player).toHaveCSS('border-radius', `${12 * roundness / 100}px`)
    await expect(caption).toHaveCSS('border-radius', `${4 * roundness / 100}px`)
  }
  await attachScreenshot('player and captions at 200% roundness')

  await setPlayerFullscreen(page, true)
  await expect(player).toHaveCSS('border-radius', '0px')
  await expect(caption).toHaveCSS('border-radius', '8px')
  await setPlayerFullscreen(page, false)
  await expect(player).toHaveCSS('border-radius', '24px')

  await page.locator('body').press('s')
  await expect(player).toHaveClass(/fullWindow/)
  await expect(player).toHaveCSS('border-radius', '0px')
  await expect(caption).toHaveCSS('border-radius', '8px')
  await page.locator('body').press('s')
  await expect(player).not.toHaveClass(/fullWindow/)
  await expect(player).toHaveCSS('border-radius', '24px')
})

test('rounds word-timed caption lines instead of each word', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page, {
    captionText: '<c>Every</c><c> word</c><c> has</c><c> a</c><c> span,</c>\n<c>but</c><c> lines</c><c> share</c><c> one</c>'
  })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await page.evaluate(() => window.$store.dispatch('updateUiRoundness', 200))

  const line = page.locator('.ftVideoPlayer .shaka-text-container .shaka-text-wrapper')
  const words = line.locator('[translate="no"]')
  await expect(words).toHaveCount(9)
  await expect(line).toHaveCSS('border-radius', '8px')
  await expect(line).toHaveCSS('box-decoration-break', 'clone')
  await expect.poll(() => line.evaluate(element => element.getClientRects().length)).toBe(2)
  await expect(line).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  for (const word of await words.all()) {
    await expect(word).toHaveCSS('border-radius', '0px')
    await expect(word).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  }
  await attachScreenshot('word-timed captions rounded per line')
})

test('scales every word of word-timed captions by the font size once', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page, {
    captionText: '<c>Every</c><c> word</c><c> keeps</c>\n<c>the</c><c> same</c><c> size</c>'
  })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())

  const container = page.locator('.ftVideoPlayer .shaka-text-container')
  const words = container.locator('.shaka-text-wrapper [translate="no"]')
  await expect(words).toHaveCount(6)

  await page.evaluate(() => window.$store.dispatch('updateDefaultCaptionSettings', JSON.stringify({ fontScaleFactor: 2 })))
  // Relative to the caption font size of the player, which it may lower to fit the bigger captions
  await expect.poll(() => container.evaluate(element => {
    const fontSize = parseFloat(getComputedStyle(element).fontSize)
    return [...element.querySelectorAll('.shaka-text-wrapper [translate="no"]')]
      .map(word => parseFloat(getComputedStyle(word).fontSize) / fontSize)
  })).toEqual(Array(6).fill(2))

  // The words stay inside the background of their lines. Measured together, as the captions can still be moving.
  await expect.poll(() => container.locator('.shaka-text-wrapper').evaluate(line => {
    const lineRects = [...line.getClientRects()]
    return [...line.querySelectorAll('[translate="no"]')].every(word => {
      const { top, bottom } = word.getBoundingClientRect()
      return lineRects.some(rect => top >= rect.top - 0.5 && bottom <= rect.bottom + 0.5)
    })
  })).toBe(true)
  await attachScreenshot('word-timed captions at 200% font size')
})

test('sizes captions relative to the player in fullscreen and full window', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page, { captionText: 'Sized with the player' })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await page.evaluate(() => window.$store.dispatch('updateDefaultCaptionSettings', JSON.stringify({ fontScaleFactor: 1.35 })))

  const player = page.locator('.ftVideoPlayer')
  const caption = player.locator('.shaka-text-container [translate="no"]')
  await expect(caption).toBeVisible()
  const measure = () => player.evaluate(element => ({
    fontSize: parseFloat(getComputedStyle(element.querySelector('.shaka-text-container [translate="no"]')).fontSize),
    playerHeight: element.querySelector('video').clientHeight,
  }))
  const shareOfPlayer = async () => {
    const { fontSize, playerHeight } = await measure()
    return fontSize / playerHeight
  }

  // 135% of Shaka's 20px at a player height of 540px
  await expect.poll(shareOfPlayer).toBeCloseTo(27 / 540, 3)
  const windowedHeight = (await measure()).playerHeight

  await setPlayerFullscreen(page, true)
  await expect.poll(async () => (await measure()).playerHeight).toBeGreaterThan(windowedHeight)
  await expect.poll(shareOfPlayer).toBeCloseTo(27 / 540, 3)
  await attachScreenshot('captions at 135% in fullscreen')
  await setPlayerFullscreen(page, false)

  await page.locator('body').press('s')
  await expect(player).toHaveClass(/fullWindow/)
  await expect.poll(async () => (await measure()).playerHeight).toBeGreaterThan(windowedHeight)
  await expect.poll(shareOfPlayer).toBeCloseTo(27 / 540, 3)
  await page.locator('body').press('s')
  await expect(player).not.toHaveClass(/fullWindow/)
  await expect.poll(shareOfPlayer).toBeCloseTo(27 / 540, 3)
})

test('saves a caption style picked from the Options of the captions menu', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:start position:0%' })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())

  const player = page.locator('.ftVideoPlayer')
  await player.hover()
  // Keep the controls shown, they can fade out before the clicks on slow machines
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await player.getByRole('button', { name: 'More settings' }).click()
  await openCaptionStyleMenu(player, '.shaka-caption-size-button')
  await player.locator('.shaka-overflow-menu').getByRole('menuitemradio', { name: '150%', exact: true }).click()

  await expect.poll(() => page.evaluate(() => JSON.parse(window.$store.getters.getDefaultCaptionSettings).fontScaleFactor)).toBe(1.5)
  // Choosing returns to the caption style, which stays open
  await expect(player.locator('.ft-caption-style-menu')).toBeVisible()
  await expect(player.locator('.shaka-caption-size-button')).toBeVisible()
})

test('picks caption font sizes between the presets with the slider of the captions menu', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionText: 'Sized caption' })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const getFontScaleFactor = () => page.evaluate(() => JSON.parse(window.$store.getters.getDefaultCaptionSettings).fontScaleFactor)

  const player = page.locator('.ftVideoPlayer')
  await player.hover()
  // Keep the controls shown, they can fade out before the clicks on slow machines
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await player.getByRole('button', { name: 'More settings' }).click()
  await openCaptionStyleMenu(player, '.shaka-caption-size-button')

  const menu = player.locator('.ft-caption-font-sizes')
  const value = menu.locator('.shaka-playback-rate-value')
  await expect(value).toHaveText('100%')
  await expect(menu.getByRole('menuitemradio', { name: '100%', exact: true })).toHaveAttribute('aria-checked', 'true')

  // The step buttons keep the menu open
  const increase = menu.getByRole('button', { name: '+', exact: true })
  for (let step = 0; step < 6; step++) {
    await increase.click()
  }
  await expect.poll(getFontScaleFactor).toBe(1.3)
  await expect(value).toHaveText('130%')
  await expect(menu.locator('.shaka-playback-rate-preset-btn[aria-checked="true"]')).toHaveCount(0)
  await expect(player.locator('.shaka-caption-size-button .shaka-current-selection-span')).toHaveText('130%')

  const slider = menu.getByRole('slider', { name: 'Font size' })
  await slider.focus()
  await slider.press('ArrowRight')
  await expect.poll(getFontScaleFactor).toBe(1.35)
  await expect(value).toHaveText('135%')

  // Clicking the start of the slider applies the smallest size once the mouse is released
  const { height } = await slider.boundingBox()
  await slider.click({ position: { x: 1, y: height / 2 } })
  await expect.poll(getFontScaleFactor).toBe(0.5)
  await expect(value).toHaveText('50%')
  await expect(menu.getByRole('button', { name: '−', exact: true })).toBeDisabled()

  // Settings from elsewhere, such as another device, move the slider along
  await page.evaluate(() => window.$store.dispatch('updateDefaultCaptionSettings', JSON.stringify({ fontScaleFactor: 4 })))
  await expect(value).toHaveText('400%')
  await expect(slider).toHaveValue('4')
  await expect(increase).toBeDisabled()
})

test('picks caption background opacities with the slider of the captions menu', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionText: 'Faded caption' })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const getBackgroundOpacity = () => page.evaluate(() => JSON.parse(window.$store.getters.getDefaultCaptionSettings).backgroundOpacity)

  const player = page.locator('.ftVideoPlayer')
  await player.hover()
  // Keep the controls shown, they can fade out before the clicks on slow machines
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await player.getByRole('button', { name: 'More settings' }).click()
  await openCaptionStyleMenu(player, '.shaka-caption-background-opacity-button')

  // The default black background shows its 80%
  const menu = player.locator('.ft-caption-background-opacities')
  const value = menu.locator('.shaka-playback-rate-value')
  const slider = menu.getByRole('slider', { name: 'Background opacity' })
  const defaultPreset = menu.getByRole('menuitemradio', { name: 'Default', exact: true })
  await expect(value).toHaveText('Default')
  await expect(slider).toHaveValue('0.8')
  await expect(defaultPreset).toHaveAttribute('aria-checked', 'true')

  await menu.getByRole('button', { name: '−', exact: true }).click()
  await expect.poll(getBackgroundOpacity).toBe(0.75)
  await expect(value).toHaveText('75%')
  await expect(defaultPreset).toHaveAttribute('aria-checked', 'false')

  await slider.focus()
  await slider.press('ArrowLeft')
  await expect.poll(getBackgroundOpacity).toBe(0.7)
  await expect(value).toHaveText('70%')
  await expect(player.locator('.shaka-caption-background-opacity-button .shaka-current-selection-span')).toHaveText('70%')

  // Choosing a preset returns to the caption style
  await defaultPreset.click()
  await expect.poll(getBackgroundOpacity).toBeNull()
  await expect(player.locator('.ft-caption-style-menu')).toBeVisible()
  await expect(player.locator('.shaka-caption-background-opacity-button .shaka-current-selection-span')).toHaveText('Default')
})

test('applies UI roundness to the caption settings preview background', async ({ page, attachScreenshot }) => {
  await goTo(page, 'settings')
  await page.locator('.settingsMenu [data-section="playback"]').click()
  const caption = page.locator('.captionPreview span')
  await expect(caption).toBeVisible()
  await caption.scrollIntoViewIfNeeded()

  for (const roundness of [0, 100, 200]) {
    await page.evaluate(value => {
      const store = window.$store
      return store.dispatch('updateUiRoundness', value)
    }, roundness)
    await expect(caption).toHaveCSS('border-radius', `${4 * roundness / 100}px`)
  }
  await attachScreenshot('caption preview at 200% roundness')
})

test('lowers bottom captions after the player controls fade', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:start position:0%' })
  await openMockedVideo(page)

  const player = page.locator('.ftVideoPlayer')
  const controls = player.locator('.shaka-controls-container')
  const captions = player.locator('.shaka-text-container')
  const caption = captions.locator('[translate="no"]')
  await expect(caption).toBeVisible()
  await setPlayerFullscreen(page, true)

  await player.hover()
  await expect(controls).toHaveAttribute('shown', 'true')
  const raisedBottom = await captions.evaluate(element => {
    return Number.parseFloat(getComputedStyle(element).bottom)
  })
  expect(raisedBottom).toBeGreaterThan(0)
  const raisedCaptionBounds = await caption.boundingBox()

  await page.mouse.move(0, 0)
  await expect(controls).not.toHaveAttribute('shown', 'true')
  await expect.poll(() => captions.evaluate(element => {
    return Number.parseFloat(getComputedStyle(element).bottom)
  })).toBe(0)
  await expect.poll(async () => {
    const bounds = await caption.boundingBox()
    return bounds?.y + bounds?.height
  }).toBeGreaterThan(raisedCaptionBounds.y + raisedCaptionBounds.height)
  // Shaka keeps the captions within the safe area of its caption region, 5% from the edges
  const [playerBounds, captionBounds] = await Promise.all([player.boundingBox(), caption.boundingBox()])
  const bottomGap = playerBounds.y + playerBounds.height - (captionBounds.y + captionBounds.height)
  expect(bottomGap).toBeGreaterThan(playerBounds.height * 0.04)
  expect(bottomGap).toBeLessThan(playerBounds.height * 0.1)
})
