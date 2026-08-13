<template>
  <FtSettingsSubpage
    :open="open"
    :title="t('Settings.Theme Settings.Custom Theme.Custom Theme Creator')"
    :icon="['fas', 'palette']"
    grow-with-content
    persist-on-deactivate
    @close="closeEditor"
  >
    <div class="customThemeEditor">
      <div class="editorHeader">
        <label class="themeNameField">
          <span>{{ t('Settings.Theme Settings.Custom Theme.Theme Name') }}</span>
          <input
            v-model="draft.name"
            type="text"
            maxlength="80"
          >
        </label>
        <div class="fileActions">
          <FtIconButton
            :title="t('Settings.Theme Settings.Custom Theme.Import Theme')"
            :icon="['fas', 'folder-open']"
            @click="importTheme"
          />
          <FtIconButton
            :title="t('Settings.Theme Settings.Custom Theme.Export Theme')"
            :icon="['fas', 'download']"
            @click="exportTheme"
          />
        </div>
      </div>
      <div class="themeSources">
        <FtSelect
          :placeholder="t('Settings.Theme Settings.Custom Theme.Based On')"
          :value="basedOnTheme"
          :select-names="baseThemeNames"
          :select-values="BASE_THEME_VALUES"
          :icon="['fas', 'palette']"
          @change="copyBaseTheme"
        />
        <FtSelect
          :placeholder="t('Settings.Theme Settings.Main Color Theme.Main Color Theme')"
          :value="draft.mainColor"
          :select-names="themeColorNames"
          :select-values="COLOR_VALUES"
          :icon="['fas', 'palette']"
          icon-color="var(--primary-color)"
          @change="copyMainColor"
        />
        <FtSelect
          :placeholder="t('Settings.Theme Settings.Secondary Color Theme')"
          :value="draft.secondaryColor"
          :select-names="themeColorNames"
          :select-values="COLOR_VALUES"
          :icon="['fas', 'palette']"
          icon-color="var(--accent-color)"
          @change="copySecondaryColor"
        />
        <div class="darkThemeControl">
          <FtToggleSwitch
            :label="t('Settings.Theme Settings.Custom Theme.Is Dark Theme')"
            :default-value="draft.isDark"
            compact
            @change="updateDarkTheme"
          />
        </div>
      </div>

      <div class="colorGrid">
        <label
          v-for="([key, property, label]) in CUSTOM_THEME_COLORS"
          :key="key"
          class="colorField"
        >
          <input
            :value="draft.colors[key]"
            type="color"
            @input="updateColor(key, property, $event.target.value)"
            @change="commitColorChanges"
          >
          <span>{{ colorNames[label] ?? label }}</span>
          <code>{{ draft.colors[key] }}</code>
        </label>
      </div>

      <div class="editorFooter">
        <FtButton
          v-if="isSavedTheme"
          class="deleteThemeButton"
          :label="t('Settings.Theme Settings.Custom Theme.Delete Theme')"
          :icon="['fas', 'trash']"
          text-color="var(--destructive-text-color)"
          background-color="var(--destructive-color)"
          @click="showDeletePrompt = true"
        />
        <FtButton
          :label="t('Settings.Theme Settings.Custom Theme.Reset Colors')"
          :icon="['fas', 'undo']"
          @click="resetTheme"
        />
        <FtButton
          :label="t('Settings.Theme Settings.Custom Theme.Save and Apply')"
          :icon="['fas', 'floppy-disk']"
          @click="saveAndApply"
        />
      </div>
      <FtPrompt
        v-if="showDeletePrompt"
        :label="t('Settings.Theme Settings.Custom Theme.Delete Theme Confirmation', { name: draft.name })"
        :option-names="[t('Settings.Theme Settings.Custom Theme.Delete Theme'), t('Cancel')]"
        :option-values="['delete', 'cancel']"
        is-first-option-destructive
        @click="handleDeletePrompt"
      />
    </div>
  </FtSettingsSubpage>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, shallowReactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import { useColorTranslations } from '../../composables/colors'
import {
  cloneDefaultCustomTheme,
  CUSTOM_THEME_COLORS,
  customThemeIdFromValue,
  customThemeValue,
  normalizeCustomTheme,
} from '../../../customTheme'
import {
  applyThemeToDocument,
  deleteCustomTheme,
  loadCustomThemes,
  saveCustomTheme,
} from '../../helpers/customTheme'
import { colors } from '../../helpers/colors'
import { readFileWithPicker, showToast, writeFileWithPicker } from '../../helpers/utils'

