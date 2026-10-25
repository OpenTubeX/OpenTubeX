import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'

import store from '../store/index'
import { MATERIAL_SYSTEM_SEED, MATERIAL_THEME_VALUES, normalizeSystemAccentColor } from '../../materialTheme.js'
import { androidDynamicColors, desktopSystemAccentColor, getAndroidDynamicColors, onAndroidDynamicColorsChanged } from '../helpers/dynamicColors'
import { setAndroidSystemBarsBackground } from '../helpers/androidUi'
import { getThemeBackground } from '../helpers/customTheme'
import { updateTrayIcon } from '../helpers/trayIcon'
import { resolveBaseTheme, resolveSystemThemeSettings } from '../../appearanceSettings'
import { calculateColorLuminance, resolveColor } from '../helpers/colors'
import { cacheStartupAppearance } from '../helpers/startupSplash'
import { normalizeScrollbarThumbWidth } from '../constants/scrollbar'
import { getAppFontFamily } from '../helpers/appFont'
import { getThumbnailListStyles } from '../constants/thumbnailSize'
import { setupPhoneViewport } from '../helpers/phoneViewport'
import { createCapacitorUiScale } from '../helpers/capacitorUiScale'

const isElectron = process.env.IS_ELECTRON
const isCapacitor = process.env.IS_CAPACITOR

/**
 * OpenTubeX appearance settings that the app shell applies to the document:
 * UI scale, font, roundness, scrollbar width and thumbnail size, the system
 * color scheme, Android dynamic colors and the desktop accent color, the tray
 * icon, the cached mobile startup appearance and Android's system bars.
 *
 * @param {{
 *   baseTheme: import('vue').ComputedRef<string>,
 *   updateTheme: () => void,
 *   isAppearanceSettingsReady: () => boolean
 * }} options
 */
