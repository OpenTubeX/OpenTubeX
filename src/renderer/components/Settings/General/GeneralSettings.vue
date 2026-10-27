<template>
  <FtSettingsSection
    :title="t('Settings.General Settings.General Settings')"
  >
    <div class="switchColumnGrid switchFlowGrid">
      <FtToggleSwitch
        v-if="IS_CAPACITOR"
        :label="t('Settings.General Settings.Enable Tabs')"
        :tooltip="t('Tooltips.General Settings.Enable Tabs')"
        :default-value="store.getters.getEnableMobileTabs"
        setting-key="enableMobileTabs"
        compact
        @change="store.dispatch('updateEnableMobileTabs', $event)"
      />
      <FtToggleSwitch
        :label="t('Settings.Privacy Settings.Enable Watch Statistics')"
        compact
        :disabled="!rememberHistory"
        :default-value="enableWatchStats"
        setting-key="enableWatchStats"
        @change="updateEnableWatchStats"
      />
      <FtToggleSwitch
        :label="t('Settings.General Settings.Check for Updates')"
        :default-value="checkForUpdates"
        setting-key="checkForUpdates"
        :compact="true"
        @change="updateCheckForUpdates"
      />
      <FtToggleSwitch
        v-if="USING_ELECTRON"
        :label="t('Settings.General Settings.Open Deep Links In New Window')"
        :default-value="openDeepLinksInNewWindow"
        setting-key="openDeepLinksInNewWindow"
        :compact="true"
        :tooltip="t('Tooltips.General Settings.Open Deep Links In New Window')"
        @change="updateOpenDeepLinksInNewWindow"
      />
      <FtToggleSwitch
        :label="t('Settings.General Settings.Update Relative Timestamps')"
        :tooltip="t('Tooltips.General Settings.Update Relative Timestamps')"
        :default-value="updateRelativeTimestamps"
        setting-key="updateRelativeTimestamps"
        :compact="true"
        @change="updateRelativeTimestampsSetting"
      />
      <FtToggleSwitch
        :label="t('Settings.General Settings.Auto Load Next Page.Label')"
        :default-value="generalAutoLoadMorePaginatedItemsEnabled"
        setting-key="generalAutoLoadMorePaginatedItemsEnabled"
        :compact="true"
        :tooltip="t('Settings.General Settings.Auto Load Next Page.Tooltip')"
        @change="updateGeneralAutoLoadMorePaginatedItemsEnabled"
      />
      <FtToggleSwitch
        v-if="USING_ELECTRON"
        :label="t('Settings.General Settings.Use tray icon')"
        :default-value="trayEnabled"
        :disabled="closedAppRefresh"
        :tooltip="closedAppRefresh ? t('Settings.General Settings.Tray required for background refresh') : ''"
        setting-key="useTrayIcon"
        :compact="true"
        @change="store.dispatch('updateUseTrayIcon', $event)"
      />
      <FtToggleSwitch
        v-if="USING_ELECTRON"
        :label="t('Settings.General Settings.Close to system tray')"
        :default-value="store.getters.getHideToTrayOnClose"
        :disabled="!trayEnabled"
        setting-key="hideToTrayOnClose"
        :compact="true"
        @change="store.dispatch('updateHideToTrayOnClose', $event)"
      />
      <FtToggleSwitch
        v-if="supportsAutoPictureInPictureMinimize && USING_ELECTRON"
        :label="t('Settings.General Settings.Minimize to system tray')"
        :default-value="hideToTrayOnMinimize"
        :disabled="!trayEnabled"
        setting-key="hideToTrayOnMinimize"
        :compact="true"
        @change="updateHideToTrayOnMinimize"
      />
      <FtToggleSwitch
        v-if="IS_CAPACITOR && !IS_IOS"
        :label="t('Settings.General Settings.Swipe to refresh')"
        :default-value="enablePullToRefresh"
        setting-key="enablePullToRefresh"
        :compact="true"
        @change="store.dispatch('updateEnablePullToRefresh', $event)"
      />
      <FtToggleSwitch
        :label="t('Settings.General Settings.Use AI Translation Completions')"
        :default-value="useAITranslationCompletions"
        setting-key="useAITranslationCompletions"
        :compact="true"
        :disabled="aiTranslationCompletionsDisabled"
        :tooltip="t('Tooltips.General Settings.Use AI Translation Completions')"
        @change="updateUseAITranslationCompletions"
      />
    </div>
    <div class="switchGrid generalSelectGrid">
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Privacy Settings.Week Starts On')"
        :value="statsWeekStartsOn"
        setting-key="statsWeekStartsOn"
        :select-names="weekStartNames"
        :select-values="WEEK_START_VALUES"
        :icon="['fas', 'chart-line']"
        :disabled="!rememberHistory || !enableWatchStats"
        @change="updateStatsWeekStartsOn"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.General Settings.Default Landing Page')"
        :value="landingPage"
        setting-key="landingPage"
        :select-names="defaultPageNames"
        :select-values="defaultPageValues"
        :icon="['fas', 'location-dot']"
        @change="updateLandingPage"
      />
      <FtSelect
        v-if="(USING_ELECTRON || IS_CAPACITOR)"
        size-to-content
        :placeholder="t('Settings.General Settings.New Tab Position.New Tab Position')"
        :value="newTabPosition"
        setting-key="newTabPosition"
        :disabled="!store.getters.getTabsEnabled"
        :select-names="newTabPositionNames"
        :select-values="NEW_TAB_POSITION_VALUES"
        :icon="['fas', 'plus']"
        @change="updateNewTabPosition"
      />
      <FtSelect
        v-if="(USING_ELECTRON || IS_CAPACITOR)"
        size-to-content
        :placeholder="t('Settings.General Settings.Tab Close Focus.Tab Close Focus')"
        :value="tabCloseFocus"
        setting-key="tabCloseFocus"
        :disabled="!store.getters.getTabsEnabled"
        :select-names="tabCloseFocusNames"
        :select-values="TAB_CLOSE_FOCUS_VALUES"
        :icon="['fas', 'xmark']"
        @change="updateTabCloseFocus"
      />
      <FtSelect
        v-if="(USING_ELECTRON || IS_CAPACITOR)"
        size-to-content
        :placeholder="t('Settings.General Settings.Startup Behavior.Startup Behavior')"
        :value="startupBehavior"
        setting-key="startupBehavior"
        :select-names="startupBehaviorNames"
        :select-values="STARTUP_BEHAVIOR_VALUES"
        :tooltip="t('Tooltips.General Settings.Startup Behavior')"
        :icon="['fas', 'power-off']"
        @change="updateStartupBehavior"
      />
      <FtSelect
        v-if="!IS_CAPACITOR && !phoneLayout"
        size-to-content
        :placeholder="t('Settings.General Settings.Extra Thumbnail Action Button.Extra Thumbnail Action Button')"
        :value="effectiveExtraThumbnailAction"
        setting-key="extraThumbnailAction"
        :select-names="extraThumbnailActionNames"
        :select-values="extraThumbnailActionValues"
        :icon="['fas', 'ellipsis-v']"
        @change="updateExtraThumbnailAction"
      />
      <FtSelect
        v-if="(IS_CAPACITOR || phoneLayout)"
        size-to-content
        :placeholder="t('Settings.General Settings.Thumbnail Swipe Gestures.Left')"
        :value="getThumbnailSwipeValue(store.getters.getThumbnailLeftSwipeAction)"
        setting-key="thumbnailLeftSwipeAction"
        :select-names="thumbnailSwipeActionNames"
        :select-values="thumbnailSwipeActionValues"
        :tooltip="t('Settings.General Settings.Thumbnail Swipe Gestures.Description')"
        :icon="getThumbnailSwipeIcon(store.getters.getThumbnailLeftSwipeAction)"
        @change="store.dispatch('updateThumbnailLeftSwipeAction', $event)"
      />
      <FtSelect
        v-if="(IS_CAPACITOR || phoneLayout)"
        size-to-content
        :placeholder="t('Settings.General Settings.Thumbnail Swipe Gestures.Right')"
        :value="getThumbnailSwipeValue(store.getters.getThumbnailRightSwipeAction)"
        setting-key="thumbnailRightSwipeAction"
        :select-names="thumbnailSwipeActionNames"
        :select-values="thumbnailSwipeActionValues"
        :tooltip="t('Settings.General Settings.Thumbnail Swipe Gestures.Description')"
        :icon="getThumbnailSwipeIcon(store.getters.getThumbnailRightSwipeAction)"
        @change="store.dispatch('updateThumbnailRightSwipeAction', $event)"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.General Settings.Locale Preference')"
        :value="currentLocale"
        setting-key="currentLocale"
        :select-names="localeNames"
        :select-values="LOCALE_VALUES"
        :icon="['fas', 'language']"
        :is-locale-selector="true"
        @change="updateCurrentLocale"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.General Settings.Date Format')"
        :value="dateFormat"
        setting-key="dateFormat"
        :select-names="dateFormatNames"
        :select-values="DATE_FORMAT_OPTIONS"
        :icon="['fas', 'calendar-days']"
        @change="updateDateFormat"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.General Settings.Time Format')"
        :value="timeFormat"
        setting-key="timeFormat"
        :select-names="timeFormatNames"
        :select-values="TIME_FORMAT_OPTIONS"
        :icon="['fas', 'clock']"
        @change="updateTimeFormat"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.General Settings.Reduced Motion.Reduced Motion')"
        :value="reducedMotion"
        setting-key="reducedMotion"
        :select-names="reducedMotionNames"
        :select-values="REDUCED_MOTION_VALUES"
        :icon="['fas', 'gauge']"
        @change="updateReducedMotion"
      />
      <FtSelect
        v-if="SUPPORTS_LOCAL_API && (backendPreference === 'local' || backendFallback)"
        size-to-content
        :placeholder="t('Settings.General Settings.Avoid translation.Avoid translation')"
        :value="avoidTranslation"
        setting-key="avoidTranslation"
        :select-names="avoidTranslationNames"
        :select-values="AVOID_TRANSLATION_VALUES"
        :tooltip="t('Tooltips.General Settings.Avoid translation')"
        :icon="['fas', 'language']"
        @change="updateAvoidTranslation"
      />
      <FtSelect
        v-if="regionDataLoaded"
        size-to-content
        :placeholder="t('Settings.General Settings.Region for Trending')"
        :value="region"
        setting-key="region"
        :select-names="regionNames"
        :select-values="regionValues"
        :icon="['fas', 'globe']"
        :tooltip="t('Tooltips.General Settings.Region for Trending')"
        @change="updateRegion"
      />
    </div>
    <FtFlexBox
      v-if="(USING_ELECTRON || IS_CAPACITOR)"
      class="confirmations"
    >
      <FtCheckboxList
        v-model="enabledConfirmations"
        :title="t('Settings.General Settings.Confirm Before')"
        :labels="confirmationLabels"
        :values="confirmationValues"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { supportsYtDlp } from '../../../helpers/ytDlpCapabilities'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtCheckboxList from '../../FtCheckboxList/FtCheckboxList.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'

