import path from 'node:path'

import { test, expect, goTo, goToSettingsSection, repoRoot, setPlayerFullscreen } from '../../helpers/app.mjs'
import { sampleColors } from '../../helpers/colors.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { BUILTIN_BASE_THEME_VALUES } from '../../../src/constants.js'

/** Text color and background composited over ancestors, including color(srgb ...) values. */
function renderedColors(locator) {
  return locator.evaluate(element => {
    const rgba = color => color.match(/[\d.]+/g).map(Number)
      .map((value, i) => color.startsWith('color(srgb ') && i < 3 ? value * 255 : value)
    const ancestors = []
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node)
    const background = ancestors.reduce((below, node) => {
      const [r, g, b, alpha = 1] = rgba(getComputedStyle(node).backgroundColor)
      return [r, g, b].map((channel, i) => Math.round(channel * alpha + below[i] * (1 - alpha)))
    }, [255, 255, 255])
    return { foreground: rgba(getComputedStyle(element).color).slice(0, 3), background }
  })
}

function contrastRatio(first, second) {
  const luminance = rgb => rgb.map(value => value / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

async function switchContrast(app, label, checked) {
  const height = await label.evaluate(element => element.getBoundingClientRect().height)
  // Sample the exposed half of the track, its adjacent background and the
  // thumb's upper quarter. Avoid rounded edges, the shadow and state glyph.
  const trackX = checked ? 12 : 34
  const [track, surface, thumb] = await sampleColors(app, label, [
    [trackX, height / 2], [trackX, height / 2 - 15],
    [checked ? 34 : 18, height / 2 - (checked ? 4.5 : 3)]
  ])
  return { track, surface, thumb, trackRatio: contrastRatio(track, surface), thumbRatio: contrastRatio(thumb, track), thumbSurfaceRatio: contrastRatio(thumb, surface) }
}

async function controlContrast(app, control, kind) {
  const { page } = app
  await control.scrollIntoViewIfNeeded()
  const [surface, ...edge] = await sampleColors(app, page.locator('.settingsWindow'), () => control.evaluate((element, kind) => {
    const rect = element.getBoundingClientRect()
    const container = element.closest('.settingsWindow').getBoundingClientRect()
    const x = rect.left - container.left
    const y = rect.top - container.top + rect.height / 2
    // Locate the strongest edge pixel near the CSS boundary. Fractional zoom
    // can spread a one-pixel stroke across neighboring screenshot pixels.
    return kind === 'slider'
      ? [[x + rect.width * 0.85, y - 8], ...[-1, 0, 1].map(offset => [x + rect.width * 0.85, y + offset])]
      : [[x - 4, y], ...[-0.5, 0.5, 1.5].map(offset => [x + offset, y])]
  }, kind))
  return { surface, edge, ratio: Math.max(...edge.map(color => contrastRatio(color, surface))) }
}

test.describe('desktop phone-panel fallbacks', () => {
  test.use({ seed: { settings: { baseTheme: 'dark', currentLocale: 'en-US' } } })

  test('description and comment text inherit the active theme color', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const elements = [
      page.locator('.videoDescription .description').first(),
      page.locator('.commentText').first(),
    ]
    const bodyColor = await page.locator('body').evaluate(element => getComputedStyle(element).color)
    for (const element of elements) {
      await expect(element).toBeVisible()
      await expect(element).toHaveCSS('color', bodyColor)
    }
  })
})

// These themes share layout rules; pair light/dark with regular/fractional zoom.
for (const [theme, scale] of [['openTubeXLight', 100], ['openTubeXDark', 125]]) {
  test.describe(`${theme} comment contrast at ${scale}%`, () => {
    test.use({ seed: { settings: { baseTheme: theme, currentLocale: 'en-US', uiScale: scale } } })

    for (const fullscreen of [false, true]) {
      test(`comment thread lines and reply connectors remain visible in ${fullscreen ? 'fullscreen' : 'watch page'}`, async ({ app, page, attachScreenshot }) => {
        await mockPlayableWatchPage(app, page)
        await openMockedVideo(page)
        if (fullscreen) {
          await setPlayerFullscreen(page, true)
          await page.locator('.fullscreenCommentsToggle').click({ force: true })
          await expect(page.locator('.fullscreenCommentsOverlay.open')).toBeVisible()
        }
        const thread = page.locator('.commentThread').first()
        const connector = thread.locator('.commentReplyConnector').first()

        for (const [element, pseudo] of [[thread, '::before'], [connector, null]]) {
          if (!pseudo) {
            await thread.locator(':scope > .commentReplyRootToggle button').click()
          }
          await expect(element).toBeVisible()
          await page.mouse.move(0, 0)
          await element.scrollIntoViewIfNeeded()
          const points = await element.evaluate((element, pseudo) => {
            const style = getComputedStyle(element, pseudo)
            const x = pseudo ? parseFloat(style.insetInlineStart) : 0
            const y = pseudo ? parseFloat(style.insetBlockStart) + 10 : 3
            return [[x - 4, y], ...[-0.5, 0.5, 1.5].map(offset => [x + offset, y])]
          }, pseudo)
          const [surface, ...edge] = await sampleColors(app, element, points)
          const ratio = Math.max(...edge.map(color => contrastRatio(color, surface)))
          expect.soft(ratio, `${pseudo ? 'thread' : 'reply connector'} ${JSON.stringify({ surface, edge })}`).toBeGreaterThanOrEqual(3)
        }
        await attachScreenshot(`${theme} comment thread contrast at ${scale}% ${fullscreen ? 'fullscreen' : 'watch page'}`)
      })
    }
  })
}

// These themes share layout rules; pair light/dark with regular/fractional zoom.
for (const [theme, scale] of [['openTubeXLight', 100], ['openTubeXDark', 125]]) {
  test.describe(`${theme} control contrast at ${scale}%`, () => {
    test.use({ seed: { settings: { baseTheme: theme, currentLocale: 'en-US', uiScale: scale } } })

    test('seekbar progress keeps a subtle teal tint and SponsorBlock categories remain visible', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      // An aborted label lookup would queue later SponsorBlock requests behind
      // network recovery. A 404 is the API's normal "no labels" response.
      await page.route('**/api/videoLabels/**', route => route.fulfill({ status: 404 }))
      const categories = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'hook', 'music_offtopic', 'filler', 'poi_highlight']
      await page.route('**/api/skipSegments/**', route => route.fulfill({
        json: [{
          videoID: 'jNQXAC9IVRw',
          segments: categories.map((category, index) => ({
            UUID: `seekbar-${category}`,
            category,
            actionType: category === 'poi_highlight' ? 'poi' : 'skip',
            segment: [index * 2 + 1, index * 2 + (category === 'poi_highlight' ? 1 : 2)],
            videoDuration: 30,
            votes: 1,
            locked: 0,
            description: ''
          }))
        }]
      }))
      await page.evaluate(() => {
        window.$store.commit('setUseSponsorBlock', true)
      })
      await openMockedVideo(page)
      const player = page.locator('.ftVideoPlayer')
      await player.locator('video').evaluate(video => {
        video.pause()
        video.currentTime = 24
        video.dispatchEvent(new Event('timeupdate'))
      })
      await player.hover()
      const bar = player.locator('.shaka-seek-bar-container')
      await expect(bar.locator('.sponsorBlockMarker')).toHaveCount(categories.length)
      await expect.poll(() => bar.locator('.shaka-seek-bar').inputValue()).toBe('24')
      const points = await bar.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return [
          [rect.width * 0.75, rect.height / 2],
          [rect.width * 0.95, rect.height / 2],
          ...Array.from(element.querySelectorAll('.sponsorBlockMarker'), marker => {
            const bounds = marker.getBoundingClientRect()
            return [bounds.x - rect.x + bounds.width / 2, bounds.y - rect.y + bounds.height / 2]
          })
        ]
      })
      const [played, unplayed, ...markers] = await sampleColors(app, bar, points)
      expect(played[1] - played[0], `teal progress: ${played}`).toBeGreaterThanOrEqual(10)
      expect(played[2] - played[0], `teal progress: ${played}`).toBeGreaterThanOrEqual(8)
      expect(Math.min(...played), `soft teal progress: ${played}`).toBeGreaterThanOrEqual(190)
      expect(Math.max(...played), `retain marker colors: ${played}`).toBeLessThanOrEqual(235)
      expect(Math.max(...played.map((value, index) => Math.abs(value - unplayed[index])))).toBeGreaterThanOrEqual(20)
      for (const [index, marker] of markers.entries()) {
        expect(Math.max(...marker.map((value, channel) => Math.abs(value - played[channel]))),
          `${categories[index]} marker: ${marker}, progress: ${played}`).toBeGreaterThanOrEqual(20)
      }
    })

    test('toggle track and thumb remain distinct in both states', async ({ app, page, attachScreenshot }) => {
      await goToSettingsSection(page, 'general')
      const toggle = page.getByRole('checkbox', { name: 'Keep relative timestamps updated' })
      for (const checked of [true, false]) {
        if (await toggle.isChecked() !== checked) await toggle.locator('..').locator('.switch-label').click()
        await expect(toggle).toBeChecked({ checked })
        const contrast = await switchContrast(app, toggle.locator('..').locator('.switch-label'), checked)
        // The thumb identifies the control with 3:1 contrast. The light track
        // uses a softer fill, but must not disappear into the page gradient.
        expect.soft(contrast.trackRatio, `track ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(theme === 'openTubeXLight' ? 1.5 : 3)
        expect.soft(contrast.thumbSurfaceRatio, `thumb against background ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(3)
        expect.soft(contrast.thumbRatio, `thumb ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(3)
        await attachScreenshot(`${theme} toggle ${checked ? 'on' : 'off'} at ${scale}%`)
      }
      // Keyboard focus and toggling still work with the new control colors.
      await toggle.focus()
      await page.keyboard.press('Space')
      await expect(toggle).toBeChecked()
      await expect(toggle.locator('..').locator('.switch-label')).toHaveCSS('outline-style', 'solid')
      await attachScreenshot(`${theme} toggle contrast at ${scale}%`)
    })

    test('active settings-header icons remain visible', async ({ page }) => {
      await goToSettingsSection(page, 'general')
      for (const name of ['Highlight settings changed from defaults', 'Show performance impact indicators']) {
        const button = page.getByRole('button', { name, exact: true })
        if (await button.getAttribute('aria-pressed') !== 'true') await button.click()
        await expect(button).toHaveAttribute('aria-pressed', 'true')
        await page.mouse.move(0, 0)
        await button.blur()
        const colors = await renderedColors(button)
        expect.soft(contrastRatio(colors.foreground, colors.background), name).toBeGreaterThanOrEqual(3)
        await button.click()
        await expect(button).toHaveAttribute('aria-pressed', 'false')
        // Keyboard focus on a disabled toggle must not look enabled.
        await page.mouse.move(0, 0)
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Tab')
        await expect(button).toBeFocused()
        const focused = await renderedColors(button)
        const distance = Math.max(...focused.background.map((channel, i) => Math.abs(channel - colors.background[i])))
        expect.soft(distance, `${name} focus differs from enabled`).toBeGreaterThanOrEqual(8)
      }
    })

    test('slider tracks and field boundaries remain visible', async ({ app, page, attachScreenshot }) => {
      await goToSettingsSection(page, 'theme')
      const slider = await controlContrast(app, page.getByRole('slider', { name: /UI Roundness/ }), 'slider')
      expect.soft(slider.ratio, `slider ${JSON.stringify(slider)}`).toBeGreaterThanOrEqual(3)
      const select = await controlContrast(app, page.getByRole('combobox', { name: /^Base theme/i }), 'field')
      expect.soft(select.ratio, `dropdown ${JSON.stringify(select)}`).toBeGreaterThanOrEqual(3)
      const icon = page.locator('.changedSettingIndicator').first()
      const iconColor = await icon.evaluate(element => getComputedStyle(element).color.match(/[\d.]+/g).slice(0, 3).map(Number))
      expect.soft(contrastRatio(iconColor, select.surface), `reset icon ${JSON.stringify({ iconColor, surface: select.surface })}`).toBeGreaterThanOrEqual(3)
      const search = await controlContrast(app, page.locator('.settingsSearch'), 'field')
      expect.soft(search.ratio, `search ${JSON.stringify(search)}`).toBeGreaterThanOrEqual(3)
      await expect(page.getByRole('combobox', { name: /Main color theme/i })).toBeDisabled()
      await attachScreenshot(`${theme} fields and sliders at ${scale}%`)
    })
  })
}

test.describe('hotPink contrast', () => {
  test.use({ seed: { settings: { baseTheme: 'hotPink', currentLocale: 'en-US' } } })

  test('toggle thumbs remain distinct in both states', { tag: '@scale' }, async ({ app, page }) => {
    await goToSettingsSection(page, 'general')
    const toggle = page.getByRole('checkbox', { name: 'Keep relative timestamps updated' })
    const tracks = []
    const thumbs = []
    for (const checked of [true, false]) {
      if (await toggle.isChecked() !== checked) await toggle.locator('..').locator('.switch-label').click()
      await expect(toggle).toBeChecked({ checked })
      const contrast = await switchContrast(app, toggle.locator('..').locator('.switch-label'), checked)
      tracks.push(contrast.track)
      thumbs.push(contrast.thumb)
      const label = toggle.locator('..').locator('.switch-label')
      // The outline separates the white thumb from the light off track.
      // Locate its rendered edge, including fractional geometry at UI zoom.
      const points = await label.evaluate((element, checked) => {
        const rect = element.getBoundingClientRect()
        const thumb = element.querySelector('.switch-thumb').getBoundingClientRect()
        const x = (checked ? thumb.left : thumb.right) - rect.left
        const y = thumb.top - rect.top + thumb.height / 2
        return [-1.5, -0.5, 0.5, 1.5].map(offset => [x + offset, y])
      }, checked)
      const edge = await sampleColors(app, label, points)
      const thumbRatio = Math.max(contrast.thumbRatio, ...edge.map(color => contrastRatio(color, contrast.track)))
      expect.soft(contrast.trackRatio, `track and background ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(3)
      expect.soft(thumbRatio, `thumb boundary and track ${JSON.stringify({ contrast, edge })}`).toBeGreaterThanOrEqual(3)
      expect.soft(contrast.thumbSurfaceRatio, `thumb and background ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(3)
    }
    expect(contrastRatio(...tracks), 'on and off tracks').toBeGreaterThanOrEqual(3)
    expect(thumbs[0], 'thumb color stays consistent').toEqual(thumbs[1])
  })

  test('settings category titles and descriptions remain readable in every state', async ({ page }) => {
    await goToSettingsSection(page, 'theme')
    const pageColors = await page.locator('body').evaluate(element => {
      const style = getComputedStyle(element)
      const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
      return { foreground: rgb(style.color), background: rgb(style.backgroundColor) }
    })
    expect.soft(contrastRatio(pageColors.foreground, pageColors.background), 'page text').toBeGreaterThanOrEqual(4.5)
    const category = page.locator('.settingsMenu .title[data-section="playback"]')
    const selected = page.locator('.settingsMenu .title.active')
    for (const state of ['normal', 'selected', 'hover', 'focus']) {
      const button = state === 'selected' ? selected : category
      if (state === 'hover') await button.hover()
      if (state === 'focus') {
        await page.mouse.move(0, 0)
        await page.keyboard.press('Tab')
        await button.focus()
      }
      const colors = await button.evaluate(element => {
        // Selected categories use a translucent color-mix(), serialized as color(srgb ...).
        const rgba = color => color.match(/[\d.]+/g).map(Number)
          .map((value, i) => color.startsWith('color(srgb ') && i < 3 ? value * 255 : value)
        const rgb = color => rgba(color).slice(0, 3)
        const menu = rgb(getComputedStyle(element.closest('.settingsMenu')).backgroundColor)
        const [r, g, b, alpha = 1] = rgba(getComputedStyle(element).backgroundColor)
        return {
          background: [r, g, b].map((channel, i) => channel * alpha + menu[i] * (1 - alpha)),
          title: rgb(getComputedStyle(element.querySelector('.titleText')).color),
          description: rgb(getComputedStyle(element.querySelector('.titleDescription')).color)
        }
      })
      for (const part of ['title', 'description']) {
        expect.soft(contrastRatio(colors[part], colors.background), `${state} ${part} ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test('slider tracks and hovered header controls remain visible', { tag: '@scale' }, async ({ app, page }) => {
    await goToSettingsSection(page, 'theme')
    const input = page.getByRole('slider', { name: /UI Roundness/ })
    const slider = await controlContrast(app, input, 'slider')
    expect.soft(slider.ratio, `slider ${JSON.stringify(slider)}`).toBeGreaterThanOrEqual(3)
    const points = await input.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const fraction = (Number(element.value) - Number(element.min)) / (Number(element.max) - Number(element.min))
      return [[1 + fraction * (rect.width - 2), rect.height / 2], [rect.width * 0.85, rect.height / 2]]
    })
    const [thumb, track] = await sampleColors(app, input, points)
    expect.soft(contrastRatio(thumb, track), `slider thumb ${JSON.stringify({ thumb, track })}`).toBeGreaterThanOrEqual(3)
    const button = page.getByRole('button', { name: 'Show performance impact indicators', exact: true })
    if (await button.getAttribute('aria-pressed') === 'true') await button.click()
    await button.hover()
    const colors = await button.evaluate(element => {
      const style = getComputedStyle(element)
      const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
      return { foreground: rgb(style.color), background: rgb(style.backgroundColor) }
    })
    expect.soft(contrastRatio(colors.foreground, colors.background), `header hover ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(3)
  })
})

test.describe('contrast sampling during settings animations', () => {
  test.use({ seed: { settings: { baseTheme: 'hotPink', currentLocale: 'en-US' } } })

  test('measures slider coordinates after the section finishes moving', { tag: '@scale' }, async ({ app, page }) => {
    await goToSettingsSection(page, 'theme')
    const input = page.getByRole('slider', { name: /UI Roundness/ })
    await input.scrollIntoViewIfNeeded()
    await input.evaluate(element => {
      // Hold the section four pixels below its final position while measuring.
      const section = element.closest('.settingsContent > [data-section]')
      const animation = section.animate([{ transform: 'translateY(4px)' }, { transform: 'none' }], { duration: 180 })
      animation.pause()
      animation.currentTime = 0
    })
    const slider = await controlContrast(app, input, 'slider')
    expect(slider.ratio, JSON.stringify(slider)).toBeGreaterThanOrEqual(3)
  })
})

test.describe('bright main color toggle contrast', () => {
  test.use({ seed: { settings: { baseTheme: 'light', mainColor: 'Yellow', currentLocale: 'en-US' } } })

  test('enabled settings-header toggles stay readable and visible with a bright main color', async ({ page }) => {
    await goToSettingsSection(page, 'general')
    const button = page.getByRole('button', { name: 'Highlight settings changed from defaults', exact: true })
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(0, 0)
    await button.blur()
    const enabled = await renderedColors(button)
    const surface = await renderedColors(page.locator('.settingsHeaderActions'))
    expect(contrastRatio(enabled.foreground, enabled.background), 'enabled icon').toBeGreaterThanOrEqual(3)
    expect(contrastRatio(enabled.background, surface.background), 'enabled container').toBeGreaterThanOrEqual(1.2)
  })
})

test.describe('toast action contrast', () => {
  test.use({ seed: { settings: { baseTheme: 'light', currentLocale: 'en-US' } } })

  test('toast actions stay readable on the dark toast in a light theme', async ({ page }) => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('opentubex:preview-managed-tools-update')))
    const toast = page.locator('.toast', { hasText: 'An update is available for yt-dlp.' })
    for (const name of ['Cancel', 'Update']) {
      const button = toast.getByRole('button', { name, exact: true })
      await expect(button).toBeVisible()
      await page.mouse.move(0, 0)
      const rest = await renderedColors(button)
      expect.soft(contrastRatio(rest.foreground, rest.background), `${name} at rest`).toBeGreaterThanOrEqual(4.5)
      await button.hover()
      await button.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
      const hovered = await renderedColors(button)
      expect.soft(contrastRatio(hovered.foreground, hovered.background), `${name} on hover`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

// Hot Pink forces black theme colors on a magenta card; Yellow is the brightest main color.
for (const settings of [{ baseTheme: 'hotPink' }, { baseTheme: 'light', mainColor: 'Yellow' }]) {
  test.describe(`${Object.values(settings).join(' ')} icon button contrast`, () => {
    const media = path.join(repoRoot, 'e2e/fixtures/media/demo.webm')
    test.use({
      seed: {
        settings: { ...settings, enableDownloads: true, currentLocale: 'en-US' },
        downloads: [
          { id: 1, title: 'Completed', status: 'completed', completedAt: Date.now(), mode: 'video', destination: media, destinations: [media], files: [] },
          { id: 2, title: 'Failed', status: 'failed', mode: 'video', retryPayload: { videoId: 'aaaaaaaaaaa', title: 'Failed', mode: 'video' }, destinations: [], files: [] },
        ]
      }
    })

    test('tonal icon buttons keep readable icons at rest and on hover', async ({ page }) => {
      await goTo(page, 'downloads')
      const buttons = [
        page.getByRole('button', { name: 'Retry download', exact: true }),
        page.getByRole('button', { name: 'Clear From List', exact: true }).first(),
        page.getByRole('button', { name: 'Remove File', exact: true }),
      ]
      for (const button of buttons) {
        await expect(button).toBeVisible()
        const name = await button.getAttribute('title')
        await page.mouse.move(0, 0)
        const rest = await renderedColors(button)
        expect.soft(contrastRatio(rest.foreground, rest.background), `${name} at rest`).toBeGreaterThanOrEqual(3)
        await button.hover()
        // Read the settled hover fill, not an interpolated transition frame
        await button.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
        const hovered = await renderedColors(button)
        expect(hovered.background, `${name} hover fill`).not.toEqual(rest.background)
        expect.soft(contrastRatio(hovered.foreground, hovered.background), `${name} on hover`).toBeGreaterThanOrEqual(3)
      }
    })
  })
}

test.describe('browser tab contrast', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('inactive tabs stand out from the vertical tab strip in every built-in theme', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => window.ftElectron.tabs.create({ route: '/history', title: 'History', makeActive: false, lazyLoad: true }))
    const tabBar = page.locator('.tabBar')
    await expect(tabBar.locator('.tab')).toHaveCount(2)
    // The vertical strip has no neighboring chrome to outline the tabs.
    await page.evaluate(() => window.$store.commit('setTabBarPosition', 'left'))
    await expect(tabBar).toHaveClass(/vertical/)
    await page.mouse.move(600, 400)
    for (const theme of BUILTIN_BASE_THEME_VALUES.filter(theme => theme !== 'system')) {
      await page.evaluate(async theme => {
        await window.$store.dispatch('updateBaseTheme', theme)
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }, theme)
      const [strip, inactive, active] = await Promise.all([
        tabBar, tabBar.locator('.tab:not(.active)'), tabBar.locator('.tab.active'),
      ].map(element => renderedColors(element).then(({ background }) => background)))
      expect.soft(contrastRatio(inactive, strip), `${theme} inactive tab on the strip`).toBeGreaterThanOrEqual(1.05)
      expect.soft(contrastRatio(active, inactive), `${theme} active tab beside an inactive tab`).toBeGreaterThanOrEqual(1.05)
      if (['black', 'materialDark', 'materialBlack'].includes(theme)) await attachScreenshot(`${theme} vertical tabs`)
    }
  })
})
