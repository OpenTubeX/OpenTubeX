import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hct, argbFromHex } from '@material/material-color-utilities'
import { dynamicThemeColors, applyDynamicColors, initializeAndroidDynamicColors, androidDynamicColors, desktopSystemAccentColor, getMaterialPalette } from '../../src/renderer/helpers/dynamicColors.js'
import { DEFAULT_MATERIAL_SEED_COLOR, MATERIAL_SYSTEM_SEED, MATERIAL_THEME_VALUES, MATERIAL_SEED_PRESETS, materialColorScheme, materialStateColor, materialSeedPalette, materialThemeMode, normalizeMaterialSeedColor, normalizeSystemAccentColor } from '../../src/materialTheme.js'
import { hasFixedThemeColors, resolveBaseTheme, resolveSystemTheme } from '../../src/appearanceSettings.js'

function palette() {
  return materialSeedPalette()
}

test('native accent colors accept Windows, macOS and Linux hexadecimal formats', () => {
  for (const value of ['895AA2FF', '#895AA2FF', '895AA2', '#895AA2']) {
    assert.equal(normalizeSystemAccentColor(value), '#895aa2')
  }
  assert.equal(normalizeSystemAccentColor('000000ff'), '#000000')
  for (const value of [null, undefined, {}, '', 'red', '#123', '#12345gff', '#1234560000', '00000000']) {
    assert.equal(normalizeSystemAccentColor(value), null)
  }
})

test('only Dynamic colors uses system colors, with a saved-seed fallback', t => {
  t.after(() => {
    desktopSystemAccentColor.value = null
    androidDynamicColors.value = { supported: false }
  })
  const manual = '#ffff00'
  desktopSystemAccentColor.value = '#895aa2'
  assert.deepEqual(getMaterialPalette(manual, 'dynamic'), materialSeedPalette('#895aa2'))
  for (const theme of ['materialLight', 'materialDark', 'materialBlack']) {
    assert.deepEqual(getMaterialPalette(manual, theme), materialSeedPalette(manual))
  }
  desktopSystemAccentColor.value = '#006a6a'
  assert.deepEqual(getMaterialPalette(manual, 'dynamic'), materialSeedPalette('#006a6a'))
  desktopSystemAccentColor.value = null
  assert.deepEqual(getMaterialPalette(manual, 'dynamic'), materialSeedPalette(manual))
  const androidPalette = materialSeedPalette('#386a20')
  androidDynamicColors.value = { supported: true, palette: androidPalette }
  desktopSystemAccentColor.value = '#006a6a'
  assert.deepEqual(getMaterialPalette(manual, 'dynamic'), androidPalette)
  for (const theme of ['materialLight', 'materialDark', 'materialBlack']) {
    assert.deepEqual(getMaterialPalette(manual, theme), materialSeedPalette(manual))
    assert.deepEqual(getMaterialPalette(MATERIAL_SYSTEM_SEED, theme), androidPalette)
  }
  androidDynamicColors.value = { supported: false }
  desktopSystemAccentColor.value = null
  assert.deepEqual(getMaterialPalette(MATERIAL_SYSTEM_SEED, 'materialDark'), materialSeedPalette(DEFAULT_MATERIAL_SEED_COLOR))
  assert.equal(normalizeMaterialSeedColor(MATERIAL_SYSTEM_SEED), MATERIAL_SYSTEM_SEED)
})

test('dynamic themes survive settings repair and do not expose manual accents', () => {
  assert.equal(resolveBaseTheme('dynamic', 'system'), 'dynamic')
  assert.equal(hasFixedThemeColors('dynamic'), true)
  assert.equal(resolveSystemTheme('dynamic', 'light'), 'light')
  assert.equal(resolveSystemTheme('dynamic', 'dark'), 'dark')
})

