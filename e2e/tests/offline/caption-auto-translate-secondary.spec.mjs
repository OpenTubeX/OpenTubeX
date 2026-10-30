import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo, openCaptionLanguages } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const SEED = {
  videoPlaybackEngine: 'built-in',
  ytDlpPlaybackEngineDefaultMigration: true,
  enableSubtitlesByDefault: true,
  preferredCaptionLocale: 'de',
}
// The video has incomplete German captions next to its auto-generated English ones
const CAPTIONS = {
  captionTranslations: true,
  captionText: language => `Original caption (${language})`,
  extraCaptionTracks: [{ languageCode: 'de', name: 'German' }],
}
const TRANSLATED_LABEL = /^German \(translated from .English \(auto-generated\).\)$/

/**
 * @param {import('@playwright/test').Locator} video
 */
function activeTextTrack(video) {
  return video.evaluate(element => {
    return element.ui?.getControls()?.getPlayer()?.getTextTracks().find(track => track.active)?.label ?? null
  })
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} setting
 */
function storedSetting(page, setting) {
  return page.evaluate(getter => window.$store.getters[getter], `get${setting[0].toUpperCase()}${setting.slice(1)}`)
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function openCaptionsMenu(page) {
  const player = page.locator('.ftVideoPlayer')
  await player.hover()
  // Keep the controls shown, they can fade out before the click on slow machines
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await player.getByRole('button', { name: 'More settings' }).click()
  await openCaptionLanguages(player)
  const captionsMenu = player.locator('.shaka-text-languages')
  await expect(captionsMenu).toBeVisible()
  return captionsMenu
}

test.describe('remembered auto-translation', () => {
  test.use({ seed: { settings: SEED } })

  test('opens later videos with the auto-translation picked in the player', async ({ app, page, attachScreenshot }) => {
    // Opens three videos
    test.slow()
    await mockPlayableWatchPage(app, page, CAPTIONS)
    let video = await openMockedVideo(page)
    await expect.poll(() => activeTextTrack(video)).toBe('German')

    const captionsMenu = await openCaptionsMenu(page)
    await captionsMenu.getByRole('button', { name: 'Auto-translate' }).click()
    await attachScreenshot('auto-translate menu')
    await page.locator('.ft-caption-translation-options').getByRole('button', { name: 'German', exact: true }).click()
    await expect.poll(() => activeTextTrack(video)).toMatch(TRANSLATED_LABEL)
    await expect.poll(() => storedSetting(page, 'autoTranslatedCaptionLocale')).toBe('de')

    // The translation wins over the video's own German captions
    video = await openMockedVideo(page, 'aqz-KE-bpKQ')
    await expect.poll(() => activeTextTrack(video)).toMatch(TRANSLATED_LABEL)

    // Picking an original track forgets the translation again
    const nextCaptionsMenu = await openCaptionsMenu(page)
    await attachScreenshot('remembered translation on the next video')
    await nextCaptionsMenu.getByRole('menuitemradio', { name: 'German', exact: true }).click()
    await expect.poll(() => activeTextTrack(video)).toBe('German')
    await expect.poll(() => storedSetting(page, 'autoTranslatedCaptionLocale')).toBe('')

    video = await openMockedVideo(page)
    await expect.poll(() => activeTextTrack(video)).toBe('German')
  })
})

test.describe('remembered auto-translation into the video language', () => {
  test.use({ seed: { settings: { ...SEED, autoTranslatedCaptionLocale: 'en' } } })

  test('keeps the original captions when they are already in that language', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, CAPTIONS)
    const video = await openMockedVideo(page)
    await expect.poll(() => activeTextTrack(video)).toBe('German')

    // Turning captions off and on again isn't a track choice, so the translation stays remembered.
    // Saving a setting is asynchronous, so the test records the dispatch, which happens synchronously.
    await page.evaluate(() => {
      window.autoTranslatedCaptionLocaleUpdates = []
      window.$store.subscribeAction(action => {
        if (action.type === 'updateAutoTranslatedCaptionLocale') {
          window.autoTranslatedCaptionLocaleUpdates.push(action.payload)
        }
      })
    })
    await page.locator('body').press('c')
    await expect.poll(() => activeTextTrack(video)).toBe(null)
    await page.locator('body').press('c')
    await expect.poll(() => activeTextTrack(video)).toBe('German')
    expect(await page.evaluate(() => window.autoTranslatedCaptionLocaleUpdates)).toEqual([])
  })
})

