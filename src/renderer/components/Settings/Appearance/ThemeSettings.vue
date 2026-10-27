<template>
  <FtSettingsSection
    :title="$t('Settings.Theme Settings.Theme Settings')"
  >
    <FtFlexBox class="themeSelectRow">
      <FtSelect
        size-to-content
        :placeholder="$t('Settings.Theme Settings.Base Theme.Base Theme')"
        :value="baseTheme"
        setting-key="baseTheme"
        :select-names="baseThemeNames"
        :select-values="baseThemeValues"
        :icon="['fas', 'palette']"
        @change="updateBaseTheme"
      />
      <FtSelect
        size-to-content
        :placeholder="$t('Settings.Theme Settings.Icon Pack.Icon Pack')"
        :value="iconPack"
        setting-key="iconPack"
        :select-names="iconPackNames"
        :select-values="ICON_PACKS"
        :icon="['fas', 'icons']"
        @change="updateIconPack"
      />
      <FtSelect
        size-to-content
        :placeholder="$t('Settings.Theme Settings.Toast Position.Toast Position')"
        :value="toastPosition"
        setting-key="toastPosition"
        :select-names="toastPositionNames"
        :select-values="TOAST_POSITION_VALUES"
        :icon="['fas', 'message']"
        @change="updateToastPosition"
      />
      <div class="testToastAction">
        <FtButton
          class="testToastButton"
          :label="t('Settings.Theme Settings.Toast Position.Test Toast')"
          :icon="['fas', 'message']"
          @click="showTestToast"
        />
      </div>
    </FtFlexBox>
    <FtFlexBox
      v-if="baseTheme === 'system'"
      class="themeSelectRow"
    >
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Theme Settings.Light Theme')"
        :value="systemLightTheme"
        setting-key="systemLightTheme"
        :select-names="systemLightThemeNames"
        :select-values="systemLightThemeValues"
        :icon="['fas', 'sun']"
        @change="store.dispatch('updateSystemLightTheme', $event)"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Theme Settings.Dark Theme')"
        :value="systemDarkTheme"
        setting-key="systemDarkTheme"
        :select-names="systemDarkThemeNames"
        :select-values="systemDarkThemeValues"
        :icon="['fas', 'moon']"
        @change="store.dispatch('updateSystemDarkTheme', $event)"
      />
    </FtFlexBox>
    <FtFlexBox class="themeSelectRow">
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Theme Settings.Font.App Font')"
        :value="appFont"
        setting-key="appFont"
        :select-names="fontNames"
        :select-values="fontValues"
        :option-groups="fontGroups"
        :option-group-labels="{
          bundled: t('Settings.Theme Settings.Font.Bundled Fonts'),
          system: t('Settings.Theme Settings.Font.System Fonts')
        }"
        :icon="['fas', 'font']"
        @change="updateAppFont"
        @open="loadSystemFonts"
      >
        <template #option="{ label, value }">
          <span :style="{ fontFamily: getAppFontFamily(value) }">{{ label }}</span>
        </template>
      </FtSelect>
      <FtSelect
        v-if="!isMaterialThemeSelected"
        size-to-content
        :placeholder="$t('Settings.Theme Settings.Main Color Theme.Main Color Theme')"
        :value="mainColor"
        setting-key="mainColor"
        :select-names="colorNames"
        :select-values="COLOR_VALUES"
        :option-colors="COLOR_SWATCHES"
        :disabled="!areColorThemesEnabled"
        :icon="['fas', 'palette']"
        icon-color="var(--primary-color)"
        @change="updateMainColor"
      />
      <FtSelect
        v-if="!isMaterialThemeSelected"
        size-to-content
        :placeholder="$t('Settings.Theme Settings.Secondary Color Theme')"
        :value="secColor"
        setting-key="secColor"
        :select-names="colorNames"
        :select-values="COLOR_VALUES"
        :option-colors="COLOR_SWATCHES"
        :disabled="!areColorThemesEnabled"
        :icon="['fas', 'palette']"
        icon-color="var(--accent-color)"
        @change="updateSecColor"
      />
    </FtFlexBox>
    <MaterialColorSettings
      v-if="showMaterialSeedColor"
      :model-value="materialSeedColor"
      @update:model-value="store.dispatch('updateMaterialSeedColor', $event)"
    />
    <FtFlexBox class="customThemeActions">
      <FtButton
        :label="t('Theme Discovery.Discover Themes')"
        :icon="['fas', 'search']"
        @click="showThemeDiscovery = true"
      />
      <FtButton
        :label="t('Settings.Theme Settings.Custom Theme.Create Custom Theme')"
        :icon="['fas', 'palette']"
        @click="openCustomThemeEditor(null)"
      />
      <FtButton
        v-if="selectedCustomThemeId"
        :label="t('Settings.Theme Settings.Custom Theme.Edit Custom Theme')"
        :icon="['fas', 'pen']"
        @click="openCustomThemeEditor(selectedCustomThemeId)"
      />
    </FtFlexBox>
    <FtFlexBox
      v-if="IS_CAPACITOR || usingElectron"
      class="appIconActions"
    >
      <AppIconSettings v-if="IS_CAPACITOR && !IS_IOS" />
      <TrayIconSettings v-if="usingElectron" />
    </FtFlexBox>
    <ThemeDiscovery
      :open="showThemeDiscovery"
      @close="showThemeDiscovery = false"
    />
    <CustomThemeEditor
      :open="showCustomThemeEditor"
      :theme-id="editingCustomThemeId"
      @close="showCustomThemeEditor = false"
    />
  </FtSettingsSection>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtButton from '../../FtButton/FtButton.vue'