test('dynamic palettes map Material surface and content roles in both appearances', () => {
  const paletteColors = palette()
  for (const dark of [false, true]) {
    const colors = dynamicThemeColors(paletteColors, dark)
    const roles = materialColorScheme(paletteColors, dark)
    assert.equal(colors.background, roles.surface)
    assert.equal(colors.cardBackground, roles.surfaceContainerLow)
    assert.equal(colors.instanceMenu, roles.surfaceContainerHigh)
    assert.equal(colors.searchBar, roles.surfaceContainerHighest)
    assert.equal(colors.primaryText, roles.onSurface)
    assert.equal(colors.primary, roles.primary)
    assert.equal(colors.textWithPrimary, roles.onPrimary)
    assert.equal(colors.accent, roles.secondary)
    assert.equal(colors.textWithAccent, roles.onSecondary)
    assert.equal(colors.sideNavActive, roles.secondaryContainer)
    assert.equal(colors.sideNavActiveText, roles.onSecondaryContainer)
    assert.notEqual(colors.sideNavHover, colors.sideNavActive, 'Hover does not look selected')
    assert.notEqual(colors.headerHover, colors.sideNavActive, 'Header hover does not look selected')
    for (const color of Object.values(colors)) assert.match(color, /^#[0-9a-f]{6}$/)
  }
})

test('palette refresh updates existing CSS properties and RGB accents', (t) => {
  const properties = new Map()
  const original = globalThis.document
  globalThis.document = { body: { style: { setProperty: (key, value) => properties.set(key, value) } } }
  t.after(() => { globalThis.document = original })
  const colors = palette()
  applyDynamicColors(colors, false)
  assert.equal(properties.get('--bg-color'), dynamicThemeColors(colors, false).background)
  colors.accent2[500] = '#abcdef'
  applyDynamicColors(colors, true)
  assert.equal(properties.get('--bg-color'), dynamicThemeColors(colors, true).background)
  assert.equal(properties.get('--accent-color-rgb'), dynamicThemeColors(colors, true).accent.slice(1).match(/../g).map(value => parseInt(value, 16)).join(' '))
  colors.neutral1[900] = '#000000'
  applyDynamicColors(colors, true)
  assert.equal(properties.get('--card-bg-color'), materialColorScheme(colors, true).surfaceContainerLow)
  colors.neutral1[900] = '#151515'
  applyDynamicColors(colors, true)
  assert.equal(properties.get('--card-bg-color'), materialColorScheme(colors, true).surfaceContainerLow)
})

test('LineageOS pure-black mode keeps the page black with distinguishable cards and menus', () => {
  const colors = neutralTonalPalette()
  // LineageOS's night overlay keeps raised tones gray but makes containers black.
  colors.neutral1[900] = '#000000'
  colors.neutral1[800] = '#171717'
  const dark = dynamicThemeColors(colors, true)
  for (const surface of ['background', 'sideNav']) {
    assert.equal(dark[surface], '#000000', surface)
  }
  assert.equal(dark.cardBackground, materialColorScheme(colors, true).surfaceContainerLow)
  assert.equal(dark.instanceMenu, materialColorScheme(colors, true).surfaceContainerHigh)
  assert.ok(contrast(dark.cardBackground, dark.background) >= 1.18, 'Cards have visible surface separation')
  assert.ok(contrast(dark.primaryText, dark.cardBackground) >= 4.5, 'Card text remains readable')
  assert.ok(contrast(dark.secondaryText, dark.cardBackground) >= 4.5, 'Secondary card text remains readable')
  assert.equal(dark.primary, materialColorScheme(colors, true).primary, 'Wallpaper accents are preserved')
  assert.notEqual(dark.dropdownHover, dark.background, 'Hover states remain distinguishable')
  assert.equal(dynamicThemeColors(colors, false).cardBackground, materialColorScheme(colors, false).surfaceContainerLow)
})

test('Material Black keeps expressive wallpaper neutrals from tinting surfaces', () => {
  // Android 17's expressive palettes give neutrals a strong hue, which made
  // Material Black cards and bars navy (#12183d) next to the black page.
  const chromatic = Object.fromEntries(Object.entries(materialSeedPalette('#4285f4')).map(([family, shades]) => [
    family,
    family.startsWith('neutral') ? materialSeedPalette('#12183d').accent1 : shades,
  ]))
  const colors = dynamicThemeColors(chromatic, true, true)
  const roles = materialColorScheme(chromatic, true, true)
  // Rounding to sRGB adds up to one unit of chroma near black.
  const chroma = hex => Hct.fromInt(argbFromHex(hex)).chroma - 1
  assert.equal(colors.background, '#000000')
  assert.equal(colors.sideNav, '#000000')
  for (const surface of ['cardBackground', 'secondaryCardBackground', 'searchBar', 'instanceMenu', 'subtleSurface']) {
    assert.ok(chroma(colors[surface]) <= 4, `${surface} stays neutral`)
    assert.ok(Hct.fromInt(argbFromHex(colors[surface])).tone <= 16, `${surface} stays near black`)
  }
  assert.ok(contrast(colors.cardBackground, colors.background) > 1, 'Cards remain distinguishable')
  for (const text of ['primaryText', 'secondaryText']) {
    assert.ok(chroma(colors[text]) <= 8, `${text} stays neutral`)
    assert.ok(contrast(colors[text], colors.searchBar) >= 4.5, `${text} remains readable`)
  }
  assert.ok(contrast(roles.outline, colors.background) >= 3, 'Outlines remain visible')
  assert.equal(colors.primary, materialColorScheme(chromatic, true).primary, 'Wallpaper accents are preserved')
  assert.equal(colors.sideNavActive, materialColorScheme(chromatic, true).secondaryContainer)
  assert.deepEqual(materialColorScheme(chromatic, true, false), materialColorScheme(chromatic, true), 'Material Dark is unchanged')
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
  assert.equal(classes.has('mainRed'), false)
  assert.equal(classes.has('secBlue'), false)
  assert.equal(properties.get('--bg-color'), dynamicThemeColors(palette(), false).background)
  dark = true
  applyThemeToDocument('dynamic', 'Red', 'Blue', null)
  assert.equal(classes.has('dark'), true)
  assert.equal(classes.has('light'), false)
  assert.equal(properties.get('--bg-color'), dynamicThemeColors(palette(), true).background)
  applyThemeToDocument('light', 'Red', 'Blue', null)
  assert.equal(classes.has('dynamicColors'), false)
  assert.equal(properties.has('--bg-color'), false)
  assert.equal(properties.has('--accent-color-rgb'), false)
  assert.equal(classes.has('light'), true)
  applyThemeToDocument('dynamic', 'Red', 'Blue', null)
  assert.equal(properties.get('--primary-color'), dynamicThemeColors(palette(), true).primary)
  androidDynamicColors.value = { supported: false }
  for (const isDark of [false, true]) {
    dark = isDark
    applyThemeToDocument('dynamic', 'Red', 'Blue', null)
    assert.equal(classes.has(isDark ? 'dark' : 'light'), true)
    assert.equal(classes.has(isDark ? 'light' : 'dark'), false)
    assert.equal(classes.has('mainRed'), false)
    assert.equal(classes.has('secBlue'), false)
    assert.equal(properties.get('--bg-color'), dynamicThemeColors(materialSeedPalette(), isDark).background)
    assert.equal(properties.has('--accent-color-rgb'), true)
  }
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
    const surfaces = ['background', 'cardBackground', 'secondaryCardBackground', 'searchBar', 'settingsSearchBar', 'subtleSurface']
    for (const background of surfaces) {
      for (const foreground of ['primaryText', 'secondaryText', 'tertiaryText', 'link', 'linkVisited', 'error']) {
        assert.ok(contrast(colors[foreground], colors[background]) >= 4.5, `${foreground} on ${background}`)
      }
      for (const foreground of ['border', 'scrollbar', 'scrollbarHover', 'scrollbarActive', 'accent']) {
        assert.ok(contrast(colors[foreground], colors[background]) >= 3, `${foreground} on ${background}`)
      }
    }
    for (const background of ['dropdownHover', 'sideNavHover']) {
      assert.ok(contrast(colors.primaryText, colors[background]) >= 4.5, `Menu text on ${background}`)
    }
    for (const [foreground, backgrounds] of [
      ['textWithPrimary', ['primary', 'primaryHover', 'primaryActive']],
      ['textWithAccent', ['accent', 'accentHover', 'accentActive', 'accentLight']],
      ['destructiveText', ['destructive', 'destructiveHover', 'destructiveActive']],
    ]) {
      for (const background of backgrounds) assert.ok(contrast(colors[foreground], colors[background]) >= 4.5, `${foreground} on ${background}`)
    }
  })
}

