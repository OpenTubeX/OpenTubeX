<template>
  <section
    ref="settingsWindowRef"
    class="settingsWindow"
    :class="{ maximized: isMaximized }"
    :style="windowStyle"
    role="dialog"
    :aria-label="windowTitle"
    tabindex="-1"
    @keydown.esc.capture="handleSettingsEscape"
  >
    <header
      class="settingsWindowHeader"
      @pointerdown="startDragging"
      @dblclick="handleHeaderDoubleClick"
    >
      <button
        v-if="showBackButton"
        type="button"
        class="settingsHeaderButton settingsBackButton"
        :aria-label="t('Back')"
        :title="t('Back')"
        @click="goBack"
      >
        <FtIcon :icon="['fas', 'arrow-left']" />
      </button>
      <div
        class="settingsBreadcrumb"
        aria-live="polite"
      >
        <span
          v-if="isAboutOpen"
          class="settingsBreadcrumbLabel"
        >
          <FtIcon
            class="settingsWindowIcon"
            :icon="['fas', 'info-circle']"
            aria-hidden="true"
          />
          <span class="settingsBreadcrumbText">{{ t('About.About') }}</span>
        </span>
        <button
          v-else-if="showBackButton"
          type="button"
          class="settingsBreadcrumbRoot"
          @click="returnToSettingsMenu"
        >
          <FtIcon
            class="settingsWindowIcon"
            :icon="['fas', 'cog']"
            aria-hidden="true"
          />
          <span class="settingsBreadcrumbText">{{ t('Settings.Settings') }}</span>
        </button>
        <span
          v-else
          class="settingsBreadcrumbLabel"
        >
          <FtIcon
            class="settingsWindowIcon"
            :icon="['fas', 'cog']"
            aria-hidden="true"
          />
          <span class="settingsBreadcrumbText">{{ t('Settings.Settings') }}</span>
        </span>
        <template v-if="!isAboutOpen && currentSectionTitle">
          <FtIcon
            class="settingsBreadcrumbSeparator"
            :icon="['fas', 'angle-right']"
          />
          <button
            v-if="subpageTitle"
            type="button"
            class="settingsBreadcrumbParent"
            @click="returnToCategory"
          >
            <FtIcon
              v-if="currentSectionIcon"
              class="settingsBreadcrumbCategoryIcon"
              :icon="currentSectionIcon"
              aria-hidden="true"
            />
            <span class="settingsBreadcrumbText">{{ currentSectionTitle }}</span>
          </button>
          <span
            v-else
            class="settingsBreadcrumbLabel"
          >
            <FtIcon
              v-if="currentSectionIcon"
              class="settingsBreadcrumbCategoryIcon"
              :icon="currentSectionIcon"
              aria-hidden="true"
            />
            <span class="settingsBreadcrumbText">{{ currentSectionTitle }}</span>
          </span>
        </template>
        <template v-if="!isAboutOpen && subpageTitle">
          <FtIcon
            class="settingsBreadcrumbSeparator"
            :icon="['fas', 'angle-right']"
          />
          <span class="settingsBreadcrumbLabel">
            <FtIcon
              v-if="subpageIcon"
              class="settingsBreadcrumbCategoryIcon settingsBreadcrumbSubpageIcon"
              :icon="subpageIcon"
              aria-hidden="true"
            />
            <span class="settingsBreadcrumbText">{{ subpageTitle }}</span>
          </span>
        </template>
      </div>
      <label
        v-if="unlocked && !isProfileManagerOpen && !isKeyboardShortcutPromptOpen && !isAboutOpen && !subpageTitle"
        class="settingsSearch"
      >
        <FtIcon :icon="['fas', 'magnifying-glass']" />
        <input
          ref="settingsSearchInputRef"
          v-model="settingsSearchQuery"
          type="search"
          :placeholder="t('Settings.Search Settings')"
          :aria-label="t('Settings.Search Settings')"
          @input="handleSettingsSearch"
        >
      </label>
      <div class="settingsHeaderActions">
        <button
          v-if="USING_ELECTRON && !isAboutOpen"
          type="button"
          class="settingsHeaderButton"
          :aria-label="t('KeyboardShortcutPrompt.Show Keyboard Shortcuts')"
          :title="t('KeyboardShortcutPrompt.Show Keyboard Shortcuts')"
          @click="showKeyboardShortcutPrompt"
        >
          <FtIcon :icon="['fas', 'keyboard']" />
        </button>
        <button
          v-if="!isAboutOpen"
          type="button"
          class="settingsHeaderButton"
          :class="{ active: settingsSectionSortEnabled }"
          :aria-label="t('Settings.Sort Settings Sections (A-Z)')"
          :title="t('Settings.Sort Settings Sections (A-Z)')"
          :aria-pressed="settingsSectionSortEnabled"
          @click="updateSettingsSectionSortEnabled(!settingsSectionSortEnabled)"
        >
          <FtIcon :icon="['fas', 'sort-alpha-down']" />
        </button>
        <button
          v-if="!isAboutOpen"
          type="button"
          class="settingsHeaderButton"
          :class="{ active: highlightChangedSettings }"
          :aria-label="t('Settings.Highlight Changed Settings')"
          :title="t('Settings.Highlight Changed Settings')"
          :aria-pressed="highlightChangedSettings"
          @click="updateHighlightChangedSettings(!highlightChangedSettings)"
        >
          <FtIcon :icon="['fas', 'pen']" />
        </button>
        <button
          v-if="!isAboutOpen"
          type="button"
          class="settingsHeaderButton"
          :class="{ active: showPerformanceImpactIndicators }"
          :aria-label="t('Settings.Performance Impact.Show Performance Impact')"
          :title="t('Settings.Performance Impact.Show Performance Impact')"
          :aria-pressed="showPerformanceImpactIndicators"
          @click="updateShowPerformanceImpactIndicators(!showPerformanceImpactIndicators)"
        >
          <FtIcon :icon="['fas', 'gauge-high']" />
        </button>
        <button
          type="button"
          class="settingsHeaderButton"
          :aria-label="maximizeButtonLabel"
          :title="maximizeButtonLabel"
          @click="toggleMaximized"
        >
          <FtIcon :icon="isMaximized ? ['fas', 'compress'] : ['fas', 'expand']" />
        </button>
        <button
          ref="settingsCloseButtonRef"
          type="button"
          class="settingsHeaderButton settingsCloseButton"
          :aria-label="t('Close')"
          :title="t('Close')"
          @click="closeSettings"
        >
          <FtIcon :icon="['fas', 'xmark']" />
        </button>
      </div>
    </header>

    <div
      ref="settingsPageRef"
      class="settingsPage"
      :class="{ compactSettings: !isInDesktopView }"
    >
      <template v-if="isAboutOpen">
        <div
          v-overlay-scrollbars
          class="settingsSubpageScroll settingsAboutPage"
        >
          <About />
        </div>
      </template>
      <template v-else-if="unlocked">
        <template v-if="isProfileManagerOpen">
          <div
            ref="profileManagerScrollRef"
            v-overlay-scrollbars
            class="settingsSubpageScroll"
            @scroll.passive="clampProfileManagerScroll"
          >
            <ProfileSettings />
          </div>
        </template>
        <template v-else-if="isKeyboardShortcutPromptOpen">
          <div
            class="settingsSubpageScroll settingsKeyboardShortcutPage"
          >
            <FtKeyboardShortcutPrompt embedded />
          </div>
        </template>
        <template v-else>
          <FtSettingsMenu
            v-show="!subpageTitle && (isInDesktopView || (!activeSection && settingsSearchQuery === ''))"
            ref="menuRef"
            v-overlay-scrollbars
            :class="[
              { mobileSettingsMenu: !isInDesktopView },
              settingsMenuTransitionClass
            ]"
            :settings-sections="filteredSettingsSectionComponents"
            :active-section="activeSection"
            :empty-message="t('Settings.No Settings Found')"
            :filtered="settingsSearchQuery !== ''"
            @navigate-to-section="navigateToSection"
          />
          <div
            v-show="!subpageTitle && (isInDesktopView || activeSection || settingsSearchQuery !== '')"
            ref="settingsContentRef"
            v-overlay-scrollbars
            class="settingsContent"
            :class="settingsContentTransitionClass"
            tabindex="-1"
            @scroll.passive="clampSettingsContentScroll"
          >
            <component
              :is="activeSettingsSection.component"
              v-if="activeSettingsSection"
              :key="activeSettingsSection.type"
              class="section"
              :data-section="activeSettingsSection.type"
            />
            <div
              v-else-if="settingsSearchResults.length > 0"
              class="settingsSearchResults"
            >
              <section
                v-for="result in settingsSearchResults"
                :key="result.section.type"
                class="settingsSearchResult"
              >
                <button
                  type="button"
                  class="settingsSearchResultHeading"
                  @click="navigateToSection(result.section.type)"
                >
                  <FtIcon :icon="result.section.icon" />
                  {{ result.section.title }}
                </button>
                <button
                  v-for="match in result.matches"
                  :key="match"
                  type="button"
                  class="settingsSearchResultMatch"
                  @click="openSearchResult(result.section.type, match)"
                >
                  {{ match }}
                </button>
              </section>
            </div>
            <p
              v-else-if="settingsSearchQuery !== ''"
              class="settingsNoResults"
            >
              {{ t('Settings.No Settings Found') }}
            </p>
          </div>
          <div
            v-show="subpageTitle"
            :id="subpageTargetId"
            v-overlay-scrollbars
            class="settingsSubpageScroll"
          />
        </template>
      </template>
      <div
        v-else
        v-overlay-scrollbars
        class="settingsPassword"
      >
        <PasswordDialog @unlocked="handleUnlock" />
      </div>
    </div>
    <div
      v-for="direction in RESIZE_DIRECTIONS"
      v-show="!isMaximized"
      :key="direction"
      class="settingsResizeHandle"
      :class="`resize-${direction}`"
      aria-hidden="true"
      @pointerdown="startResizing($event, direction)"
    />
  </section>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  provide,
  ref,
  useId,
  useTemplateRef,
  watch
} from 'vue'
import { useI18n } from 'vue-i18n'