export function useAppearance({ baseTheme, updateTheme, isAppearanceSettingsReady }) {
  const capacitorUiScale = isCapacitor ? createCapacitorUiScale(window, document) : null
  watch(() => store.getters.getUiScale, value => {
    capacitorUiScale?.setScale(value)
    document.documentElement.style.setProperty('--phone-touch-target', `${Math.max(48, 4800 / value)}px`)
  }, { immediate: true })
  onBeforeUnmount(setupPhoneViewport(window, document, isCapacitor && !process.env.IS_IOS))
  onBeforeUnmount(() => capacitorUiScale?.dispose())

  const appFont = computed(() => store.getters.getAppFont)
  const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)')
  const systemUsesDarkTheme = ref(systemColorScheme.matches)
  systemColorScheme.addEventListener('change', handleSystemColorSchemeChange)

  if (isCapacitor) {
    let dynamicColorsListener
    let disposed = false
    const receiveColors = (colors) => {
      if (disposed) return
      androidDynamicColors.value = colors
      const theme = baseTheme.value === 'system'
        ? (systemUsesDarkTheme.value ? store.getters.getSystemDarkTheme : store.getters.getSystemLightTheme)
        : baseTheme.value
      if (MATERIAL_THEME_VALUES.includes(theme)) updateTheme()
    }
    onMounted(async () => {
      try {
        dynamicColorsListener = await onAndroidDynamicColorsChanged(receiveColors)
        if (disposed) {
          await dynamicColorsListener?.remove()
          return
        }
        receiveColors(await getAndroidDynamicColors())
      } catch (error) {
        console.error('Failed to load Android dynamic colors:', error)
      }
    })
    onBeforeUnmount(() => {
      disposed = true
      dynamicColorsListener?.remove()
    })
  }

  if (isElectron) {
    let disposed = false
    let receivedUpdate = false
    const receiveAccent = color => {
      if (disposed) return
      desktopSystemAccentColor.value = normalizeSystemAccentColor(color)
      if (baseTheme.value === 'dynamic' || store.getters.getMaterialSeedColor === MATERIAL_SYSTEM_SEED) updateTheme()
    }
    const removeListener = window.ftElectron.handleSystemAccentColorUpdated(color => {
      receivedUpdate = true
      receiveAccent(color)
    })
    window.ftElectron.getSystemAccentColor().then(color => {
      if (!receivedUpdate) receiveAccent(color)
    }).catch(error => console.error('Failed to load system accent color:', error))
    onBeforeUnmount(() => {
      disposed = true
      removeListener()
    })
  }

  watch(() => store.getters.getMaterialSeedColor, updateTheme)
  watch(appFont, updateAppFont)
  watch(() => store.getters.getSystemLightTheme, updateTheme)
  watch(() => store.getters.getSystemDarkTheme, updateTheme)
  watch(() => store.getters.getHideStartupSplash, cacheCapacitorStartupAppearance)
  watch(() => store.getters.getCustomThemes, cacheCapacitorStartupAppearance)

  /** @type {import('vue').ComputedRef<number>} */
  const uiRoundness = computed(() => store.getters.getUiRoundness)

  watch(uiRoundness, updateUiRoundness)

  /** @type {import('vue').ComputedRef<number>} */
  const scrollbarThumbWidth = computed(() => store.getters.getScrollbarThumbWidth)

  watch(scrollbarThumbWidth, updateScrollbarThumbWidth)

  /** @type {import('vue').ComputedRef<number>} */
  const thumbnailSize = computed(() => store.getters.getThumbnailSize)

  watch(thumbnailSize, updateThumbnailListSize)

  watch(() => store.getters.getTrayIconPreset, refreshTrayIcon)

  function refreshTrayIcon() {
    if (isElectron && isAppearanceSettingsReady()) {
      updateTrayIcon(store.getters.getTrayIconPreset).catch(error => console.error('Unable to update tray icon', error))
    }
  }

  function cacheCapacitorStartupAppearance() {
    if (!isCapacitor || !isAppearanceSettingsReady()) return
    const appearance = (dark) => {
      const theme = baseTheme.value === 'system'
        ? (dark ? store.getters.getSystemDarkTheme : store.getters.getSystemLightTheme)
        : baseTheme.value
      const background = getThemeBackground(theme, store.getters.getCustomThemes, dark, store.getters.getMaterialSeedColor)
      return { background, dark: calculateColorLuminance(background) !== '#000000' }
    }
    cacheStartupAppearance({
      light: appearance(false),
      dark: appearance(true),
      hideSplash: store.getters.getHideStartupSplash
    })
  }

  function updateSystemBarsStyle() {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SystemBars')) return

    // Native video needs a transparent WebView; use the theme backdrop behind it.
    const bodyStyle = getComputedStyle(document.body)
    const backgroundColor = bodyStyle.getPropertyValue('--bg-color').trim() || bodyStyle.backgroundColor
    const usesDarkIcons = calculateColorLuminance(backgroundColor) === '#000000'
    Promise.all([
      setAndroidSystemBarsBackground(backgroundColor, ['system', 'dynamic'].includes(baseTheme.value)),
      SystemBars.setStyle({
        style: usesDarkIcons ? SystemBarsStyle.Light : SystemBarsStyle.Dark
      })
    ]).catch((error) => {
      console.error('Failed to update system bar style:', error)
    })
  }

  function updateAppFont() {
    document.body.style.setProperty(
      '--app-font-family',
      getAppFontFamily(appFont.value)
    )
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

  function handleSystemColorSchemeChange(event) {
    systemUsesDarkTheme.value = event.matches
    if (['system', 'dynamic'].includes(baseTheme.value)) updateTheme()
  }

  function updateUiRoundness() {
    document.body.style.setProperty('--ui-roundness', String(uiRoundness.value / 100))
  }

  function updateScrollbarThumbWidth() {
    document.body.style.setProperty(
      '--scrollbar-thumb-width',
      `${normalizeScrollbarThumbWidth(scrollbarThumbWidth.value)}px`
    )
  }

  // Setting these once on the body keeps a thumbnail size change from
  // re-rendering every list that shows thumbnails.
  function updateThumbnailListSize() {
    for (const [property, value] of Object.entries(getThumbnailListStyles(thumbnailSize.value))) {
      document.body.style.setProperty(property, value)
    }
  }

  updateAppFont()
  updateUiRoundness()
  updateScrollbarThumbWidth()
  updateThumbnailListSize()

  onBeforeUnmount(() => {
    systemColorScheme.removeEventListener('change', handleSystemColorSchemeChange)
  })

  return {
    systemUsesDarkTheme,
    refreshTrayIcon,
    cacheCapacitorStartupAppearance,
    updateSystemBarsStyle,
    sanitizeAppearanceSettings
  }
}
