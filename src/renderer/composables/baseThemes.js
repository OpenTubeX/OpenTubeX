import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { BUILTIN_BASE_THEME_VALUES, BUILTIN_BASE_THEME_TRANSLATION_KEYS } from '../../constants'
import { getThemeClassification } from '../../appearanceSettings'
import { customThemeValue, isCustomThemeValue } from '../../customTheme'
import store from '../store/index'

export function useBaseThemeNames(includeSystem = true) {
  const { tm } = useI18n()
  const keys = includeSystem ? BUILTIN_BASE_THEME_TRANSLATION_KEYS : BUILTIN_BASE_THEME_TRANSLATION_KEYS.slice(1)

  return computed(() => {
    const translations = tm('Settings.Theme Settings.Base Theme')
    return keys.map(key => translations[key] ?? key)
  })
}

/** Group a theme select option; "Follow system" stays above the labeled groups. */
export function baseThemeGroup(value) {
  if (value === 'system') return 'system'
  return isCustomThemeValue(value) ? 'custom' : 'builtIn'
}

/** Keep the Appearance and quick-settings theme selectors in the same order. */
export function useBaseThemeOptions(customThemes) {
  const { t } = useI18n()
  const builtInNames = useBaseThemeNames()
  const options = computed(() => {
    const themes = BUILTIN_BASE_THEME_VALUES.map((value, index) => ({ value, name: builtInNames.value[index] }))
    return themes.concat(customThemes.value.map(({ id, name }) => ({ value: customThemeValue(id), name })))
  })
  return {
    baseThemeValues: computed(() => options.value.map(({ value }) => value)),
    baseThemeNames: computed(() => options.value.map(({ name }) => name)),
    // Headings only help once custom themes exist.
    baseThemeGroupLabels: computed(() => customThemes.value.length === 0
      ? {}
      : {
          builtIn: t('Settings.Theme Settings.Base Theme.Built-in Themes'),
          custom: t('Settings.Theme Settings.Base Theme.Custom Themes'),
        }),
  }
}

/**
 * The System default, Light and Dark modes of the theme gallery. The system
 * theme settings remember the light and dark choices while a single theme is active.
 */
export function useThemeMode() {
  const customThemes = computed(() => store.getters.getCustomThemes)
  const themeOptions = useBaseThemeOptions(customThemes)
  const { baseThemeValues, baseThemeNames } = themeOptions
  const baseTheme = computed(() => store.getters.getBaseTheme)

  function themeName(value) {
    return baseThemeNames.value[baseThemeValues.value.indexOf(value)] ?? ''
  }

  /** System default and Dynamic colors follow the system; every other theme is either light or dark. */
  const mode = computed(() => ['system', 'dynamic'].includes(baseTheme.value)
    ? 'system'
    : getThemeClassification(baseTheme.value, customThemes.value) ?? 'system')

  const lightTheme = computed(() => mode.value === 'light' ? baseTheme.value : store.getters.getSystemLightTheme)
  const darkTheme = computed(() => mode.value === 'dark' ? baseTheme.value : store.getters.getSystemDarkTheme)
  const systemPreview = computed(() => baseTheme.value === 'dynamic'
    ? { theme: 'dynamic', darkTheme: 'dynamic' }
    : { theme: lightTheme.value, darkTheme: darkTheme.value })

  const modeTiles = computed(() => [
    { mode: 'system', name: themeName('system'), preview: systemPreview.value },
    { mode: 'light', name: themeName('light'), preview: { theme: lightTheme.value } },
    { mode: 'dark', name: themeName('dark'), preview: { theme: darkTheme.value, dark: true } },
  ])

  async function rememberSingleTheme() {
    if (mode.value === 'light' && store.getters.getSystemLightTheme !== baseTheme.value) {
      await store.dispatch('updateSystemLightTheme', baseTheme.value)
    } else if (mode.value === 'dark' && store.getters.getSystemDarkTheme !== baseTheme.value) {
      await store.dispatch('updateSystemDarkTheme', baseTheme.value)
    }
  }

  async function selectMode(next) {
    if (next === mode.value) return
    const theme = next === 'system' ? 'system' : next === 'light' ? lightTheme.value : darkTheme.value
    await rememberSingleTheme()
    await store.dispatch('updateBaseTheme', theme)
  }

  return {
    ...themeOptions,
    customThemes,
    baseTheme,
    themeName,
    mode,
    lightTheme,
    darkTheme,
    systemPreview,
    modeTiles,
    selectMode,
  }
}