const props = defineProps({
  open: {
    type: Boolean,
    required: true
  },
  themeId: {
    type: String,
    default: null
  }
})
const emit = defineEmits(['close'])
const { t, tm } = useI18n()
const draft = shallowReactive(cloneDefaultCustomTheme())
const showDeletePrompt = ref(false)
let previewing = false
const basedOnTheme = ref('dark')
const pendingColorPreviews = new Map()
let colorPreviewTimer = null

const BASE_THEME_VALUES = [
  'light', 'dark', 'black', 'nordic', 'hotPink', 'pastelPink',
  'catppuccinFrappe', 'catppuccinLatte', 'catppuccinMocha', 'dracula',
  'everforestDarkHard', 'everforestDarkMedium', 'everforestDarkLow',
  'everforestLightHard', 'everforestLightMedium', 'everforestLightLow',
  'gruvboxDark', 'gruvboxLight', 'solarizedDark', 'solarizedLight'
]
const BASE_THEME_TRANSLATION_KEYS = [
  'Light', 'Dark', 'Black', 'Nordic', 'Hot Pink', 'Pastel Pink',
  'Catppuccin Frappe', 'Catppuccin Latte', 'Catppuccin Mocha', 'Dracula',
  'Everforest Dark Hard', 'Everforest Dark Medium', 'Everforest Dark Low',
  'Everforest Light Hard', 'Everforest Light Medium', 'Everforest Light Low',
  'Gruvbox Dark', 'Gruvbox Light', 'Solarized Dark', 'Solarized Light'
]
const MAIN_COLOR_KEYS = ['primary', 'primaryHover', 'primaryActive', 'textWithPrimary']
const SECONDARY_COLOR_KEYS = [
  'accent', 'accentHover', 'accentActive', 'accentLight', 'accentVisited',
  'textWithAccent', 'link', 'linkVisited'
]
const baseThemeNames = computed(() => {
  const translations = tm('Settings.Theme Settings.Base Theme')
  return BASE_THEME_TRANSLATION_KEYS.map(key => translations[key] ?? key)
})
const COLOR_VALUES = colors.map(color => color.name)
const themeColorNames = useColorTranslations()
const colorNames = computed(() => tm('Settings.Theme Settings.Custom Theme.Colors'))
const isSavedTheme = computed(() => store.getters.getCustomThemes.some(({ id }) => id === draft.id))

watch(() => props.open, async (open) => {
  store.commit('setCustomThemeEditorOpen', open)
  if (!open) return
  try {
    const themes = await loadCustomThemes()
    store.commit('setCustomThemes', themes)
    const theme = themes.find(({ id }) => id === props.themeId)
    if (theme) {
      setDraft(theme)
      previewing = true
      previewTheme()
    } else {
      const newTheme = cloneDefaultCustomTheme()
      newTheme.id = crypto.randomUUID()
      const selectedTheme = resolveSelectedTheme(store.getters.getBaseTheme)
      const selectedCustomTheme = themes.find(({ id }) => id === customThemeIdFromValue(selectedTheme))
      if (selectedCustomTheme) {
        setDraft(normalizeCustomTheme({
          ...selectedCustomTheme,
          id: newTheme.id,
          name: newTheme.name,
          colors: { ...selectedCustomTheme.colors }
        }))
        previewing = true
        previewTheme()
      } else {
        setDraft(normalizeCustomTheme(newTheme))
        draft.mainColor = store.getters.getMainColor
        draft.secondaryColor = store.getters.getSecColor
        copyBaseTheme(BASE_THEME_VALUES.includes(selectedTheme) ? selectedTheme : 'dark')
      }
    }
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Unable to Load'), error)
  }
}, { immediate: true })

function resolveSelectedTheme(theme) {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? store.getters.getSystemDarkTheme
    : store.getters.getSystemLightTheme
}

watch(() => store.getters.getIsKeyboardShortcutPromptShown, (open) => {
  if (open && props.open) closeEditor()
}, { flush: 'sync' })

function setDraft(theme) {
  draft.version = theme.version
  draft.id = theme.id
  draft.name = theme.name
  draft.basedOn = theme.basedOn
  basedOnTheme.value = theme.basedOn
  draft.mainColor = theme.mainColor
  draft.secondaryColor = theme.secondaryColor
  draft.isDark = theme.isDark
  draft.colors = { ...theme.colors }
}

function previewTheme() {
  applyThemeToDocument(customThemeValue(draft.id), store.getters.getMainColor, store.getters.getSecColor, draft)
}

function closeEditor() {
  previewing = false
  showDeletePrompt.value = false
  store.commit('setCustomThemeEditorOpen', false)
  cancelPendingColorPreviews()
  applyThemeToDocument(
    store.getters.getBaseTheme,
    store.getters.getMainColor,
    store.getters.getSecColor,
    store.getters.getCustomThemes.find(({ id }) => id === customThemeIdFromValue(store.getters.getBaseTheme)) ?? null
  )
  emit('close')
}

