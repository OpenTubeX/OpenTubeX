<template>
  <FtSettingsSection
    :title="t('Settings.Channel Settings.Channel Settings')"
  >
    <p class="sectionDescription">
      {{ t('Settings.Channel Settings.Channel Settings Description') }}
    </p>
    <div class="enableChannelSettingsToggle">
      <FtToggleSwitch
        :label="t('Settings.Channel Settings.Enable Channel Playback Settings')"
        :compact="true"
        :default-value="settings.enableChannelSettings"
        setting-key="enableChannelSettings"
        @change="value => updateSetting('enableChannelSettings', value)"
      />
    </div>
    <div
      v-if="settings.enableChannelSettings"
      class="preferenceToggles"
    >
      <FtToggleSwitch
        v-for="preference in PREFERENCES"
        :key="preference.type"
        :label="autoUpdateLabels[preference.type]"
        :compact="true"
        :default-value="settings[preference.autoUpdateKey]"
        :setting-key="preference.autoUpdateKey"
        @change="value => updateSetting(preference.autoUpdateKey, value)"
      />
    </div>
    <FtFlexBox>
      <div class="manageButton">
        <FtButton
          :label="manageButtonLabel"
          :icon="['fas', 'sliders-h']"
          @click="showManager = true"
        />
        <FtSyncedSettingIndicator
          :setting-keys="channelPreferenceSettingKeys"
          :enable-label="savedChannelSyncEnableLabel"
          :disable-label="savedChannelSyncDisableLabel"
        />
      </div>
    </FtFlexBox>
    <FtSettingsSubpage
      :open="showManager"
      :title="t('Settings.Channel Settings.Saved Channels')"
      :icon="['fas', 'users']"
      @close="showManager = false"
    >
      <template #breadcrumb-action>
        <FtSyncedSettingIndicator
          :setting-keys="channelPreferenceSettingKeys"
          :enable-label="savedChannelSyncEnableLabel"
          :disable-label="savedChannelSyncDisableLabel"
        />
      </template>
      <div
        v-if="showChannelSearch || availableSubscriptions.length > 0"
        class="channelManagerToolbar"
      >
        <FtInput
          v-if="showChannelSearch"
          class="channelSearch"
          input-type="search"
          :label="t('Settings.Channel Settings.Search Channels')"
          :icon="['fas', 'search']"
          :placeholder="t('Form Inputs.Search Text Hint')"
          :show-action-button="false"
          :value="searchQuery"
          @input="value => searchQuery = value"
        />
        <FtButton
          v-if="availableSubscriptions.length > 0"
          class="addSubscribedChannelButton"
          :label="t('Settings.Channel Settings.Add Subscribed Channel')"
          :icon="['fas', 'plus']"
          @click="showAddChannelPrompt = true"
        />
      </div>
      <div
        ref="channelListContainer"
        v-overlay-scrollbars
        class="channelListContainer"
      >
        <div
          ref="channelListContent"
          class="channelListContent"
        >
          <p
            v-if="visibleChannelEntries.length === 0"
            class="emptyState"
          >
            {{ channelEntries.length === 0
              ? t('Settings.Channel Settings.No Saved Channels')
              : t('Settings.Channel Settings.No Matching Channels') }}
          </p>
          <ul
            v-else
            class="channelList"
          >
            <li
              v-for="channel in displayedChannelEntries"
              :key="channel.id"
              :data-channel-id="channel.id"
              class="channelEntry"
            >
              <div class="channelHeader">
                <component
                  :is="channel.route ? 'router-link' : 'span'"
                  class="channelLink"
                  :tabindex="channel.route ? null : -1"
                  :role="channel.route ? null : 'group'"
                  :aria-label="channel.name"
                  :to="channel.route ?? undefined"
                >
                  <FtRetryImage
                    v-if="channel.thumbnail"
                    :fallback-icon="['fas', 'circle-user']"
                    class="channelThumbnail"
                    :src="channel.thumbnail"
                    alt=""
                  />
                  <span
                    v-else
                    class="channelThumbnail channelThumbnailPlaceholder"
                  >
                    <FtIcon :icon="['fas', 'circle-user']" />
                  </span>
                  <p
                    class="channelName"
                    dir="auto"
                  >
                    {{ channel.name }}
                    <span
                      v-if="channel.handle"
                      class="channelHandle"
                      dir="auto"
                    >{{ channel.handle }}</span>
                    <span
                      v-if="channel.platform"
                      class="channelHandle"
                    ><FtIcon
                      class="channelPlatformIcon"
                      :icon="channel.platform.icon"
                      aria-hidden="true"
                    />{{ channel.platform.name }}</span>
                  </p>
                </component>
                <FtIconButton
                  v-if="channel.addableOptions.length > 0"
                  :title="t('Settings.Channel Settings.Add Setting')"
                  :icon="['fas', 'plus']"
                  :dropdown-options="channel.addableOptions"
                  dropdown-position-x="left"
                  :dropdown-portal="true"
                  @click="type => addPreference(channel.id, type)"
                />
                <FtIconButton
                  :title="t('Settings.Channel Settings.Forget Channel')"
                  :icon="['fas', 'trash']"
                  theme="destructive"
                  @click="forgetChannel(channel.id)"
                />
              </div>
              <div class="channelPreferences">
                <div
                  v-for="preference in channel.preferences"
                  :key="preference.type"
                  class="channelPreference"
                >
                  <FtIcon
                    class="preferenceIcon"
                    :icon="preference.icon"
                    :title="preference.label"
                  />
                  <FtSlider
                    v-if="preference.type === 'playbackSpeed'"
                    :label="t('Settings.Player Settings.Playback Speed')"
                    :default-value="preference.value"
                    :min-value="videoPlaybackRateInterval"
                    :max-value="maxVideoPlaybackRate"
                    :step="videoPlaybackRateInterval"
                    value-extension="x"
                    @change="value => setPreference(channel.id, preference.type, value)"
                  />
                  <FtSelect
                    v-else-if="preference.type === 'videoQuality'"
                    :placeholder="t('Settings.Channel Settings.Video Quality')"
                    :value="preference.value"
                    :select-names="channel.autoQuality ? qualityNamesWithAuto : qualityNames"
                    :select-values="channel.autoQuality ? QUALITY_VALUES_WITH_AUTO : RESOLUTION_VALUES"
                    :icon="preference.icon"
                    :show-icon="false"
                    @change="value => setPreference(channel.id, preference.type, value)"
                  />
                  <FtToggleSwitch
                    v-else-if="preference.type === 'subtitlesState'"
                    :label="t('Settings.Channel Settings.Subtitles Enabled')"
                    :compact="true"
                    :default-value="preference.value"
                    @change="value => setPreference(channel.id, preference.type, value)"
                  />
                  <FtSlider
                    v-else
                    :label="t('Settings.Channel Settings.Volume')"
                    :default-value="Math.round(preference.value * 100)"
                    :min-value="0"
                    :max-value="100"
                    :step="1"
                    value-extension="%"
                    @change="value => setPreference(channel.id, preference.type, value / 100)"
                  />
                  <FtIconButton
                    :title="t('Settings.Channel Settings.Forget Value')"
                    :icon="['fas', 'xmark']"
                    @click="deletePreference(channel.id, preference.type)"
                  />
                </div>
              </div>
            </li>
          </ul>
          <FtAutoLoadNextPageWrapper
            v-if="hasMoreChannels"
            :key="channelPage"
            @load-next-page="channelPage++"
          >
            <FtFlexBox>
              <FtButton
                :label="t('Channels.Load More Channels')"
                :icon="['fas', 'arrow-down']"
                background-color="var(--primary-color)"
                text-color="var(--text-with-main-color)"
                @click="loadMoreChannels"
              />
            </FtFlexBox>
          </FtAutoLoadNextPageWrapper>
        </div>
      </div>
      <FtPrompt
        v-if="showAddChannelPrompt"
        ref="addChannelPrompt"
        :label="t('Settings.Channel Settings.Add Subscribed Channel')"
        theme="readable-width"
        fixed-layout
        @click="closeAddChannelPrompt"
      >
        <template #label="{ labelId }">
          <div class="addSubscribedChannelHeader">
            <h2
              :id="labelId"
              class="addSubscribedChannelHeading"
            >
              {{ t('Settings.Channel Settings.Add Subscribed Channel') }}
            </h2>
            <FtInput
              ref="addChannelSearch"
              class="addSubscribedChannelSearch"
              input-type="search"
              :label="t('Settings.Channel Settings.Search Channels')"
              :icon="['fas', 'search']"
              :placeholder="t('Form Inputs.Search Text Hint')"
              :show-action-button="false"
              :value="addChannelSearchQuery"
              @input="value => addChannelSearchQuery = value"
            />
          </div>
        </template>
        <div class="addSubscribedChannelPicker">
          <p
            v-if="visibleAvailableSubscriptions.length === 0"
            class="addSubscribedChannelEmptyState"
          >
            {{ t('Settings.Channel Settings.No Matching Channels') }}
          </p>
          <ul
            v-else
            ref="addChannelList"
            class="addSubscribedChannelList"
          >
            <li
              v-for="channel in displayedAvailableSubscriptions"
              :key="channel.id"
            >
              <button
                type="button"
                class="addSubscribedChannelOption"
                :disabled="addingSubscribedChannel"
                @click="addSubscribedChannel(channel.id)"
              >
                <FtRetryImage
                  v-if="channel.thumbnail"
                  :fallback-icon="['fas', 'circle-user']"
                  class="channelThumbnail"
                  :src="channel.thumbnail"
                  alt=""
                />
                <span
                  v-else
                  class="channelThumbnail channelThumbnailPlaceholder"
                  aria-hidden="true"
                >
                  <FtIcon :icon="['fas', 'circle-user']" />
                </span>
                <span
                  class="addSubscribedChannelName"
                  dir="auto"
                >
                  {{ channel.name }}
                  <span
                    v-if="channel.handle"
                    class="channelHandle"
                    dir="auto"
                  >{{ channel.handle }}</span>
                  <span
                    v-if="channel.platform"
                    class="channelHandle"
                  ><FtIcon
                    class="channelPlatformIcon"
                    :icon="channel.platform.icon"
                    aria-hidden="true"
                  />{{ channel.platform.name }}</span>
                </span>
                <FtIcon
                  class="addSubscribedChannelIcon"
                  :icon="['fas', 'plus']"
                  aria-hidden="true"
                />
              </button>
            </li>
          </ul>
          <FtAutoLoadNextPageWrapper
            v-if="hasMoreAvailableSubscriptions"
            :key="addChannelPage"
            @load-next-page="addChannelPage++"
          >
            <FtFlexBox>
              <FtButton
                :label="t('Channels.Load More Channels')"
                :icon="['fas', 'arrow-down']"
                background-color="var(--primary-color)"
                text-color="var(--text-with-main-color)"
                @click="loadMoreAvailableSubscriptions"
              />
            </FtFlexBox>
          </FtAutoLoadNextPageWrapper>
        </div>
        <template #footer>
          <FtFlexBox>
            <FtButton
              :label="t('Close')"
              :icon="['fas', 'xmark']"
              @click="closeAddChannelPrompt"
            />
          </FtFlexBox>
        </template>
      </FtPrompt>
    </FtSettingsSubpage>
  </FtSettingsSection>