import GeneralSettings from '../../components/GeneralSettings/GeneralSettings.vue'
import ThemeSettings from '../../components/ThemeSettings.vue'
import PlayerSettings from '../../components/PlayerSettings/PlayerSettings.vue'
import CaptionSettings from '../../components/CaptionSettings/CaptionSettings.vue'
import ChannelSettings from '../../components/ChannelSettings/ChannelSettings.vue'
import ExternalPlayerSettings from '../../components/ExternalPlayerSettings.vue'
import DownloadSettings from '../../components/DownloadSettings.vue'
import ExternalSoftwareSettings from '../../components/ExternalSoftwareSettings.vue'
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
import PasswordDialog from '../../components/PasswordDialog/PasswordDialog.vue'
import ContextMenuSearchSettings from '../../components/ContextMenuSearchSettings/ContextMenuSearchSettings.vue'
import FtSettingsMenu from '../../components/FtSettingsMenu/FtSettingsMenu.vue'
import FtKeyboardShortcutPrompt from '../../components/FtKeyboardShortcutPrompt/FtKeyboardShortcutPrompt.vue'
import ProfileSettings from '../ProfileSettings/ProfileSettings.vue'
import About from '../About/About.vue'

import store from '../../store/index'
import { settingsSubpageKey } from '../../components/FtSettingsSubpage/settingsSubpage'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { getProxyTestUrl } from '../../helpers/proxy-test'
import {
  SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS,
  SETTINGS_SEARCH_KEYS,
  SETTINGS_SEARCH_SELECT_GROUP_LABELS,
} from '../../helpers/settings-search-config'

