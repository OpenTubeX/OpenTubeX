<template>
  <div class="themePickerEntry">
    <button
      type="button"
      class="themePickerButton"
      data-settings-subpage="theme"
      @click="open = true"
    >
      <ThemePreview
        class="entryPreview"
        v-bind="mode === 'system' ? systemPreview : { theme: baseTheme }"
      />
      <span class="entryText">
        <span class="entryLabel">{{ t('Settings.Theme Settings.Theme and Colors') }}</span>
        <span class="entrySummary">
          <span
            v-for="(theme, index) in themeSummary"
            :key="index"
            class="entryChip"
          >
            <FtIcon
              v-if="theme.icon"
              class="entryChipIcon"
              :icon="theme.icon"
            />
            <span class="entryChipName">{{ theme.name }}</span>
          </span>
        </span>
        <span
          v-if="colorSummary.length > 0"
          class="entrySummary entryColors"
        >
          <span
            v-for="color in colorSummary"
            :key="color.label"
            class="entryChip"
            :title="color.label"
          >
            <span
              class="entrySwatch"
              :style="{ backgroundColor: color.color }"
            />
            <span class="entryChipName">{{ color.name }}</span>
          </span>
        </span>
      </span>
      <FtIcon
        class="entryChevron"
        :icon="['fas', 'angle-right']"
      />
    </button>
    <FtSyncedSettingIndicator
      :setting-keys="THEME_SETTING_KEYS"
      :is-changed="themeSettingsChanged"
      @reset="resetThemeSettings"
    />
  </div>
  <FtSettingsSubpage
    :open="open"
    :title="t('Settings.Theme Settings.Theme and Colors')"
    :icon="['fas', 'palette']"
    grow-with-content
    @close="open = false"
  >
    <div
      ref="contentRef"
      class="themeGallery"
    >
      <div class="themeHeader">
        <div
          class="themeModes"
          role="radiogroup"
          data-setting-key="baseTheme"
          :aria-label="t('Settings.Theme Settings.Base Theme.Base Theme')"
        >
          <label
            v-for="tile in modeTiles"
            :key="tile.mode"
            class="themeOption"
          >
            <input
              type="radio"
              name="themeMode"
              :checked="mode === tile.mode"
              @change="selectMode(tile.mode)"
            >
            <span class="optionPreview">
              <ThemePreview v-bind="tile.preview" />
            </span>
            <span class="optionName">{{ tile.name }}</span>
          </label>
        </div>

        <!-- Every color control stays rendered in one cell and only the edited
             theme's is shown, so choosing a theme never moves the gallery. -->
        <div class="themeColors">
          <FtFlexBox
            class="themeSelectRow"
            :class="{ hiddenColorControl: colorControl !== 'colors' }"
          >
            <FtSelect
              size-to-content
              :placeholder="t('Settings.Theme Settings.Main Color Theme.Main Color Theme')"
              :value="mainColor"
              setting-key="mainColor"
              :select-names="colorNames"
              :select-values="COLOR_VALUES"
              :option-colors="COLOR_SWATCHES"
              :icon="['fas', 'palette']"
              icon-color="var(--primary-color)"
              @change="store.dispatch('updateMainColor', $event)"
            />
            <FtSelect
              size-to-content
              :placeholder="t('Settings.Theme Settings.Secondary Color Theme')"
              :value="secColor"
              setting-key="secColor"
              :select-names="colorNames"
              :select-values="COLOR_VALUES"
              :option-colors="COLOR_SWATCHES"
              :icon="['fas', 'palette']"
              icon-color="var(--accent-color)"
              @change="store.dispatch('updateSecColor', $event)"
            />
          </FtFlexBox>
          <AccentColorSettings
            :class="{ hiddenColorControl: colorControl !== 'material' }"
            :model-value="store.getters.getMaterialSeedColor"
            @update:model-value="store.dispatch('updateMaterialSeedColor', $event)"
          />
          <AccentColorSettings
            :class="{ hiddenColorControl: colorControl !== 'signal' }"
            variant="signal"
            :model-value="store.getters.getSignalAccentColor"
            @update:model-value="store.dispatch('updateSignalAccentColor', $event)"
          />
        </div>
      </div>

      <div class="themeTabBar">
        <FtTabs
          variant="segmented"
          :aria-label="t('Settings.Theme Settings.Base Theme.Base Theme')"
        >
          <button
            v-for="tab in tabs"
            :id="`theme-tab-${tab.id}`"
            :key="tab.id"
            type="button"
            class="themeTab"
            role="tab"
            aria-controls="theme-tab-panel"
            :aria-selected="tab.id === section.id"
            :tabindex="tab.id === section.id ? 0 : -1"
            @click="editing = tab.id"
            @keydown.left.right.prevent="switchTab"
          >
            <FtIcon :icon="tab.icon" />
            <span class="themeTabText">
              <span class="themeTabLabel">{{ tab.label }}</span>
              <span class="themeTabValue">{{ tab.selectedName }}</span>
            </span>
          </button>
        </FtTabs>
        <FtSyncedSettingIndicator
          :key="section.settingKey"
          :setting-key="section.settingKey"
          :is-changed="section.selected !== DEFAULT_SETTINGS[section.settingKey]"
          @reset="selectTheme(section.id, DEFAULT_SETTINGS[section.settingKey])"
        />
        <div class="themeActions">
          <FtButton
            :title="t('Theme Discovery.Discover Themes')"
            :icon="['fas', 'search']"
            @click="showThemeDiscovery = true"
          >
            <template #label>
              <span class="themeActionLabel">{{ t('Theme Discovery.Discover Themes') }}</span>
            </template>
          </FtButton>
          <FtButton
            :title="t('Settings.Theme Settings.Custom Theme.Create Custom Theme')"
            :icon="['fas', 'palette']"
            @click="openCustomThemeEditor(null)"
          >
            <template #label>
              <span class="themeActionLabel">{{ t('Settings.Theme Settings.Custom Theme.Create Custom Theme') }}</span>
            </template>
          </FtButton>
        </div>
      </div>

      <div
        id="theme-tab-panel"
        class="themeSection"
        role="tabpanel"
        :aria-label="section.label"
        :data-setting-key="section.settingKey"
      >
        <div
          v-for="group in section.groups"
          :key="group.id"
          class="themeGroup"
          role="group"
          :aria-labelledby="group.label ? `theme-group-${group.id}` : undefined"
        >
          <h4
            v-if="group.label"
            :id="`theme-group-${group.id}`"
            class="themeGroupLabel"
          >
            {{ group.label }}
          </h4>
          <div class="themeOptions">
            <div
              v-for="option in group.options"
              :key="option.value"
              class="themeCard"
            >
              <label class="themeOption">
                <input
                  type="radio"
                  :name="section.settingKey"
                  :checked="option.value === section.selected"
                  @change="selectTheme(section.id, option.value)"
                >
                <span class="optionPreview">
                  <ThemePreview
                    :theme="option.value"
                    :dark="section.id === 'dark'"
                  />
                  <FtIcon
                    v-if="option.value === section.selected"
                    class="selectedBadge"
                    :icon="['fas', 'check']"
                  />
                </span>
                <span
                  :id="`theme-name-${option.value}`"
                  class="optionName"
                >{{ option.name }}</span>
              </label>
              <button
                v-if="isCustomThemeValue(option.value)"
                type="button"
                class="editThemeButton"
                :aria-label="t('Settings.Theme Settings.Custom Theme.Edit Custom Theme')"
                :aria-describedby="`theme-name-${option.value}`"
                :title="t('Settings.Theme Settings.Custom Theme.Edit Custom Theme')"
                @click="openCustomThemeEditor(customThemeIdFromValue(option.value))"
              >
                <FtIcon :icon="['fas', 'pen']" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </FtSettingsSubpage>
  <ThemeDiscovery
    :open="showThemeDiscovery"
    @close="showThemeDiscovery = false"
  />
  <CustomThemeEditor
    :open="showCustomThemeEditor"
    :theme-id="editingCustomThemeId"
    @close="showCustomThemeEditor = false"
  />
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsSubpage from '../../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtTabs from '../../FtTabs/FtTabs.vue'
import FtSyncedSettingIndicator from '../../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import ThemeDiscovery from '../../ThemeDiscovery.vue'
import CustomThemeEditor from '../../CustomThemeEditor/CustomThemeEditor.vue'
import AccentColorSettings from './AccentColorSettings.vue'
import ThemePreview from './ThemePreview.vue'