test('startup continues when the native palette request stalls and ignores its late result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => { androidDynamicColors.value = { supported: false } })
  let resolveRequest
  const request = new Promise(resolve => { resolveRequest = resolve })
  let ready = false
  const initialization = initializeAndroidDynamicColors(request).then(() => { ready = true })
  t.mock.timers.tick(1500)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ready, true, 'A stalled native bridge must not block mounting')
  await initialization
  assert.equal(androidDynamicColors.value.supported, false)
  resolveRequest({ supported: true, palette: palette() })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(androidDynamicColors.value.supported, false, 'Late startup results must not replace live state')
})

test('startup uses a timely palette and propagates native errors to the fallback handler', async (t) => {
  t.after(() => { androidDynamicColors.value = { supported: false } })
  await initializeAndroidDynamicColors(Promise.resolve({ supported: true, palette: palette() }))
  assert.equal(androidDynamicColors.value.supported, true)
  await assert.rejects(initializeAndroidDynamicColors(Promise.reject(new Error('bridge failed'))), /bridge failed/)
})


test('Material variants remain fixed across system appearance and work as system choices', () => {
  for (const dark of [false, true]) {
    assert.equal(materialThemeMode('materialLight', dark), 'light')
    assert.equal(materialThemeMode('materialDark', dark), 'dark')
    assert.equal(materialThemeMode('materialBlack', dark), 'black')
    assert.equal(materialThemeMode('dynamic', dark), dark ? 'dark' : 'light')
  }
  for (const theme of MATERIAL_THEME_VALUES) {
    assert.equal(resolveBaseTheme(theme, 'system'), theme)
    assert.equal(hasFixedThemeColors(theme), true)
  }
  assert.equal(resolveSystemTheme('materialLight', 'light'), 'materialLight')
  assert.equal(resolveSystemTheme('materialDark', 'dark'), 'materialDark')
  assert.equal(resolveSystemTheme('materialBlack', 'dark'), 'materialBlack')
})