</template>

<script setup>
import FtRetryImage from '../../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../../FtButton/FtButton.vue'
import FtAutoLoadNextPageWrapper from '../../FtAutoLoadNextPageWrapper.vue'
import { useListPagination } from '../../../composables/useListPagination'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../../FtIconButton/FtIconButton.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtPrompt from '../../FtPrompt/FtPrompt.vue'
import FtSettingsSubpage from '../../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSlider from '../../FtSlider/FtSlider.vue'
import FtSyncedSettingIndicator from '../../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'
import {
  CHANNEL_PREFERENCE_TYPES,
  fetchChannelInfo,
  getCachedChannelInfo,
  getPlatformChannelPreferenceKey,
  parseChannelPreferences,
  parsePlatformChannelPreferenceKey,
  removeChannelPreference,
  saveChannelPreference
} from '../../../helpers/channel-preferences'
import { findFollowedChannel, getFollowedChannels, supportsPlatformFollows } from '../../../helpers/platformFeed'
import { getPlatform, getPlatformChannelRoute, PLATFORM_ICONS } from '../../../../platforms/index'
import { showToast } from '../../../helpers/utils'
import { matchesChannelQuery } from '../../../helpers/subscription-channels'
import { clampOverlayScrollTop } from '../../../helpers/overlayScrollbars'
import { AUTO_QUALITY_FALLBACK, playbackEngineSupportsAutoQuality } from '../../../helpers/player/autoQuality'

