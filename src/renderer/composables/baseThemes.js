import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { BUILTIN_BASE_THEME_VALUES, BUILTIN_BASE_THEME_TRANSLATION_KEYS } from '../../constants'
import { customThemeValue } from '../../customTheme'
import { androidDynamicColors } from '../helpers/dynamicColors'

export function useBaseThemeNames(includeSystem = true) {
  const { tm } = useI18n()
  const keys = includeSystem ? BUILTIN_BASE_THEME_TRANSLATION_KEYS : BUILTIN_BASE_THEME_TRANSLATION_KEYS.slice(1)

  return computed(() => {
    const translations = tm('Settings.Theme Settings.Base Theme')
    return keys.map(key => translations[key] ?? key)
  })
}

/** Keep the Appearance and quick-settings theme selectors in the same order. */
export function useBaseThemeOptions(customThemes) {
  const { t } = useI18n()
  const builtInNames = useBaseThemeNames()
  const options = computed(() => {
    const themes = BUILTIN_BASE_THEME_VALUES.map((value, index) => ({ value, name: builtInNames.value[index] }))
    if (androidDynamicColors.value.supported) {
      const index = themes.findIndex(({ value }) => value === 'openTubeXDark') + 1
      themes.splice(index, 0, { value: 'dynamic', name: t('Settings.Theme Settings.Base Theme.Dynamic colors') })
    }
    return themes.concat(customThemes.value.map(({ id, name }) => ({ value: customThemeValue(id), name })))
  })
  return {
    baseThemeValues: computed(() => options.value.map(({ value }) => value)),
    baseThemeNames: computed(() => options.value.map(({ name }) => name)),
  }
}