const USING_ELECTRON = !!process.env.IS_ELECTRON
const SETTINGS_DESKTOP_WIDTH_THRESHOLD = 760
const SETTINGS_BOUNDS_STORAGE_KEY = 'opentubex-settings-window-bounds'
const WINDOW_MARGIN = 12
const MINIMUM_WIDTH = 360
const MINIMUM_HEIGHT = 360
const RESIZE_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

const NON_SETTING_MESSAGE_KEY_PATTERN = /(?:^No\b|^How\b|^Checking\b|^Current .+\b(?:has|is|will)\b|^Operation in Progress$|(?:Description|Hint|Tooltip|Template|Warning|Error|Status|Message|Not Downloaded|Unavailable|Connected|Connecting|Success|Failed|Failure)$)/i

const { locale, t, tm } = useI18n()
const isInDesktopView = ref(true)
const isMaximized = ref(false)
const activeSection = ref(store.getters.getSettingsWindowSection)
const settingsSearchQuery = ref('')
const settingsContentTransitionClass = ref('')
const settingsMenuTransitionClass = ref('')
const settingsWindowRef = useTemplateRef('settingsWindowRef')
const settingsPageRef = useTemplateRef('settingsPageRef')
const settingsContentRef = useTemplateRef('settingsContentRef')
const profileManagerScrollRef = useTemplateRef('profileManagerScrollRef')
const settingsSearchInputRef = useTemplateRef('settingsSearchInputRef')
const settingsCloseButtonRef = useTemplateRef('settingsCloseButtonRef')
const menuRef = useTemplateRef('menuRef')
const subpageTargetId = `settings-subpage-${useId().replaceAll(':', '')}`
const subpageTitle = ref('')
const subpageIcon = ref(null)
let closeSubpage = null
let subpagePersistsOnDeactivate = false
let settingsResizeObserver = null
let settingsSectionResizeObserver = null
let profileManagerResizeObserver = null
let settingsContentPaddingBottom = 0
let observationScheduled = false
let boundsSaveTimer = null
let boundsAnimation = null
let searchHighlightTimer = null
let draggingPointerId = null
let resizeSession = null
let dragOffsetX = 0
let dragOffsetY = 0
let maximizedDragSession = null
let restoreBounds = null

const windowBounds = ref(getInitialBounds())
const windowStyle = computed(() => isMaximized.value
  ? {
      left: '0',
      top: '0',
      inlineSize: '100vw',
      blockSize: '100vh'
    }
  : {
      left: `${windowBounds.value.x}px`,
      top: `${windowBounds.value.y}px`,
      inlineSize: `${windowBounds.value.width}px`,
      blockSize: `${windowBounds.value.height}px`
    })
const maximizeButtonLabel = computed(() => isMaximized.value ? t('Restore') : t('Maximize'))

const settingsSectionSortEnabled = computed(() => store.getters.getSettingsSectionSortEnabled)
const highlightChangedSettings = computed(() => store.getters.getHighlightChangedSettings)
const showPerformanceImpactIndicators = computed(() => store.getters.getShowPerformanceImpactIndicators)
const isProfileManagerOpen = computed(() => store.getters.getSettingsWindowView === 'profile')
const isAboutOpen = computed(() => store.getters.getSettingsWindowView === 'about')
const isKeyboardShortcutPromptOpen = computed(() => store.getters.getIsKeyboardShortcutPromptShown)
const windowTitle = computed(() => isAboutOpen.value ? t('About.About') : t('Settings.Settings'))

const settingsComponentsData = computed(() => [
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
    type: 'channel',
    title: t('Settings.Channel Settings.Channel Settings'),
    icon: ['fas', 'users'],
    component: ChannelSettings
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
      }, {
        type: 'download',
        title: t('Settings.Download Settings.Download Settings'),
        icon: ['fas', 'download'],
        component: DownloadSettings
      }, {
        type: 'external-software',
        title: t('Settings.External Software Settings.External Software Settings'),
        icon: ['fas', 'server'],
        component: ExternalSoftwareSettings
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
    ? [{
        type: 'proxy',
        title: t('Settings.Proxy Settings.Proxy Settings'),
        icon: ['fas', 'network-wired'],
        component: ProxySettings
      }]
    : []),
  {
    type: 'sponsor-block',
    title: t('Settings.SponsorBlock Settings.SponsorBlock Settings'),
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
  ...(process.env.IS_ELECTRON
    ? [{
        type: 'experimental',
        title: t('Settings.Experimental Settings.Experimental Settings'),
        icon: ['fas', 'flask'],
        component: ExperimentalSettings
      }]
    : [])
])

