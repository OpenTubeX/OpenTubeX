<template>
  <FtSettingsSection
    :title="$t('Settings.Theme Settings.Theme Settings')"
  >
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Match Top Bar with Main Color')"
          compact
          :default-value="barColor"
          setting-key="barColor"
          @change="updateBarColor"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Expand Side Bar by Default')"
          compact
          :default-value="expandSideBar"
          setting-key="expandSideBar"
          @change="handleExpandSideBar"
        />
        <FtToggleSwitch
          v-if="usingElectron"
          :label="$t('Settings.Theme Settings.Disable Smooth Scrolling')"
          compact
          :default-value="disableSmoothScrollingToggleValue"
          @change="handleRestartPrompt"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Show Thumbnail Size Button in Header')"
          compact
          :default-value="showThumbnailSizeButtonInHeader"
          setting-key="showThumbnailSizeButtonInHeader"
          @change="updateShowThumbnailSizeButtonInHeader"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Hide Side Bar Labels')"
          compact
          :default-value="hideLabelsSideBar"
          setting-key="hideLabelsSideBar"
          @change="updateHideLabelsSideBar"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Hide Side Bar on Watch Pages')"
          compact
          :default-value="hideSideBarOnWatchPages"
          setting-key="hideSideBarOnWatchPages"
          @change="updateHideSideBarOnWatchPages"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Hide OpenTubeX Header Logo')"
          compact
          :default-value="hideHeaderLogo"
          setting-key="hideHeaderLogo"
          @change="updateHideHeaderLogo"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Hide Profile Selector in Header')"
          :tooltip="$t('Tooltips.Theme Settings.Hide Profile Selector in Header')"
          compact
          :default-value="hideProfileSelectorInHeader"
          setting-key="hideProfileSelectorInHeader"
          @change="updateHideProfileSelectorInHeader"
        />
      </div>
    </div>
    <template v-if="usingElectron">
      <FtFlexBox>
        <FtSlider
          :label="$t('Settings.Theme Settings.UI Scale')"
          :default-value="uiScale"
          :min-value="50"
          :max-value="300"
          :step="5"
          value-extension="%"
          @change="updateUiScale"
        />
      </FtFlexBox>
    </template>
    <FtFlexBox>
      <div class="switchColumn">
        <FtSlider
          :label="t('Settings.Theme Settings.Thumbnail Size')"
          :default-value="thumbnailSize"
          setting-key="thumbnailSize"
          :min-value="MIN_THUMBNAIL_SIZE"
          :max-value="MAX_THUMBNAIL_SIZE"
          :step="THUMBNAIL_SIZE_STEP"
          value-extension="%"
          @input="previewThumbnailSize"
          @change="updateThumbnailSize"
        />
      </div>
    </FtFlexBox>
    <br>
    <FtFlexBox>
      <FtSelect
        :placeholder="$t('Settings.Theme Settings.Base Theme.Base Theme')"
        :value="baseTheme"
        setting-key="baseTheme"
        :select-names="baseThemeNames"
        :select-values="BASE_THEME_VALUES"
        :icon="['fas', 'palette']"
        @change="updateBaseTheme"
      />
      <FtSelect
        :placeholder="$t('Settings.Theme Settings.Main Color Theme.Main Color Theme')"
        :value="mainColor"
        setting-key="mainColor"
        :select-names="colorNames"
        :select-values="COLOR_VALUES"
        :disabled="!areColorThemesEnabled"
        :icon="['fas', 'palette']"
        icon-color="var(--primary-color)"
        @change="updateMainColor"
      />
      <FtSelect
        :placeholder="$t('Settings.Theme Settings.Secondary Color Theme')"
        :value="secColor"
        setting-key="secColor"
        :select-names="colorNames"
        :select-values="COLOR_VALUES"
        :disabled="!areColorThemesEnabled"
        :icon="['fas', 'palette']"
        icon-color="var(--accent-color)"
        @change="updateSecColor"
      />
    </FtFlexBox>
    <FtPrompt
      v-if="showRestartPrompt"
      :label="$t('Settings[\'The app needs to restart for changes to take effect. Restart and apply change?\']')"
      :option-names="restartPromptNames"
      :option-values="RESTART_PROMPT_VALUES"
      @click="handleSmoothScrolling"
    />
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtSelect from './FtSelect/FtSelect.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'
import FtSlider from './FtSlider/FtSlider.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'

import store from '../store/index'

import { colors } from '../helpers/colors'
import { useColorTranslations } from '../composables/colors'
import {
  MAX_THUMBNAIL_SIZE,
  MIN_THUMBNAIL_SIZE,
  THUMBNAIL_SIZE_STEP
} from '../constants/thumbnailSize'

const { t } = useI18n()

// Themes are devided into 3 groups.
// The first group contains the default themes.
// The second group are themes that don't have specific primary and secondary colors.
// The third group are themes that do have specific primary and secondary colors available.

const BASE_THEME_VALUES = [
  // First group
  'system',
  'light',
  'dark',
  'black',
  // Second group
  'nordic',
  'hotPink',
  'pastelPink',
  // Third group
  'catppuccinFrappe',
  'catppuccinLatte',
  'catppuccinMocha',
  'dracula',
  'everforestDarkHard',
  'everforestDarkMedium',
  'everforestDarkLow',
  'everforestLightHard',
  'everforestLightMedium',
  'everforestLightLow',
  'gruvboxDark',
  'gruvboxLight',
  'solarizedDark',
  'solarizedLight'
]