import store from '../../../store/index'
import { DEFAULT_SETTINGS } from '../../../store/modules/settings'
import { getThemeClassification, hasFixedThemeColors } from '../../../../appearanceSettings'
import { customThemeIdFromValue, isCustomThemeValue } from '../../../../customTheme'
import { DEFAULT_MATERIAL_SEED_COLOR, MATERIAL_SEED_PRESETS, MATERIAL_SYSTEM_SEED, MATERIAL_THEME_VALUES } from '../../../../materialTheme.js'
import { DEFAULT_SIGNAL_ACCENT_COLOR, SIGNAL_ACCENT_PRESETS, SIGNAL_THEME_VALUES } from '../../../../signalTheme.js'
import { colors } from '../../../helpers/colors'
import { androidDynamicColors, getSystemAccentColor } from '../../../helpers/dynamicColors.js'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../../helpers/overlayScrollbars'
import { useColorTranslations } from '../../../composables/colors'
import { baseThemeGroup, useBaseThemeOptions } from '../../../composables/baseThemes'
import { useSystemDarkMode } from '../../../composables/useSystemDarkMode'

const { t, tm } = useI18n()
/** @type {boolean} */
const usingElectron = process.env.IS_ELECTRON

const open = ref(false)
const showThemeDiscovery = ref(false)
const showCustomThemeEditor = ref(false)
const editingCustomThemeId = ref(null)

