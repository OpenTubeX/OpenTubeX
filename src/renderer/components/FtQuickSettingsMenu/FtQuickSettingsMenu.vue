<template>
  <div class="quickSettings">
    <button
      ref="triggerRef"
      type="button"
      class="profileTrigger"
      :aria-label="t('Settings.Quick Settings.Quick Settings')"
      :title="t('Settings.Quick Settings.Quick Settings')"
      :aria-expanded="menuOpen"
      :aria-controls="id"
      :style="{ background: activeProfile.bgColor, color: activeProfile.textColor }"
      @click="toggleMenu"
      @mousedown="handleTriggerMouseDown"
      @keydown.esc.stop="closeMenu"
    >
      <span
        class="profileInitial"
        dir="auto"
      >
        {{ activeProfileInitial }}
      </span>
    </button>

    <Transition
      name="quick-settings-menu"
      @after-leave="handleMenuAfterLeave"
    >
      <FtCard
        v-if="menuOpen"
        :id="id"
        ref="menuRef"
        v-overlay-scrollbars
        class="quickSettingsMenu"
        role="dialog"
        :aria-label="t('Settings.Quick Settings.Quick Settings')"
        tabindex="-1"
        @focusout="handleMenuFocusOut"
        @keydown.esc.stop="closeMenu"
      >
        <template v-if="profilePanelOpen">
          <header class="profilePanelHeader">
            <button
              type="button"
              :aria-label="t('Back')"
              :title="t('Back')"
              @click="closeProfilePanel"
            >
              <FontAwesomeIcon :icon="['fas', 'arrow-left']" />
            </button>
            <h2>{{ t('Profile.Profile Select') }}</h2>
            <button
              type="button"
              :aria-label="t('Profile.Profile Settings')"
              :title="t('Profile.Profile Settings')"
              @click="openProfileSettings"
            >
              <FontAwesomeIcon :icon="['fas', 'sliders-h']" />
            </button>
          </header>
          <div
            class="profileList"
            role="listbox"
            :aria-label="t('Profile.Profile Select')"
          >
            <button
              v-for="profile in profileList"
              :key="profile._id"
              type="button"
              class="profileOption"
              role="option"
              :aria-selected="profile._id === activeProfile._id"
              @click="setActiveProfile(profile)"
            >
              <span
                class="profileAvatar"
                :style="{ background: profile.bgColor, color: profile.textColor }"
              >
                {{ profileInitials[profile._id] }}
              </span>
              <span dir="auto">{{ translateProfileName(profile) }}</span>
              <FontAwesomeIcon
                v-if="profile._id === activeProfile._id"
                class="activeProfileIcon"
                :icon="['fas', 'check']"
              />
            </button>
          </div>
        </template>

        <template v-else>
          <div class="profileHeaderRow">
            <button
              type="button"
              class="profileSummary"
              @click="openProfilePanel"
            >
              <span
                class="profileAvatar"
                :style="{ background: activeProfile.bgColor, color: activeProfile.textColor }"
              >
                {{ activeProfileInitial }}
              </span>
              <span class="profileSummaryText">
                <strong dir="auto">{{ translateProfileName(activeProfile) }}</strong>
              </span>
              <FontAwesomeIcon :icon="['fas', 'angle-right']" />
            </button>
            <button
              type="button"
              class="allSettingsShortcut"
              :aria-label="t('Settings.Quick Settings.All Settings')"
              :title="t('Settings.Quick Settings.All Settings')"
              @click="openSettings"
            >
              <FontAwesomeIcon :icon="['fas', 'cog']" />
            </button>
          </div>

          <section class="menuSection">
            <h3>{{ t('Settings.Quick Settings.Appearance') }}</h3>
            <div class="selectPair">
              <FtSelect
                class="quickSelect"
                :placeholder="t('Settings.Theme Settings.Base Theme.Base Theme')"
                :value="baseTheme"
                setting-key="baseTheme"
                :select-names="baseThemeNames"
                :select-values="BASE_THEME_VALUES"
                :icon="['fas', 'palette']"
                @change="updateSetting('BaseTheme', $event)"
              />
              <FtSelect
                class="quickSelect"
                :placeholder="t('Settings.Theme Settings.Main Color Theme.Main Color Theme')"
                :value="mainColor"
                setting-key="mainColor"
                :select-names="colorNames"
                :select-values="COLOR_VALUES"
                :disabled="baseTheme === 'hotPink'"
                :icon="['fas', 'palette']"
                icon-color="var(--primary-color)"
                @change="updateSetting('MainColor', $event)"
              />
            </div>
            <div class="sliderGroup">
              <FtSlider
                v-if="USING_ELECTRON"
                :label="t('Settings.Theme Settings.UI Scale')"
                :default-value="uiScale"
                :min-value="50"
                :max-value="300"
                :step="5"
                value-extension="%"
                @change="updateUiScale"
              />
              <FtSlider
                class="thumbnailSizeSlider"
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
          </section>

          <section class="menuSection">
            <h3>{{ t('Settings.Quick Settings.Playback') }}</h3>
            <FtSelect
              class="quickSelect"
              :placeholder="t('Settings.Player Settings.Default Quality.Default Quality')"
              :value="defaultQuality"
              setting-key="defaultQuality"
              :select-names="qualityNames"
              :select-values="qualityValues"
              :icon="['fas', 'photo-film']"
              @change="updateSetting('DefaultQuality', $event)"
            />
            <FtToggleSwitch
              :label="t('Settings.Player Settings.Play Next Video')"
              :default-value="playNextVideo"
              :disabled="hideRecommendedVideos"
              setting-key="playNextVideo"
              compact
              @change="updateSetting('PlayNextVideo', $event)"
            />
            <FtToggleSwitch
              :label="t('Settings.Player Settings.Turn on Subtitles by Default')"
              :default-value="enableSubtitlesByDefault"
              setting-key="enableSubtitlesByDefault"
              compact
              @change="updateSetting('EnableSubtitlesByDefault', $event)"
            />
          </section>

          <section class="menuSection">
            <h3>{{ t('Settings.Quick Settings.Content') }}</h3>
            <FtSelect
              class="quickSelect"
              :placeholder="t('Settings.General Settings.Video View Type.Video View Type')"
              :value="listType"
              setting-key="listType"
              :select-names="viewTypeNames"
              :select-values="VIEW_TYPE_VALUES"
              :icon="listType === 'grid' ? ['fas', 'grip'] : ['fas', 'list']"
              @change="updateSetting('ListType', $event)"
            />
            <FtToggleSwitch
              :label="t('Settings.Distraction Free Settings.Hide Recommended Videos')"
              :default-value="hideRecommendedVideos"
              setting-key="hideRecommendedVideos"
              compact
              @change="handleHideRecommendedVideos"
            />
            <FtToggleSwitch
              :label="t('Settings.Distraction Free Settings.Hide Comments')"
              :default-value="hideComments"
              setting-key="hideComments"
              compact
              @change="updateSetting('HideComments', $event)"
            />
          </section>

          <section class="menuSection">
            <h3>{{ t('Settings.Quick Settings.Language and Region') }}</h3>
            <div class="selectPair">
              <FtSelect
                class="quickSelect"
                :placeholder="t('Settings.General Settings.Locale Preference')"
                :value="currentLocale"
                setting-key="currentLocale"
                :select-names="localeNames"
                :select-values="LOCALE_VALUES"
                :icon="['fas', 'language']"
                is-locale-selector
                @change="updateSetting('CurrentLocale', $event)"
              />
              <FtSelect
                v-if="regionValues.length > 0"
                class="quickSelect"
                :placeholder="t('Settings.General Settings.Region for Trending')"
                :value="region"
                setting-key="region"
                :select-names="regionNames"
                :select-values="regionValues"
                :icon="['fas', 'globe']"
                @change="updateSetting('Region', $event)"
              />
            </div>
          </section>

          <div class="menuLinks">
            <button
              v-if="USING_ELECTRON"
              type="button"
              @click="openKeyboardShortcuts"
            >
              <FontAwesomeIcon :icon="['fas', 'keyboard']" />
              <span>{{ t('KeyboardShortcutPrompt.Keyboard Shortcuts') }}</span>
              <FontAwesomeIcon
                class="linkArrow"
                :icon="['fas', 'angle-right']"
              />
            </button>
            <button
              type="button"
              @click="openAbout"
            >
              <FontAwesomeIcon :icon="['fas', 'info-circle']" />
              <span>{{ t('About.About') }}</span>
              <FontAwesomeIcon
                class="linkArrow"
                :icon="['fas', 'angle-right']"
              />
            </button>
          </div>
        </template>
      </FtCard>
    </Transition>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../ft-card/ft-card.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import allLocales from '../../../../static/locales/activeLocales.json'