const { locale, t } = useI18n()

const IS_CAPACITOR = Boolean(process.env.IS_CAPACITOR)
const PREFERENCES = CHANNEL_PREFERENCE_TYPES.filter(preference => (
  !IS_CAPACITOR || preference.type !== 'volume'
))
const channelPreferenceSettingKeys = PREFERENCES.map(preference => preference.valuesKey)
const disableChannelLinks = computed(() => store.getters.getDisableChannelLinks)

/** Only offer the search field once scanning the list by eye gets tedious */
const SEARCH_THRESHOLD = 5

const RESOLUTION_VALUES = ['2160', '1440', '1080', '720', '480', '360', '240', '144']
const QUALITY_VALUES_WITH_AUTO = [...RESOLUTION_VALUES, 'auto']

/**
 * Auto quality is broken with SABR, so YouTube channels only offer it unless
 * every video's streams use it. Other platforms play through yt-dlp, without SABR.
 * @param {string} channelId
 * @returns {boolean}
 */
function isAutoQualityAvailable(channelId) {
  return parsePlatformChannelPreferenceKey(channelId) !== null ||
    playbackEngineSupportsAutoQuality(store.getters.getVideoPlaybackEngine, store.getters.getBuiltInStreams)
}

const qualityNames = computed(() => [
  t('Settings.Player Settings.Default Quality.4k'),
  t('Settings.Player Settings.Default Quality.1440p'),
  t('Settings.Player Settings.Default Quality.1080p'),
  t('Settings.Player Settings.Default Quality.720p'),
  t('Settings.Player Settings.Default Quality.480p'),
  t('Settings.Player Settings.Default Quality.360p'),
  t('Settings.Player Settings.Default Quality.240p'),
  t('Settings.Player Settings.Default Quality.144p')
])

