<template>
  <FtSettingsSection
    :title="t('Settings.General Settings.Sections.Startup and Tabs')"
    :icon="['fas', 'clone']"
  >
    <div class="settingsRows">
      <FtSettingsRow
        v-if="IS_CAPACITOR"
        :description="t('Tooltips.General Settings.Enable Tabs')"
        :title="t('Settings.General Settings.Enable Tabs')"
        :icon="['fas', 'horizontal-tabs']"
      >
        <FtToggleSwitch
          :label="t('Settings.General Settings.Enable Tabs')"
          hide-label
          :default-value="store.getters.getEnableMobileTabs"
          setting-key="enableMobileTabs"
          @change="store.dispatch('updateEnableMobileTabs', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.General Settings.Default Landing Page')"
        :icon="['fas', 'location-dot']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.General Settings.Default Landing Page')"
          :value="landingPage"
          setting-key="landingPage"
          :select-names="defaultPageNames"
          :select-values="defaultPageValues"
          :option-icons="defaultPageIcons"
          @change="updateLandingPage"
        />
      </FtSettingsRow>
      <template v-if="USING_ELECTRON || IS_CAPACITOR">
        <FtSettingsRow
          :tooltip="t('Tooltips.General Settings.Startup Behavior')"
          :title="t('Settings.General Settings.Startup Behavior.Startup Behavior')"
          :icon="['fas', 'power-off']"
        >
          <FtSelect
            hide-label
            :placeholder="t('Settings.General Settings.Startup Behavior.Startup Behavior')"
            :value="startupBehavior"
            setting-key="startupBehavior"
            :select-names="startupBehaviorNames"
            :select-values="STARTUP_BEHAVIOR_VALUES"
            @change="updateStartupBehavior"
          />
        </FtSettingsRow>
        <FtSettingsRow
          :title="t('Settings.General Settings.New Tab Position.New Tab Position')"
          :icon="['fas', 'plus']"
        >
          <FtSelect
            hide-label
            :placeholder="t('Settings.General Settings.New Tab Position.New Tab Position')"
            :value="newTabPosition"
            setting-key="newTabPosition"
            :disabled="!store.getters.getTabsEnabled"
            :select-names="newTabPositionNames"
            :select-values="NEW_TAB_POSITION_VALUES"
            @change="updateNewTabPosition"
          />
        </FtSettingsRow>
        <FtSettingsRow
          :title="t('Settings.General Settings.Tab Close Focus.Tab Close Focus')"
          :icon="['fas', 'xmark']"
        >
          <FtSelect
            hide-label
            :placeholder="t('Settings.General Settings.Tab Close Focus.Tab Close Focus')"
            :value="tabCloseFocus"
            setting-key="tabCloseFocus"
            :disabled="!store.getters.getTabsEnabled"
            :select-names="tabCloseFocusNames"
            :select-values="TAB_CLOSE_FOCUS_VALUES"
            @change="updateTabCloseFocus"
          />
        </FtSettingsRow>
      </template>
      <template v-if="USING_ELECTRON">
        <FtSettingsRow
          :description="t('Tooltips.General Settings.Open Deep Links In New Window')"
          :title="t('Settings.General Settings.Open Deep Links In New Window')"
          :icon="['fas', 'up-right-from-square']"
        >
          <FtToggleSwitch
            :label="t('Settings.General Settings.Open Deep Links In New Window')"
            hide-label
            :default-value="openDeepLinksInNewWindow"
            setting-key="openDeepLinksInNewWindow"
            @change="updateOpenDeepLinksInNewWindow"
          />
        </FtSettingsRow>
        <FtSettingsRow
          :description="t('Tooltips.General Settings.Close Window With Last Tab')"
          :title="t('Settings.General Settings.Close Window With Last Tab')"
          :icon="['fas', 'rectangle-xmark']"
        >
          <FtToggleSwitch
            :label="t('Settings.General Settings.Close Window With Last Tab')"
            hide-label
            :default-value="store.getters.getCloseWindowWithLastTab"
            setting-key="closeWindowWithLastTab"
            @change="store.dispatch('updateCloseWindowWithLastTab', $event)"
          />
        </FtSettingsRow>
      </template>
    </div>
  </FtSettingsSection>
  <FtSettingsSection
    :title="t('Settings.General Settings.Sections.Language and Region')"
    :icon="['fas', 'language']"
  >
    <div class="settingsRows">
      <FtSettingsRow
        :title="t('Settings.General Settings.Locale Preference')"
        :icon="['fas', 'language']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.General Settings.Locale Preference')"
          :value="currentLocale"
          setting-key="currentLocale"
          :select-names="localeNames"
          :select-values="LOCALE_VALUES"
          :is-locale-selector="true"
          @change="updateCurrentLocale"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Tooltips.General Settings.Use AI Translation Completions')"
        :title="t('Settings.General Settings.Use AI Translation Completions')"
        :icon="['fas', 'robot']"
      >
        <FtToggleSwitch
          :label="t('Settings.General Settings.Use AI Translation Completions')"
          hide-label
          :default-value="useAITranslationCompletions"
          setting-key="useAITranslationCompletions"
          :disabled="aiTranslationCompletionsDisabled"
          @change="updateUseAITranslationCompletions"
        />
      </FtSettingsRow>
      <FtSettingsRow
        v-if="SUPPORTS_LOCAL_API && (backendPreference === 'local' || backendFallback)"
        :tooltip="t('Tooltips.General Settings.Avoid translation')"
        :title="t('Settings.General Settings.Avoid translation.Avoid translation')"
        :icon="['fas', 'font']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.General Settings.Avoid translation.Avoid translation')"
          :value="avoidTranslation"
          setting-key="avoidTranslation"
          :select-names="avoidTranslationNames"
          :select-values="AVOID_TRANSLATION_VALUES"
          @change="updateAvoidTranslation"
        />
      </FtSettingsRow>
      <FtSettingsRow
        v-if="regionDataLoaded"
        :description="t('Tooltips.General Settings.Region for Trending')"
        :title="t('Settings.General Settings.Region for Trending')"
        :icon="['fas', 'globe']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.General Settings.Region for Trending')"
          :value="region"
          setting-key="region"
          :select-names="regionNames"
          :select-values="regionValues"
          @change="updateRegion"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.General Settings.Date Format')"
        :icon="['fas', 'calendar-days']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.General Settings.Date Format')"
          :value="dateFormat"
          setting-key="dateFormat"
          :select-names="dateFormatNames"
          :select-values="DATE_FORMAT_OPTIONS"
          @change="updateDateFormat"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.General Settings.Time Format')"
        :icon="['fas', 'clock']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.General Settings.Time Format')"
          :value="timeFormat"
          setting-key="timeFormat"
          :select-names="timeFormatNames"
          :select-values="TIME_FORMAT_OPTIONS"
          @change="updateTimeFormat"
        />
      </FtSettingsRow>
    </div>
  </FtSettingsSection>
  <FtSettingsSection
    v-if="USING_ELECTRON || IS_CAPACITOR || !IS_SELF_HOSTED"
    :title="t('Settings.General Settings.Sections.System')"
    :icon="['fas', 'display']"
  >
    <div class="settingsRows">
      <FtSettingsRow
        v-if="USING_ELECTRON || IS_CAPACITOR"
        :tooltip="t('Tooltips.General Settings.Notifications')"
        :title="t('Settings.General Settings.Notifications.Notifications')"
        :icon="['fas', 'bell']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.General Settings.Notifications.Notifications')"
          :value="store.getters.getNotificationMode"
          setting-key="notificationMode"
          :select-names="notificationModeNames"
          :select-values="NOTIFICATION_MODE_VALUES"
          @change="store.dispatch('updateNotificationMode', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        v-if="USING_ELECTRON"
        :title="t('Settings.General Settings.System Tray.System Tray')"
        :description="closedAppRefresh ? t('Settings.General Settings.Tray required for background refresh') : ''"
        :icon="['fas', 'display']"
      >
        <FtSelect
          hide-label
          multiple
          :placeholder="t('Settings.General Settings.System Tray.System Tray')"
          :empty-label="t('Global.Off')"
          :value="systemTray"
          setting-key="useTrayIcon"
          :sync-setting-keys="TRAY_SETTING_KEYS"
          :is-changed="systemTrayChanged"
          :select-names="systemTrayOptions.map(({ name }) => name)"
          :select-values="systemTrayOptions.map(({ value }) => value)"
          :disabled-values="closedAppRefresh ? ['icon'] : []"
          @change="updateSystemTray"
          @reset="resetSystemTray"
        />
      </FtSettingsRow>
      <!-- Self-hosted servers are updated by their admin -->
      <FtSettingsRow
        v-if="!IS_SELF_HOSTED"
        :title="t('Settings.General Settings.Check for Updates')"
        :icon="['fas', 'arrows-rotate']"
      >
        <FtToggleSwitch
          :label="t('Settings.General Settings.Check for Updates')"
          hide-label
          :default-value="checkForUpdates"
          setting-key="checkForUpdates"
          @change="updateCheckForUpdates"
        />
      </FtSettingsRow>
      <template v-if="IS_CAPACITOR">
        <FtSettingsRow
          :title="t('Settings.General Settings.Haptic Feedback')"
          :icon="['fas', 'smartphone']"
        >
          <FtToggleSwitch
            :label="t('Settings.General Settings.Haptic Feedback')"
            hide-label
            :default-value="store.getters.getHapticFeedback"
            setting-key="hapticFeedback"
            @change="store.dispatch('updateHapticFeedback', $event)"
          />
        </FtSettingsRow>
        <FtSettingsRow
          v-if="!IS_IOS"
          :description="t('Tooltips.General Settings.Ignore System Haptics Setting')"
          :title="t('Settings.General Settings.Ignore System Haptics Setting')"
          :icon="['fas', 'smartphone']"
        >
          <FtToggleSwitch
            :label="t('Settings.General Settings.Ignore System Haptics Setting')"
            hide-label
            :disabled="!store.getters.getHapticFeedback"
            :default-value="store.getters.getHapticFeedbackIgnoresSystemSetting"
            setting-key="hapticFeedbackIgnoresSystemSetting"
            @change="store.dispatch('updateHapticFeedbackIgnoresSystemSetting', $event)"
          />
        </FtSettingsRow>
        <FtSettingsRow
          v-if="!IS_IOS"
          :title="t('Settings.General Settings.Swipe to refresh')"
          :icon="['fas', 'arrows-rotate']"
        >
          <FtToggleSwitch
            :label="t('Settings.General Settings.Swipe to refresh')"
            hide-label
            :default-value="enablePullToRefresh"
            setting-key="enablePullToRefresh"
            @change="store.dispatch('updateEnablePullToRefresh', $event)"
          />
        </FtSettingsRow>
      </template>
    </div>
  </FtSettingsSection>
  <FtSettingsSection
    :title="t('Settings.General Settings.Sections.Browsing')"
    :icon="['fas', 'list']"
  >
    <div class="settingsRows">
      <FtSettingsRow
        :description="t('Settings.General Settings.Auto Load Next Page.Lists Tooltip')"
        :title="t('Settings.General Settings.Auto Load Next Page.Label')"
        :icon="['fas', 'arrow-down']"
      >
        <FtToggleSwitch
          :label="t('Settings.General Settings.Auto Load Next Page.Label')"
          hide-label
          :default-value="generalAutoLoadMorePaginatedItemsEnabled"
          setting-key="generalAutoLoadMorePaginatedItemsEnabled"
          @change="updateGeneralAutoLoadMorePaginatedItemsEnabled"
        />
      </FtSettingsRow>
      <FtSettingsRow
        v-if="!IS_CAPACITOR && !phoneLayout"
        :title="t('Settings.General Settings.Extra Thumbnail Action Button.Extra Thumbnail Action Button')"
        :icon="['fas', 'ellipsis-vertical']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.General Settings.Extra Thumbnail Action Button.Extra Thumbnail Action Button')"
          :value="effectiveExtraThumbnailAction"
          setting-key="extraThumbnailAction"
          :select-names="extraThumbnailActionNames"
          :select-values="extraThumbnailActionValues"
          @change="updateExtraThumbnailAction"
        />
      </FtSettingsRow>
      <template v-else>
        <FtSettingsRow
          v-for="side in thumbnailSwipeSides"
          :key="side.settingKey"
          :description="t('Settings.General Settings.Thumbnail Swipe Gestures.Description')"
          :title="side.label"
          :icon="getThumbnailSwipeIcon(store.getters[side.getter])"
        >
          <FtSelect
            hide-label
            :placeholder="side.label"
            :value="getThumbnailSwipeValue(store.getters[side.getter])"
            :setting-key="side.settingKey"
            :select-names="thumbnailSwipeActionNames"
            :select-values="thumbnailSwipeActionValues"
            @change="store.dispatch(side.updater, $event)"
          />
        </FtSettingsRow>
      </template>
    </div>
    <FtFlexBox class="confirmations">
      <FtCheckboxList
        v-model="enabledConfirmations"
        class="checkboxColumns"
        :title="t('Settings.General Settings.Confirm Before')"
        :labels="confirmationLabels"
        :values="confirmationValues"
        :sync-setting-keys="confirmationSettingKeys"
        :is-changed="confirmationsChanged"
        @reset="resetConfirmations"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { supportsYtDlp } from '../../../helpers/ytDlpCapabilities'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtCheckboxList from '../../FtCheckboxList/FtCheckboxList.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'