import { localeTranslationPercentages } from '../../i18n/index'
import { colors } from '../../helpers/colors'
import { useColorTranslations } from '../../composables/colors'
import {
  MAX_THUMBNAIL_SIZE,
  MIN_THUMBNAIL_SIZE,
  THUMBNAIL_SIZE_STEP
} from '../../constants/thumbnailSize'
import { AUTO_QUALITY_FALLBACK, playbackEngineSupportsAutoQuality } from '../../helpers/player/autoQuality'
import { showToast } from '../../helpers/utils'
import { getFirstCharacter } from '../../helpers/strings'
import { MAIN_PROFILE_ID } from '../../../constants'

const { locale, t } = useI18n()
const id = useId()
const USING_ELECTRON = process.env.IS_ELECTRON

const menuOpen = ref(false)
const profilePanelOpen = ref(false)
let mouseDownOnTrigger = false
let pointerDownInsideMenu = false
const triggerRef = useTemplateRef('triggerRef')
const menuRef = useTemplateRef('menuRef')

const profileList = computed(() => store.getters.getProfileList)
const activeProfile = computed(() => store.getters.getActiveProfile)
const activeProfileInitial = computed(() => activeProfile.value?.name
  ? getFirstCharacter(translateProfileName(activeProfile.value), locale.value)
  : '')
