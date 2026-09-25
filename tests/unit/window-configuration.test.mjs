import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveWindowBackground, resolveWindowBounds } from '../../src/main/windowConfiguration.js'

test('window configuration resolves a system theme through the saved light theme', async () => {
  const values = { baseTheme: 'system', systemLightTheme: 'light' }
  const background = await resolveWindowBackground({
    settings: { _findOne: async key => ({ value: values[key] }) },
    nativeTheme: { shouldUseDarkColors: false },
    loadCustomThemes: async () => [],
    getSelectedCustomTheme: async () => null
  })
  assert.equal(background, '#f1f1f1')
})

test('window configuration rejects saved bounds outside connected displays', async () => {
  const settings = { _findOne: async () => ({ value: { x: 3000, y: 0, width: 800, height: 600, maximized: true } }) }
  const screen = { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }] }
  assert.deepEqual(await resolveWindowBounds({ settings, screen, sessionData: null }), {
    savedBounds: undefined,
    savedMaximized: true
  })
  assert.deepEqual(await resolveWindowBounds({ settings, screen, sessionData: {
    bounds: { x: 100, y: 100, width: 900, height: 700, maximized: false }
  } }), {
    savedBounds: { x: 100, y: 100, width: 900, height: 700 },
    savedMaximized: false
  })
})
