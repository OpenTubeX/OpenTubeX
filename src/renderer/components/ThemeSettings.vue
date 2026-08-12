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
          :label="$t('Settings.Theme Settings.Always Show Scrollbars')"
          :tooltip="$t('Tooltips.Theme Settings.Always Show Scrollbars')"
          compact
          :default-value="alwaysShowScrollbars"
          setting-key="alwaysShowScrollbars"
          @change="updateAlwaysShowScrollbars"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Show Toast Timeout Indicator')"
          compact
          :default-value="showToastTimeoutIndicator"
          setting-key="showToastTimeoutIndicator"
          @change="updateShowToastTimeoutIndicator"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Use Grid Player Menu')"
          :tooltip="$t('Tooltips.Theme Settings.Use Grid Player Menu')"
          compact
          :default-value="usePlayerMenuGrid"
          setting-key="usePlayerMenuGrid"
          @change="updateUsePlayerMenuGrid"
        />
        <FtToggleSwitch
          v-if="usingElectron"
          :label="$t('Settings.Theme Settings.Use Fixed Tab Width')"
          :tooltip="$t('Tooltips.Theme Settings.Use Fixed Tab Width')"
          compact
          :default-value="useFixedTabWidth"
          setting-key="useFixedTabWidth"
          @change="updateUseFixedTabWidth"
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
          v-if="usingElectron"
          :label="$t('Settings.Theme Settings.Show Tab Icons')"
          compact
          :default-value="showTabIcons"
          setting-key="showTabIcons"
          @change="updateShowTabIcons"
        />
        <FtToggleSwitch
          v-if="usingElectron"
          :label="$t('Settings.Theme Settings.Show Tab Previews')"
          compact
          :default-value="showTabPreviews"
          setting-key="showTabPreviews"
          @change="updateShowTabPreviews"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Show Progress as Notification')"
          :tooltip="$t('Tooltips.Theme Settings.Show Progress as Notification')"
          compact
          :default-value="showProgressBarToast"
          setting-key="showProgressBarToast"
          @change="updateShowProgressBarToast"
        />
      </div>
    </div>
    <template v-if="usingElectron">
      <FtFlexBox>
        <div class="switchColumn">
          <FtSlider
            :label="$t('Settings.Theme Settings.Tab Width')"
            :default-value="fixedTabWidth"
            setting-key="fixedTabWidth"
            :min-value="MIN_FIXED_TAB_WIDTH"
            :max-value="MAX_FIXED_TAB_WIDTH"
            :step="FIXED_TAB_WIDTH_STEP"
            :disabled="!useFixedTabWidth"
            value-extension="px"
            @input="previewFixedTabWidth"
            @change="updateFixedTabWidth"
          />
        </div>
        <FtButton
          v-if="showTabIcons"
          :label="loadingTabIcons
            ? $t('Settings.Theme Settings.Loading Missing Tab Icons')
            : $t('Settings.Theme Settings.Load Missing Tab Icons')"
          :icon="['fas', 'download']"
          :disabled="loadingTabIcons || !hasMissingTabIcons"
          @click="loadTabIcons"
        />
      </FtFlexBox>
    </template>
    <div class="sliderGrid">
      <FtSlider
        v-if="usingElectron"
        :label="$t('Settings.Theme Settings.UI Scale')"
        :default-value="uiScale"
        :min-value="50"
        :max-value="300"
        :step="5"
        value-extension="%"
        @change="updateUiScale"
      />
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
      <FtSlider
        :label="t('Settings.Theme Settings.UI Roundness')"
        :default-value="uiRoundness"
        setting-key="uiRoundness"
        :min-value="0"
        :max-value="200"
        :step="5"
        value-extension="%"
        @input="previewUiRoundness"
        @change="updateUiRoundness"
      />
      <FtSlider
        :label="t('Settings.Theme Settings.Scrollbar Width')"
        :default-value="scrollbarThumbWidth"
        setting-key="scrollbarThumbWidth"
        :min-value="MIN_SCROLLBAR_THUMB_WIDTH"
        :max-value="MAX_SCROLLBAR_THUMB_WIDTH"
        :step="SCROLLBAR_THUMB_WIDTH_STEP"
        value-extension="px"
        @input="previewScrollbarThumbWidth"
        @change="updateScrollbarThumbWidth"
      />
      <FtSlider
        :label="t('Settings.Theme Settings.Animation Speed')"
        :default-value="animationSpeed"
        setting-key="animationSpeed"
        :min-value="25"
        :max-value="200"
        :step="5"
        :disabled="reducedMotionEnabled"
        value-extension="%"
        @input="previewAnimationSpeed"
        @change="updateAnimationSpeed"
      />
    </div>
    <br>
    <FtFlexBox>
      <FtSelect
        :placeholder="$t('Settings.Theme Settings.Toast Position.Toast Position')"
        :value="toastPosition"
        setting-key="toastPosition"
        :select-names="toastPositionNames"
        :select-values="TOAST_POSITION_VALUES"
        :icon="['fas', 'message']"
        @change="updateToastPosition"
      />
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
    <br>
    <FtPrompt
      v-if="showRestartPrompt"
      autosize
      :label="$t('Settings[\'The app needs to restart for changes to take effect. Restart and apply change?\']')"
      :option-names="restartPromptNames"
      :option-values="RESTART_PROMPT_VALUES"
      @click="handleSmoothScrolling"
    />
  </FtSettingsSection>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtSelect from './FtSelect/FtSelect.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'