function resetTheme() {
  cancelPendingColorPreviews()
  copyThemeSources()
}

function updateColor(key, property, value) {
  draft.colors[key] = value
  if (!previewing) return

  pendingColorPreviews.set(key, { property, value })
  if (colorPreviewTimer === null) {
    colorPreviewTimer = setTimeout(flushColorPreviews, 32)
  }
}

function commitColorChanges() {
  flushColorPreviews()
  // Keep drag-time changes outside Vue's render cycle. Replacing the object
  // once the native picker commits updates the displayed hex value without
  // writing back into an open color picker on every pointer movement.
  draft.colors = { ...draft.colors }
}

function flushColorPreviews() {
  if (colorPreviewTimer !== null) {
    clearTimeout(colorPreviewTimer)
    colorPreviewTimer = null
  }
  for (const [key, { property, value }] of pendingColorPreviews) {
    document.body.style.setProperty(property, value)
    if (key === 'accent') {
      document.body.style.setProperty(
        '--accent-color-rgb',
        value.match(/[\da-f]{2}/gi).map(component => Number.parseInt(component, 16)).join(' ')
      )
    }
  }
  pendingColorPreviews.clear()
}

function cancelPendingColorPreviews() {
  if (colorPreviewTimer !== null) {
    clearTimeout(colorPreviewTimer)
    colorPreviewTimer = null
  }
  pendingColorPreviews.clear()
}

function updateDarkTheme(value) {
  draft.isDark = value
  if (previewing) {
    document.body.dataset.customTheme = value ? 'dark' : 'light'
  }
}

function copyBaseTheme(baseTheme) {
  cancelPendingColorPreviews()
  basedOnTheme.value = baseTheme
  draft.basedOn = baseTheme
  copyThemeSources()
}

function copyMainColor(mainColor) {
  draft.mainColor = mainColor
  copyThemeColors(MAIN_COLOR_KEYS)
}

function copySecondaryColor(secondaryColor) {
  draft.secondaryColor = secondaryColor
  copyThemeColors(SECONDARY_COLOR_KEYS)
}

function copyThemeSources() {
  cancelPendingColorPreviews()
  draft.colors = readThemeSourceColors()
  draft.isDark = !['light', 'pastelPink', 'catppuccinLatte', 'everforestLightHard',
    'everforestLightMedium', 'everforestLightLow', 'gruvboxLight', 'solarizedLight']
    .includes(draft.basedOn)
  previewing = true
  previewTheme()
}

function copyThemeColors(keys) {
  cancelPendingColorPreviews()
  const sourceColors = readThemeSourceColors()
  draft.colors = {
    ...draft.colors,
    ...Object.fromEntries(keys.map(key => [key, sourceColors[key]]))
  }
  previewing = true
  previewTheme()
}

function readThemeSourceColors() {
  previewing = false
  applyThemeToDocument(draft.basedOn, draft.mainColor, draft.secondaryColor, null)

  const probe = document.createElement('span')
  probe.hidden = true
  document.body.append(probe)
  const backgroundHex = readColor(probe, '--bg-color', [255, 255, 255])
  const background = backgroundHex.match(/[\da-f]{2}/gi).map(value => Number.parseInt(value, 16))
  const colors = Object.fromEntries(CUSTOM_THEME_COLORS.map(([key, property]) =>
    [key, readColor(probe, property, background)]))
  probe.remove()
  return colors
}

function readColor(probe, property, background) {
  probe.style.color = `var(${property})`
  const color = getComputedStyle(probe).color
  const match = color.match(/rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/)
  if (!match) return '#000000'

  const alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4])
  return '#' + match.slice(1, 4).map((value, index) => {
    const composited = Math.round(Number.parseInt(value, 10) * alpha + background[index] * (1 - alpha))
    return composited.toString(16).padStart(2, '0')
  }).join('')
}

async function saveAndApply() {
  try {
    flushColorPreviews()
    const themes = await saveCustomTheme(draft)
    store.commit('setCustomThemes', themes)
    const savedTheme = themes.find(({ id }) => id === draft.id)
    setDraft(savedTheme)
    await store.dispatch('updateBaseTheme', customThemeValue(savedTheme.id))
    showToast({
      message: t('Settings.Theme Settings.Custom Theme.Theme Saved'),
      icon: ['fas', 'check']
    })
    closeEditor()
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Unable to Save'), error)
  }
}

