<template>
  <div
    ref="settingsPageRef"
    class="settingsPage"
    :class="{ mobileSettings: !isInDesktopView }"
  >
    <template v-if="unlocked">
      <div v-show="settingsSectionTypeOpenInMobile != null">
        <button
          class="returnToMenuMobileButton"
          :aria-label="t('Settings.Return to Settings Menu')"
          :title="t('Settings.Return to Settings Menu')"
          @click="returnToSettingsMenu"
        >
          <FontAwesomeIcon
            class="returnToMenuMobileIcon"
            :icon="['fas', 'angle-left']"
          />
        </button>
      </div>
      <FtSettingsMenu
        v-show="isInDesktopView || settingsSectionTypeOpenInMobile == null"
        ref="menuRef"
        :class="{ mobileSettingsMenu: !isInDesktopView }"
        :settings-sections="settingsSectionComponents"
        :active-section="activeSection"
        @navigate-to-section="navigateToSection"
      />
      <div
        v-show="isInDesktopView || settingsSectionTypeOpenInMobile != null"
        class="settingsContent"
      >
        <div class="switchRow">
          <div
            v-if="USING_ELECTRON"
            class="settingButtonWithSync"
          >
            <FtButton
              :label="t('KeyboardShortcutPrompt.Show Keyboard Shortcuts')"
              :icon="['fas', 'keyboard']"
              @click="showKeyboardShortcutPrompt"
            />
            <FtSyncedSettingIndicator setting-key="keyboardShortcuts" />
          </div>
          <FtToggleSwitch
            class="settingsToggle"
            :label="t('Settings.Sort Settings Sections (A-Z)')"
            :default-value="settingsSectionSortEnabled"
            setting-key="settingsSectionSortEnabled"
            @change="updateSettingsSectionSortEnabled"
          />
          <FtToggleSwitch
            class="settingsToggle"
            :label="t('Settings.Highlight Changed Settings')"
            :default-value="highlightChangedSettings"
            setting-key="highlightChangedSettings"
            @change="updateHighlightChangedSettings"
          />
        </div>
        <div class="settingsSections">
          <component
            :is="section.component"
            v-for="section in settingsSectionComponents"
            :key="section.type"
            ref="sectionRefs"
            class="section"
            :class="{ hideOnMobile: settingsSectionTypeOpenInMobile !== section.type }"
            :data-section="section.type"
          />
        </div>
      </div>
    </template>
    <PasswordDialog
      v-else
      @unlocked="handleUnlock"
    />
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import GeneralSettings from '../../components/GeneralSettings/GeneralSettings.vue'
import ThemeSettings from '../../components/ThemeSettings.vue'
import PlayerSettings from '../../components/PlayerSettings/PlayerSettings.vue'
import CaptionSettings from '../../components/CaptionSettings/CaptionSettings.vue'
import ExternalPlayerSettings from '../../components/ExternalPlayerSettings.vue'
import DownloadSettings from '../../components/DownloadSettings.vue'
import SubscriptionSettings from '../../components/SubscriptionSettings/SubscriptionSettings.vue'
import PrivacySettings from '../../components/PrivacySettings.vue'
import DataSettings from '../../components/DataSettings/DataSettings.vue'
import SyncSettings from '../../components/SyncSettings/SyncSettings.vue'
import DistractionSettings from '../../components/DistractionSettings/DistractionSettings.vue'
import ProxySettings from '../../components/ProxySettings/ProxySettings.vue'
import SponsorBlockSettings from '../../components/SponsorBlockSettings.vue'
import RydSettings from '../../components/RydSettings.vue'
import ParentalControlSettings from '../../components/ParentalControlSettings.vue'
import ExperimentalSettings from '../../components/ExperimentalSettings/ExperimentalSettings.vue'
import PasswordSettings from '../../components/PasswordSettings/PasswordSettings.vue'
import PasswordDialog from '../../components/PasswordDialog/PasswordDialog.vue'
import ContextMenuSearchSettings from '../../components/ContextMenuSearchSettings/ContextMenuSearchSettings.vue'
import FtToggleSwitch from '../../components/FtToggleSwitch/FtToggleSwitch.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtSyncedSettingIndicator from '../../components/FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import FtSettingsMenu from '../../components/FtSettingsMenu/FtSettingsMenu.vue'

import store from '../../store/index'

const USING_ELECTRON = !!process.env.IS_ELECTRON
const SETTINGS_MOBILE_WIDTH_THRESHOLD = 1015
const SETTINGS_DESKTOP_WIDTH_THRESHOLD = SETTINGS_MOBILE_WIDTH_THRESHOLD + 20

const { locale, t } = useI18n()
const route = useRoute()
const router = useRouter()

const isInDesktopView = ref(true)
const settingsSectionTypeOpenInMobile = ref(null)
const activeSection = ref(null)