function openCustomThemeEditor(themeId) {
  editingCustomThemeId.value = themeId
  showCustomThemeEditor.value = true
}
const contentRef = useTemplateRef('contentRef')

const customThemes = computed(() => store.getters.getCustomThemes)
const { baseThemeValues, baseThemeNames, baseThemeGroupLabels } = useBaseThemeOptions(customThemes)
const baseTheme = computed(() => store.getters.getBaseTheme)

function themeName(value) {
  return baseThemeNames.value[baseThemeValues.value.indexOf(value)] ?? ''
}

/** System default and Dynamic colors follow the system; every other theme is either light or dark. */
const mode = computed(() => ['system', 'dynamic'].includes(baseTheme.value)
  ? 'system'
  : getThemeClassification(baseTheme.value, customThemes.value) ?? 'system')

// The system theme settings remember the light and dark choices while a single theme is active.
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

const systemDark = useSystemDarkMode()
/** The theme list shown in System default mode; single theme modes always show their own. */
const editing = ref(systemDark.value ? 'dark' : 'light')
watch(mode, value => {
  if (value !== 'system') editing.value = value
})

function selectedTheme(id) {
  if (baseTheme.value === 'dynamic') return 'dynamic'
  return id === 'light' ? lightTheme.value : darkTheme.value
}

function sectionLabel(id) {
  return id === 'light' ? t('Settings.Theme Settings.Light Theme') : t('Settings.Theme Settings.Dark Theme')
}

const tabs = computed(() => (mode.value === 'system' ? ['light', 'dark'] : [mode.value]).map(id => ({
  id,
  icon: ['fas', id === 'light' ? 'sun' : 'moon'],
  label: sectionLabel(id),
  selectedName: themeName(selectedTheme(id)),
})))

const section = computed(() => {
  const id = mode.value === 'system' ? editing.value : mode.value
  const groups = []
  baseThemeValues.value.forEach((value, index) => {
    // Dynamic colors has a light and a dark variant, so both lists offer it.
    if (value !== 'dynamic' && getThemeClassification(value, customThemes.value) !== id) return
    const groupId = baseThemeGroup(value)
    let group = groups.at(-1)
    if (group?.id !== groupId) {
      group = { id: groupId, label: baseThemeGroupLabels.value[groupId] ?? '', options: [] }
      groups.push(group)
    }
    group.options.push({ value, name: baseThemeNames.value[index] })
  })
  return {
    id,
    label: sectionLabel(id),
    settingKey: id === 'light' ? 'systemLightTheme' : 'systemDarkTheme',
    selected: selectedTheme(id),
    groups,
  }
})

