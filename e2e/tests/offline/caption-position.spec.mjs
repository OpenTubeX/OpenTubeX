import { setPlayerFullscreen, test, expect } from '../../helpers/app.mjs'
import { openCaptionStyleMenu, openMockedVideo, openPlayerOptions } from '../../helpers/player.mjs'
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
  await openPlayerOptions(player)
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
  await openPlayerOptions(player)
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
