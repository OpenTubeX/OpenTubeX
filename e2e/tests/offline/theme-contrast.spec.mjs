import path from 'node:path'
import { readFileSync } from 'node:fs'

import { test, expect, goToSettingsSection, repoRoot } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { BUILTIN_BASE_THEME_VALUES, CATPPUCCIN_MACCHIATO_COLORS, FIXED_COLOR_BASE_THEMES } from '../../../src/constants.js'
import { MATERIAL_SEED_PRESETS } from '../../../src/materialTheme.js'
import { SIGNAL_ACCENT_PRESETS } from '../../../src/signalTheme.js'

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
            .toBeGreaterThanOrEqual(label === 'palette' && foreground.every(channel => channel === 255) ? 3 : 4.5)
        }
      }
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