async function switchTab() {
  if (mode.value !== 'system') return
  editing.value = editing.value === 'light' ? 'dark' : 'light'
  await nextTick()
  document.getElementById(`theme-tab-${editing.value}`)?.focus()
}

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

async function selectTheme(section, value) {
  if (value === 'dynamic') {
    await store.dispatch('updateBaseTheme', value)
    return
  }
  await store.dispatch(section === 'light' ? 'updateSystemLightTheme' : 'updateSystemDarkTheme', value)
  await store.dispatch('updateBaseTheme', mode.value === 'system' ? 'system' : value)
}

const activeThemes = computed(() => baseTheme.value === 'system'
  ? [store.getters.getSystemLightTheme, store.getters.getSystemDarkTheme]
  : [baseTheme.value])
const usesMaterialSeedColor = theme => MATERIAL_THEME_VALUES.includes(theme) &&
  !(theme === 'dynamic' && (usingElectron || androidDynamicColors.value.supported))
const showMaterialSeedColor = computed(() => activeThemes.value.some(usesMaterialSeedColor))
const showSignalAccentColor = computed(() => activeThemes.value.some(theme => SIGNAL_THEME_VALUES.includes(theme)))
const showColorThemes = computed(() => activeThemes.value.some(theme => !hasFixedThemeColors(theme)))

/** The color settings of the theme being edited: main and secondary colors, an accent color, or none. */
const colorControl = computed(() => {
  const theme = section.value.selected
  if (usesMaterialSeedColor(theme)) return 'material'
  if (SIGNAL_THEME_VALUES.includes(theme)) return 'signal'
  return hasFixedThemeColors(theme) ? null : 'colors'
})

const COLOR_VALUES = colors.map(color => color.name)
const COLOR_SWATCHES = colors.map(color => color.value)
const colorNames = useColorTranslations()
const mainColor = computed(() => store.getters.getMainColor)
const secColor = computed(() => store.getters.getSecColor)

/** Shown on the Appearance page, so the theme and the colors that apply to it are visible without opening the gallery. */
const themeSummary = computed(() => mode.value === 'system' && baseTheme.value !== 'dynamic'
  ? [
      { icon: ['fas', 'sun'], name: themeName(lightTheme.value) },
      { icon: ['fas', 'moon'], name: themeName(darkTheme.value) },
    ]
  : [{ icon: null, name: themeName(baseTheme.value) }])

function accentSummary(label, value, presets, fallback) {
  if (value === MATERIAL_SYSTEM_SEED) {
    return {
      label,
      color: getSystemAccentColor() ?? fallback,
      name: androidDynamicColors.value.supported
        ? t('Settings.Theme Settings.Material Wallpaper Colors')
        : t('Settings.Theme Settings.Material System Accent Color'),
    }
  }
  const preset = presets.find(({ color }) => color === value.toLowerCase())
  const presetNames = tm('Settings.Theme Settings.Main Color Theme')
  return { label, color: value, name: preset ? presetNames[preset.name] ?? preset.name : value }
}

const colorSummary = computed(() => {
  const summary = []
  if (showColorThemes.value) {
    for (const [label, value] of [
      [t('Settings.Theme Settings.Main Color Theme.Main Color Theme'), mainColor.value],
      [t('Settings.Theme Settings.Secondary Color Theme'), secColor.value],
    ]) {
      const index = COLOR_VALUES.indexOf(value)
      summary.push({ label, color: COLOR_SWATCHES[index], name: colorNames.value[index] ?? value })
    }
  }
  if (showMaterialSeedColor.value) {
    summary.push(accentSummary(t('Settings.Theme Settings.Material Accent Color'),
      store.getters.getMaterialSeedColor, MATERIAL_SEED_PRESETS, DEFAULT_MATERIAL_SEED_COLOR))
  }
  if (showSignalAccentColor.value) {
    summary.push(accentSummary(t('Settings.Theme Settings.Tally Accent Color'),
      store.getters.getSignalAccentColor, SIGNAL_ACCENT_PRESETS, DEFAULT_SIGNAL_ACCENT_COLOR))
  }
  return summary
})