const profileInitials = computed(() => profileList.value.reduce((initials, profile) => {
  initials[profile._id] = profile?.name
    ? getFirstCharacter(translateProfileName(profile), locale.value)
    : ''
  return initials
}, {}))

const BASE_THEME_VALUES = [
  'system', 'light', 'dark', 'black', 'nordic', 'hotPink', 'pastelPink',
  'catppuccinFrappe', 'catppuccinLatte', 'catppuccinMocha', 'dracula',
  'everforestDarkHard', 'everforestDarkMedium', 'everforestDarkLow',
  'everforestLightHard', 'everforestLightMedium', 'everforestLightLow',
  'gruvboxDark', 'gruvboxLight', 'solarizedDark', 'solarizedLight'
]

const baseThemeNames = computed(() => [
  t('Settings.Theme Settings.Base Theme.System Default'),
  t('Settings.Theme Settings.Base Theme.Light'),
  t('Settings.Theme Settings.Base Theme.Dark'),
  t('Settings.Theme Settings.Base Theme.Black'),
  t('Settings.Theme Settings.Base Theme.Nordic'),
  t('Settings.Theme Settings.Base Theme.Hot Pink'),
  t('Settings.Theme Settings.Base Theme.Pastel Pink'),
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
const VIEW_TYPE_VALUES = ['grid', 'list']
const viewTypeNames = computed(() => [
  t('Settings.General Settings.Video View Type.Grid'),
  t('Settings.General Settings.Video View Type.List')
])
const LOCALE_VALUES = ['system', ...allLocales]
const localeNames = computed(() => [
  t('Settings.General Settings.System Default'),
  ...process.env.LOCALE_NAMES.map((name, index) => `${name} (${localeTranslationPercentages.value[index]}%)`)
])

const baseTheme = computed(() => store.getters.getBaseTheme)
const mainColor = computed(() => store.getters.getMainColor)
const uiScale = computed(() => store.getters.getUiScale)
const thumbnailSize = computed(() => store.getters.getThumbnailSize)
const playNextVideo = computed(() => store.getters.getPlayNextVideo)
const enableSubtitlesByDefault = computed(() => store.getters.getEnableSubtitlesByDefault)
const listType = computed(() => store.getters.getListType)
const hideRecommendedVideos = computed(() => store.getters.getHideRecommendedVideos)
const hideComments = computed(() => store.getters.getHideComments)
const currentLocale = computed(() => store.getters.getCurrentLocale)
const region = computed(() => store.getters.getRegion)
const regionNames = computed(() => store.getters.getRegionNames)
const regionValues = computed(() => store.getters.getRegionValues)

const RESOLUTION_VALUES = ['2160', '1440', '1080', '720', '480', '360', '240', '144']
const autoQualityAvailable = computed(() => playbackEngineSupportsAutoQuality(store.getters.getVideoPlaybackEngine))
const qualityValues = computed(() => autoQualityAvailable.value ? [...RESOLUTION_VALUES, 'auto'] : RESOLUTION_VALUES)
const qualityNames = computed(() => [
  t('Settings.Player Settings.Default Quality.4k'),
  t('Settings.Player Settings.Default Quality.1440p'),
  t('Settings.Player Settings.Default Quality.1080p'),
  t('Settings.Player Settings.Default Quality.720p'),
  t('Settings.Player Settings.Default Quality.480p'),
  t('Settings.Player Settings.Default Quality.360p'),
  t('Settings.Player Settings.Default Quality.240p'),
  t('Settings.Player Settings.Default Quality.144p'),
  ...(autoQualityAvailable.value ? [t('Settings.Player Settings.Default Quality.Auto')] : [])
])
const defaultQuality = computed(() => {
  const value = store.getters.getDefaultQuality
  return value === 'auto' && !autoQualityAvailable.value ? AUTO_QUALITY_FALLBACK : value
})

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    nextTick(() => menuRef.value?.$el?.focus())
  }
}