test.describe('captions turned off right after the player enables them', () => {
  test.use({ seed: { settings: SEED } })

  test('stay off when Shaka applies its caption preference afterwards', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, CAPTIONS)
    // The mocked video plays from a URL, so Shaka applies the preferred captions itself half a second after the
    // first frame if no captions are on by then. Turn them off with the shortcut as soon as the player enables them.
    await page.evaluate(() => {
      new MutationObserver((_, observer) => {
        const video = document.querySelector('.tabContent[aria-hidden="false"] video')
        if (!video) return
        observer.disconnect()
        const turnOff = () => {
          if (!video.ui?.getControls()?.getPlayer()?.getTextTracks().some(track => track.active)) return
          video.textTracks.removeEventListener('change', turnOff)
          window.captionsTurnedOffAt = video.currentTime
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true, cancelable: true }))
        }
        video.textTracks.addEventListener('change', turnOff)
      }).observe(document.body, { childList: true, subtree: true })
    })
    const video = await openMockedVideo(page)
    const turnedOffAt = await page.evaluate(() => window.captionsTurnedOffAt)
    expect(turnedOffAt).toEqual(expect.any(Number))
    await expect.poll(() => activeTextTrack(video)).toBe(null)

    // Playing on for longer than Shaka waits
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(turnedOffAt + 1.5)
    expect(await activeTextTrack(video)).toBe(null)
  })
})

test.describe('secondary captions', () => {
  test.use({ seed: { settings: { ...SEED, preferredCaptionLocale: 'en' } } })

  test('shows a second caption track together with the main captions @scale', async ({ app, page, attachScreenshot }) => {
    // Opens two videos
    test.slow()
    await mockPlayableWatchPage(app, page, CAPTIONS)
    let video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await expect.poll(() => activeTextTrack(video)).toBe('English (auto-generated)')

    const player = page.locator('.ftVideoPlayer')
    const mainCaption = player.locator('.shaka-text-container [translate="no"]')
    const secondaryCaption = player.locator('.secondaryCaptions')
    await expect(mainCaption).toHaveText('Original caption (en)')
    await expect(secondaryCaption).toHaveCount(0)

    const captionsMenu = await openCaptionsMenu(page)
    await attachScreenshot('captions menu')
    await captionsMenu.getByRole('button', { name: 'Secondary Captions', exact: true }).click()
    const secondaryMenu = player.locator('.ft-caption-secondary-menu')
    const options = secondaryMenu.locator('.ft-caption-secondary-options')
    await expect(options.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-selected', 'true')
    // The main track isn't offered a second time
    await expect(options.getByRole('button')).toHaveText(['Off', 'German'])

    // A short list keeps the height of the settings menu like the other submenus instead of stretching it
    const overflowMenu = player.locator('.shaka-overflow-menu')
    const [menuHeight, settingsMenuHeight] = await Promise.all([
      overflowMenu.boundingBox().then(bounds => bounds.height),
      overflowMenu.evaluate(element => parseFloat(element.style.minBlockSize)),
    ])
    expect(Math.abs(menuHeight - settingsMenuHeight)).toBeLessThan(1)

    // A short list is centered below the header like the other submenus
    const [optionsBounds, firstBounds, lastBounds] = await Promise.all([
      options.boundingBox(),
      options.getByRole('button').first().boundingBox(),
      options.getByRole('button').last().boundingBox(),
    ])
    const tilesCenterY = (firstBounds.y + lastBounds.y + lastBounds.height) / 2
    expect(Math.abs(tilesCenterY - (optionsBounds.y + optionsBounds.height / 2))).toBeLessThan(2)
    await attachScreenshot('secondary captions menu')

    // Like in Shaka's submenus, a click beside the options goes back
    await options.click({ position: { x: 2, y: 2 } })
    await expect(secondaryMenu).toBeHidden()
    await expect(captionsMenu).toBeVisible()

    await captionsMenu.getByRole('button', { name: 'Secondary Captions', exact: true }).click()
    await options.getByRole('button', { name: 'German', exact: true }).click()
    await expect(captionsMenu).toBeVisible()
    await expect(secondaryCaption).toHaveText('Original caption (de)')
    await expect(mainCaption).toHaveText('Original caption (en)')
    await expect.poll(() => storedSetting(page, 'secondaryCaptionLocale')).toBe('de')

    // Bottom-anchored main captions push the secondary ones to the top edge
    await page.keyboard.press('Escape')
    const [playerBounds, secondaryBounds, mainBounds] = await Promise.all([
      player.boundingBox(), secondaryCaption.locator('span').boundingBox(), mainCaption.boundingBox(),
    ])
    expect(secondaryBounds.y + secondaryBounds.height).toBeLessThan(playerBounds.y + playerBounds.height / 2)
    expect(secondaryBounds.y + secondaryBounds.height).toBeLessThan(mainBounds.y)
    await attachScreenshot('secondary captions above the main captions')

    // Turning captions off hides both
    await page.locator('body').press('c')
    await expect.poll(() => activeTextTrack(video)).toBe(null)
    await expect(secondaryCaption).toHaveCount(0)
    await page.locator('body').press('c')
    await expect(secondaryCaption).toHaveText('Original caption (de)')

    // The language is remembered for the next video
    video = await openMockedVideo(page, 'aqz-KE-bpKQ')
    await expect(secondaryCaption).toHaveText('Original caption (de)')

    const nextCaptionsMenu = await openCaptionsMenu(page)
    await nextCaptionsMenu.getByRole('button', { name: 'Secondary Captions', exact: true }).click()
    await expect(options.getByRole('button', { name: 'German', exact: true })).toHaveAttribute('aria-selected', 'true')
    await options.getByRole('button', { name: 'Off', exact: true }).click()
    await expect(secondaryCaption).toHaveCount(0)
    await expect.poll(() => storedSetting(page, 'secondaryCaptionLocale')).toBe('')
  })
})

test.describe('secondary captions beside a translation', () => {
  test.use({ seed: { settings: { ...SEED, preferredCaptionLocale: 'en' } } })

  test('offers the only original track as secondary captions under a translated main track', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true, captionText: CAPTIONS.captionText })
    const video = await openMockedVideo(page)
    await expect.poll(() => activeTextTrack(video)).toBe('English (auto-generated)')

    const captionsMenu = await openCaptionsMenu(page)
    const secondaryButton = captionsMenu.getByRole('button', { name: 'Secondary Captions', exact: true })
    await expect(secondaryButton).toHaveCount(0)

    await captionsMenu.getByRole('button', { name: 'Auto-translate' }).click()
    await page.locator('.ft-caption-translation-options').getByRole('button', { name: 'German', exact: true }).click()
    await expect.poll(() => activeTextTrack(video)).toMatch(TRANSLATED_LABEL)
    await expect(captionsMenu).toBeVisible()
    await expect(secondaryButton).toBeVisible()
  })
})