import store from '../../../store/index'
import { DEFAULT_SETTINGS, defaultUpdaterId } from '../../../store/modules/settings'
import { localeTranslationPercentages } from '../../../i18n/index'

import allLocales from '../../../../../static/locales/activeLocales.json'
import { initializePlatformInfo, supportsAutoPictureInPictureMinimize } from '../../../helpers/platform'
import { usePhoneLayout } from '../../../composables/usePhoneLayout'
import { useLandingPageOptions } from '../../../composables/useLandingPageOptions'
import {
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  formatDate,
  formatTime,
  normalizeDateFormat,
  normalizeTimeFormat,
} from '../../../helpers/dateFormat'

const USING_ELECTRON = !!process.env.IS_ELECTRON
const IS_SELF_HOSTED = !!process.env.IS_SELF_HOSTED
const IS_IOS = !!process.env.IS_IOS
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const phoneLayout = usePhoneLayout()
const enablePullToRefresh = computed(() => store.getters.getEnablePullToRefresh)
const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API

const { locale, t } = useI18n()

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
    visible: USING_ELECTRON || IS_CAPACITOR,
    label: () => t('Settings.General Settings.Confirmation Options.Closing App'),
    settingKey: 'confirmCloseApp'
  },
  {
    value: 'closeWindow',
    visible: USING_ELECTRON,
    label: () => t('Settings.General Settings.Confirmation Options.Closing Window'),
    settingKey: 'confirmCloseWindowWithMultipleTabs'
  },
  {
    value: 'closeTabs',
    visible: USING_ELECTRON || IS_CAPACITOR,
    label: () => t('Settings.General Settings.Confirmation Options.Closing Tabs'),
    settingKey: 'confirmCloseMultipleTabs'
  },
  {
    value: 'loadTabs',
    visible: USING_ELECTRON || IS_CAPACITOR,
    label: () => t('Settings.General Settings.Confirmation Options.Loading Tabs'),
    settingKey: 'confirmLoadMultipleTabs'
  },
  {
    value: 'unloadTabs',
    visible: USING_ELECTRON || IS_CAPACITOR,
    label: () => t('Settings.General Settings.Confirmation Options.Unloading Tabs'),
    settingKey: 'confirmUnloadMultipleTabs'
  },
  {
    value: 'refreshAllFeeds',
    visible: true,
    label: () => t('Settings.General Settings.Confirmation Options.Refreshing All Feeds'),
    settingKey: 'confirmRefreshAllFeeds'
  }
]
const VISIBLE_CONFIRMATION_OPTIONS = CONFIRMATION_OPTIONS.filter(option => option.visible)
const confirmationValues = VISIBLE_CONFIRMATION_OPTIONS.map(option => option.value)
const confirmationSettingKeys = VISIBLE_CONFIRMATION_OPTIONS.map(option => option.settingKey)
const confirmationLabels = computed(() => VISIBLE_CONFIRMATION_OPTIONS.map(option => option.label()))
const enabledConfirmations = computed({
  get: () => VISIBLE_CONFIRMATION_OPTIONS.filter(option => store.state.settings[option.settingKey]).map(option => option.value),
  set: values => {
    const enabled = new Set(values)
    for (const option of VISIBLE_CONFIRMATION_OPTIONS) {
      const next = enabled.has(option.value)
      if (store.state.settings[option.settingKey] !== next) {
        store.dispatch(defaultUpdaterId(option.settingKey), next)
      }
    }
  }
})
const confirmationsChanged = computed(() => confirmationSettingKeys.some(key => store.state.settings[key] !== DEFAULT_SETTINGS[key]))
function resetConfirmations() {
  for (const key of confirmationSettingKeys) {
    if (store.state.settings[key] !== DEFAULT_SETTINGS[key]) store.dispatch('resetSettingToDefault', key)
  }
}

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