const collator = computed(() => new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' }))
const settingsSectionComponents = computed(() => {
  const sections = [{
    type: 'general',
    title: t('Settings.General Settings.General Settings'),
    icon: ['fas', 'border-all'],
    component: GeneralSettings
  }, ...settingsComponentsData.value]

  return settingsSectionSortEnabled.value
    ? sections.toSorted((a, b) => collator.value.compare(a.title, b.title))
    : sections
})
const settingsSearchExtraValues = computed(() => ({
  privacy: flattenMessageValues(tm('Settings.Password Settings')),
  proxy: [
    `${t('Settings.Proxy Settings.Clicking on Test Proxy will send a request to')} ` +
    getProxyTestUrl(locale.value)
  ]
}))
const isSearchableSettingsMessage = (sectionType, path, value) => {
  if (/\{[^{}]+\}/.test(value)) return false
  const messagePath = path.join('.')
  const messageKey = path.at(-1) ?? ''
  return !SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS[sectionType]?.has(messagePath) &&
    !NON_SETTING_MESSAGE_KEY_PATTERN.test(messageKey)
}
const removeRedundantSearchMatches = (values) => {
  const keptMatches = []
  const normalizedMatches = []
  for (const value of values.toSorted((a, b) => a.length - b.length)) {
    const normalizedValue = normalizeSearchText(value)
    if (normalizedMatches.some(shorterValue => normalizedValue.includes(shorterValue))) continue
    keptMatches.push(value)
    normalizedMatches.push(normalizedValue)
  }
  return keptMatches
}
const settingsSearchableValues = computed(() => new Map(
  settingsSectionComponents.value.map((section) => {
    const messages = tm(SETTINGS_SEARCH_KEYS[section.type])
    const values = [...new Set([
      section.title,
      ...flattenMessageValues(
        messages,
        SETTINGS_SEARCH_SELECT_GROUP_LABELS[section.type],
        [],
        (path, value) => isSearchableSettingsMessage(section.type, path, value)
      ),
      ...(settingsSearchExtraValues.value[section.type] ?? [])
    ])]
    return [section.type, values]
  })
))
const settingsSearchResults = computed(() => {
  const query = normalizeSearchText(settingsSearchQuery.value)
  if (query === '') return []

  return settingsSectionComponents.value.flatMap((section) => {
    const values = settingsSearchableValues.value.get(section.type) ?? []
    const matches = removeRedundantSearchMatches(
      values.filter(value => normalizeSearchText(value).includes(query))
    )
    return matches.length === 0 ? [] : [{ section, matches: matches.slice(0, 6) }]
  })
})
const filteredSettingsSectionComponents = computed(() => {
  if (settingsSearchQuery.value === '') return settingsSectionComponents.value
  return settingsSearchResults.value.map(({ section }) => section)
})
const activeSettingsSection = computed(() => {
  return settingsSectionComponents.value.find(({ type }) => type === activeSection.value) ?? null
})
const currentSectionTitle = computed(() => {
  if (isKeyboardShortcutPromptOpen.value) {
    return t('KeyboardShortcutPrompt.Keyboard Shortcuts')
  }
  if (isProfileManagerOpen.value) {
    return t('Profile.Profile Manager')
  }
  return activeSettingsSection.value?.title ?? ''
})
const currentSectionIcon = computed(() => {
  if (isKeyboardShortcutPromptOpen.value) {
    return ['fas', 'keyboard']
  }
  if (isProfileManagerOpen.value) {
    return ['fas', 'users']
  }
  return activeSettingsSection.value?.icon ?? null
})
const showBackButton = computed(() => {
  return isKeyboardShortcutPromptOpen.value || isProfileManagerOpen.value || subpageTitle.value !== '' ||
    (!isInDesktopView.value && activeSection.value !== null)
})

const unlocked = ref(store.getters.getSettingsPassword === '')

provide(settingsSubpageKey, {
  targetId: subpageTargetId,
  open(title, close, persistOnDeactivate = false, icon = null) {
    subpageTitle.value = title
    subpageIcon.value = icon
    closeSubpage = close
    subpagePersistsOnDeactivate = persistOnDeactivate
  },
  close(close) {
    if (closeSubpage === close) {
      subpageTitle.value = ''
      subpageIcon.value = null
      closeSubpage = null
      subpagePersistsOnDeactivate = false
    }
  }
})

onMounted(handleMounted)
onActivated(handleMounted)
onDeactivated(() => {
  if (!subpagePersistsOnDeactivate) {
    closeSubpage?.()
  }
  stopObserving()
  stopDragging()
  stopResizing()
})
onBeforeUnmount(() => {
  stopObserving()
  stopDragging()
  stopResizing()
  if (boundsSaveTimer !== null) {
    clearTimeout(boundsSaveTimer)
  }
  boundsAnimation?.cancel()
  if (searchHighlightTimer !== null) {
    clearTimeout(searchHighlightTimer)
  }
})

watch(isProfileManagerOpen, (open) => {
  if (!open) {
    stopObservingProfileManager()
    setInitialSection()
  } else {
    nextTick(observeProfileManager)
  }
})
watch(activeSection, (section) => {
  if (section !== null) {
    store.commit('setSettingsWindowSection', section)
  }
  nextTick(observeActiveSettingsSection)
})

function handleMounted() {
  unlocked.value = store.getters.getSettingsPassword === ''
  handleResize(settingsWindowRef.value?.clientWidth ?? windowBounds.value.width)
  setInitialSection()
  nextTick(observeProfileManager)
  nextTick(() => (settingsSearchInputRef.value ?? settingsCloseButtonRef.value)?.focus())
  if (settingsResizeObserver !== null || observationScheduled) {
    return
  }
  observationScheduled = true
  nextTick(() => {
    observationScheduled = false
    const element = settingsWindowRef.value
    if (!element) return
    handleResize(element.clientWidth)
    settingsResizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      handleResize(width)
      if (width > 0 && height > 0) {
        if (
          !isMaximized.value &&
          boundsAnimation === null &&
          draggingPointerId === null &&
          resizeSession === null
        ) {
          windowBounds.value = clampBounds({
            ...windowBounds.value,
            width: element.offsetWidth,
            height: element.offsetHeight
          })
          scheduleBoundsSave()
        }
        if (settingsContentRef.value) {
          clampOverlayScrollTop(
            settingsContentRef.value,
            getActiveSettingsSectionEnd(settingsContentRef.value)
          )
        }
      }
    })
    settingsResizeObserver.observe(element)
    window.addEventListener('resize', clampWindowToViewport)
    observeActiveSettingsSection()
  })
}

