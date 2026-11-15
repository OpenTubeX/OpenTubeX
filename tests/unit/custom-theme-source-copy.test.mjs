import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CUSTOM_THEME_EDITABLE_COLORS, CUSTOM_THEME_BLURS, DEFAULT_CUSTOM_THEME, normalizeCustomTheme } from '../../src/customTheme.js'

const component = readFileSync(new URL('../../src/renderer/components/CustomThemeEditor/CustomThemeEditor.vue', import.meta.url), 'utf8')
const copySource = component.match(/function copyThemeSources\(\) \{[\s\S]*?\n\}/)[0]

test('copying theme sources updates editable colors and preserves unused stored colors through serialization', () => {
  const draft = structuredClone(DEFAULT_CUSTOM_THEME)
  draft.id = 'source-copy-test'
  const editableKeys = new Set(CUSTOM_THEME_EDITABLE_COLORS.map(([key]) => key))
  const legacyKeys = Object.keys(draft.colors).filter(key => !editableKeys.has(key))
  for (const key of legacyKeys) draft.colors[key] = '#123456'
  const sourceColors = Object.fromEntries(Object.keys(draft.colors).map(key => [key, '#abcdef']))
  const bindings = {
    draft,
    CUSTOM_THEME_EDITABLE_COLORS,
    CUSTOM_THEME_BLURS,
    cancelPendingColorPreviews() {},
    readThemeSourceColors: () => sourceColors,
    themeSourceColors: { value: null },
    getThemeClassification: () => 'dark',
    previewTheme() {},
  }
  new Function(...Object.keys(bindings), `let previewing; ${copySource}; copyThemeSources()`)(...Object.values(bindings))
  const saved = normalizeCustomTheme(JSON.parse(JSON.stringify(draft)))
  for (const key of legacyKeys) assert.equal(saved.colors[key], '#123456', key)
  for (const key of editableKeys) assert.equal(saved.colors[key], '#abcdef', key)
})