import store from '../../../store/index'
import { localeTranslationPercentages } from '../../../i18n/index'

import allLocales from '../../../../../static/locales/activeLocales.json'
import { translateWindowTitle } from '../../../helpers/strings'
import { initializePlatformInfo, supportsAutoPictureInPictureMinimize } from '../../../helpers/platform'
import { filterAvailableNavigationItems } from '../../../../navigationAvailability'
import { usePhoneLayout } from '../../../composables/usePhoneLayout'
import {
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  formatDate,
  formatTime,
  normalizeDateFormat,
  normalizeTimeFormat,
} from '../../../helpers/dateFormat'

const USING_ELECTRON = !!process.env.IS_ELECTRON
const IS_IOS = !!process.env.IS_IOS
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const phoneLayout = usePhoneLayout()
const enablePullToRefresh = computed(() => store.getters.getEnablePullToRefresh)
const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API

const { locale, t } = useI18n()

const rememberHistory = computed(() => store.getters.getRememberHistory)

/** @type {import('vue').ComputedRef<boolean>} */
const enableWatchStats = computed(() => store.getters.getEnableWatchStats)

/**
 * @param {boolean} value
 */
function updateEnableWatchStats(value) {
  store.dispatch('updateEnableWatchStats', value)
}

const WEEK_START_VALUES = ['0', '1', '2', '3', '4', '5', '6']
const weekStartNames = computed(() => {
  const formatter = new Intl.DateTimeFormat(locale.value, { weekday: 'long' })
  const sunday = new Date(2024, 0, 7, 12)

  return WEEK_START_VALUES.map((_, index) => {
    const date = new Date(sunday)
    date.setDate(date.getDate() + index)
    return formatter.format(date)
  })
})