const qualityNamesWithAuto = computed(() => [...qualityNames.value, t('Settings.Player Settings.Default Quality.Auto')])

const autoUpdateLabels = computed(() => ({
  playbackSpeed: t('Settings.Channel Settings.Auto Save Playback Speed'),
  videoQuality: t('Settings.Channel Settings.Auto Save Video Quality'),
  subtitlesState: t('Settings.Channel Settings.Auto Save Subtitles State'),
  volume: t('Settings.Channel Settings.Auto Save Volume')
}))

/** Shared between the rows in a channel's card and the menu for adding one */
const PREFERENCE_ICONS = Object.freeze({
  playbackSpeed: ['fas', 'gauge'],
  videoQuality: ['fas', 'photo-film'],
  subtitlesState: ['fas', 'closed-captioning'],
  volume: ['fas', 'volume-high']
})

const preferenceLabels = computed(() => ({
  playbackSpeed: t('Settings.Player Settings.Playback Speed'),
  videoQuality: t('Settings.Channel Settings.Video Quality'),
  subtitlesState: t('Settings.Channel Settings.Subtitles Enabled'),
  volume: t('Settings.Channel Settings.Volume')
}))

const settings = computed(() => store.state.settings)
const savedChannelSyncEnableLabel = computed(() => (
  t('Settings.Channel Settings.Enable Saved Channel Settings Sync')
))
const savedChannelSyncDisableLabel = computed(() => (
  t('Settings.Channel Settings.Disable Saved Channel Settings Sync')
))

