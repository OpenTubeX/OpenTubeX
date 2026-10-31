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