function stopObserving() {
  observationScheduled = false
  settingsResizeObserver?.disconnect()
  settingsResizeObserver = null
  settingsSectionResizeObserver?.disconnect()
  settingsSectionResizeObserver = null
  stopObservingProfileManager()
  settingsContentPaddingBottom = 0
  window.removeEventListener('resize', clampWindowToViewport)
}

function observeProfileManager() {
  stopObservingProfileManager()
  const content = profileManagerScrollRef.value
  const profileManager = content?.firstElementChild
  if (!content || !(profileManager instanceof HTMLElement)) return

  profileManagerResizeObserver = new ResizeObserver(() => {
    clampOverlayScrollTop(content, profileManager)
  })
  profileManagerResizeObserver.observe(profileManager)
  clampOverlayScrollTop(content, profileManager)
}

function stopObservingProfileManager() {
  profileManagerResizeObserver?.disconnect()
  profileManagerResizeObserver = null
}

function clampProfileManagerScroll() {
  const content = profileManagerScrollRef.value
  const profileManager = content?.firstElementChild
  if (content && profileManager instanceof HTMLElement) {
    clampOverlayScrollTop(content, profileManager)
  }
}

function observeActiveSettingsSection() {
  settingsSectionResizeObserver?.disconnect()
  settingsSectionResizeObserver = null
  const content = settingsContentRef.value
  const section = getActiveSettingsSectionEnd(content)
  if (!content || !section) return
  settingsContentPaddingBottom = Number.parseFloat(getComputedStyle(content).paddingBottom)

  settingsSectionResizeObserver = new ResizeObserver(() => {
    clampOverlayScrollTop(content, section)
  })
  content.querySelectorAll(':scope > .section').forEach(element => {
    settingsSectionResizeObserver.observe(element)
  })
  clampOverlayScrollTop(content, section)
}

function clampSettingsContentScroll(event) {
  const content = event.currentTarget
  const section = getActiveSettingsSectionEnd(content)
  if (!section) return
  const contentEnd = section.offsetTop + section.offsetHeight + settingsContentPaddingBottom
  if (content.scrollTop > Math.max(0, contentEnd - content.clientHeight)) {
    clampOverlayScrollTop(content, section)
  }
}

function getActiveSettingsSectionEnd(content) {
  const sections = content?.querySelectorAll(':scope > .section')
  return sections?.[sections.length - 1] ?? null
}

function handleUnlock() {
  unlocked.value = true
  nextTick(setInitialSection)
}

function setInitialSection() {
  if (isProfileManagerOpen.value || !unlocked.value || settingsSearchQuery.value !== '') return
  if (isInDesktopView.value && activeSection.value === null) {
    activeSection.value = getRememberedSection()
  }
}

function getRememberedSection() {
  const rememberedSection = store.getters.getSettingsWindowSection
  return settingsSectionComponents.value.some(({ type }) => type === rememberedSection)
    ? rememberedSection
    : settingsSectionComponents.value[0].type
}

function navigateToSection(sectionType) {
  const previousSection = activeSection.value
  closeSubpage?.()
  subpageTitle.value = ''
  subpageIcon.value = null
  closeSubpage = null
  activeSection.value = sectionType
  if (isInDesktopView.value && previousSection !== null && previousSection !== sectionType) {
    const previousIndex = settingsSectionComponents.value.findIndex(({ type }) => type === previousSection)
    const nextIndex = settingsSectionComponents.value.findIndex(({ type }) => type === sectionType)
    animateSettingsElement(
      settingsContentRef,
      settingsContentTransitionClass,
      nextIndex >= previousIndex ? 'settingsSectionSlideForward' : 'settingsSectionSlideBackward'
    )
  } else if (!isInDesktopView.value) {
    animateSettingsElement(
      settingsContentRef,
      settingsContentTransitionClass,
      'settingsCompactSlideForward'
    )
    nextTick(() => settingsContentRef.value?.focus({ preventScroll: true }))
  }
}