/**
 * @param {string} channelId
 * @returns {string}
 */
function getDefaultQuality(channelId) {
  const value = store.getters.getDefaultQuality

  return value === 'auto' && !isAutoQualityAvailable(channelId) ? AUTO_QUALITY_FALLBACK : value
}

/** @type {import('vue').ComputedRef<number>} */
const videoPlaybackRateInterval = computed(() => store.getters.getVideoPlaybackRateInterval)

/** @type {import('vue').ComputedRef<number>} */
const maxVideoPlaybackRate = computed(() => parseInt(store.getters.getMaxVideoPlaybackRate))

/** @type {import('vue').ComputedRef<Map<string, { name: string, thumbnail: string, handle?: string }>>} */
const subscriptionsById = computed(() => store.getters.getSubscribedChannelsById)

const backendOptions = computed(() => ({
  preference: store.getters.getBackendPreference,
  fallback: store.getters.getBackendFallback,
}))

const showManager = ref(false)
const showAddChannelPrompt = ref(false)
const addChannelSearchQuery = ref('')
const addingSubscribedChannel = ref(false)
const pendingPreferenceInitializations = new Map()
const addChannelSearch = useTemplateRef('addChannelSearch')
const addChannelPrompt = useTemplateRef('addChannelPrompt')
const addChannelList = useTemplateRef('addChannelList')
const addChannelScroller = computed(() => addChannelPrompt.value?.contentScroller ?? null)

watch(showAddChannelPrompt, async (open) => {
  if (!open) {
    return
  }

  resetAddChannelPage()

  // FtPrompt assigns its initial focus after mounting. Wait for that pass,
  // then put keyboard users directly in the channel search.
  await nextTick()
  await nextTick()
  addChannelSearch.value?.focus()
})

/**
 * Saved settings of channels on other platforms are keyed by `platform:id`.
 * Builds without yt-dlp can't open those channels.
 * @param {string} channelId
 * @param {{ platform: string, id: string } | null} platformChannel
 */
function getChannelRoute(channelId, platformChannel) {
  if (disableChannelLinks.value) return null
  if (!platformChannel) return `/channel/${channelId}`
  return supportsPlatformFollows ? getPlatformChannelRoute(platformChannel.platform, platformChannel.id) : null
}

/**
 * @param {{ platform: string } | null} platformChannel
 * @returns {{ name: string, icon: string[] } | null}
 */
function getPlatformLabel(platformChannel) {
  if (!platformChannel) return null
  const { platform } = platformChannel
  return { name: getPlatform(platform)?.name ?? platform, icon: PLATFORM_ICONS[platform] ?? ['fas', 'globe'] }
}

/**
 * The name and avatar of a channel without a network request, if possible.
 * @param {string} channelId
 */
function getKnownChannelInfo(channelId) {
  const platformChannel = parsePlatformChannelPreferenceKey(channelId)
  const followed = platformChannel && findFollowedChannel(platformChannel.platform, platformChannel.id)
  if (followed) return { name: followed.name, thumbnail: followed.avatar ?? '' }
  return getCachedChannelInfo(channelId, subscriptionsById.value)
}
const searchQuery = ref('')
const channelsPerPage = 24
const channelListContainer = useTemplateRef('channelListContainer')
const channelListContent = useTemplateRef('channelListContent')
let contentResizeObserver = null

