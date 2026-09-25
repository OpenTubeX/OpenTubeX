/**
 * @typedef {object} AppearanceGetters
 * @property {string} getBaseTheme
 * @property {string} getSystemLightTheme
 * @property {string} getSystemDarkTheme
 * @property {string} getMainColor
 * @property {string} getSecColor
 * @property {string} getTrayIconPreset
 * @property {Array<{ id: string }>} getCustomThemes
 */

/**
 * Applies root appearance settings and repairs persisted theme choices after
 * custom themes load. The caller owns the document and platform side effects.
 *
 * @param {object} dependencies
 * @param {{ getters: AppearanceGetters, dispatch: (action: string, value: string) => Promise<unknown> }} dependencies.store
 * @param {import('vue').ComputedRef<string>} dependencies.baseTheme
 * @param {import('vue').Ref<boolean>} dependencies.systemUsesDarkTheme
 * @param {import('vue').ComputedRef<string>} dependencies.mainColor
 * @param {import('vue').ComputedRef<string>} dependencies.secColor
 * @param {typeof import('./customTheme.js').applyThemeToDocument} dependencies.applyThemeToDocument
 * @param {() => void} dependencies.refreshTrayIcon
 * @param {() => void} dependencies.updateSystemBarsStyle
 * @param {typeof import('../../appearanceSettings.js').resolveSystemThemeSettings} dependencies.resolveSystemThemeSettings
 * @param {typeof import('../../appearanceSettings.js').resolveBaseTheme} dependencies.resolveBaseTheme
 * @param {(value: string, fallback: string) => string} dependencies.resolveColor
 */
export function createAppAppearanceController({
  store, baseTheme, systemUsesDarkTheme, mainColor, secColor,
  applyThemeToDocument, refreshTrayIcon, updateSystemBarsStyle,
  resolveSystemThemeSettings, resolveBaseTheme, resolveColor,
}) {
  function updateTheme() {
    const effectiveTheme = baseTheme.value === 'system'
      ? (systemUsesDarkTheme.value ? store.getters.getSystemDarkTheme : store.getters.getSystemLightTheme)
      : baseTheme.value
    const customThemes = store.getters.getCustomThemes
    const customTheme = customThemes.find(theme => `custom:${theme.id}` === effectiveTheme) ??
      (effectiveTheme === 'custom' ? customThemes[0] : null) ?? null
    applyThemeToDocument(effectiveTheme, mainColor.value, secColor.value, customTheme)
    if (store.getters.getTrayIconPreset === 'theme') refreshTrayIcon()
    updateSystemBarsStyle()
  }

  async function sanitizeAppearanceSettings(customThemes) {
    const systemThemes = resolveSystemThemeSettings({
      systemLightTheme: store.getters.getSystemLightTheme,
      systemDarkTheme: store.getters.getSystemDarkTheme,
    }, customThemes)
    const settings = [
      ['BaseTheme', resolveBaseTheme(store.getters.getBaseTheme, 'system', customThemes)],
      ['SystemLightTheme', systemThemes.systemLightTheme],
      ['SystemDarkTheme', systemThemes.systemDarkTheme],
      ['MainColor', resolveColor(store.getters.getMainColor, 'Red')],
      ['SecColor', resolveColor(store.getters.getSecColor, 'Blue')],
    ]

    await Promise.all(settings.map(([name, value]) =>
      store.getters[`get${name}`] === value ? null : store.dispatch(`update${name}`, value)))
  }

  return { updateTheme, sanitizeAppearanceSettings }
}