const TRAY_SETTING_KEYS = ['useTrayIcon', 'hideToTrayOnClose', 'hideToTrayOnMinimize']

// The 'minimize' event doesn't fire on Wayland.
const systemTrayOptions = computed(() => [
  { value: 'icon', name: t('Settings.General Settings.System Tray.Show Icon') },
  { value: 'close', name: t('Settings.General Settings.System Tray.Close to Tray') },
  ...(supportsAutoPictureInPictureMinimize.value
    ? [{ value: 'minimize', name: t('Settings.General Settings.System Tray.Minimize to Tray') }]
    : []),
])

// Windows only hide to the tray while its icon is shown.
const systemTray = computed(() => trayEnabled.value
  ? [
      'icon',
      ...(store.getters.getHideToTrayOnClose ? ['close'] : []),
      ...(store.getters.getHideToTrayOnMinimize && supportsAutoPictureInPictureMinimize.value ? ['minimize'] : []),
    ]
  : [])

/**
 * Hiding windows to the tray turns its icon on, and turning the icon off stops
 * hiding them. Background subscription refresh keeps the icon on, so the menu
 * disables that option then.
 * @param {string[]} values
 */
function updateSystemTray(values) {
  const iconRemoved = trayEnabled.value && !values.includes('icon')

  const settings = {
    useTrayIcon: !iconRemoved && values.length > 0,
    hideToTrayOnClose: !iconRemoved && values.includes('close'),
    // Keeps the stored value where this option isn't offered.
    ...(supportsAutoPictureInPictureMinimize.value && { hideToTrayOnMinimize: !iconRemoved && values.includes('minimize') }),
  }
  for (const [key, value] of Object.entries(settings)) {
    if (store.state.settings[key] !== value) store.dispatch(defaultUpdaterId(key), value)
  }
}

