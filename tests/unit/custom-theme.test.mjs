import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  customThemeBackdropBlur,
  customThemeContentHash,
  DEFAULT_CUSTOM_THEME,
  normalizeCustomTheme,
} from '../../src/customTheme.js'

function legacyTheme() {
  const theme = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_THEME))
  delete theme.version
  delete theme.blurs
  for (const key of [
    'border',
    'subtleSurface',
    'selectionBackground',
    'selectionText',
    'logoPressed',
    'scrollbarActive',
    'dropdownHover',
    'dropdownHoverText',
    'headerHover',
    'headerHoverText',
    'headerPressed',
    'headerPressedText',
    'coloredHeaderHover',
    'coloredHeaderHoverText',
    'coloredHeaderPressed',
    'coloredHeaderPressedText',
    'watchedThumbnailOverlay',
  ]) delete theme.colors[key]
  return theme
}

test('migrates legacy custom themes without changing their existing appearance', () => {
  const theme = legacyTheme()
  theme.colors.scrollbarHover = '#75757580'
  const migrated = normalizeCustomTheme(theme)

  assert.equal(migrated.version, 2)
  assert.equal(migrated.colors.border, theme.colors.tertiaryText)
  assert.equal(migrated.colors.selectionBackground, theme.colors.primary)
  assert.equal(migrated.colors.selectionText, theme.colors.textWithPrimary)
  assert.equal(migrated.colors.logoPressed, theme.colors.logoTertiary)
  assert.equal(migrated.colors.headerHover, theme.colors.sideNavHover)
  assert.equal(migrated.colors.headerPressed, theme.colors.tertiaryText)
  assert.equal(migrated.colors.coloredHeaderPressed, theme.colors.primaryActive)
  assert.equal(migrated.colors.scrollbarActive, '#a3a3a399')
  assert.equal(migrated.colors.watchedThumbnailOverlay, '#121212b3')
  assert.deepEqual(migrated.blurs, {
    cardBackground: 0,
    secondaryCardBackground: 0,
    searchBar: 0,
    settingsSearchBar: 0,
    primaryInput: 0,
  })
})

test('defaults missing watched overlays to the existing thumbnail fade for older themes', () => {
  for (const [background, overlay] of [
    ['#ffffff', '#ffffffb3'],
    ['#ABCDEF', '#abcdefb3'],
    ['#12345600', '#123456b3'],
    ['#12345680', '#123456b3'],
  ]) {
    const theme = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_THEME))
    delete theme.colors.watchedThumbnailOverlay
    theme.colors.background = background
    assert.equal(normalizeCustomTheme(theme).colors.watchedThumbnailOverlay, overlay)
  }
})

test('preserves watched overlay color and opacity through theme serialization', () => {
  for (const color of ['#ABCDEF80', '#12345600', '#123456']) {
    const theme = {
      ...DEFAULT_CUSTOM_THEME,
      colors: { ...DEFAULT_CUSTOM_THEME.colors, watchedThumbnailOverlay: color },
    }
    const normalized = normalizeCustomTheme(theme)
    assert.equal(normalized.colors.watchedThumbnailOverlay, color.toLowerCase())
    assert.deepEqual(normalizeCustomTheme(JSON.parse(JSON.stringify(normalized))), normalized)
  }
  assert.throws(() => normalizeCustomTheme({
    ...DEFAULT_CUSTOM_THEME,
    colors: { ...DEFAULT_CUSTOM_THEME.colors, watchedThumbnailOverlay: 'invalid' },
  }), /Invalid or missing custom theme color: watchedThumbnailOverlay/)
})