/** @type {import('vue').ComputedRef<string>} */
const statsWeekStartsOn = computed(() => store.getters.getStatsWeekStartsOn)

/**
 * @param {string} value
 */
function updateStatsWeekStartsOn(value) {
  store.dispatch('updateStatsWeekStartsOn', value)
}
const router = useRouter()

// The 'minimize' event doesn't fire on Wayland. This shared check starts during
// app initialization, before settings can mount, and is cached for every view.
initializePlatformInfo()

/** @type {import('vue').ComputedRef<boolean>} */
const checkForUpdates = computed(() => store.getters.getCheckForUpdates)

/**
 * @param {boolean} value
 */
function updateCheckForUpdates(value) {
  store.dispatch('updateCheckForUpdates', value)
}

const CONFIRMATION_OPTIONS = [
  {
    value: 'closeApp',
    label: () => t('Settings.General Settings.Confirmation Options.Closing App'),
    enabled: () => store.getters.getConfirmCloseApp,
    action: 'updateConfirmCloseApp'
  },
  {
    value: 'closeWindow',
    label: () => t('Settings.General Settings.Confirmation Options.Closing Window'),
    enabled: () => store.getters.getConfirmCloseWindowWithMultipleTabs,
    action: 'updateConfirmCloseWindowWithMultipleTabs'
  },
  {
    value: 'closeTabs',
    label: () => t('Settings.General Settings.Confirmation Options.Closing Tabs'),
    enabled: () => store.getters.getConfirmCloseMultipleTabs,
    action: 'updateConfirmCloseMultipleTabs'
  },
  {
    value: 'loadTabs',
    label: () => t('Settings.General Settings.Confirmation Options.Loading Tabs'),
    enabled: () => store.getters.getConfirmLoadMultipleTabs,
    action: 'updateConfirmLoadMultipleTabs'
  },
  {
    value: 'unloadTabs',
    label: () => t('Settings.General Settings.Confirmation Options.Unloading Tabs'),
    enabled: () => store.getters.getConfirmUnloadMultipleTabs,
    action: 'updateConfirmUnloadMultipleTabs'
  }
]
const visibleConfirmationOptions = computed(() => IS_CAPACITOR
  ? CONFIRMATION_OPTIONS.slice(0, 1)
  : CONFIRMATION_OPTIONS)