/** @type {import('vue').ComputedRef<boolean>} */
const settingsSectionSortEnabled = computed(() => store.getters.getSettingsSectionSortEnabled)
const highlightChangedSettings = computed(() => store.getters.getHighlightChangedSettings)

const settingsComponentsData = computed(() => {
  return [
    {
      type: 'theme',
      title: t('Settings.Theme Settings.Theme Settings'),
      icon: ['fas', 'display'],
      component: ThemeSettings
    },
    {
      type: 'player',
      title: t('Settings.Player Settings.Player Settings'),
      icon: ['fas', 'circle-play'],
      component: PlayerSettings
    },
    {
      type: 'caption-appearance',
      title: t('Settings.Player Settings.Caption Appearance.Captions'),
      icon: ['fas', 'closed-captioning'],
      component: CaptionSettings
    },
    ...(process.env.IS_ELECTRON
      ? [{
          type: 'external-player',
          title: t('Settings.External Player Settings.External Player Settings'),
          icon: ['fas', 'clapperboard'],
          component: ExternalPlayerSettings
        },
        {
          type: 'download',
          title: t('Settings.Download Settings.Download Settings'),
          icon: ['fas', 'download'],
          component: DownloadSettings
        }]
      : []),
    {
      type: 'subscription',
      title: t('Settings.Subscription Settings.Subscription Settings'),
      icon: ['fas', 'play'],
      component: SubscriptionSettings
    },
    {
      type: 'distraction',
      title: t('Settings.Distraction Free Settings.Distraction Free Settings'),
      icon: ['fas', 'eye-slash'],
      component: DistractionSettings
    },
    {
      type: 'parental-control',
      title: t('Settings.Parental Control Settings.Parental Control Settings'),
      icon: ['fas', 'user-lock'],
      component: ParentalControlSettings
    },
    {
      type: 'privacy',
      title: t('Settings.Privacy Settings.Privacy Settings'),
      icon: ['fas', 'lock'],
      component: PrivacySettings
    },
    {
      type: 'data',
      title: t('Settings.Data Settings.Data Settings'),
      icon: ['fas', 'database'],
      component: DataSettings
    },
    {
      type: 'sync',
      title: t('Settings.Sync Settings.Sync Settings'),
      icon: ['fas', 'sync'],
      component: SyncSettings
    },
    ...(process.env.IS_ELECTRON
      ? [
          {
            type: 'proxy',
            title: t('Settings.Proxy Settings.Proxy Settings'),
            icon: ['fas', 'network-wired'],
            component: ProxySettings
          }
        ]
      : []),
    {
      type: 'sponsor-block',
      title: t('Settings.SponsorBlock Settings.SponsorBlock Settings'),
      // TODO: replace with SponsorBlock icon
      icon: ['fas', 'shield'],
      component: SponsorBlockSettings
    },
    {
      type: 'return-youtube-dislike',
      title: t('Settings.Return YouTube Dislike Settings.Return YouTube Dislike Settings'),
      icon: ['fas', 'thumbs-down'],
      component: RydSettings
    },
    ...(process.env.IS_ELECTRON
      ? [{
          type: 'context-menu-search',
          title: t('Settings.Context Menu Search Settings.Context Menu Search Settings'),
          icon: ['fas', 'magnifying-glass'],
          component: ContextMenuSearchSettings
        }]
      : []),
    {
      type: 'password',
      title: t('Settings.Password Settings.Password Settings'),
      icon: ['fas', 'key'],
      component: PasswordSettings
    },
    ...(process.env.IS_ELECTRON
      ? [{
          type: 'experimental',
          title: t('Settings.Experimental Settings.Experimental Settings'),
          icon: ['fas', 'flask'],
          component: ExperimentalSettings
        }]
      : []),
  ]
})

const collator = computed(() => {
  return new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' })
})

const settingsSectionComponents = computed(() => {
  let settingsSections = settingsComponentsData.value

  if (settingsSectionSortEnabled.value) {
    const collator_ = collator.value

    settingsSections = settingsSections.toSorted((a, b) => {
      return collator_.compare(a.title, b.title)
    })
  }

  // ensure General Settings is placed first regardless of sorting
  const generalSettingsEntry = {
    type: 'general',
    title: t('Settings.General Settings.General Settings'),
    icon: ['fas', 'border-all'],
    component: GeneralSettings
  }

  return [generalSettingsEntry, ...settingsSections]
})

const unlocked = ref(store.getters.getSettingsPassword === '')

if (unlocked.value) {
  onMounted(handleMounted)
}

function handleUnlock() {
  unlocked.value = true

  nextTick(() => {
    handleMounted()
  })
}