const THEME_SETTING_KEYS = ['baseTheme', 'systemLightTheme', 'systemDarkTheme', 'mainColor', 'secColor', 'materialSeedColor', 'signalAccentColor']
const themeSettingsChanged = computed(() => THEME_SETTING_KEYS.some(key => store.state.settings[key] !== DEFAULT_SETTINGS[key]))
function resetThemeSettings() {
  for (const key of THEME_SETTING_KEYS) {
    if (store.state.settings[key] !== DEFAULT_SETTINGS[key]) store.dispatch('resetSettingToDefault', key)
  }
}

let resizeObserver
watch(open, async (isOpen) => {
  resizeObserver?.disconnect()
  if (!isOpen) return
  // Start with the theme the app currently shows.
  if (mode.value === 'system') editing.value = systemDark.value ? 'dark' : 'light'
  await nextTick()
  const content = contentRef.value
  if (!content) return
  const scroller = content.closest('.settingsSubpageScroll')
  restoreOverlayScrollTop(scroller, 0)
  resizeObserver = new ResizeObserver(() => {
    // Hidden under theme discovery or the theme editor, which use the same viewport.
    if (content.getClientRects().length > 0) clampOverlayScrollTop(scroller, content)
  })
  resizeObserver.observe(content)
  resizeObserver.observe(scroller)
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped src="./themeSelectRow.css" />
<style scoped>
.themePickerEntry {
  container-type: inline-size;
  display: flex;
  align-items: center;
  gap: 4px;
  min-inline-size: 0;
}

.themePickerButton {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 12px;
  min-inline-size: 0;
  padding: 8px;
  padding-inline-end: 12px;
  border: 1px solid var(--input-border-color, var(--border-color));
  border-radius: var(--shape-corner-medium);
  background-color: transparent;
  color: var(--primary-text-color);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: background-color var(--motion-fast-effects), border-radius var(--motion-fast-spatial);
}

.themePickerButton:hover,
.themePickerButton:focus-visible {
  background-color: var(--side-nav-hover-color);
}

.themePickerButton:active {
  border-radius: var(--shape-corner-small);
  background-color: var(--side-nav-active-color);
}

.entryPreview {
  flex-shrink: 0;
  inline-size: 80px;
  border-radius: var(--shape-corner-small);
  box-shadow: 0 0 0 1px var(--divider-color);
}

.entryText {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-inline-size: 0;
}

.entryLabel {
  font-size: 0.8em;
  color: var(--secondary-text-color);
}

/* Each summary stays on one line; long names shorten instead of wrapping. */
.entrySummary {
  display: flex;
  gap: 4px 14px;
  min-inline-size: 0;
}

.entryColors {
  font-size: 0.875em;
  color: var(--secondary-text-color);
}

.entryChip {
  display: flex;
  align-items: center;
  gap: 6px;
  min-inline-size: 0;
}

.entryChipIcon,
.entrySwatch {
  flex-shrink: 0;
}

.entryChipIcon {
  color: var(--secondary-text-color);
}

.entrySwatch {
  inline-size: 0.8em;
  block-size: 0.8em;
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--divider-color);
}

.entryChipName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Narrow rows list each theme and color on its own line, so names stay readable. */
@container (width < 440px) {
  .entryPreview {
    inline-size: 56px;
  }

  .entrySummary {
    flex-direction: column;
    gap: 2px;
  }
}

.entryChevron {
  flex-shrink: 0;
  color: var(--secondary-text-color);
}

.themeGallery {
  /* The gap spaces the controls; selects add their own margin otherwise. */
  --settings-control-margin: 0;

  display: flex;
  flex-direction: column;
  gap: 24px;
  min-inline-size: 0;
}

.themeHeader {
  display: grid;
  grid-template-columns: minmax(0, 34rem) minmax(0, 1fr);
  align-items: center;
  gap: 16px 32px;
}

.themeModes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

/* The color controls share one cell, so it is as tall as the tallest of them
   whichever is shown. */
.themeColors {
  display: grid;
  align-items: center;
  justify-items: center;
  min-inline-size: 0;
}

.themeColors > * {
  grid-area: 1 / 1;
}

.themeColors > .themeSelectRow {
  justify-self: stretch;

  /* Stacked selects need room for the label above each. */
  row-gap: 20px;
}

.hiddenColorControl {
  visibility: hidden;
}

@container (width < 760px) {
  .themeHeader {
    grid-template-columns: minmax(0, 1fr);
  }
}

.themeTabBar {
  display: flex;
  align-items: center;
  gap: 4px;
  min-inline-size: 0;
}

.themeTabBar > .materialTabs {
  flex: 0 1 auto;
  min-inline-size: 0;
}

.themeActions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  margin-inline-start: auto;
}