const baseThemeNames = computed(() => [
  // First group
  t('Settings.Theme Settings.Base Theme.System Default'),
  t('Settings.Theme Settings.Base Theme.Light'),
  t('Settings.Theme Settings.Base Theme.Dark'),
  t('Settings.Theme Settings.Base Theme.Black'),
  // Second group
  t('Settings.Theme Settings.Base Theme.Nordic'),
  t('Settings.Theme Settings.Base Theme.Hot Pink'),
  t('Settings.Theme Settings.Base Theme.Pastel Pink'),
  // Third group
  t('Settings.Theme Settings.Base Theme.Catppuccin Frappe'),
  t('Settings.Theme Settings.Base Theme.Catppuccin Latte'),
  t('Settings.Theme Settings.Base Theme.Catppuccin Mocha'),
  t('Settings.Theme Settings.Base Theme.Dracula'),
  t('Settings.Theme Settings.Base Theme.Everforest Dark Hard'),
  t('Settings.Theme Settings.Base Theme.Everforest Dark Medium'),
  t('Settings.Theme Settings.Base Theme.Everforest Dark Low'),
  t('Settings.Theme Settings.Base Theme.Everforest Light Hard'),
  t('Settings.Theme Settings.Base Theme.Everforest Light Medium'),
  t('Settings.Theme Settings.Base Theme.Everforest Light Low'),
  t('Settings.Theme Settings.Base Theme.Gruvbox Dark'),
  t('Settings.Theme Settings.Base Theme.Gruvbox Light'),
  t('Settings.Theme Settings.Base Theme.Solarized Dark'),
  t('Settings.Theme Settings.Base Theme.Solarized Light')
])

const COLOR_VALUES = colors.map(color => color.name)
const colorNames = useColorTranslations()

/** @type {import('vue').ComputedRef<boolean>} */
const barColor = computed(() => {
  return store.getters.getBarColor
})

/**
 * @param {boolean} value
 */
function updateBarColor(value) {
  store.dispatch('updateBarColor', value)
}

/** @type {import('vue').ComputedRef<string>} */
const baseTheme = computed(() => {
  return store.getters.getBaseTheme
})

/**
 * @param {string} value
 */
function updateBaseTheme(value) {
  store.dispatch('updateBaseTheme', value)
}

const areColorThemesEnabled = computed(() => baseTheme.value !== 'hotPink')

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

/** @type {import('vue').ComputedRef<boolean>} */
const expandSideBar = computed(() => {
  return store.getters.getExpandSideBar
})

/** @type {import('vue').ComputedRef<boolean>} */
const isSideNavOpen = computed(() => {
  return store.getters.getIsSideNavOpen
})

/**
 * @param {boolean} value
 */
function handleExpandSideBar(value) {
  if (isSideNavOpen.value !== value) {
    store.commit('toggleSideNav')
  }

  store.dispatch('updateExpandSideBar', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideSideBarOnWatchPages = computed(() => store.getters.getHideSideBarOnWatchPages)

/**
 * @param {boolean} value
 */
function updateHideSideBarOnWatchPages(value) {
  store.dispatch('updateHideSideBarOnWatchPages', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideLabelsSideBar = computed(() => {
  return store.getters.getHideLabelsSideBar
})

/**
 * @param {boolean} value
 */
function updateHideLabelsSideBar(value) {
  store.dispatch('updateHideLabelsSideBar', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideHeaderLogo = computed(() => {
  return store.getters.getHideHeaderLogo
})

/**
 * @param {boolean} value
 */
function updateHideHeaderLogo(value) {
  store.dispatch('updateHideHeaderLogo', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideProfileSelectorInHeader = computed(() => {
  return store.getters.getHideProfileSelectorInHeader
})

/**
 * @param {boolean} value
 */
function updateHideProfileSelectorInHeader(value) {
  store.dispatch('updateHideProfileSelectorInHeader', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showThumbnailSizeButtonInHeader = computed(() => {
  return store.getters.getShowThumbnailSizeButtonInHeader
})

/**
 * @param {boolean} value
 */
function updateShowThumbnailSizeButtonInHeader(value) {
  store.dispatch('updateShowThumbnailSizeButtonInHeader', value)
}

/** @type {import('vue').ComputedRef<number>} */
const uiScale = computed(() => store.getters.getUiScale)

/**
 * @param {number} value
 */
function updateUiScale(value) {
  store.dispatch('updateUiScale', value)
}

/** @type {import('vue').ComputedRef<number>} */
const thumbnailSize = computed(() => store.getters.getThumbnailSize)

/**
 * @param {number} value
 */
function previewThumbnailSize(value) {
  store.commit('setThumbnailSize', value)
}

/**
 * @param {number} value
 */
function updateThumbnailSize(value) {
  store.dispatch('updateThumbnailSize', value)
}

/** @type {boolean} */
const usingElectron = process.env.IS_ELECTRON

const RESTART_PROMPT_VALUES = [
  'restart',
  'cancel'
]

const restartPromptNames = computed(() => [
  t('Yes, Restart'),
  t('Cancel')
])

/** @type {import('vue').Ref<boolean>} */
const disableSmoothScrollingToggleValue = ref(store.getters.getDisableSmoothScrolling)
const showRestartPrompt = ref(false)

/**
 * @param {boolean} value
 */
function handleRestartPrompt(value) {
  disableSmoothScrollingToggleValue.value = value
  showRestartPrompt.value = true
}

/**
 * @param {'restart' | 'cancel' | null} value
 */
function handleSmoothScrolling(value) {
  showRestartPrompt.value = false

  if (value === null || value === 'cancel') {
    disableSmoothScrollingToggleValue.value = !disableSmoothScrollingToggleValue.value
    return
  }

  if (process.env.IS_ELECTRON) {
    store.dispatch('updateDisableSmoothScrolling',
      disableSmoothScrollingToggleValue.value
    ).then(() => {
      window.ftElectron.relaunch()
    })
  }
}
</script>