/**
 * @param {Readonly<import('vue').ShallowRef<HTMLElement | {$el?: HTMLElement} | null>>} elementRef
 * @param {import('vue').Ref<string>} classRef
 * @param {string} className
 */
async function animateSettingsElement(elementRef, classRef, className) {
  classRef.value = ''
  await nextTick()
  const element = elementRef.value?.$el ?? elementRef.value
  element?.getBoundingClientRect()
  classRef.value = className
  await nextTick()

  // A class left in place keeps its animation attached to the element, so
  // anything that later has the browser start it over — rebuilding the overlay
  // scrollbars, for instance — replays the slide long after the navigation it
  // belonged to. Drop it once it has played.
  // Nothing to play, because reduced motion suppressed it. Leaving the class
  // behind would let it slide as soon as reduced motion is turned back off.
  const animations = element?.getAnimations() ?? []
  if (animations.length === 0) {
    if (classRef.value === className) {
      classRef.value = ''
    }
    return
  }

  const results = await Promise.allSettled(animations.map(animation => animation.finished))
  // Rejected means a newer navigation cancelled this one, and owns the class now.
  if (results.some(({ status }) => status === 'rejected')) return

  if (classRef.value === className) {
    classRef.value = ''
  }
}

async function openSearchResult(sectionType, label) {
  settingsSearchQuery.value = ''
  navigateToSection(sectionType)
  await nextTick()

  const content = settingsContentRef.value
  if (!content) return
  const normalizedLabel = normalizeSearchText(label.trim())
  const visibleTextElements = [...content.querySelectorAll(
    'label, button, p, h1, h2, h3, h4, span, legend, div'
  )]
    .filter(element => element.getClientRects().length > 0)
  const labelElement = visibleTextElements
    .filter(element => getSearchTargetText(element) === normalizedLabel)
    .at(-1) ?? visibleTextElements
    .filter(element => getSearchTargetText(element).startsWith(`${normalizedLabel}:`))
    .at(-1)
  const control = labelElement?.closest(
    '.switch-ctn, .select, .ft-input-component, .pure-material-slider, ' +
    '.pure-checkbox, .captionControl, .preferenceToggle'
  ) ?? labelElement
  const target = control?.classList.contains('ft-input-component')
    ? control.querySelector('.ft-input')
    : control
  if (!target) return

  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  target.classList.remove('settingsSearchTarget')
  // Restart the animation if the same result is selected repeatedly.
  await new Promise(resolve => requestAnimationFrame(resolve))
  target.classList.add('settingsSearchTarget')
  if (searchHighlightTimer !== null) clearTimeout(searchHighlightTimer)
  searchHighlightTimer = setTimeout(() => {
    target.classList.remove('settingsSearchTarget')
    searchHighlightTimer = null
  }, 2200)
}

function getSearchTargetText(element) {
  const clone = element.cloneNode(true)
  clone.querySelectorAll('.tooltip, .changedSettingIndicator, .changedSettingIndicatorPlaceholder')
    .forEach(child => child.remove())
  return normalizeSearchText(clone.textContent.trim())
}

function handleSettingsSearch() {
  closeSubpage?.()
  subpageTitle.value = ''
  subpageIcon.value = null
  closeSubpage = null
  activeSection.value = settingsSearchQuery.value === '' && isInDesktopView.value
    ? getRememberedSection()
    : null
  nextTick(() => {
    if (settingsContentRef.value) settingsContentRef.value.scrollTop = 0
  })
}

function flattenMessageValues(value, selectGroups = {}, path = [], include = () => true) {
  if (typeof value === 'string') return include(path, value) ? [value] : []
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flattenMessageValues(item, selectGroups, [...path, index.toString()], include))
  }
  if (value !== null && typeof value === 'object') {
    const retainedKeys = selectGroups[path.join('.')]
    return Object.entries(value)
      .filter(([key]) => retainedKeys === undefined || retainedKeys.includes(key))
      .flatMap(([key, childValue]) =>
        flattenMessageValues(childValue, selectGroups, [...path, key], include))
  }
  return []
}

function normalizeSearchText(value) {
  return value.toLocaleLowerCase(locale.value).normalize('NFKD').replaceAll(/\s+/g, ' ').trim()
}

function goBack() {
  if (isKeyboardShortcutPromptOpen.value) {
    store.dispatch('hideKeyboardShortcutPrompt')
  } else if (isProfileManagerOpen.value) {
    returnToSettingsMenu()
  } else if (subpageTitle.value) {
    closeSubpage?.()
  } else {
    returnToSettingsMenu()
  }
}

function returnToSettingsMenu() {
  if (isKeyboardShortcutPromptOpen.value) {
    store.dispatch('hideKeyboardShortcutPrompt')
    if (!isInDesktopView.value) {
      activeSection.value = null
    }
    return
  }
  if (isProfileManagerOpen.value) {
    store.dispatch('showSettingsWindowRoot')
    activeSection.value = isInDesktopView.value ? 'data' : null
    return
  }
  closeSubpage?.()
  subpageTitle.value = ''
  subpageIcon.value = null
  closeSubpage = null
  if (!isInDesktopView.value) {
    const previousSection = activeSection.value
    activeSection.value = null
    animateSettingsElement(menuRef, settingsMenuTransitionClass, 'settingsCompactSlideBackward')
    nextTick(() => menuRef.value?.focusLink(previousSection))
  }
}

