import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dynamicThemeColors, applyDynamicColors } from '../../src/renderer/helpers/dynamicColors.js'
import { hasFixedThemeColors, resolveBaseTheme, resolveSystemTheme } from '../../src/appearanceSettings.js'

function palette() {
  return Object.fromEntries(['accent1', 'accent2', 'accent3', 'neutral1', 'neutral2'].map((family, i) => [
    family,
    Object.fromEntries([0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
      .map(tone => [tone, `#${(i * 10000 + tone).toString(16).padStart(6, '0')}`]))
  ]))
}

test('dynamic themes survive settings repair and do not expose manual accents', () => {
  assert.equal(resolveBaseTheme('dynamic', 'system'), 'dynamic')
  assert.equal(hasFixedThemeColors('dynamic'), true)
  assert.equal(resolveSystemTheme('dynamic', 'light'), 'light')
  assert.equal(resolveSystemTheme('dynamic', 'dark'), 'dark')
})

test('dynamic palettes use contrasting tones in light and dark mode', () => {
  const colors = palette()
  const light = dynamicThemeColors(colors, false)
  const dark = dynamicThemeColors(colors, true)
  assert.equal(light.background, colors.neutral1[50])
  assert.equal(light.primaryText, colors.neutral1[900])
  assert.equal(light.primary, colors.accent1[600])
  assert.equal(light.textWithPrimary, colors.accent1[0])
  assert.equal(dark.background, colors.neutral1[900])
  assert.equal(dark.primaryText, colors.neutral1[100])
  assert.equal(dark.primary, colors.accent1[200])
  assert.equal(dark.textWithPrimary, colors.accent1[800])
  assert.equal(dark.link, colors.accent3[200])
  for (const value of Object.values({...light, ...dark})) assert.match(value, /^#[0-9a-f]{6}$/)
})

test('palette refresh updates existing CSS properties and RGB accents', (t) => {
  const properties = new Map()
  const original = globalThis.document
  globalThis.document = { body: { style: { setProperty: (key, value) => properties.set(key, value) } } }
  t.after(() => { globalThis.document = original })
  const colors = palette()
  applyDynamicColors(colors, false)
  assert.equal(properties.get('--bg-color'), colors.neutral1[50])
  colors.accent3[200] = '#abcdef'
  applyDynamicColors(colors, true)
  assert.equal(properties.get('--bg-color'), colors.neutral1[900])
  assert.equal(properties.get('--accent-color-rgb'), '171 205 239')
})

test('switching back from dynamic colors or a custom-theme preview restores the selected theme', async (t) => {
  const { applyThemeToDocument } = await import('../../src/renderer/helpers/customTheme.js')
  const { androidDynamicColors } = await import('../../src/renderer/helpers/dynamicColors.js')
  const properties = new Map()
  const classes = new Set()
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window
  globalThis.document = { body: {
    style: {
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: key => properties.delete(key),
    },
    classList: {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
    },
    dataset: {},
  } }
  let dark = false
  globalThis.window = { matchMedia: () => ({ matches: dark }) }
  androidDynamicColors.value = { supported: true, palette: palette() }
  t.after(() => {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
    androidDynamicColors.value = { supported: false }
  })
  applyThemeToDocument('dynamic', 'Red', 'Blue', null)
  assert.equal(classes.has('light'), true)
  assert.equal(classes.has('dynamicColors'), true)
  assert.equal(properties.get('--bg-color'), palette().neutral1[50])
  dark = true
  applyThemeToDocument('dynamic', 'Red', 'Blue', null)
  assert.equal(classes.has('dark'), true)
  assert.equal(classes.has('light'), false)
  assert.equal(properties.get('--bg-color'), palette().neutral1[900])
  applyThemeToDocument('light', 'Red', 'Blue', null)
  assert.equal(classes.has('dynamicColors'), false)
  assert.equal(properties.has('--bg-color'), false)
  assert.equal(properties.has('--accent-color-rgb'), false)
  assert.equal(classes.has('light'), true)
  applyThemeToDocument('dynamic', 'Red', 'Blue', null)
  assert.equal(properties.get('--primary-color'), palette().accent1[200])
})

function contrast(first, second) {
  const luminance = hex => hex.slice(1).match(/../g).map(channel => {
    const value = parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

// Android tonal shades specify perceptual lightness, independent of palette hue.
function neutralTonalPalette() {
  const shades = Object.fromEntries(Object.keys(palette().neutral1).map(shade => {
    const lightness = 100 - Number(shade) / 10
    const linear = lightness > 8 ? ((lightness + 16) / 116) ** 3 : lightness / 903.3
    const srgb = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
    return [shade, '#' + Math.round(srgb * 255).toString(16).padStart(2, '0').repeat(3)]
  }))
  return Object.fromEntries(Object.keys(palette()).map(family => [family, shades]))
}

for (const dark of [false, true]) {
  test(`dynamic ${dark ? 'dark' : 'light'} controls and text meet contrast thresholds`, () => {
    const colors = dynamicThemeColors(neutralTonalPalette(), dark)
    assert.notEqual(colors.searchBar, colors.cardBackground, 'Fields must have a distinct fill')
    const surfaces = ['background', 'cardBackground', 'secondaryCardBackground', 'searchBar', 'settingsSearchBar', 'subtleSurface', 'dropdownHover', 'sideNavHover']
    for (const background of surfaces) {
      for (const foreground of ['primaryText', 'secondaryText', 'tertiaryText', 'link', 'linkVisited', 'error']) {
        assert.ok(contrast(colors[foreground], colors[background]) >= 4.5, `${foreground} on ${background}`)
      }
      for (const foreground of ['border', 'scrollbar', 'scrollbarHover', 'scrollbarActive', 'accent']) {
        assert.ok(contrast(colors[foreground], colors[background]) >= 3, `${foreground} on ${background}`)
      }
    }
    for (const [foreground, backgrounds] of [
      ['textWithPrimary', ['primary', 'primaryHover', 'primaryActive', 'coloredHeaderHover', 'coloredHeaderPressed']],
      ['textWithAccent', ['accent', 'accentHover', 'accentActive', 'accentLight']],
      ['destructiveText', ['destructive', 'destructiveHover', 'destructiveActive']],
    ]) {
      for (const background of backgrounds) assert.ok(contrast(colors[foreground], colors[background]) >= 4.5, `${foreground} on ${background}`)
    }
    assert.ok(contrast('#eeeeee', colors.primaryInput) >= 4.5, 'Colored header search text')
  })
}