test('seed colors are normalized and invalid persisted values fall back safely', () => {
  assert.equal(normalizeMaterialSeedColor('#ABCDEF'), '#abcdef')
  for (const value of [null, {}, '#123', '#123456ff', 'red', '']) {
    assert.equal(normalizeMaterialSeedColor(value), DEFAULT_MATERIAL_SEED_COLOR)
    assert.deepEqual(materialSeedPalette(value), materialSeedPalette(DEFAULT_MATERIAL_SEED_COLOR))
  }
})

for (const mode of ['light', 'dark', 'black']) {
  test(`Material ${mode} palettes retain contrast across vivid, neutral and extreme seeds`, () => {
    const seeds = ['#000000', '#ffffff', '#808080', ...MATERIAL_SEED_PRESETS.map(preset => preset.color)]
    // Cover the entire hue wheel, including yellow where RGB lightening fails.
    for (let hue = 0; hue < 360; hue += 15) {
      const x = 255 * (1 - Math.abs((hue / 60) % 2 - 1))
      const channels = hue < 60 ? [255, x, 0] : hue < 120 ? [x, 255, 0]
        : hue < 180 ? [0, 255, x] : hue < 240 ? [0, x, 255]
          : hue < 300 ? [x, 0, 255] : [255, 0, x]
      seeds.push('#' + channels.map(c => Math.round(c).toString(16).padStart(2, '0')).join(''))
    }
    for (const seed of seeds) {
      const colors = dynamicThemeColors(materialSeedPalette(seed), mode !== 'light', mode === 'black')
      if (mode === 'black') assert.equal(colors.background, '#000000')
      for (const bg of ['background', 'cardBackground', 'searchBar', 'settingsSearchBar', 'subtleSurface', 'instanceMenu', 'sideNav', 'dropdownHover']) {
        for (const fg of ['primaryText', 'secondaryText', 'tertiaryText', 'link', 'linkVisited', 'error']) {
          assert.ok(contrast(colors[fg], colors[bg]) >= 4.5, `${seed}: ${fg} on ${bg}: ${contrast(colors[fg], colors[bg])}`)
        }
        if (bg !== 'dropdownHover') {
          for (const fg of ['border', 'primary', 'accent', 'scrollbar']) {
            assert.ok(contrast(colors[fg], colors[bg]) >= 3, `${seed}: ${fg} on ${bg}`)
          }
        }
      }
      for (const [fg, backgrounds] of [
        ['textWithPrimary', ['primary', 'primaryHover', 'primaryActive']],
        ['textWithAccent', ['accent', 'accentHover', 'accentActive', 'accentLight']],
        ['destructiveText', ['destructive', 'destructiveHover', 'destructiveActive']],
        ['selectionText', ['selectionBackground']],
      ]) {
        for (const bg of backgrounds) assert.ok(contrast(colors[fg], colors[bg]) >= 4.5, `${seed}: ${fg} on ${bg}`)
      }
    }
  })
}


for (const dark of [false, true]) {
  test(`Material ${dark ? 'dark' : 'light'} container pairs and state layers retain contrast for every preset`, () => {
    for (const preset of MATERIAL_SEED_PRESETS) {
      const roles = materialColorScheme(materialSeedPalette(preset.color), dark)
      for (const base of ['primaryContainer', 'secondaryContainer', 'tertiaryContainer', 'errorContainer']) {
        const on = roles[`on${base[0].toUpperCase()}${base.slice(1)}`]
        for (const opacity of [0, 0.08, 0.12]) {
          const background = materialStateColor(roles[base], on, opacity)
          assert.ok(contrast(on, background) >= 4.5, `${preset.name}: ${base} at ${opacity}`)
        }
      }
      for (const surface of ['surface', 'surfaceContainerLow', 'surfaceContainerHigh', 'surfaceContainerHighest']) {
        assert.ok(contrast(roles.outline, roles[surface]) >= 3, `${preset.name}: outline on ${surface}`)
        for (const text of ['onSurface', 'onSurfaceVariant']) assert.ok(contrast(roles[text], roles[surface]) >= 4.5, `${preset.name}: ${text} on ${surface}`)
      }
    }
  })
}