import ThemeDiscovery from '../../ThemeDiscovery.vue'
import CustomThemeEditor from '../../CustomThemeEditor/CustomThemeEditor.vue'
import AppIconSettings from './AppIconSettings.vue'
import MaterialColorSettings from './MaterialColorSettings.vue'
import TrayIconSettings from './TrayIconSettings.vue'

import store from '../../../store/index'
import { getThemeClassification, hasFixedThemeColors } from '../../../../appearanceSettings'
import { customThemeIdFromValue } from '../../../../customTheme'
import { MATERIAL_THEME_VALUES } from '../../../../materialTheme.js'

import { colors } from '../../../helpers/colors'
import { androidDynamicColors } from '../../../helpers/dynamicColors.js'
import { useColorTranslations } from '../../../composables/colors'
import { useBaseThemeOptions } from '../../../composables/baseThemes'
import { normalizeToastPosition, TOAST_POSITION_VALUES } from '../../../constants/toastPosition'
import { showToast } from '../../../helpers/utils'
import { ICON_PACKS } from '../../../icons/iconPackState'
import { DEFAULT_APP_FONT, getAppFontFamily, normalizeAppFont, SYSTEM_APP_FONT } from '../../../helpers/appFont'

const { locale, t } = useI18n()
const IS_IOS = !!process.env.IS_IOS
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
/** @type {boolean} */
const usingElectron = process.env.IS_ELECTRON

const customThemes = computed(() => store.getters.getCustomThemes)
const { baseThemeValues, baseThemeNames } = useBaseThemeOptions(customThemes)
function systemThemeOptions(classification) {
  return baseThemeValues.value.flatMap((value, index) =>
    getThemeClassification(value, customThemes.value) === classification
      ? [{ name: baseThemeNames.value[index], value }]
      : [])
}

const systemLightThemeOptions = computed(() => systemThemeOptions('light'))
const systemLightThemeValues = computed(() => systemLightThemeOptions.value.map(({ value }) => value))
const systemLightThemeNames = computed(() => systemLightThemeOptions.value.map(({ name }) => name))
const systemDarkThemeOptions = computed(() => systemThemeOptions('dark'))
const systemDarkThemeValues = computed(() => systemDarkThemeOptions.value.map(({ value }) => value))
const systemDarkThemeNames = computed(() => systemDarkThemeOptions.value.map(({ name }) => name))

const iconPackNames = computed(() => [
  t('Settings.Theme Settings.Icon Pack.Material Symbols'),
  t('Settings.Theme Settings.Icon Pack.Remix Icon')
])

const COLOR_VALUES = colors.map(color => color.name)
const COLOR_SWATCHES = colors.map(color => color.value)
const colorNames = useColorTranslations()
const showThemeDiscovery = ref(false)
const showCustomThemeEditor = ref(false)
const editingCustomThemeId = ref(null)
const systemFonts = ref([])
let systemFontsPromise = null