watch(showManager, async (open, _previous, onCleanup) => {
  let cancelled = false
  onCleanup(() => {
    cancelled = true
    contentResizeObserver?.disconnect()
    contentResizeObserver = null
  })
  if (!open) return
  resetChannelPage()
  await nextTick()
  if (cancelled) return

  const scroller = channelListContainer.value
  const content = channelListContent.value
  if (!scroller || !content) return
  const clampScroll = () => clampOverlayScrollTop(scroller, content)
  contentResizeObserver = new ResizeObserver(clampScroll)
  contentResizeObserver.observe(scroller)
  contentResizeObserver.observe(content)
  clampScroll()
})

onBeforeUnmount(() => contentResizeObserver?.disconnect())

/**
 * Channels that had to be fetched, so that they can be displayed once they arrive.
 * @type {import('vue').Ref<Map<string, { name: string, thumbnail: string }>>}
 */
const fetchedChannels = ref(new Map())

/**
 * @param {string} settingKey
 * @param {boolean} value
 */
function updateSetting(settingKey, value) {
  store.dispatch(`update${settingKey[0].toUpperCase()}${settingKey.slice(1)}`, value)
}

const collator = computed(() => new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' }))

/**
 * Every channel that has at least one remembered value, along with the types
 * that are not remembered for it yet.
 * @type {import('vue').ComputedRef<{
 *   id: string,
 *   name: string,
 *   thumbnail: string,
 *   handle: string | null,
 *   platform: { name: string, icon: string[] } | null,
 *   route: string | import('vue-router').RouteLocationRaw | null,
 *   autoQuality: boolean,
 *   preferences: {
 *     type: string,
 *     value: number | string | boolean,
 *     icon: string[],
 *     label: string
 *   }[],
 *   addableOptions: { label: string, value: string, icon: string[] }[]
 * }[]>}
 */
const channelEntries = computed(() => {
  /** @type {Map<string, Map<string, number | string | boolean>>} */
  const valuesByChannel = new Map()

  for (const { type, valuesKey } of PREFERENCES) {
    for (const [channelId, value] of Object.entries(parseChannelPreferences(settings.value[valuesKey], valuesKey))) {
      if (!valuesByChannel.has(channelId)) {
        valuesByChannel.set(channelId, new Map())
      }

      valuesByChannel.get(channelId).set(
        type,
        // Fall back for entries that still hold auto while it is unavailable,
        // to the same quality that playback uses for them
        type === 'videoQuality' && String(value) === 'auto' && !isAutoQualityAvailable(channelId)
          ? AUTO_QUALITY_FALLBACK
          : value
      )
    }
  }

  const entries = Array.from(valuesByChannel, ([channelId, values]) => {
    // Read unconditionally, so this recomputes once a fetch fills the channel in
    const fetched = fetchedChannels.value.get(channelId)
    const channel = getKnownChannelInfo(channelId) ?? fetched
    const platformChannel = parsePlatformChannelPreferenceKey(channelId)

    const preferences = PREFERENCES
      .filter(({ type }) => values.has(type))
      .map(({ type }) => ({
        type,
        value: values.get(type),
        icon: PREFERENCE_ICONS[type],
        label: preferenceLabels.value[type]
      }))

    const addableOptions = PREFERENCES
      .filter(({ type }) => !values.has(type))
      .map(({ type }) => ({
        label: preferenceLabels.value[type],
        value: type,
        icon: PREFERENCE_ICONS[type]
      }))

    return {
      id: channelId,
      name: channel?.name || platformChannel?.id || channelId,
      thumbnail: channel?.thumbnail ?? '',
      handle: subscriptionsById.value.get(channelId)?.handle ?? null,
      platform: getPlatformLabel(platformChannel),
      route: getChannelRoute(channelId, platformChannel),
      autoQuality: isAutoQualityAvailable(channelId),
      preferences,
      addableOptions
    }
  })

  return entries.sort((a, b) => collator.value.compare(a.name, b.name))
})

const showChannelSearch = computed(() => channelEntries.value.length > SEARCH_THRESHOLD || searchQuery.value !== '')

/** Subscriptions and followed channels that do not have any saved channel preference yet. */
const availableSubscriptions = computed(() => {
  const savedChannelIds = new Set(channelEntries.value.map(({ id }) => id))

  return [
    ...Array.from(subscriptionsById.value, ([id, channel]) => ({
      id,
      name: channel.name || id,
      thumbnail: channel.thumbnail ?? '',
      handle: channel.handle ?? null,
      platform: null
    })),
    ...getFollowedChannels().map(channel => ({
      id: getPlatformChannelPreferenceKey(channel),
      name: channel.name,
      thumbnail: channel.avatar ?? '',
      handle: null,
      platform: getPlatformLabel(channel)
    }))
  ]
    .filter(({ id }) => !savedChannelIds.has(id))
    .sort((a, b) => collator.value.compare(a.name, b.name))
})

const visibleAvailableSubscriptions = computed(() => {
  const query = addChannelSearchQuery.value.trim().toLowerCase()

  if (query === '') {
    return availableSubscriptions.value
  }

  return availableSubscriptions.value.filter(channel => matchesChannelQuery(channel, query))
})

// Mount subscriptions in batches so the picker opens quickly with thousands of them.
const { page: addChannelPage, hasMore: hasMoreAvailableSubscriptions, displayedItems: displayedAvailableSubscriptions, reset: resetAddChannelPage, loadMore: loadMoreAvailableSubscriptions } = useListPagination(visibleAvailableSubscriptions, {
  pageSize: 50,
  append: true,
  resetOn: addChannelSearchQuery,
  scrollTarget: addChannelScroller,
  focusItem: index => addChannelList.value?.children[index]?.querySelector('button')?.focus()
})

const visibleChannelEntries = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  if (query === '') {
    return channelEntries.value
  }

  return channelEntries.value.filter(channel => matchesChannelQuery(channel, query))
})