.themeActions .btn {
  margin: 0;
}

/* Narrow rows keep the actions beside the tabs as icon buttons. */
@container (width < 760px) {
  .themeActionLabel {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .themeActions .btn {
    min-inline-size: 0;
    padding-inline: 12px;
  }
}

.themeTab {
  min-inline-size: 0;
  text-align: start;
}

.themeTabText {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}

.themeTabLabel {
  font-size: 0.8em;
  font-weight: 400;
}

.themeTabValue {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.themeSection {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-inline-size: 0;
}

.themeGroupLabel {
  margin-block: 0 12px;
  font-size: 1em;
  font-weight: 600;
  color: var(--secondary-text-color);
}

.themeOptions {
  display: grid;
  /* At least two columns, so phones still compare themes side by side. */
  grid-template-columns: repeat(auto-fill, minmax(min(calc(50% - 6px), 176px), 1fr));
  gap: 16px 12px;
}

.themeCard {
  position: relative;
  min-inline-size: 0;
}

.editThemeButton {
  position: absolute;
  z-index: 2;
  inset-block-start: 6px;
  inset-inline-start: 6px;
  display: grid;
  place-items: center;
  inline-size: 28px;
  block-size: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background-color: var(--card-bg-color);
  color: var(--primary-text-color);
  box-shadow: 0 1px 3px var(--primary-shadow-color);
  cursor: pointer;
  transition: background-color var(--motion-fast-effects);
}

.editThemeButton:hover,
.editThemeButton:focus-visible {
  background-color: var(--side-nav-hover-color);
}

.editThemeButton .ft-icon {
  font-size: 0.85em;
}

.themeOption {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-inline-size: 0;
  cursor: pointer;
}

/* The preview is the control; the radio stays for keyboard and screen readers. */
.themeOption input {
  position: absolute;
  z-index: 1;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.optionPreview {
  position: relative;
  display: block;
  border-radius: var(--shape-corner-medium);
  outline: 1px solid var(--divider-color);
  transition: outline-color var(--motion-fast-effects), border-radius var(--motion-fast-spatial);
}

.themeOption:hover .optionPreview {
  outline: 2px solid var(--tertiary-text-color);
}

.themeOption:has(:checked) .optionPreview {
  outline: 3px solid var(--primary-color);
  outline-offset: 2px;
}

.themeOption:has(:focus-visible) .optionPreview {
  outline: 3px solid var(--primary-color);
  outline-offset: 4px;
}

.themeOption:active .optionPreview {
  border-radius: var(--shape-corner-small);
}

.selectedBadge {
  position: absolute;
  inset-block-start: 6px;
  inset-inline-end: 6px;
  box-sizing: border-box;
  inline-size: 24px;
  block-size: 24px;
  padding: 4px;
  border-radius: 50%;
  background-color: var(--primary-color);
  color: var(--text-with-main-color);
}

.optionName {
  overflow-wrap: anywhere;
  text-align: center;
}

.themeOption:has(:checked) .optionName {
  font-weight: 600;
}
</style>