async function handleDeletePrompt(value) {
  showDeletePrompt.value = false
  if (value !== 'delete') return

  try {
    const deletedThemeValue = customThemeValue(draft.id)
    const themes = await deleteCustomTheme(draft.id)
    store.commit('setCustomThemes', themes)
    if (store.getters.getSystemLightTheme === deletedThemeValue) {
      await store.dispatch('updateSystemLightTheme', draft.basedOn)
    }
    if (store.getters.getSystemDarkTheme === deletedThemeValue) {
      await store.dispatch('updateSystemDarkTheme', draft.basedOn)
    }
    if (store.getters.getBaseTheme === deletedThemeValue) {
      await store.dispatch('updateMainColor', draft.mainColor)
      await store.dispatch('updateSecColor', draft.secondaryColor)
      await store.dispatch('updateBaseTheme', draft.basedOn)
    }
    showToast({
      message: t('Settings.Theme Settings.Custom Theme.Theme Deleted'),
      icon: ['fas', 'trash']
    })
    closeEditor()
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Unable to Delete'), error)
  }
}

async function importTheme() {
  try {
    const file = await readFileWithPicker(
      t('Settings.Theme Settings.Custom Theme.Theme File'),
      { 'application/json': '.json' },
      'custom-theme-import',
      'documents'
    )
    if (file === null) return
    cancelPendingColorPreviews()
    const importedTheme = normalizeCustomTheme(JSON.parse(file.content))
    importedTheme.id = crypto.randomUUID()
    setDraft(importedTheme)
    previewTheme()
    showToast({
      message: t('Settings.Theme Settings.Custom Theme.Theme Imported'),
      icon: ['fas', 'check']
    })
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Invalid Theme File'), error)
  }
}

async function exportTheme() {
  try {
    const theme = normalizeCustomTheme(draft)
    const filename = `${theme.name.replaceAll(/[^\p{L}\p{N}._-]+/gu, '-').replaceAll(/^-|-$/g, '') || 'custom-theme'}.json`
    const saved = await writeFileWithPicker(
      filename,
      `${JSON.stringify(theme, null, 2)}\n`,
      t('Settings.Theme Settings.Custom Theme.Theme File'),
      'application/json',
      '.json',
      'custom-theme-export',
      'documents'
    )
    if (saved) {
      showToast({
        message: t('Settings.Theme Settings.Custom Theme.Theme Exported'),
        icon: ['fas', 'check']
      })
    }
  } catch (error) {
    showError(t('Settings.Theme Settings.Custom Theme.Unable to Export'), error)
  }
}

function showError(message, error) {
  console.error(message, error)
  const detail = error instanceof Error ? error.message : String(error)
  showToast({ message: `${message}: ${detail}`, icon: ['fas', 'circle-exclamation'] })
}

onBeforeUnmount(() => {
  cancelPendingColorPreviews()
  store.commit('setCustomThemeEditorOpen', false)
})
</script>

<style scoped>
.customThemeEditor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
}

.editorFooter,
.fileActions {
  display: flex;
  align-items: end;
  gap: 12px;
}

.editorHeader {
  display: flex;
  align-items: end;
  gap: 12px;
}

.editorFooter {
  justify-content: flex-end;
}

.deleteThemeButton {
  margin-inline-end: auto;
}

.themeNameField {
  flex: 1;
  display: grid;
  gap: 8px;
  color: var(--secondary-text-color);
}

.themeSources {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 12px;
  min-block-size: 75px;
}

.themeSources :deep(.select) {
  flex: 1 1 200px;
  min-inline-size: 0;
  max-inline-size: 260px;
}

.darkThemeControl {
  flex: 0 0 auto;
  padding-block-start: 31px;
}

.themeNameField input {
  box-sizing: border-box;
  inline-size: 100%;
  min-block-size: 42px;
  border: 1px solid var(--divider-color);
  border-radius: calc(8px * var(--ui-roundness));
  padding-inline: 12px;
  color: var(--primary-text-color);
  background: var(--search-bar-color);
}

.colorGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.colorField {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-block-size: 46px;
  border-radius: calc(8px * var(--ui-roundness));
  padding: 6px 10px;
  color: var(--primary-text-color);
  background: var(--card-bg-color);
}

.colorField input {
  inline-size: 38px;
  block-size: 32px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}

.colorField code {
  color: var(--tertiary-text-color);
  font-size: 0.78rem;
}

@container (width < 560px) {
  .customThemeEditor {
    padding: 16px;
  }

  .editorHeader {
    align-items: end;
  }

  .themeSources {
    flex-direction: column;
    gap: 0;
  }

  .darkThemeControl {
    padding-block-start: 0;
  }

  .themeSources :deep(.select) {
    flex-basis: auto;
    inline-size: 100%;
    max-inline-size: none;
  }
}
</style>