function handleMenuAfterLeave() {
  profilePanelOpen.value = false
}

function handleTriggerMouseDown() {
  if (menuOpen.value) {
    mouseDownOnTrigger = true
  }
}

function focusMenu() {
  nextTick(() => menuRef.value?.$el?.focus())
}

function handleWindowFocus() {
  if (menuOpen.value && !menuRef.value?.$el?.matches(':focus-within')) {
    menuRef.value?.$el?.focus()
  }
}

function handleWindowBlur() {
  pointerDownInsideMenu = false
}

function handleDocumentPointerDown(event) {
  pointerDownInsideMenu = event.target instanceof Node && menuRef.value?.$el?.contains(event.target)
}

function handleDocumentPointerUp() {
  setTimeout(() => {
    pointerDownInsideMenu = false
  })
}

onMounted(() => {
  window.addEventListener('focus', handleWindowFocus)
  window.addEventListener('blur', handleWindowBlur)
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  document.addEventListener('pointerup', handleDocumentPointerUp, true)
  document.addEventListener('pointercancel', handleDocumentPointerUp, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', handleWindowFocus)
  window.removeEventListener('blur', handleWindowBlur)
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  document.removeEventListener('pointerup', handleDocumentPointerUp, true)
  document.removeEventListener('pointercancel', handleDocumentPointerUp, true)
})

function openProfilePanel() {
  profilePanelOpen.value = true
  focusMenu()
}

function closeProfilePanel() {
  profilePanelOpen.value = false
  focusMenu()
}

function handleMenuFocusOut(event) {
  if (event.relatedTarget === null) {
    const controlChangedDuringClick = pointerDownInsideMenu
    setTimeout(() => {
      if (controlChangedDuringClick) {
        focusMenu()
        return
      }
      if (document.hasFocus() && !menuRef.value?.$el.matches(':focus-within')) {
        menuOpen.value = false
      }
    })
    return
  }

  if (mouseDownOnTrigger) {
    mouseDownOnTrigger = false
  } else if (!menuRef.value?.$el.matches(':focus-within')) {
    menuOpen.value = false
  }
}

function closeMenu() {
  menuOpen.value = false
  triggerRef.value?.focus()
}

function translateProfileName(profile) {
  return profile._id === MAIN_PROFILE_ID ? t('Profile.All Channels') : profile.name
}

function setActiveProfile(profile) {
  if (profile._id !== activeProfile.value._id) {
    store.commit('setActiveProfile', profile._id)
    showToast({
      message: t('Profile.{profile} is now the active profile', { profile: translateProfileName(profile) }),
      icon: ['fas', 'user-check']
    })
  }
  menuOpen.value = false
}

function openProfileSettings() {
  menuOpen.value = false
  store.dispatch('showSettingsWindow', 'profile')
}

/**
 * @param {string} setting
 * @param {string | boolean} value
 */
function updateSetting(setting, value) {
  store.dispatch(`update${setting}`, value)
}

function updateUiScale(value) {
  store.dispatch('updateUiScale', value)
}

function previewThumbnailSize(value) {
  store.commit('setThumbnailSize', value)
}

function updateThumbnailSize(value) {
  store.dispatch('updateThumbnailSize', value)
}

function handleHideRecommendedVideos(value) {
  if (value) {
    store.dispatch('updatePlayNextVideo', false)
  }

  store.dispatch('updateHideRecommendedVideos', value)
}

function openSettings() {
  menuOpen.value = false
  store.dispatch('toggleSettingsWindow')
}

function openKeyboardShortcuts() {
  menuOpen.value = false
  store.dispatch('showKeyboardShortcutPrompt')
}

function openAbout() {
  menuOpen.value = false
  store.dispatch('showSettingsWindow', 'about')
}

</script>

<style scoped src="./FtQuickSettingsMenu.css" />