function returnToCategory() {
  closeSubpage?.()
}

function showKeyboardShortcutPrompt() {
  store.dispatch('showKeyboardShortcutPrompt')
}

function updateSettingsSectionSortEnabled(value) {
  store.dispatch('updateSettingsSectionSortEnabled', value)
}

function updateShowPerformanceImpactIndicators(value) {
  store.dispatch('updateShowPerformanceImpactIndicators', value)
}

function updateHighlightChangedSettings(value) {
  store.dispatch('updateHighlightChangedSettings', value)
}

function handleResize(width) {
  if (width <= 0) return
  const desktop = width >= SETTINGS_DESKTOP_WIDTH_THRESHOLD
  if (desktop === isInDesktopView.value) return
  isInDesktopView.value = desktop
  if (desktop && activeSection.value === null && settingsSearchQuery.value === '') {
    activeSection.value = getRememberedSection()
  }
}

function closeSettings() {
  store.dispatch('hideKeyboardShortcutPrompt')
  store.dispatch('hideSettingsWindow')
}

async function toggleMaximized() {
  cancelBoundsAnimation()
  const element = settingsWindowRef.value
  const from = getWindowAnimationState(element)
  if (isMaximized.value) {
    restoreSettingsWindow()
  } else {
    restoreBounds = { ...windowBounds.value }
    isMaximized.value = true
  }
  await nextTick()
  animateWindowBounds(element, from)
}

function getWindowAnimationState(element) {
  if (!element) return null
  const bounds = element.getBoundingClientRect()
  return {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    borderRadius: getComputedStyle(element).borderRadius
  }
}

// The window is already at its target bounds here, so the difference is played back
// with transforms only. Animating left/top/width/height instead would relayout the
// whole settings page and re-evaluate its container queries on every single frame.
function animateWindowBounds(element, from) {
  if (!element || !from || document.documentElement.dataset.reducedMotion === 'reduce') return
  const to = getWindowAnimationState(element)
  if (to.width === 0 || to.height === 0) return
  const animation = element.animate([
    {
      transformOrigin: '0 0',
      transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
      borderRadius: from.borderRadius
    },
    {
      transformOrigin: '0 0',
      transform: 'none',
      borderRadius: to.borderRadius
    }
  ], {
    duration: 240,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
  })
  boundsAnimation = animation
  animation.finished.catch(() => {}).finally(() => {
    if (boundsAnimation === animation) boundsAnimation = null
  })
}

function cancelBoundsAnimation() {
  boundsAnimation?.cancel()
  boundsAnimation = null
}

function restoreSettingsWindow() {
  if (!isMaximized.value) return
  windowBounds.value = clampBounds(restoreBounds ?? windowBounds.value)
  restoreBounds = null
  isMaximized.value = false
  scheduleBoundsSave()
}

function handleSettingsEscape(event) {
  if (event.target.closest('[aria-expanded="true"]')) return
  event.stopPropagation()
  closeSettings()
}

function handleHeaderDoubleClick(event) {
  if (event.button !== 0 || event.target.closest('button, input, .settingsSearch')) return
  toggleMaximized()
}

function startDragging(event) {
  if (event.button !== 0 || event.target.closest('button, input, .settingsSearch')) return
  cancelBoundsAnimation()
  const renderedBounds = settingsWindowRef.value.getBoundingClientRect()
  if (isMaximized.value) {
    const floatingBounds = clampBounds(restoreBounds ?? windowBounds.value)
    maximizedDragSession = {
      floatingBounds,
      horizontalPosition: renderedBounds.width > 0
        ? (event.clientX - renderedBounds.left) / renderedBounds.width
        : 0.5,
      pointerOffsetY: event.clientY - renderedBounds.top
    }
  } else {
    const bounds = windowBounds.value
    dragOffsetX = event.clientX - bounds.x
    dragOffsetY = event.clientY - bounds.y
  }
  draggingPointerId = event.pointerId
  document.documentElement.classList.add('draggingSettingsWindow')
  window.addEventListener('pointermove', dragWindow)
  window.addEventListener('pointerup', stopDragging)
  window.addEventListener('pointercancel', stopDragging)
  event.preventDefault()
}

function dragWindow(event) {
  if (event.pointerId !== draggingPointerId) return
  if (maximizedDragSession !== null) {
    const { floatingBounds, horizontalPosition, pointerOffsetY } = maximizedDragSession
    windowBounds.value = clampBounds({
      ...floatingBounds,
      x: event.clientX - floatingBounds.width * horizontalPosition,
      y: event.clientY - pointerOffsetY
    })
    dragOffsetX = event.clientX - windowBounds.value.x
    dragOffsetY = event.clientY - windowBounds.value.y
    maximizedDragSession = null
    restoreBounds = null
    isMaximized.value = false
    return
  }
  windowBounds.value = clampBounds({
    ...windowBounds.value,
    x: event.clientX - dragOffsetX,
    y: event.clientY - dragOffsetY
  })
}