import FtSlider from './FtSlider/FtSlider.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtButton from './FtButton/FtButton.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'

import store from '../store/index'

import { colors } from '../helpers/colors'
import { useColorTranslations } from '../composables/colors'
import {
  MAX_THUMBNAIL_SIZE,
  MIN_THUMBNAIL_SIZE,
  THUMBNAIL_SIZE_STEP
} from '../constants/thumbnailSize'
import {
  FIXED_TAB_WIDTH_STEP,
  MAX_FIXED_TAB_WIDTH,
  MIN_FIXED_TAB_WIDTH
} from '../constants/tabWidth'
import {
  MAX_SCROLLBAR_THUMB_WIDTH,
  MIN_SCROLLBAR_THUMB_WIDTH,
  normalizeScrollbarThumbWidth,
  SCROLLBAR_THUMB_WIDTH_STEP
} from '../constants/scrollbar'
import { normalizeToastPosition, TOAST_POSITION_VALUES } from '../constants/toastPosition'
import { setAnimationSpeed } from '../helpers/animationSpeed'
import { getMissingTabAvatarTabs, loadMissingTabAvatars } from '../helpers/loadTabAvatars'
import { showToast } from '../helpers/utils'

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
const alwaysShowScrollbars = computed(() => {
  return store.getters.getAlwaysShowScrollbars
})

/**
 * @param {boolean} value
 */