test.describe('secondary captions under top-anchored main captions', () => {
  test.use({
    seed: {
      settings: {
        ...SEED,
        preferredCaptionLocale: 'en',
        secondaryCaptionLocale: 'de',
        defaultCaptionSettings: JSON.stringify({ anchor: 'top-center' }),
      }
    }
  })

  test('keeps the secondary captions above the visible controls @scale', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, CAPTIONS)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())

    const player = page.locator('.ftVideoPlayer')
    const secondaryCaption = player.locator('.secondaryCaptions span')
    await expect(secondaryCaption).toHaveText('Original caption (de)')

    await player.hover()
    await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
    const bottomControls = player.locator('.shaka-bottom-controls')
    await expect(bottomControls).toBeVisible()
    // Shaka moves its caption area above the controls, the secondary captions follow it
    await expect.poll(async () => {
      const [captionBounds, controlsBounds] = await Promise.all([secondaryCaption.boundingBox(), bottomControls.boundingBox()])
      return captionBounds.y + captionBounds.height <= controlsBounds.y + 0.5
    }).toBe(true)
  })
})

test.describe('secondary captions after Shaka replaces its caption area', () => {
  test.use({ seed: { settings: { ...SEED, preferredCaptionLocale: 'en', secondaryCaptionLocale: 'de' } } })

  test('follows the new caption area @scale', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, CAPTIONS)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())

    const player = page.locator('.ftVideoPlayer')
    const secondaryCaption = player.locator('.secondaryCaptions span')
    await expect(secondaryCaption).toHaveText('Original caption (de)')

    // Shaka creates a new caption area when it reloads, here it starts lower than the old one
    await player.evaluate(element => {
      const textContainer = element.querySelector('.shaka-text-container')
      const replacement = textContainer.cloneNode(false)
      replacement.style.top = '80px'
      textContainer.replaceWith(replacement)
    })
    await video.evaluate(element => { element.currentTime = 0.1 })

    await expect.poll(async () => {
      const [captionBounds, areaBounds] = await Promise.all([
        secondaryCaption.boundingBox(),
        // The old caption area's displayer stays alive here, and Shaka re-attaches it after the
        // replacement, which a real reload destroys. The replacement comes first, like a new one would.
        player.locator('.shaka-text-container').first().boundingBox(),
      ])
      return captionBounds.y >= areaBounds.y - 0.5
    }).toBe(true)
  })
})
