import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveBaseTheme, resolveSystemThemeSettings } from '../../src/appearanceSettings.js'
import { createAppAppearanceController } from '../../src/renderer/helpers/appAppearance.js'

test('system theme selects the named custom theme and refreshes a themed tray icon', () => {
  const applied = []
  let trayRefreshes = 0
  let barUpdates = 0
  const customThemes = [{ id: 'first' }, { id: 'second' }]
  const { updateTheme } = createAppAppearanceController({
    baseTheme: { value: 'system' },
    systemUsesDarkTheme: { value: true },
    mainColor: { value: 'Red' },
    secColor: { value: 'Blue' },
    store: { getters: {
      getSystemDarkTheme: 'custom:second',
      getSystemLightTheme: 'light',
      getCustomThemes: customThemes,
      getTrayIconPreset: 'theme',
    } },
    applyThemeToDocument: (...args) => applied.push(args),
    refreshTrayIcon: () => { trayRefreshes++ },
    updateSystemBarsStyle: () => { barUpdates++ },
  })
  updateTheme()
  assert.deepEqual([...applied[0]], ['custom:second', 'Red', 'Blue', customThemes[1]])
  assert.equal(trayRefreshes, 1)
  assert.equal(barUpdates, 1)
})

test('appearance repair updates only invalid settings after custom themes load', async () => {
  const dispatches = []
  const getters = {
    getSystemLightTheme: 'custom:missing',
    getSystemDarkTheme: 'dark',
    getBaseTheme: 'custom:missing',
    getMainColor: 'Red',
    getSecColor: 'Blue',
  }
  const { sanitizeAppearanceSettings } = createAppAppearanceController({
    store: { getters, dispatch: async (name, value) => { dispatches.push([name, value]) } },
    resolveBaseTheme,
    resolveSystemThemeSettings,
    resolveColor: color => color,
  })
  await sanitizeAppearanceSettings([])
  assert.deepEqual(dispatches.map(([name]) => name).sort(), ['updateBaseTheme', 'updateSystemLightTheme'])
})