test('normalizes transparent colors and bounded backdrop blur strengths', () => {
  const theme = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_THEME))
  theme.colors.cardBackground = '#12345680'
  theme.blurs.cardBackground = 100
  theme.blurs.searchBar = -4

  const normalized = normalizeCustomTheme(theme)
  assert.equal(normalized.colors.cardBackground, '#12345680')
  assert.equal(normalized.blurs.cardBackground, 40)
  assert.equal(normalized.blurs.searchBar, 0)
  assert.equal(customThemeBackdropBlur(normalized.colors.cardBackground, 12), 'blur(12px)')
  assert.equal(customThemeBackdropBlur('#123456', 12), 'none')
  assert.equal(customThemeBackdropBlur('#12345680', 0), 'none')
})

test('preserves source fingerprints through save and sync, but drops them from copies', () => {
  const theme = {
    ...DEFAULT_CUSTOM_THEME,
    id: 'discussion-1197',
    discussionThemeHash: 'a'.repeat(64),
  }
  const normalized = normalizeCustomTheme(theme)
  assert.equal(normalized.discussionThemeHash, 'a'.repeat(64))
  assert.deepEqual(normalizeCustomTheme(JSON.parse(JSON.stringify(normalized))), normalized)
  assert.equal(normalizeCustomTheme({ ...theme, id: 'my-copy' }).discussionThemeHash, undefined)
  assert.equal(normalizeCustomTheme({ ...theme, discussionThemeHash: 'invalid' }).discussionThemeHash, undefined)
})


test('theme fingerprints ignore formatting, key order, local IDs and source fingerprints', async () => {
  const theme = normalizeCustomTheme(DEFAULT_CUSTOM_THEME)
  const expected = await customThemeContentHash(theme)
  assert.match(expected, /^[\da-f]{64}$/)
  const reordered = Object.fromEntries(Object.entries(theme).reverse())
  reordered.colors = Object.fromEntries(Object.entries(theme.colors).reverse())
  reordered.blurs = Object.fromEntries(Object.entries(theme.blurs).reverse())
  assert.equal(await customThemeContentHash(JSON.parse(JSON.stringify(reordered, null, 4))), expected)
  assert.equal(await customThemeContentHash({ ...theme, id: 'discussion-1197', discussionThemeHash: 'b'.repeat(64) }), expected)
  assert.equal(await customThemeContentHash({ ...theme, colors: { ...theme.colors, background: '#ABCDEF' } }),
    await customThemeContentHash({ ...theme, colors: { ...theme.colors, background: '#abcdef' } }))
})

test('theme fingerprints detect changes to colors, blur, name and theme settings', async () => {
  const theme = normalizeCustomTheme(DEFAULT_CUSTOM_THEME)
  const original = await customThemeContentHash(theme)
  for (const patch of [
    { colors: { ...theme.colors, background: '#112233' } },
    { colors: { ...theme.colors, watchedThumbnailOverlay: '#ff880080' } },
    { blurs: { ...theme.blurs, cardBackground: 10 } },
    { name: 'New theme name' },
    { isDark: !theme.isDark },
    { basedOn: 'light' },
    { mainColor: 'Purple' },
    { secondaryColor: 'Green' },
  ]) assert.notEqual(await customThemeContentHash({ ...theme, ...patch }), original)
})

test('keeps existing fingerprints for missing and default watched overlays after normalization and serialization', async () => {
  // Fingerprints generated by the default branch before watched overlays existed.
  for (const [background, fingerprint] of [
    ['#121212', 'ff5c02ed5d364bba9dea54406f3f23139d19b08a92316bbf38ac810ce59bcf8e'],
    ['#12345680', 'ac69688dc0ad3080895a0afa8c8c557f2441fcd53d0b2e2c6d024a5be0b0ec08'],
  ]) {
    const theme = { ...DEFAULT_CUSTOM_THEME, colors: { ...DEFAULT_CUSTOM_THEME.colors, background } }
    delete theme.colors.watchedThumbnailOverlay
    assert.equal(await customThemeContentHash(theme), fingerprint)
    const normalized = normalizeCustomTheme(theme)
    assert.equal(await customThemeContentHash(normalized), fingerprint)
    assert.equal(await customThemeContentHash(JSON.parse(JSON.stringify(normalized))), fingerprint)
  }
})