onBeforeUnmount(() => {
  document.removeEventListener('scroll', markScrolledToSectionAsActive)
  settingsResizeObserver?.disconnect()
})

function showKeyboardShortcutPrompt() {
  store.dispatch('showKeyboardShortcutPrompt')
}

/**
 * @param {boolean} value
 */
function updateSettingsSectionSortEnabled(value) {
  store.dispatch('updateSettingsSectionSortEnabled', value)
}

/**
 * @param {boolean} value
 */
function updateHighlightChangedSettings(value) {
  store.dispatch('updateHighlightChangedSettings', value)
}

function handleMounted() {
  handleResize()
  settingsResizeObserver = new ResizeObserver(([entry]) => {
    handleResize(entry.contentRect.width)
  })
  settingsResizeObserver.observe(settingsPageRef.value)
  document.addEventListener('scroll', markScrolledToSectionAsActive)

  const sectionFromHash = route.hash.slice(1)
  const initialSection = settingsSectionComponents.value.some(({ type }) => type === sectionFromHash)
    ? sectionFromHash
    : settingsSectionComponents.value[0].type

  activeSection.value = initialSection

  if (sectionFromHash === initialSection) {
    navigateToSection(initialSection, false)
  } else if (isInDesktopView.value) {
    updateSectionHash(initialSection)
  }
}

const sectionRefs = useTemplateRef('sectionRefs')
const settingsPageRef = useTemplateRef('settingsPageRef')
let settingsResizeObserver = null
let hasMeasuredSettingsWidth = false

/**
 * @param {string} sectionType
 * @param {boolean} updateHash
 */
function navigateToSection(sectionType, updateHash = true) {
  if (updateHash) {
    updateSectionHash(sectionType)
  }

  if (isInDesktopView.value) {
    nextTick(() => {
      const sectionElement = sectionRefs.value.find(sectionRef => {
        return sectionRef.$el.dataset.section === sectionType
      })?.$el
      sectionElement.scrollIntoView()

      const sectionHeading = sectionElement.firstChild.firstChild
      sectionHeading.tabIndex = 0
      sectionHeading.focus()
      sectionHeading.tabIndex = -1
    })
  } else {
    settingsSectionTypeOpenInMobile.value = sectionType
  }
}

/**
 * @param {string | null} sectionType
 */
function updateSectionHash(sectionType) {
  const hash = sectionType == null ? '' : `#${sectionType}`

  if (route.hash !== hash) {
    router.replace({
      hash,
      state: {
        preserveScroll: true,
        skipTabRouteLoading: true
      }
    })
  }
}

const menuRef = useTemplateRef('menuRef')

function returnToSettingsMenu() {
  const openSection = settingsSectionTypeOpenInMobile.value
  settingsSectionTypeOpenInMobile.value = null
  updateSectionHash(null)

  // focus the corresponding Settings Menu title
  nextTick(() => {
    return menuRef.value?.focusLink(openSection)
  })
}

/* Set the current section to be shown as active in the Settings Menu
* if it is the lowest section within the top quarter of the viewport (25vh) */
function markScrolledToSectionAsActive() {
  if (!isInDesktopView.value) {
    activeSection.value = null
    return
  }

  const scrollY = window.scrollY + window.innerHeight / 4

  for (const sectionRef of sectionRefs.value) {
    const sectionElement = sectionRef.$el

    const sectionHeight = sectionElement.offsetHeight
    const sectionTop = sectionElement.offsetTop

    if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
      const sectionType = sectionElement.dataset.section
      if (activeSection.value !== sectionType) {
        activeSection.value = sectionType
        updateSectionHash(sectionType)
      }
      break
    }
  }
}

function handleResize(width = settingsPageRef.value?.clientWidth ?? window.innerWidth) {
  const wasNotInDesktopView = !isInDesktopView.value

  if (!hasMeasuredSettingsWidth) {
    isInDesktopView.value = width > SETTINGS_MOBILE_WIDTH_THRESHOLD
    hasMeasuredSettingsWidth = true
  } else if (isInDesktopView.value) {
    isInDesktopView.value = width > SETTINGS_MOBILE_WIDTH_THRESHOLD
  } else {
    // Avoid a scrollbar-induced feedback loop at the layout breakpoint.
    isInDesktopView.value = width > SETTINGS_DESKTOP_WIDTH_THRESHOLD
  }

  // navigate to section that was open in mobile or desktop view, if any
  if (isInDesktopView.value && wasNotInDesktopView && settingsSectionTypeOpenInMobile.value != null) {
    navigateToSection(settingsSectionTypeOpenInMobile.value)
    settingsSectionTypeOpenInMobile.value = null
  } else if (!isInDesktopView.value && !wasNotInDesktopView && activeSection.value) {
    navigateToSection(activeSection.value)
  }
}
</script>

<style scoped src="./Settings.css" />