// Mount editors in batches so large saved channel lists open quickly.
const { page: channelPage, hasMore: hasMoreChannels, displayedItems: displayedChannelEntries, reset: resetChannelPage, restoreScroll: restoreChannelScroll, loadMore: loadMoreChannels } = useListPagination(visibleChannelEntries, {
  pageSize: channelsPerPage,
  append: true,
  resetOn: searchQuery,
  scrollTarget: channelListContainer,
  focusItem: index => channelListContent.value?.querySelectorAll('.channelEntry')[index]?.querySelector('.channelLink')?.focus()
})

/** @param {string} channelId */
async function revealChannel(channelId) {
  searchQuery.value = ''
  await nextTick()
  const index = visibleChannelEntries.value.findIndex(channel => channel.id === channelId)
  if (index === -1) return
  channelPage.value = Math.floor(index / channelsPerPage)
  await restoreChannelScroll()
  channelListContent.value?.querySelector(`[data-channel-id="${CSS.escape(channelId)}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

const manageButtonLabel = computed(() => {
  return t('Settings.Channel Settings.Manage Saved Channels', { channelCount: channelEntries.value.length })
})

/** Resolves the channels that aren't subscribed to, the rest is already known locally */
async function fetchMissingChannels() {
  const missingIds = channelEntries.value
    .map(({ id }) => id)
    .filter(id => getKnownChannelInfo(id) === null)

  for (const channelId of missingIds) {
    const channel = await fetchChannelInfo(channelId, backendOptions.value)

    if (channel !== null) {
      // replace the map so that the computed entries pick the channel up
      fetchedChannels.value = new Map(fetchedChannels.value).set(channelId, channel)
    }
  }
}

watch([showManager, channelEntries], ([isManagerOpen]) => {
  if (isManagerOpen) {
    fetchMissingChannels()
  }
})

/**
 * @param {string} channelId
 * @param {'playbackSpeed' | 'videoQuality' | 'subtitlesState' | 'volume'} type
 * @param {number | string | boolean} value
 * @param {symbol} [initializationToken]
 */
function setPreference(channelId, type, value, initializationToken) {
  const key = `${channelId}:${type}`
  if (initializationToken === undefined) {
    pendingPreferenceInitializations.delete(key)
  } else {
    pendingPreferenceInitializations.set(key, initializationToken)
  }

  return saveChannelPreference(store, channelId, type, value)
}

/**
 * Starts remembering a setting for a channel that doesn't have one yet,
 * beginning at whatever the global default is.
 * @param {string} channelId
 * @param {'playbackSpeed' | 'videoQuality' | 'subtitlesState' | 'volume'} type
 */
function addPreference(channelId, type) {
  return setPreference(channelId, type, defaultPreferenceValue(channelId, type))
}

/**
 * @param {string} channelId
 * @param {'playbackSpeed' | 'videoQuality' | 'subtitlesState' | 'volume'} type
 */
function defaultPreferenceValue(channelId, type) {
  switch (type) {
    case 'playbackSpeed':
      return store.getters.getDefaultPlayback
    case 'videoQuality':
      return getDefaultQuality(channelId)
    case 'subtitlesState':
      return store.getters.getEnableSubtitlesByDefault
    case 'volume':
      return store.getters.getDefaultVolume
  }
}

/**
 * Creates a saved channel entry with the global defaults for every
 * per-channel preference.
 * @param {string} channelId
 */
async function addSubscribedChannel(channelId) {
  if (addingSubscribedChannel.value) {
    return
  }

  const preferencesToAdd = PREFERENCES.map(({ type }) => ({
    type,
    initialValue: defaultPreferenceValue(channelId, type)
  }))
  addingSubscribedChannel.value = true
  const initializationToken = Symbol(channelId)
  try {
    const saved = await Promise.all(preferencesToAdd.map(({ type, initialValue }) => (
      setPreference(channelId, type, initialValue, initializationToken).catch((error) => {
        console.error(error)
        return false
      })
    )))

    if (saved.some(value => !value)) {
      const rolledBack = await Promise.all(preferencesToAdd.map(({ type, initialValue }) => (
        rollbackPreference(channelId, type, initialValue, initializationToken)
          .catch(error => {
            console.error(error)
            return false
          })
      )))
      if (rolledBack.some(value => !value)) {
        addChannelSearchQuery.value = ''
        showAddChannelPrompt.value = false
        await revealChannel(channelId)
      }
      showToast({
        message: t('Channel.Failed to save subscription settings'),
        icon: ['fas', 'circle-exclamation']
      })
      return
    }

    addChannelSearchQuery.value = ''
    showAddChannelPrompt.value = false
    await revealChannel(channelId)
  } finally {
    for (const { type } of preferencesToAdd) {
      const key = `${channelId}:${type}`
      if (pendingPreferenceInitializations.get(key) === initializationToken) {
        pendingPreferenceInitializations.delete(key)
      }
    }
    addingSubscribedChannel.value = false
  }
}

function closeAddChannelPrompt() {
  showAddChannelPrompt.value = false
  addChannelSearchQuery.value = ''
}

/**
 * Removes an initialized value unless it has since been edited.
 * @param {string} channelId
 * @param {'playbackSpeed' | 'videoQuality' | 'subtitlesState' | 'volume'} type
 * @param {number | string | boolean} initialValue
 * @param {symbol} initializationToken
 */
function rollbackPreference(channelId, type, initialValue, initializationToken) {
  const key = `${channelId}:${type}`
  if (pendingPreferenceInitializations.get(key) !== initializationToken) {
    return Promise.resolve(true)
  }

  pendingPreferenceInitializations.delete(key)
  return removeChannelPreference(store, channelId, type, value => value === initialValue)
}

/**
 * @param {string} channelId
 * @param {'playbackSpeed' | 'videoQuality' | 'subtitlesState' | 'volume'} type
 */
function deletePreference(channelId, type) {
  return removeChannelPreference(store, channelId, type)
}

/**
 * @param {string} channelId
 */
function forgetChannel(channelId) {
  for (const { type } of PREFERENCES) {
    removeChannelPreference(store, channelId, type)
  }
}
</script>

<style scoped src="./ChannelSettings.css" />