function stopDragging(event) {
  if (event && event.pointerId !== draggingPointerId) return
  if (draggingPointerId === null) return
  draggingPointerId = null
  maximizedDragSession = null
  document.documentElement.classList.remove('draggingSettingsWindow')
  window.removeEventListener('pointermove', dragWindow)
  window.removeEventListener('pointerup', stopDragging)
  window.removeEventListener('pointercancel', stopDragging)
  scheduleBoundsSave()
}

function startResizing(event, direction) {
  if (event.button !== 0 || isMaximized.value) return
  cancelBoundsAnimation()
  resizeSession = {
    direction,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    bounds: { ...windowBounds.value }
  }
  document.documentElement.classList.add('resizingSettingsWindow')
  document.documentElement.style.cursor = getComputedStyle(event.currentTarget).cursor
  window.addEventListener('pointermove', resizeWindow)
  window.addEventListener('pointerup', stopResizing)
  window.addEventListener('pointercancel', stopResizing)
  event.preventDefault()
  event.stopPropagation()
}

function resizeWindow(event) {
  if (resizeSession === null || event.pointerId !== resizeSession.pointerId) return
  const { direction, startX, startY, bounds } = resizeSession
  const deltaX = event.clientX - startX
  const deltaY = event.clientY - startY
  let left = bounds.x
  let right = bounds.x + bounds.width
  let top = bounds.y
  let bottom = bounds.y + bounds.height

  if (direction.includes('e')) right += deltaX
  if (direction.includes('w')) left += deltaX
  if (direction.includes('s')) bottom += deltaY
  if (direction.includes('n')) top += deltaY

  const maximumRight = window.innerWidth - WINDOW_MARGIN
  const maximumBottom = window.innerHeight - WINDOW_MARGIN
  const minimumWidth = Math.min(MINIMUM_WIDTH, maximumRight - WINDOW_MARGIN)
  const minimumHeight = Math.min(MINIMUM_HEIGHT, maximumBottom - WINDOW_MARGIN)
  left = Math.max(WINDOW_MARGIN, left)
  top = Math.max(WINDOW_MARGIN, top)
  right = Math.min(maximumRight, right)
  bottom = Math.min(maximumBottom, bottom)

  if (right - left < minimumWidth) {
    if (direction.includes('w')) left = Math.max(WINDOW_MARGIN, right - minimumWidth)
    else right = Math.min(maximumRight, left + minimumWidth)
  }
  if (bottom - top < minimumHeight) {
    if (direction.includes('n')) top = Math.max(WINDOW_MARGIN, bottom - minimumHeight)
    else bottom = Math.min(maximumBottom, top + minimumHeight)
  }

  windowBounds.value = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  }
}

function stopResizing(event) {
  if (resizeSession === null || (event && event.pointerId !== resizeSession.pointerId)) return
  resizeSession = null
  document.documentElement.classList.remove('resizingSettingsWindow')
  document.documentElement.style.removeProperty('cursor')
  window.removeEventListener('pointermove', resizeWindow)
  window.removeEventListener('pointerup', stopResizing)
  window.removeEventListener('pointercancel', stopResizing)
  scheduleBoundsSave()
}

function clampWindowToViewport() {
  if (isMaximized.value) return
  windowBounds.value = clampBounds(windowBounds.value)
}

function clampBounds(bounds) {
  const maximumWidth = Math.max(0, window.innerWidth - WINDOW_MARGIN * 2)
  const maximumHeight = Math.max(0, window.innerHeight - WINDOW_MARGIN * 2)
  const width = Math.min(Math.max(bounds.width, MINIMUM_WIDTH), maximumWidth)
  const height = Math.min(Math.max(bounds.height, MINIMUM_HEIGHT), maximumHeight)
  return {
    x: Math.min(Math.max(bounds.x, WINDOW_MARGIN), window.innerWidth - width - WINDOW_MARGIN),
    y: Math.min(Math.max(bounds.y, WINDOW_MARGIN), window.innerHeight - height - WINDOW_MARGIN),
    width,
    height
  }
}

function getInitialBounds() {
  const fallbackWidth = Math.min(1080, Math.max(MINIMUM_WIDTH, window.innerWidth - 64))
  const fallbackHeight = Math.min(720, Math.max(MINIMUM_HEIGHT, window.innerHeight - 120))
  const fallback = {
    x: Math.round((window.innerWidth - fallbackWidth) / 2),
    y: Math.max(WINDOW_MARGIN, Math.round((window.innerHeight - fallbackHeight) / 2)),
    width: fallbackWidth,
    height: fallbackHeight
  }
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_BOUNDS_STORAGE_KEY))
    if ([saved?.x, saved?.y, saved?.width, saved?.height].every(Number.isFinite)) {
      return clampBounds(saved)
    }
  } catch {
    // Ignore corrupt state and use the centered default.
  }
  return clampBounds(fallback)
}

function scheduleBoundsSave() {
  if (boundsSaveTimer !== null) clearTimeout(boundsSaveTimer)
  boundsSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SETTINGS_BOUNDS_STORAGE_KEY, JSON.stringify(windowBounds.value))
    } catch {
      // Bounds are convenience state; storage can be unavailable or full.
    } finally {
      boundsSaveTimer = null
    }
  }, 150)
}
</script>

<style scoped src="./Settings.css" />