const appFont = computed(() => normalizeAppFont(store.getters.getAppFont))
const bundledFontNames = ['Figtree', 'Source Sans 3', 'IBM Plex Sans', 'Inter', 'Manrope', 'Plus Jakarta Sans', 'Google Sans']
const bundledFontValues = bundledFontNames.map(name => `${name} Variable`)
const fontValues = computed(() => [
  DEFAULT_APP_FONT,
  'Roboto',
  ...bundledFontValues,
  SYSTEM_APP_FONT,
  ...[...new Set([
    ...IS_CAPACITOR ? [] : [appFont.value],
    ...systemFonts.value
  ])]
    .filter(font => font !== DEFAULT_APP_FONT && font !== 'Roboto' && font !== SYSTEM_APP_FONT && !bundledFontValues.includes(font))
    .toSorted(new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' }).compare)
])
const fontNames = computed(() => [
  'Geist',
  'Roboto',
  ...bundledFontNames,
  t('Settings.Theme Settings.Font.System Default'),
  ...fontValues.value.slice(3 + bundledFontValues.length)
])

const fontGroups = computed(() => fontValues.value.map((font, index) =>
  index < 2 + bundledFontValues.length ? 'bundled' : 'system'))

function updateAppFont(value) {
  store.dispatch('updateAppFont', value)
}

async function loadSystemFonts() {
  if (IS_CAPACITOR || systemFontsPromise !== null) return

  const fontRequest = process.env.IS_ELECTRON
    ? window.ftElectron.getSystemFonts()
    : typeof window.queryLocalFonts === 'function'
      ? window.queryLocalFonts().then(fonts => fonts.map(({ family }) => family))
      : Promise.resolve([])

  systemFontsPromise = fontRequest
    .then(fonts => {
      const families = fonts
        .map(font => font.trim())
        .filter(Boolean)
      systemFonts.value = [...new Set(families)]
    })
    .catch(error => {
      console.error('Failed to load system fonts', error)
      showToast(t('Settings.Theme Settings.Font.Unable to Load'))
    })

  await systemFontsPromise
}

/** @type {import('vue').ComputedRef<string>} */
const baseTheme = computed(() => {
  return store.getters.getBaseTheme
})
const systemLightTheme = computed(() => store.getters.getSystemLightTheme)
const systemDarkTheme = computed(() => store.getters.getSystemDarkTheme)
const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const systemUsesDarkTheme = ref(systemColorScheme.matches)

function updateSystemColorScheme(event) {
  systemUsesDarkTheme.value = event.matches
}

/**
 * @param {string} value
 */
function updateBaseTheme(value) {
  store.dispatch('updateBaseTheme', value)
}

const iconPack = computed(() => store.getters.getIconPack)

/**
 * @param {import('../../../icons/iconPackState').IconPackId} value
 */
function updateIconPack(value) {
  store.dispatch('updateIconPack', value)
}

const isMaterialThemeSelected = computed(() => MATERIAL_THEME_VALUES.includes(baseTheme.value === 'system'
  ? (systemUsesDarkTheme.value ? systemDarkTheme.value : systemLightTheme.value)
  : baseTheme.value))

const materialSeedColor = computed(() => store.getters.getMaterialSeedColor)
const usesMaterialSeedColor = theme => MATERIAL_THEME_VALUES.includes(theme) &&
  !(theme === 'dynamic' && (usingElectron || androidDynamicColors.value.supported))
const showMaterialSeedColor = computed(() => baseTheme.value === 'system'
  ? [systemLightTheme.value, systemDarkTheme.value].some(usesMaterialSeedColor)
  : usesMaterialSeedColor(baseTheme.value))

const areColorThemesEnabled = computed(() => baseTheme.value === 'system'
  ? !hasFixedThemeColors(systemUsesDarkTheme.value ? systemDarkTheme.value : systemLightTheme.value)
  : !hasFixedThemeColors(baseTheme.value))
const selectedCustomThemeId = computed(() => customThemeIdFromValue(baseTheme.value === 'system'
  ? (systemUsesDarkTheme.value ? systemDarkTheme.value : systemLightTheme.value)
  : baseTheme.value))

function openCustomThemeEditor(themeId) {
  editingCustomThemeId.value = themeId
  showCustomThemeEditor.value = true
}

/** @type {import('vue').ComputedRef<string>} */
const mainColor = computed(() => {
  return store.getters.getMainColor
})

/**
 * @param {string} value
 */
function updateMainColor(value) {
  store.dispatch('updateMainColor', value)
}

/** @type {import('vue').ComputedRef<string>} */
const secColor = computed(() => {
  return store.getters.getSecColor
})

/**
 * @param {string} value
 */
function updateSecColor(value) {
  store.dispatch('updateSecColor', value)
}

const toastPositionNames = computed(() => [
  t('Settings.Theme Settings.Toast Position.Bottom Left'),
  t('Settings.Theme Settings.Toast Position.Bottom Center'),
  t('Settings.Theme Settings.Toast Position.Bottom Right'),
  t('Settings.Theme Settings.Toast Position.Top Left'),
  t('Settings.Theme Settings.Toast Position.Top Center'),
  t('Settings.Theme Settings.Toast Position.Top Right')
])

/** @type {import('vue').ComputedRef<'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right'>} */
const toastPosition = computed(() => normalizeToastPosition(store.getters.getToastPosition))
let toastPositionUpdatePromise = Promise.resolve()

/**
 * @param {'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right'} value
 */
function updateToastPosition(value) {
  toastPositionUpdatePromise = toastPositionUpdatePromise
    .then(() => store.dispatch('updateToastPosition', value))
}

async function showTestToast() {
  await toastPositionUpdatePromise
  showToast({
    message: t('Settings.Theme Settings.Toast Position.Test Toast'),
    icon: ['fas', 'message']
  })
}

onMounted(() => {
  systemColorScheme.addEventListener('change', updateSystemColorScheme)
})
onUnmounted(() => {
  systemColorScheme.removeEventListener('change', updateSystemColorScheme)
})
</script>

<style scoped src="./themeSelectRow.css" />
<style scoped>
.customThemeActions,
.appIconActions {
  margin-block-start: 24px;
}

.testToastAction {
  display: flex;
  justify-content: center;
}

.testToastButton {
  margin-block: var(--settings-control-margin);
}

@container settings-content (width <= 580px) {
  .testToastAction {
    inline-size: 100%;
  }
}
</style>