const confirmationValues = computed(() => visibleConfirmationOptions.value.map(option => option.value))
const confirmationLabels = computed(() => visibleConfirmationOptions.value.map(option => option.label()))
const enabledConfirmations = computed({
  get: () => visibleConfirmationOptions.value.filter(option => option.enabled()).map(option => option.value),
  set: values => {
    const enabled = new Set(values)
    for (const option of visibleConfirmationOptions.value) {
      const next = enabled.has(option.value)
      if (option.enabled() !== next) {
        store.dispatch(option.action, next)
      }
    }
  }
})

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/** @type {import('vue').ComputedRef<boolean>} */
const generalAutoLoadMorePaginatedItemsEnabled = computed(() => {
  return store.getters.getGeneralAutoLoadMorePaginatedItemsEnabled
})

/**
 * @param {boolean} value
 */
function updateGeneralAutoLoadMorePaginatedItemsEnabled(value) {
  store.dispatch('updateGeneralAutoLoadMorePaginatedItemsEnabled', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const closedAppRefresh = computed(() => store.getters.getEnableClosedAppSubscriptionRefresh)
const trayEnabled = computed(() => store.getters.getUseTrayIcon || closedAppRefresh.value)
const hideToTrayOnMinimize = computed(() => store.getters.getHideToTrayOnMinimize)

/**
 * @param {boolean} value
 */
function updateHideToTrayOnMinimize(value) {
  store.dispatch('updateHideToTrayOnMinimize', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const openDeepLinksInNewWindow = computed(() => store.getters.getOpenDeepLinksInNewWindow)

/**
 * @param {boolean} value
 */
function updateOpenDeepLinksInNewWindow(value) {
  store.dispatch('updateOpenDeepLinksInNewWindow', value)
}

const updateRelativeTimestamps = computed(() => store.getters.getUpdateRelativeTimestamps)

/**
 * @param {boolean} value
 */
function updateRelativeTimestampsSetting(value) {
  store.dispatch('updateUpdateRelativeTimestamps', value)
}

/** @type {import('vue').ComputedRef<'local' | 'invidious' | 'yattee'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

const navigationItems = computed(() => store.getters.getNavigationItems)

const defaultPages = computed(() => {
  const routeByPath = new Map(router.getRoutes().map(route => [route.path.slice(1), route]))
  return filterAvailableNavigationItems(navigationItems.value, {
    supportsLocalApi: SUPPORTS_LOCAL_API,
    backendPreference: backendPreference.value,
    backendFallback: backendFallback.value,
    showWatchStats: store.getters.getRememberHistory && store.getters.getEnableWatchStats,
  })
    .map(id => routeByPath.get(id))
    .filter(route => route != null)
})

const defaultPageNames = computed(() => defaultPages.value.map((route) => translateWindowTitle(route.meta.title)))

const defaultPageValues = computed(() => {
  // avoid Vue parsing issues by excluding '/' from path values
  return defaultPages.value.map((route) => route.path.slice(1))
})

/** @type {import('vue').ComputedRef<'home' | 'subscriptions' | 'subscribedchannels' | 'popular' | 'userplaylists' | 'history' | 'trending' | 'stats'>} */
const landingPage = computed(() => store.getters.getLandingPage)

/**
 * @param {'home' | 'subscriptions' | 'subscribedChannels' | 'popular' | 'userPlaylists' | 'history' | 'trending'} value
 */
function updateLandingPage(value) {
  store.dispatch('updateLandingPage', value)
}

const NEW_TAB_POSITION_VALUES = ['end', 'afterCurrent', 'afterCurrentInOrder']

const newTabPositionNames = computed(() => [
  t('Settings.General Settings.New Tab Position.At the end'),
  t('Settings.General Settings.New Tab Position.After current tab'),
  t('Settings.General Settings.New Tab Position.After current tab in opened order')
])

/** @type {import('vue').ComputedRef<'end' | 'afterCurrent' | 'afterCurrentInOrder'>} */
const newTabPosition = computed(() => store.getters.getNewTabPosition)

/**
 * @param {'end' | 'afterCurrent' | 'afterCurrentInOrder'} value
 */
function updateNewTabPosition(value) {
  store.dispatch('updateNewTabPosition', value)
}

const TAB_CLOSE_FOCUS_VALUES = ['lastActiveTab', 'nextTab', 'previousTab']

const tabCloseFocusNames = computed(() => [
  t('Settings.General Settings.Tab Close Focus.Last active tab'),
  t('Settings.General Settings.Tab Close Focus.Next tab in tab order'),
  t('Settings.General Settings.Tab Close Focus.Previous tab in tab order')
])

/** @type {import('vue').ComputedRef<'lastActiveTab' | 'previousTab' | 'nextTab'>} */
const tabCloseFocus = computed(() => store.getters.getTabCloseFocus)

/**
 * @param {'lastActiveTab' | 'previousTab' | 'nextTab'} value
 */
function updateTabCloseFocus(value) {
  store.dispatch('updateTabCloseFocus', value)
}

const STARTUP_BEHAVIOR_VALUES = ['loadAllTabs', 'restoreTabLoadState', 'loadLastActiveTab', 'loadLandingPage', 'emptySession']

const startupBehaviorNames = computed(() => [
  t('Settings.General Settings.Startup Behavior.Load all tabs'),
  t('Settings.General Settings.Startup Behavior.Load previously loaded tabs'),
  t('Settings.General Settings.Startup Behavior.Load last active tab'),
  t('Settings.General Settings.Startup Behavior.Load landing page, keep other tabs unloaded'),
  t('Settings.General Settings.Startup Behavior.Start with an empty session')
])

/** @type {import('vue').ComputedRef<'loadAllTabs' | 'restoreTabLoadState' | 'loadLastActiveTab' | 'loadLandingPage' | 'emptySession'>} */
const startupBehavior = computed(() => store.getters.getStartupBehavior)

/**
 * @param {'loadAllTabs' | 'restoreTabLoadState' | 'loadLastActiveTab' | 'loadLandingPage' | 'emptySession'} value
 */
function updateStartupBehavior(value) {
  store.dispatch('updateStartupBehavior', value)
}

const enableDownloads = computed(() => store.getters.getEnableDownloads)

/** @type {import('vue').ComputedRef<'' | 'history' | 'markAsFullySeen' | 'copyYoutube' | 'openYoutube' | 'download'>} */
const extraThumbnailAction = computed(() => store.getters.getExtraThumbnailAction)

const effectiveExtraThumbnailAction = computed(() => (
  !enableDownloads.value && extraThumbnailAction.value === 'download'
    ? ''
    : extraThumbnailAction.value
))

const extraThumbnailActionValues = computed(() => [
  '',
  'history',
  'markAsFullySeen',
  'copyYoutube',
  'openYoutube',
  ...(supportsYtDlp && enableDownloads.value ? ['download'] : [])
])

const extraThumbnailActionNames = computed(() => [
  t('Settings.General Settings.Extra Thumbnail Action Button.None'),
  t('Settings.General Settings.Extra Thumbnail Action Button.Mark as Watched'),
  t('Video.Mark As Fully Watched'),
  t('Settings.General Settings.Extra Thumbnail Action Button.Copy YouTube Link'),
  t('Settings.General Settings.Extra Thumbnail Action Button.Open in YouTube'),
  ...(supportsYtDlp && enableDownloads.value ? [t('Downloads.Download Video')] : [])
])

/**
 * @param {'' | 'history' | 'markAsFullySeen' | 'copyYoutube' | 'openYoutube' | 'download'} value
 */
function updateExtraThumbnailAction(value) {
  store.dispatch('updateExtraThumbnailAction', value)
}

const thumbnailSwipeActions = computed(() => [
  ['disabled', t('Settings.Player Settings.Swipe Gestures.Disabled')],
  ['addToPlaylist', t('User Playlists.Add to Playlist')],
  ['history', t('Video.Mark As Watched')],
  ['markAsFullySeen', t('Video.Mark As Fully Watched')],
  ['quickBookmark', t('Tab Organizer.Icon Labels.Bookmark')],
  ['addToQueue', t('Video.Add to Queue')],
  ['playNext', t('Video.Play Next')],
  ['copyYoutube', t('Video.Copy YouTube Link')],
  ...(IS_CAPACITOR ? [['share', t('Share.Share Link')]] : []),
  ...(supportsYtDlp && enableDownloads.value ? [['download', t('Downloads.Download Video')]] : []),
])
function getThumbnailSwipeIcon(action) {
  return {
    addToPlaylist: ['fac', 'playlist-add'],
    history: ['fas', 'eye'],
    markAsFullySeen: ['fas', 'flag-checkered'],
    quickBookmark: ['fas', 'bookmark'],
    addToQueue: ['fas', 'add-to-queue'],
    playNext: ['fas', 'play-next'],
    copyYoutube: ['fas', 'link'],
    share: ['fas', 'share-alt'],
    download: ['fas', 'download'],
  }[getThumbnailSwipeValue(action)] ?? ['fas', 'xmark']
}

const thumbnailSwipeActionValues = computed(() => thumbnailSwipeActions.value.map(([value]) => value))
const thumbnailSwipeActionNames = computed(() => thumbnailSwipeActions.value.map(([, name]) => name))

function getThumbnailSwipeValue(action) {
  return thumbnailSwipeActionValues.value.includes(action) ? action : 'disabled'
}

const LOCALE_VALUES = ['system', ...allLocales]

const localeNames = computed(() => [
  t('Settings.General Settings.System Default'),
  ...process.env.LOCALE_NAMES.map((name, index) => `${name} (${localeTranslationPercentages.value[index]}%)`)
])

/** @type {import('vue').ComputedRef<string>} */
const currentLocale = computed(() => store.getters.getCurrentLocale)

/** @type {import('vue').ComputedRef<boolean>} */
const useAITranslationCompletions = computed(() => store.getters.getUseAITranslationCompletions)

const aiTranslationCompletionsDisabled = computed(() => {
  const selectedLocale = currentLocale.value === 'system' ? locale.value : currentLocale.value
  const localeIndex = allLocales.indexOf(selectedLocale)
  return localeTranslationPercentages.value[localeIndex] === 100
})

/**
 * @param {string} value
 */
function updateCurrentLocale(value) {
  store.dispatch('updateCurrentLocale', value)
}

/** @type {import('vue').ComputedRef<string>} */
const dateFormat = computed(() => normalizeDateFormat(store.getters.getDateFormat))

const dateFormatNames = computed(() => [
  `${t('Settings.General Settings.Language Default')} (${formatDate(new Date(), locale.value, 'locale')})`,
  ...DATE_FORMAT_OPTIONS.slice(1),
])

/** @param {string} value */
function updateDateFormat(value) {
  store.dispatch('updateDateFormat', value)
}

/** @type {import('vue').ComputedRef<string>} */
const timeFormat = computed(() => normalizeTimeFormat(store.getters.getTimeFormat))

const timeFormatNames = computed(() => {
  const example = new Date()
  const options = { hour: 'numeric', minute: '2-digit' }

  return [
    `${t('Settings.General Settings.Language Default')} (${formatTime(example, locale.value, 'locale', options)})`,
    `12h (${formatTime(example, locale.value, '12-hour', options)})`,
    `24h (${formatTime(example, locale.value, '24-hour', options)})`,
  ]
})

/** @param {string} value */
function updateTimeFormat(value) {
  store.dispatch('updateTimeFormat', value)
}

/** @param {boolean} value */
function updateUseAITranslationCompletions(value) {
  store.dispatch('updateUseAITranslationCompletions', value)
}

const REDUCED_MOTION_VALUES = ['system', 'on', 'off']

const reducedMotionNames = computed(() => [
  t('Settings.General Settings.Reduced Motion.System'),
  t('Settings.General Settings.Reduced Motion.Force On'),
  t('Settings.General Settings.Reduced Motion.Force Off')
])

/** @type {import('vue').ComputedRef<'system' | 'on' | 'off'>} */
const reducedMotion = computed(() => store.getters.getReducedMotion)

/**
 * @param {'system' | 'on' | 'off'} value
 */
function updateReducedMotion(value) {
  store.dispatch('updateReducedMotion', value)
}

/** @type {import('vue').ComputedRef<'disabled' | 'watch_only' | 'entire_app'>} */
const avoidTranslation = computed(() => store.getters.getAvoidTranslation)

/**
 * @param {'disabled' | 'watch_only' | 'entire_app'} value
 */
function updateAvoidTranslation(value) {
  store.dispatch('updateAvoidTranslation', value)
}

const AVOID_TRANSLATION_VALUES = ['disabled', 'watch_only', 'entire_app']

const avoidTranslationNames = computed(() => [
  t('Settings.General Settings.Avoid translation.Disabled'),
  t('Settings.General Settings.Avoid translation.Watch Only'),
  t('Settings.General Settings.Avoid translation.Entire App')
])

/** @type {import('vue').ComputedRef<string[]>} */
const regionNames = computed(() => store.getters.getRegionNames)

/** @type {import('vue').ComputedRef<string[]>} */
const regionValues = computed(() => store.getters.getRegionValues)

const regionDataLoaded = computed(() => regionValues.value.length > 0)

/** @type {import('vue').ComputedRef<string>} */
const region = computed(() => store.getters.getRegion)

/**
 * @param {string} value
 */
function updateRegion(value) {
  store.dispatch('updateRegion', value)
}
</script>

<style scoped src="../generalSelectGrid.css" />
<style scoped src="./GeneralSettings.css" />
