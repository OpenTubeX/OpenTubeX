import path from 'node:path'
import { readFileSync } from 'node:fs'

import { test, expect, goTo, goToSettingsSection, repoRoot, setPlayerFullscreen } from '../../helpers/app.mjs'
import { sampleColors } from '../../helpers/colors.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { BUILTIN_BASE_THEME_VALUES, CATPPUCCIN_MACCHIATO_COLORS, FIXED_COLOR_BASE_THEMES } from '../../../src/constants.js'
import { MATERIAL_SEED_PRESETS } from '../../../src/materialTheme.js'
import { SIGNAL_ACCENT_PRESETS } from '../../../src/signalTheme.js'

/** Text color and background composited over ancestors, including color(srgb ...) values. */
function renderedColors(locator) {
  return locator.evaluate(element => {
    const rgba = color => color.match(/-?[\d.]+(?:e[-+]?\d+)?/gi).map(Number)
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

/** Every theme's own accents, plus the main colors that stress light and dark surfaces most. */
function tintedSelectionCombos() {
  const mainColors = ['Pink', 'Yellow', 'CatppuccinLatteRed']
  return BUILTIN_BASE_THEME_VALUES.filter(theme => theme !== 'system').flatMap(theme => {
    if (theme.startsWith('openTubeX')) return SIGNAL_ACCENT_PRESETS.map(({ color }) => ({ theme, mutation: 'setSignalAccentColor', color }))
    if (theme.startsWith('material')) return MATERIAL_SEED_PRESETS.map(({ color }) => ({ theme, mutation: 'setMaterialSeedColor', color }))
    if (FIXED_COLOR_BASE_THEMES.includes(theme)) return [{ theme }]
    return mainColors.map(color => ({ theme, mutation: 'setMainColor', color }))
  })
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

    test('seekbar progress keeps a subtle accent tint and SponsorBlock categories remain visible', async ({ app, page }) => {
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
      // The default red accent tints the neutral progress fill.
      expect(played[0] - played[1], `red progress: ${played}`).toBeGreaterThanOrEqual(10)
      expect(played[0] - played[2], `red progress: ${played}`).toBeGreaterThanOrEqual(10)
      expect(Math.min(...played), `soft red progress: ${played}`).toBeGreaterThanOrEqual(180)
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
      const { foreground: iconColor } = await renderedColors(icon)
      expect.soft(contrastRatio(iconColor, select.surface), `reset icon ${JSON.stringify({ iconColor, surface: select.surface })}`).toBeGreaterThanOrEqual(3)
      const search = await controlContrast(app, page.locator('.settingsSearch'), 'field')
      expect.soft(search.ratio, `search ${JSON.stringify(search)}`).toBeGreaterThanOrEqual(3)
      await expect(page.getByRole('combobox', { name: /Main color theme/i })).toHaveCount(0)
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
      // Quarter-pixel steps reach every device pixel the outline covers; whole
      // CSS pixels are 1.25 device pixels apart at 125% and can skip one.
      const points = await label.evaluate((element, checked) => {
        const rect = element.getBoundingClientRect()
        const thumb = element.querySelector('.switch-thumb').getBoundingClientRect()
        const x = (checked ? thumb.left : thumb.right) - rect.left
        const y = thumb.top - rect.top + thumb.height / 2
        return Array.from({ length: 13 }, (_, index) => [x - 1.5 + index / 4, y])
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
      const rgb = color => color.match(/-?[\d.]+(?:e[-+]?\d+)?/gi).slice(0, 3).map(Number).map(value => color.startsWith('color(srgb ') ? value * 255 : value)
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
        const rgba = color => color.match(/-?[\d.]+(?:e[-+]?\d+)?/gi).map(Number)
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
    const colors = await button.evaluate(async element => {
      // Sample the settled hover colors, not a frame of their fade.
      await Promise.all(element.getAnimations().map(animation => animation.finished))
      const style = getComputedStyle(element)
      const rgb = color => color.match(/-?[\d.]+(?:e[-+]?\d+)?/gi).slice(0, 3).map(Number).map(value => color.startsWith('color(srgb ') ? value * 255 : value)
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

// The main and secondary color pickers offer every color in this list.
const THEME_COLORS = [
  ...readFileSync(path.join(repoRoot, 'src/renderer/helpers/colors.js'), 'utf8').matchAll(/\bname: '(\w+)'/g)
].map(([, name]) => name).concat(CATPPUCCIN_MACCHIATO_COLORS.map(({ name }) => name))

test.describe('main color text contrast', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('text on every main color stays readable on primary controls', async ({ page }) => {
    const privacy = await goToSettingsSection(page, 'privacy')
    // Matching entries enable the primary Set Password button, which is tonal.
    await privacy.getByLabel('Password', { exact: true }).fill('contrast')
    await privacy.getByLabel('Confirm password', { exact: true }).fill('contrast')
    const button = privacy.getByRole('button', { name: 'Set Password', exact: true })
    await expect(button).toBeEnabled()
    await expect(button).toHaveClass(/\bvariant-tonal\b/)
    // Measure it pressed, its state with the strongest overlay.
    await button.evaluate(element => { element.dataset.contrastTarget = '' })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-contrast-target]' })
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] })
    // Enabled header toggles use the selected-container color pair.
    const toggle = page.getByRole('button', { name: 'Highlight settings changed from defaults', exact: true })
    if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.activeElement?.blur())

    expect(THEME_COLORS.length).toBeGreaterThan(90)
    const targets = { button: await button.elementHandle(), toggle: await toggle.elementHandle() }
    for (const baseTheme of ['light', 'dark']) {
      await page.evaluate(theme => window.$store.dispatch('updateBaseTheme', theme), baseTheme)
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${baseTheme}\\b`))
      // Swap the class the app applies for the main color setting directly;
      // saving the setting for every color exceeds the test timeout.
      const results = await page.evaluate(({ names, button, toggle }) => {
        const rgb = color => color.match(/-?[\d.]+(?:e[-+]?\d+)?/gi).slice(0, 3).map(Number).map(value => color.startsWith('color(srgb ') ? value * 255 : value)
        const probe = document.createElement('span')
        probe.style.color = 'var(--text-with-main-color)'
        probe.style.backgroundColor = 'var(--primary-color)'
        document.body.append(probe)
        const measure = element => {
          const style = getComputedStyle(element)
          return { foreground: rgb(style.color), background: rgb(style.backgroundColor) }
        }
        const results = names.map(name => {
          const { classList } = document.body
          classList.remove(...[...classList].filter(className => /^main[A-Z]/.test(className)))
          classList.add(`main${name}`)
          // Start the color transitions, then read their settled colors.
          for (const element of [button, toggle]) measure(element)
          // Looping animations, such as spinners, can't finish and would throw
          for (const animation of document.getAnimations()) {
            if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish()
          }
          return { name, palette: measure(probe), 'pressed button': measure(button), 'selected toggle': measure(toggle) }
        })
        probe.remove()
        return results
      }, { names: THEME_COLORS, ...targets })
      // Each class applies its own primary color.
      expect(new Set(results.map(({ palette }) => `${palette.background}`)).size).toBeGreaterThan(90)
      for (const { name, ...colors } of results) {
        for (const [label, { foreground, background }] of Object.entries(colors)) {
          expect.soft(contrastRatio(foreground, background), `${baseTheme} ${name} ${label} ${JSON.stringify({ foreground, background })}`)
            .toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})

/**
 * Apply every main or secondary color class and measure its text on the hover
 * and pressed state colors, plus `elements` in their current state.
 */
async function measureStateColors(page, prefix, elements = {}) {
  const [text, fill] = prefix === 'main'
    ? ['--text-with-main-color', '--primary-color']
    : ['--text-with-accent-color', '--accent-color']
  return page.evaluate(({ names, prefix, text, fill, elements }) => {
    const rgb = color => color.match(/-?[\d.]+(?:e[-+]?\d+)?/gi).slice(0, 3).map(Number).map(value => color.startsWith('color(srgb ') ? value * 255 : value)
    const probes = Object.fromEntries(['hover', 'active'].map(state => {
      const probe = document.createElement('span')
      probe.style.color = `var(${text})`
      probe.style.backgroundColor = `var(${fill}-${state})`
      document.body.append(probe)
      return [state === 'active' ? 'pressed' : state, probe]
    }))
    const measure = element => {
      const style = getComputedStyle(element)
      return { foreground: rgb(style.color), background: rgb(style.backgroundColor) }
    }
    const pattern = new RegExp(`^${prefix}[A-Z]`)
    const results = names.map(name => {
      const { classList } = document.body
      classList.remove(...[...classList].filter(className => pattern.test(className)))
      classList.add(`${prefix}${name}`)
      // Start the color transitions, then read their settled colors.
      for (const element of Object.values(elements)) measure(element)
      // Looping animations, such as spinners, can't finish and would throw
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish()
      }
      return {
        name,
        ...Object.fromEntries(Object.entries({ ...probes, ...elements }).map(([label, element]) => [label, measure(element)]))
      }
    })
    for (const probe of Object.values(probes)) probe.remove()
    return results
  }, { names: THEME_COLORS, prefix, text, fill, elements })
}

test.describe('state color text contrast', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('text on every main and secondary color stays readable on hover and pressed fills', async ({ page }) => {
    await goToSettingsSection(page, 'privacy')
    // Enabled header toggles take the selected hover color on hover.
    const toggle = page.getByRole('button', { name: 'Highlight settings changed from defaults', exact: true })
    if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.activeElement?.blur())
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.settingsHeaderButton.active[aria-pressed="true"]' })
    expect(nodeId).toBeTruthy()
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] })
    const hoveredToggle = await toggle.elementHandle()

    expect(THEME_COLORS.length).toBeGreaterThan(90)
    for (const baseTheme of ['light', 'dark']) {
      await page.evaluate(theme => window.$store.dispatch('updateBaseTheme', theme), baseTheme)
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${baseTheme}\\b`))
      // Swap the classes the app applies for the color settings directly;
      // saving the settings for every color exceeds the test timeout.
      const results = {
        main: await measureStateColors(page, 'main', { 'hovered selected toggle': hoveredToggle }),
        secondary: await measureStateColors(page, 'sec'),
      }
      for (const [kind, colors] of Object.entries(results)) {
        // Each class applies its own state colors.
        expect(new Set(colors.map(({ pressed }) => `${pressed.background}`)).size).toBeGreaterThan(80)
        for (const { name, ...states } of colors) {
          for (const [label, { foreground, background }] of Object.entries(states)) {
            expect.soft(contrastRatio(foreground, background), `${baseTheme} ${kind} ${name} ${label} ${JSON.stringify({ foreground, background })}`)
              .toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
    // The forced hover fills the toggle with the selected hover color, not its rest color.
    const probe = await hoveredToggle.evaluateHandle(element => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--selected-container-hover-color)'
      element.after(probe)
      return probe
    })
    const [{ 'hovered selected toggle': hovered, 'selected hover': selectedHover }] = await measureStateColors(page, 'main', { 'hovered selected toggle': hoveredToggle, 'selected hover': probe })
    await probe.evaluate(element => element.remove())
    expect(hovered.background).toEqual(selectedHover.background)
  })
})

test.describe('secondary colors and main color states', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  // Controls filled with the main color take its text color, so a secondary
  // color must not swap in a hover or pressed fill of its own.
  test('leave the hover and pressed fills of the main color alone', async ({ page }) => {
    await goToSettingsSection(page, 'privacy')
    const changed = await page.evaluate(names => {
      const { classList } = document.body
      const read = () => {
        const style = getComputedStyle(document.body)
        return ['--primary-color-hover', '--primary-color-active'].map(name => style.getPropertyValue(name).trim()).join()
      }
      classList.remove(...[...classList].filter(className => /^(main|sec)[A-Z]/.test(className)))
      classList.add('mainDraculaPink')
      const main = read()
      return names.filter(name => {
        classList.add(`sec${name}`)
        const states = read()
        classList.remove(`sec${name}`)
        return states !== main
      })
    }, THEME_COLORS)
    expect(changed).toEqual([])
  })
})

test.describe('secondary color text contrast', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US', useProxy: true } } })

  test('text on every secondary color stays readable on accent-filled surfaces', async ({ page }) => {
    const advanced = await goToSettingsSection(page, 'proxy')
    // The proxy warning is filled with the accent color.
    const warning = advanced.locator('.proxy-warning')
    await expect(warning).toBeVisible()

    expect(THEME_COLORS.length).toBeGreaterThan(90)
    for (const baseTheme of ['light', 'dark']) {
      await page.evaluate(theme => window.$store.dispatch('updateBaseTheme', theme), baseTheme)
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${baseTheme}\\b`))
      // Swap the class the app applies for the secondary color setting directly;
      // saving the setting for every color exceeds the test timeout.
      const results = await warning.evaluate((warning, names) => {
        const rgb = color => color.match(/-?[\d.]+(?:e[-+]?\d+)?/gi).slice(0, 3).map(Number).map(value => color.startsWith('color(srgb ') ? value * 255 : value)
        const probe = document.createElement('span')
        probe.style.color = 'var(--text-with-accent-color)'
        probe.style.backgroundColor = 'var(--accent-color)'
        document.body.append(probe)
        const measure = element => {
          const style = getComputedStyle(element)
          return { foreground: rgb(style.color), background: rgb(style.backgroundColor) }
        }
        const results = names.map(name => {
          const { classList } = document.body
          classList.remove(...[...classList].filter(className => /^sec[A-Z]/.test(className)))
          classList.add(`sec${name}`)
          return { name, palette: measure(probe), 'proxy warning': measure(warning) }
        })
        probe.remove()
        return results
      }, THEME_COLORS)
      // Each class applies its own accent color.
      expect(new Set(results.map(({ palette }) => `${palette.background}`)).size).toBeGreaterThan(90)
      for (const { name, ...colors } of results) {
        for (const [label, { foreground, background }] of Object.entries(colors)) {
          expect.soft(contrastRatio(foreground, background), `${baseTheme} ${name} ${label} ${JSON.stringify({ foreground, background })}`)
            .toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})

test.describe('secondary color switch thumbs', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('checked switch thumbs stay light where they contrast with the accent track', async ({ page }) => {
    await goToSettingsSection(page, 'general')
    const toggle = page.getByRole('checkbox', { name: 'Keep relative timestamps updated' })
    if (!await toggle.isChecked()) await toggle.locator('..').locator('.switch-label').click()
    await expect(toggle).toBeChecked()

    for (const baseTheme of ['light', 'dark']) {
      await page.evaluate(theme => window.$store.dispatch('updateBaseTheme', theme), baseTheme)
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${baseTheme}\\b`))
      // Swap the class the app applies for the secondary color setting directly;
      // saving the setting for every color exceeds the test timeout.
      const results = await toggle.locator('..').locator('.switch-label-text').evaluate((text, names) => {
        const rgb = color => color.match(/-?[\d.]+(?:e[-+]?\d+)?/gi).slice(0, 3).map(Number).map(value => color.startsWith('color(srgb ') ? value * 255 : value)
        const thumb = text.querySelector('.switch-thumb')
        const measure = () => ({
          thumb: rgb(getComputedStyle(thumb).backgroundColor),
          track: rgb(getComputedStyle(text, '::before').backgroundColor),
        })
        return names.map(name => {
          const { classList } = document.body
          classList.remove(...[...classList].filter(className => /^sec[A-Z]/.test(className)))
          classList.add(`sec${name}`)
          // Start the color transitions, then read their settled colors.
          measure()
          for (const animation of document.getAnimations()) {
            if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish()
          }
          return { name, ...measure() }
        })
      }, THEME_COLORS)
      for (const { name, thumb, track } of results) {
        expect.soft(contrastRatio(thumb, track), `${baseTheme} ${name} ${JSON.stringify({ thumb, track })}`)
          .toBeGreaterThanOrEqual(3)
      }
      // The thumb is a graphic, so it needs 3:1 rather than the 4.5:1 that
      // pushed text on these colors to black.
      const thumbs = Object.fromEntries(results.map(({ name, thumb }) => [name, thumb]))
      for (const name of ['Blue', 'Red', 'Pink', 'Teal']) {
        expect.soft(thumbs[name], `${baseTheme} ${name}`).toEqual([255, 255, 255])
      }
      for (const name of ['GruvboxLightOrange', 'GruvboxLightBlue', 'GruvboxLightPurple']) {
        expect.soft(thumbs[name], `${baseTheme} ${name}`).toEqual([251, 241, 199])
      }
    }
    // Custom themes keep their own text color on their own accent.
    const customThumb = await toggle.locator('..').locator('.switch-thumb').evaluate(thumb => {
      const { classList, style } = document.body
      classList.remove(...[...classList].filter(className => /^sec[A-Z]/.test(className)))
      classList.add('custom', 'secBlue')
      style.setProperty('--text-with-accent-color', 'rgb(1, 2, 3)')
      const read = () => getComputedStyle(thumb).backgroundColor
      // Start the color transition, then read its settled color.
      read()
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish()
      }
      return read()
    })
    expect(customThumb).toBe('rgb(1, 2, 3)')
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

test.describe('selected tab label contrast', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('selected labels stay readable on their tint in every theme and accent', async ({ page }) => {
    test.slow()
    const combos = tintedSelectionCombos()

    await goToSettingsSection(page, 'data')
    const tab = page.locator('.settingsWindow [data-settings-tab="data"]')
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await tab.blur()

    // Hover adds a fill, so recheck the combinations closest to the limit at rest.
    const hoverCombos = combos.filter(({ theme, color }) =>
      ['gruvboxDark', 'gruvboxLight', 'pastelPink', 'hotPink'].includes(theme) || (['light', 'dark'].includes(theme) && color === 'Yellow'))
    const failures = []
    for (const [state, stateCombos] of [['rest', combos], ['hover', hoverCombos]]) {
      if (state === 'hover') await tab.hover()
      else await page.mouse.move(0, 0)
      const results = await tab.evaluate(async (tab, combos) => {
        const context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
        // Composite the layers like the renderer, so any color syntax resolves to sRGB bytes.
        const paint = layers => {
          context.globalAlpha = 1
          context.fillStyle = '#fff'
          context.fillRect(0, 0, 1, 1)
          for (const [color, alpha = 1] of layers) {
            context.globalAlpha = alpha
            context.fillStyle = color
            context.fillRect(0, 0, 1, 1)
          }
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
        }
        const ancestors = []
        for (let node = tab.parentElement; node; node = node.parentElement) ancestors.unshift(node)
        const results = []
        // Skip persistence: the theme watcher applies committed values on the next tick.
        for (const { theme, mutation, color } of combos) {
          window.$store.commit('setBaseTheme', theme)
          if (mutation) window.$store.commit(mutation, color)
          await new Promise(resolve => setTimeout(resolve))
          document.getAnimations().forEach(animation => animation.effect?.getComputedTiming().endTime !== Infinity && animation.finish())
          const highlight = getComputedStyle(tab, '::before')
          // The highlight sits below the tab's own hover fill.
          const background = paint([
            ...ancestors.map(node => [getComputedStyle(node).backgroundColor]),
            [highlight.backgroundColor, Number(highlight.opacity)],
            [getComputedStyle(tab).backgroundColor],
          ])
          results.push({ theme, color, foreground: paint([[getComputedStyle(tab).color]]), background })
        }
        return results
      }, stateCombos)
      for (const { theme, color, foreground, background } of results) {
        const ratio = contrastRatio(foreground, background)
        if (ratio < 4.5) failures.push(`${state} ${theme} ${color ?? ''} ${ratio.toFixed(2)}:1 ${JSON.stringify({ foreground, background })}`)
      }
    }
    expect(failures).toEqual([])
  })

  test('selected settings categories keep their title and description readable in every theme and accent', async ({ page }) => {
    test.slow()
    const combos = tintedSelectionCombos()
    await goToSettingsSection(page, 'theme')
    const category = page.locator('.settingsMenu .title.active')
    const failures = []
    for (const state of ['rest', 'hover']) {
      if (state === 'hover') await category.hover()
      else await page.mouse.move(0, 0)
      const results = await category.evaluate(async (category, combos) => {
        const context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
        // Composite the layers like the renderer, so any color syntax resolves to sRGB bytes.
        const paint = layers => {
          context.fillStyle = '#fff'
          context.fillRect(0, 0, 1, 1)
          for (const color of layers) {
            context.fillStyle = color
            context.fillRect(0, 0, 1, 1)
          }
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
        }
        const layers = []
        for (let node = category; node; node = node.parentElement) layers.unshift(node)
        const results = []
        // Skip persistence: the theme watcher applies committed values on the next tick.
        for (const { theme, mutation, color } of combos) {
          window.$store.commit('setBaseTheme', theme)
          if (mutation) window.$store.commit(mutation, color)
          await new Promise(resolve => setTimeout(resolve))
          document.getAnimations().forEach(animation => animation.effect?.getComputedTiming().endTime !== Infinity && animation.finish())
          const background = paint(layers.map(node => getComputedStyle(node).backgroundColor))
          for (const part of ['titleText', 'titleDescription']) {
            results.push({ theme, color, part, foreground: paint([getComputedStyle(category.querySelector(`.${part}`)).color]), background })
          }
        }
        return results
      }, combos)
      for (const { theme, color, part, foreground, background } of results) {
        const ratio = contrastRatio(foreground, background)
        if (ratio < 4.5) failures.push(`${state} ${theme} ${color ?? ''} ${part} ${ratio.toFixed(2)}:1 ${JSON.stringify({ foreground, background })}`)
      }
    }
    expect(failures).toEqual([])
  })
})

/** Label, icon and composited background of a context menu item in each theme and accent. */
function menuItemColors(item, combos) {
  return item.evaluate(async (item, combos) => {
    const context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
    // Composite the layers like the renderer, so any color syntax resolves to sRGB bytes.
    const paint = layers => {
      context.globalAlpha = 1
      context.fillStyle = '#fff'
      context.fillRect(0, 0, 1, 1)
      for (const color of layers) {
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
      }
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const results = []
    // Skip persistence: the theme watcher applies committed values on the next tick.
    for (const { theme, mutation, color } of combos) {
      window.$store.commit('setBaseTheme', theme)
      if (mutation) window.$store.commit(mutation, color)
      await new Promise(resolve => setTimeout(resolve))
      document.getAnimations().forEach(animation => animation.effect?.getComputedTiming().endTime !== Infinity && animation.finish())
      const layers = []
      for (let node = item; node; node = node.parentElement) {
        if (node.classList.contains('contextMenu')) layers.unshift(getComputedStyle(node, '::before').backgroundColor)
        layers.unshift(getComputedStyle(node).backgroundColor)
      }
      results.push({
        theme,
        color,
        foreground: paint([getComputedStyle(item).color]),
        icon: paint([getComputedStyle(item.querySelector('.itemIcon')).color]),
        background: paint(layers),
      })
    }
    return results
  }, combos)
}

test.describe('context menu item contrast', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  async function openTabMenu(page) {
    const tab = page.locator('.tabBar .tab.active')
    const tabBox = await tab.boundingBox()
    await page.mouse.click(tabBox.x + 24, tabBox.y + tabBox.height / 2, { button: 'right' })
    return page.locator('.contextMenu')
  }

  test('selected menu items stay readable on their tint in every theme and accent', async ({ page }) => {
    test.slow()
    const combos = tintedSelectionCombos()
    const menu = await openTabMenu(page)
    const trigger = menu.getByRole('menuitem', { name: 'Move Tab to Group', exact: true })
    await trigger.hover()
    // A new tab is ungrouped, so this row is the selected one
    const item = menu.getByRole('menuitemradio', { name: 'Ungrouped', exact: true })
    await expect(item).toHaveAttribute('aria-checked', 'true')
    await expect(item).toBeVisible()

    const failures = []
    for (const state of ['rest', 'hover']) {
      if (state === 'hover') await item.hover()
      for (const { theme, color, foreground, background } of await menuItemColors(item, combos)) {
        const ratio = contrastRatio(foreground, background)
        if (ratio < 4.5) failures.push(`${state} ${theme} ${color ?? ''} ${ratio.toFixed(2)}:1 ${JSON.stringify({ foreground, background })}`)
      }
    }
    expect(failures).toEqual([])
  })

  // Icons take an accent tone, and the hover layer is tinted with it.
  test('menu icons stand out and labels stay readable on hover in every theme and accent', async ({ page }) => {
    test.slow()
    const combos = tintedSelectionCombos()
    const menu = await openTabMenu(page)
    const item = menu.getByRole('menuitem', { name: 'Move Tab to Group', exact: true })
    await expect(item).toBeVisible()

    const failures = []
    for (const state of ['rest', 'hover']) {
      if (state === 'hover') await item.hover()
      for (const { theme, color, foreground, icon, background } of await menuItemColors(item, combos)) {
        const iconRatio = contrastRatio(icon, background)
        if (iconRatio < 3) failures.push(`${state} icon ${theme} ${color ?? ''} ${iconRatio.toFixed(2)}:1 ${JSON.stringify({ icon, background })}`)
        const labelRatio = contrastRatio(foreground, background)
        if (labelRatio < 4.5) failures.push(`${state} label ${theme} ${color ?? ''} ${labelRatio.toFixed(2)}:1 ${JSON.stringify({ foreground, background })}`)
      }
    }
    expect(failures).toEqual([])
  })
})

test.describe('hover surface contrast', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  // Side navigation entries and pressed phone cards put the hover text color on the hover color.
  test('hover text stays readable on the hover color in every theme', async ({ page }) => {
    const results = await page.evaluate(async themes => {
      const context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
      const paint = color => {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
      }
      const probe = document.createElement('span')
      probe.style.color = 'var(--side-nav-hover-text-color)'
      probe.style.backgroundColor = 'var(--side-nav-hover-color)'
      document.body.append(probe)
      const results = []
      for (const theme of themes) {
        window.$store.commit('setBaseTheme', theme)
        await new Promise(resolve => setTimeout(resolve))
        const style = getComputedStyle(probe)
        results.push({ theme, foreground: paint(style.color), background: paint(style.backgroundColor) })
      }
      probe.remove()
      return results
    }, BUILTIN_BASE_THEME_VALUES.filter(theme => theme !== 'system'))
    expect(results.length).toBeGreaterThan(40)
    const failures = results.filter(({ foreground, background }) => contrastRatio(foreground, background) < 4.5)
      .map(({ theme, foreground, background }) => `${theme} ${contrastRatio(foreground, background).toFixed(2)}:1`)
    expect(failures).toEqual([])
  })
})

test.describe('filled button state contrast', () => {
  test.use({ seed: { settings: { baseTheme: 'light', mainColor: 'Pink', currentLocale: 'en-US' } } })

  test('filled buttons keep their label readable on hover and when pressed', async ({ page }) => {
    await page.evaluate(() => window.$store.dispatch(
      'showCreatePlaylistPrompt', { title: '', description: '', sourcePlaylistId: null }
    ))
    await page.locator('.playlistNameInput input').fill('Filled button states')
    await page.locator('.promptCard .btn.primary').first().evaluate(element => {
      element.classList.replace('variant-tonal', 'variant-filled')
      element.dataset.stateTest = ''
      element.addEventListener('click', event => {
        event.preventDefault()
        event.stopImmediatePropagation()
      }, true)
    })
    const button = page.locator('[data-state-test]')
    await expect(button).toBeEnabled()
    // The settled fill, label and state shades as rendered sRGB channels. The fill
    // animates, and mid-transition colors compute to syntaxes like oklab().
    const colors = () => button.evaluate(element => {
      const context = document.createElement('canvas').getContext('2d')
      const channels = color => {
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
      }
      const styles = getComputedStyle(element)
      return {
        settled: element.getAnimations().length === 0,
        foreground: channels(styles.color),
        background: channels(styles.backgroundColor),
        hover: channels(styles.getPropertyValue('--button-hover')),
        active: channels(styles.getPropertyValue('--button-active')),
      }
    })
    // Waits for the fill to settle on a state shade, then returns the label contrast.
    const settledRatio = async (shade, message) => {
      let ratio
      await expect.poll(async () => {
        const { settled, foreground, background, [shade]: expected } = await colors()
        ratio = contrastRatio(foreground, background)
        return settled && background.join() === expected.join()
      }, { message }).toBe(true)
      return ratio
    }

    for (const theme of ['primary', 'destructive']) {
      // Keep the rendered component's scoped styles while exercising its theme.
      await button.evaluate((element, theme) => element.classList.replace('primary', theme), theme)
      await button.hover()
      expect(await settledRatio('hover', `${theme} hover`), `${theme} hover`).toBeGreaterThanOrEqual(4.5)
      await page.mouse.down()
      try {
        expect(await settledRatio('active', `${theme} pressed`), `${theme} pressed`).toBeGreaterThanOrEqual(4.5)
      } finally {
        await page.mouse.up()
        await page.mouse.move(0, 0)
      }
    }
  })
})

test.describe('destructive button colors', () => {
  test.use({ seed: { settings: { baseTheme: 'dark', mainColor: 'Red', secColor: 'Purple', currentLocale: 'en-US' } } })

  test('destructive actions stay red when the main color is red', async ({ page }) => {
    const body = page.locator('body')
    await expect(body).toHaveClass(/\bmainRed\b/)
    await expect(body).toHaveClass(/\bsecPurple\b/)
    await expect(body).toHaveCSS('--destructive-color', '#f44336')
  })

  test('error text stays red and readable on every surface in every theme and accent', async ({ page }) => {
    test.slow()
    const combos = tintedSelectionCombos()
    const results = await page.evaluate(async combos => {
      const context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
      // Composite the layers like the renderer, so any color syntax resolves to sRGB bytes.
      const paint = layers => {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, 1, 1)
        for (const color of layers) {
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
        }
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
      }
      const probe = document.createElement('span')
      document.body.append(probe)
      const resolve = value => {
        probe.style.color = value
        return getComputedStyle(probe).color
      }
      const results = []
      // Skip persistence: the theme watcher applies committed values on the next tick.
      for (const { theme, mutation, color } of combos) {
        window.$store.commit('setBaseTheme', theme)
        if (mutation) window.$store.commit(mutation, color)
        await new Promise(resolve => setTimeout(resolve))
        const surfaces = ['--bg-color', '--card-bg-color', '--secondary-card-bg-color'].map(name => resolve(`var(${name})`))
        results.push({
          theme,
          color,
          text: paint([resolve('var(--error-text-color)')]),
          // Cards sit on the page and secondary cards on cards; some are translucent.
          surfaces: { page: paint(surfaces.slice(0, 1)), card: paint(surfaces.slice(0, 2)), 'secondary card': paint(surfaces) }
        })
      }
      probe.remove()
      return results
    }, combos)
    const failures = []
    for (const { theme, color, text, surfaces } of results) {
      for (const [surface, background] of Object.entries(surfaces)) {
        const ratio = contrastRatio(text, background)
        if (ratio < 4.5) failures.push(`${theme} ${color ?? ''} ${surface} ${ratio.toFixed(2)}:1 ${JSON.stringify({ text, background })}`)
      }
      // A pink card leaves no room for red text, so it uses the text color there.
      const [red, green, blue] = text
      if (theme !== 'hotPink' && !(red > green + 40 && red > blue + 40)) failures.push(`${theme} ${color ?? ''} error text is not red ${JSON.stringify(text)}`)
    }
    expect(failures).toEqual([])
  })

  test('tonal destructive buttons stay red and readable in every theme and accent', async ({ page }) => {
    test.slow()
    const combos = tintedSelectionCombos()
    const privacy = await goToSettingsSection(page, 'privacy')
    // Matching entries enable the tonal Set Password button; give it the destructive theme.
    await privacy.getByLabel('Password', { exact: true }).fill('contrast')
    await privacy.getByLabel('Confirm password', { exact: true }).fill('contrast')
    const button = privacy.getByRole('button', { name: 'Set Password', exact: true })
    await expect(button).toBeEnabled()
    await expect(button).toHaveClass(/\bvariant-tonal\b/)
    await button.evaluate(element => {
      element.classList.replace('primary', 'destructive')
      element.dataset.contrastTarget = ''
    })
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.activeElement?.blur())
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-contrast-target]' })
    const failures = []
    for (const state of ['rest', 'hover', 'active']) {
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: state === 'rest' ? [] : [state] })
      const results = await button.evaluate(async (button, combos) => {
        const context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
        // Composite the layers like the renderer, so any color syntax resolves to sRGB bytes.
        const paint = layers => {
          context.fillStyle = '#fff'
          context.fillRect(0, 0, 1, 1)
          for (const color of layers) {
            context.fillStyle = color
            context.fillRect(0, 0, 1, 1)
          }
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
        }
        const layers = []
        for (let node = button; node; node = node.parentElement) layers.unshift(node)
        const results = []
        // Skip persistence: the theme watcher applies committed values on the next tick.
        for (const { theme, mutation, color } of combos) {
          window.$store.commit('setBaseTheme', theme)
          if (mutation) window.$store.commit(mutation, color)
          await new Promise(resolve => setTimeout(resolve))
          document.getAnimations().forEach(animation => animation.effect?.getComputedTiming().endTime !== Infinity && animation.finish())
          const style = getComputedStyle(button)
          results.push({
            theme,
            color,
            foreground: paint([style.color]),
            icon: paint([getComputedStyle(button.querySelector(':scope > .ft-icon')).color]),
            text: paint([style.getPropertyValue('--primary-text-color')]),
            background: paint(layers.map(node => getComputedStyle(node).backgroundColor))
          })
        }
        return results
      }, combos)
      for (const { theme, color, foreground, icon, text, background } of results) {
        const label = `${state} ${theme} ${color ?? ''}`
        const ratio = contrastRatio(foreground, background)
        if (ratio < 4.5) failures.push(`${label} label ${ratio.toFixed(2)}:1 ${JSON.stringify({ foreground, background })}`)
        const iconRatio = contrastRatio(icon, background)
        if (iconRatio < 3) failures.push(`${label} icon ${iconRatio.toFixed(2)}:1 ${JSON.stringify({ icon, background })}`)
        if (foreground.join() === text.join()) failures.push(`${label} label uses the plain text color`)
        // A pink card leaves no room for a red icon, so it matches the label there.
        const [red, green, blue] = icon
        if (theme !== 'hotPink' && !(red > green + 60 && red > blue + 60)) failures.push(`${label} icon is not red ${JSON.stringify(icon)}`)
      }
    }
    expect(failures).toEqual([])
  })
})