function updateAlwaysShowScrollbars(value) {
  store.dispatch('updateAlwaysShowScrollbars', value)
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
const showToastTimeoutIndicator = computed(() => store.getters.getShowToastTimeoutIndicator)

/**
 * @param {boolean} value
 */
function updateShowToastTimeoutIndicator(value) {
  store.dispatch('updateShowToastTimeoutIndicator', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const usePlayerMenuGrid = computed(() => store.getters.getUsePlayerMenuGrid)

/**
 * @param {boolean} value
 */
function updateUsePlayerMenuGrid(value) {
  store.dispatch('updateUsePlayerMenuGrid', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showProgressBarToast = computed(() => store.getters.getShowProgressBarToast)

/**
 * @param {boolean} value
 */
function updateShowProgressBarToast(value) {
  store.dispatch('updateShowProgressBarToast', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showTabIcons = computed(() => store.getters.getShowTabIcons)
const hasMissingTabIcons = computed(() => getMissingTabAvatarTabs(store.getters.getTabs).length > 0)
const loadingTabIcons = ref(false)

async function loadTabIcons() {
  if (loadingTabIcons.value) return
  loadingTabIcons.value = true
  try {
    const { loaded, failed } = await loadMissingTabAvatars(store.getters.getTabs)
    if (loaded === 0 && failed === 0) {
      showToast(t('Settings.Theme Settings.No Missing Tab Icons'))
    } else if (failed > 0) {
      showToast(t('Settings.Theme Settings.Loaded Tab Icons With Failures', { loaded, failed }))
    } else {
      showToast(t('Settings.Theme Settings.Loaded Tab Icons', { count: loaded }))
    }
  } finally {
    loadingTabIcons.value = false
  }
}

/**
 * @param {boolean} value
 */
function updateShowTabIcons(value) {
  store.dispatch('updateShowTabIcons', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showTabPreviews = computed(() => store.getters.getShowTabPreviews)

/**
 * @param {boolean} value
 */
function updateShowTabPreviews(value) {
  store.dispatch('updateShowTabPreviews', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const useFixedTabWidth = computed(() => store.getters.getUseFixedTabWidth)

/** @type {import('vue').ComputedRef<number>} */
const fixedTabWidth = computed(() => store.getters.getFixedTabWidth)

/**
 * @param {boolean} value
 */
function updateUseFixedTabWidth(value) {
  store.dispatch('updateUseFixedTabWidth', value)
}

/**
 * @param {number} value
 */
function previewFixedTabWidth(value) {
  store.commit('setFixedTabWidth', value)
}

/**
 * @param {number} value
 */
function updateFixedTabWidth(value) {
  store.dispatch('updateFixedTabWidth', value)
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

/**
 * @param {'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right'} value
 */
function updateToastPosition(value) {
  store.dispatch('updateToastPosition', value)
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
const uiRoundness = computed(() => store.getters.getUiRoundness)
const scrollbarThumbWidth = computed(
  () => normalizeScrollbarThumbWidth(store.getters.getScrollbarThumbWidth)
)
const animationSpeed = computed(() => store.getters.getAnimationSpeed)

const systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const systemReducedMotionEnabled = ref(systemReducedMotion.matches)
const reducedMotion = computed(() => store.getters.getReducedMotion)
const reducedMotionEnabled = computed(() => reducedMotion.value === 'on' ||
  (reducedMotion.value === 'system' && systemReducedMotionEnabled.value))

function updateSystemReducedMotion(event) {
  systemReducedMotionEnabled.value = event.matches
}

onMounted(() => systemReducedMotion.addEventListener('change', updateSystemReducedMotion))
onUnmounted(() => systemReducedMotion.removeEventListener('change', updateSystemReducedMotion))

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

/**
 * @param {number} value
 */
function previewUiRoundness(value) {
  store.commit('setUiRoundness', value)
}

/**
 * @param {number} value
 */
function updateUiRoundness(value) {
  store.dispatch('updateUiRoundness', value)
}

/**
 * @param {number} value
 */
function previewScrollbarThumbWidth(value) {
  store.commit('setScrollbarThumbWidth', value)
}

/**
 * @param {number} value
 */
function updateScrollbarThumbWidth(value) {
  store.dispatch('updateScrollbarThumbWidth', value)
}

/**
 * @param {number} value
 */
function previewAnimationSpeed(value) {
  setAnimationSpeed(value)
}

/**
 * @param {number} value
 */
function updateAnimationSpeed(value) {
  store.dispatch('updateAnimationSpeed', value)
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

<style scoped>
.sliderGrid {
  --slider-gap: 24px;

  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--slider-gap);
}

.sliderGrid :deep(.pure-material-slider) {
  box-sizing: border-box;
  flex: 1 1 180px;
  max-inline-size: 380px;
  inline-size: auto;

  /* The gap already spaces them out, and their own margin would count towards
     how many fit in a row. */
  margin-inline: 0;
}

/* Up to four sliders fill a row evenly, but a fifth would sit alone on the next
   one while the others are squeezed together. Sizing them as thirds of the row
   splits them 3 + 2, all the same width, with more room each. */
.sliderGrid:has(:nth-child(5)) :deep(.pure-material-slider) {
  --slider-size: clamp(
    180px,
    calc((100% - 2 * var(--slider-gap)) / 3),
    380px
  );

  flex-basis: var(--slider-size);
  max-inline-size: var(--slider-size);
}
</style>