const systemTrayChanged = computed(() => TRAY_SETTING_KEYS.some(key => store.state.settings[key] !== DEFAULT_SETTINGS[key]))
function resetSystemTray() {
  for (const key of TRAY_SETTING_KEYS) {
    if (store.state.settings[key] !== DEFAULT_SETTINGS[key]) store.dispatch('resetSettingToDefault', key)
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const openDeepLinksInNewWindow = computed(() => store.getters.getOpenDeepLinksInNewWindow)

/**
 * @param {boolean} value
 */
function updateOpenDeepLinksInNewWindow(value) {
  store.dispatch('updateOpenDeepLinksInNewWindow', value)
}

/** @type {import('vue').ComputedRef<'local' | 'invidious' | 'yattee'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

const { landingPageNames: defaultPageNames, landingPageValues: defaultPageValues, landingPageIcons: defaultPageIcons } = useLandingPageOptions()

/** @type {import('vue').ComputedRef<'home' | 'subscriptions' | 'subscribedchannels' | 'popular' | 'userplaylists' | 'history' | 'trending' | 'stats'>} */
const landingPage = computed(() => store.getters.getLandingPage)

/**
 * @param {'home' | 'subscriptions' | 'subscribedChannels' | 'popular' | 'userPlaylists' | 'history' | 'trending'} value
 */
function updateLandingPage(value) {
  store.dispatch('updateLandingPage', value)
}

const thumbnailSwipeSides = computed(() => [{
  label: t('Settings.General Settings.Thumbnail Swipe Gestures.Left'),
  settingKey: 'thumbnailLeftSwipeAction',
  getter: 'getThumbnailLeftSwipeAction',
  updater: 'updateThumbnailLeftSwipeAction'
}, {
  label: t('Settings.General Settings.Thumbnail Swipe Gestures.Right'),
  settingKey: 'thumbnailRightSwipeAction',
  getter: 'getThumbnailRightSwipeAction',
  updater: 'updateThumbnailRightSwipeAction'
}])

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

/** @type {import('vue').ComputedRef<'' | 'history' | 'markAsFullySeen' | 'markAsSeen' | 'playNext' | 'addToQueue' | 'openBackgroundTab' | 'copyYoutube' | 'openYoutube' | 'download'>} */
const extraThumbnailAction = computed(() => store.getters.getExtraThumbnailAction)

const effectiveExtraThumbnailAction = computed(() => (
  extraThumbnailActionValues.value.includes(extraThumbnailAction.value)
    ? extraThumbnailAction.value
    : ''
))

const extraThumbnailActionValues = computed(() => [
  '',
  'history',
  'markAsFullySeen',
  'markAsSeen',
  'playNext',
  'addToQueue',
  ...(USING_ELECTRON && store.getters.getTabsEnabled ? ['openBackgroundTab'] : []),
  'copyYoutube',
  'openYoutube',
  ...(supportsYtDlp && enableDownloads.value ? ['download'] : [])
])

const extraThumbnailActionNames = computed(() => [
  t('Settings.General Settings.Extra Thumbnail Action Button.None'),
  t('Settings.General Settings.Extra Thumbnail Action Button.Mark as Watched'),
  t('Video.Mark As Fully Watched'),
  t('Subscriptions.Mark As Seen'),
  t('Video.Play Next'),
  t('Video.Add to Queue'),
  ...(USING_ELECTRON && store.getters.getTabsEnabled ? [t('Context Menu.Open in a Background Tab')] : []),
  t('Settings.General Settings.Extra Thumbnail Action Button.Copy YouTube Link'),
  t('Settings.General Settings.Extra Thumbnail Action Button.Open in YouTube'),
  ...(supportsYtDlp && enableDownloads.value ? [t('Downloads.Download Video')] : [])
])

/**
 * @param {'' | 'history' | 'markAsFullySeen' | 'markAsSeen' | 'playNext' | 'addToQueue' | 'openBackgroundTab' | 'copyYoutube' | 'openYoutube' | 'download'} value
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
    quickBookmark: ['far', 'bookmark'],
    addToQueue: ['fas', 'add-to-queue'],
    playNext: ['fas', 'play-next'],
    copyYoutube: ['fas', 'link'],
    share: ['fas', 'share-nodes'],
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

const NOTIFICATION_MODE_VALUES = ['both', 'system', 'off']

const notificationModeNames = computed(() => [
  t('Settings.General Settings.Notifications.System and In-App'),
  t('Settings.General Settings.Notifications.System Only'),
  t('Settings.General Settings.Notifications.Off')
])

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

<style scoped src="./GeneralSettings.css" />
