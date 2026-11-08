<template>
  <div class="manageButton">
    <FtButton
      :label="t('Channel.Subscription settings')"
      :icon="['fas', 'sliders-h']"
      @click="showManager = true"
    />
    <FtSyncedSettingIndicator :setting-keys="[SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY]" />
  </div>
  <FtSettingsSubpage
    :open="showManager"
    :title="t('Channel.Subscription settings')"
    :icon="['fas', 'sliders-h']"
    @close="showManager = false"
  >
    <template #breadcrumb-action>
      <FtSyncedSettingIndicator :setting-keys="[SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY]" />
    </template>
    <div class="channelSettingsHeader">
      <FtInput
        input-type="search"
        :label="t('Settings.Channel Settings.Search Channels')"
        :icon="['fas', 'search']"
        :placeholder="t('Form Inputs.Search Text Hint')"
        :show-action-button="false"
        :value="searchQuery"
        @input="searchQuery = $event"
      />
      <div
        v-if="channels.length > 0"
        class="channelSelectionToolbar"
      >
        <div class="channelSelectionSummary">
          <p
            :id="`${id}-selection-summary`"
            aria-live="polite"
          >
            {{ selectedChannelCountText }}
          </p>
          <div class="channelSelectionActions">
            <FtButton
              :disabled="visibleChannels.length === 0 || allVisibleChannelsSelected"
              @click="selectAllVisibleChannels"
            >
              <span>{{ t('Profile.Select All') }}</span>
              <FtIcon
                class="channelSelectionActionIcon"
                :icon="['fas', 'check']"
                aria-hidden="true"
              />
            </FtButton>
            <FtButton
              :disabled="selectedChannelIds.size === 0"
              @click="clearChannelSelection"
            >
              <span>{{ t('Profile.Select None') }}</span>
              <FtIcon
                class="channelSelectionActionIcon"
                :icon="['fas', 'xmark']"
                aria-hidden="true"
              />
            </FtButton>
          </div>
        </div>
        <div
          v-if="selectedChannelIds.size > 0"
          class="bulkFeedTypeSettings"
          role="group"
          :aria-labelledby="`${id}-selection-summary`"
        >
          <FtSubscriptionPreferences
            :feed-type-states="selectedFeedTypeStates"
            :notification-feed-type-states="uploadNotificationsAvailable ? selectedNotificationFeedTypeStates : null"
            :daily-video-limit="selectedDailyVideoLimit"
            :show-members-only="restrictedPlaybackConfigured ? selectedMembersOnlyState : null"
            @toggle-feed-type="updateSelectedFeedType"
            @update-daily-video-limit="updateSelectedChannelLimit"
            @update-show-members-only="updateSelectedShowMembersOnly"
          />
        </div>
      </div>
    </div>
    <div
      ref="channelSettingsScroller"
      v-overlay-scrollbars
      class="channelSettingsScroller"
    >
      <div ref="channelSettingsContent">
        <p
          v-if="channels.length === 0"
          class="emptyState"
        >
          {{ t('Home Page.Nothing here yet') }}
        </p>
        <p
          v-else-if="visibleChannels.length === 0"
          class="emptyState"
        >
          {{ t('Settings.Channel Settings.No Matching Channels') }}
        </p>
        <ul
          v-else
          class="channelSettingsList"
        >
          <li
            v-for="(channel, index) in displayedChannels"
            :key="channel.id"
            class="channelSettings"
            :class="{ selected: isChannelSelected(channel.id) }"
            role="group"
            :aria-labelledby="`${id}-channel-${index}`"
          >
            <div class="channelIdentity">
              <button
                type="button"
                class="channelSelectionOption"
                :class="{ selected: isChannelSelected(channel.id) }"
                role="checkbox"
                :aria-checked="isChannelSelected(channel.id)"
                :aria-labelledby="`${id}-channel-${index}`"
                @click="toggleChannelSelection(channel.id)"
              >
                <FtIcon
                  v-if="isChannelSelected(channel.id)"
                  :icon="['fas', 'check']"
                  aria-hidden="true"
                />
              </button>
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
                :id="`${id}-channel-${index}`"
                class="channelName"
                dir="auto"
              >
                {{ channel.name || channel.id }}
              </p>
            </div>
            <FtSubscriptionPreferences
              :feed-type-states="channelFeedTypeStates(channel)"
              :notification-feed-type-states="uploadNotificationsAvailable ? channelFeedTypeStates(channel, 'notificationFeedTypes') : null"
              :daily-video-limit="channelSettings(channel).dailyVideoLimit"
              :show-members-only="restrictedPlaybackConfigured ? channelSettings(channel).showMembersOnly : null"
              @toggle-feed-type="(feedType, key) => updateFeedType(channel, feedType, !isFeedTypeEnabled(channel, feedType, key), key)"
              @update-daily-video-limit="value => updateChannelLimit(channel, value)"
              @update-show-members-only="value => updateShowMembersOnly(channel, value)"
            />
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
  </FtSettingsSubpage>
</template>

<script setup>
import FtRetryImage from '../../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSyncedSettingIndicator from '../../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import { SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY } from '../../../helpers/subscription-settings-sync'
import FtButton from '../../FtButton/FtButton.vue'
import FtAutoLoadNextPageWrapper from '../../FtAutoLoadNextPageWrapper.vue'
import { useListPagination } from '../../../composables/useListPagination'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtSettingsSubpage from '../../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSubscriptionPreferences from '../../FtSubscriptionPreferences/FtSubscriptionPreferences.vue'

import store from '../../../store/index'
import { supportsUploadNotifications as uploadNotificationsSupported } from '../../../helpers/uploadNotifications'
import { showToast } from '../../../helpers/utils'
import { clampOverlayScrollTop } from '../../../helpers/overlayScrollbars'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../../helpers/restricted-playback'
import {
  formatSubscriptionDailyVideoLimit,
  getSubscriptionFeedTypeOptions,
  getUpdatedSubscriptionFeedTypes,
  normalizeSubscriptionChannelSettings,
  parseSubscriptionDailyVideoLimit
} from '../../../helpers/subscription-channels'

const uploadNotificationsAvailable = computed(() => uploadNotificationsSupported && store.getters.getNotificationMode !== 'off')

const { locale, t } = useI18n()
const id = useId()
const showManager = ref(false)
const searchQuery = ref('')
// Mount editors in batches so large subscription lists open quickly.
const channelsPerPage = 24
const channelSettingsScroller = useTemplateRef('channelSettingsScroller')
const channelSettingsContent = useTemplateRef('channelSettingsContent')
const optimisticChannelSettings = shallowRef(new Map())
const selectedChannelIds = shallowRef(new Set())
const restrictedPlaybackConfigured = computed(() => (
  hasConfiguredRestrictedPlaybackAuthentication(store.getters)
))

let contentResizeObserver = null
let observationGeneration = 0
let updateSequence = 0
let pendingChannelSettingsUpdates = 0
let hasFailedChannelSettingsUpdate = false
let channelSettingsUpdateQueue = Promise.resolve()
const latestUpdateByChannel = new Map()

watch(showManager, async (open) => {
  const generation = ++observationGeneration
  stopObservingContent()
  if (!open) return
  resetChannelPage()

  await nextTick()
  if (generation !== observationGeneration || !showManager.value) return

  const scroller = channelSettingsScroller.value
  const content = channelSettingsContent.value
  if (!scroller || !content) return

  const clampScroll = () => clampOverlayScrollTop(scroller, content)
  contentResizeObserver = new ResizeObserver(clampScroll)
  contentResizeObserver.observe(scroller)
  contentResizeObserver.observe(content)
  clampScroll()
})

onBeforeUnmount(() => {
  observationGeneration += 1
  stopObservingContent()
})

function stopObservingContent() {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
}

const channels = computed(() => {
  const subscriptions = store.getters.getProfileList[0]?.subscriptions ?? []
  const collator = new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' })

  return [...subscriptions].sort((a, b) => (
    collator.compare(a.name || a.id, b.name || b.id)
  ))
})

const visibleChannels = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (query === '') return channels.value

  return channels.value.filter(channel => (
    (channel.name || '').toLocaleLowerCase().includes(query) ||
    channel.id.toLocaleLowerCase().includes(query)
  ))
})

const { page: channelPage, hasMore: hasMoreChannels, displayedItems: displayedChannels, reset: resetChannelPage, loadMore: loadMoreChannels } = useListPagination(visibleChannels, {
  pageSize: channelsPerPage,
  append: true,
  resetOn: searchQuery,
  scrollTarget: channelSettingsScroller,
  focusItem: index => channelSettingsContent.value?.querySelectorAll('.channelSelectionOption')[index]?.focus()
})

const feedTypes = computed(() => getSubscriptionFeedTypeOptions(t))
const selectedChannels = computed(() => channels.value.filter(channel => (
  selectedChannelIds.value.has(channel.id)
)))
const selectedChannelCountText = computed(() => t('Profile.{number} selected', {
  number: selectedChannelIds.value.size
}))
const allVisibleChannelsSelected = computed(() => (
  visibleChannels.value.length > 0 &&
  visibleChannels.value.every(channel => selectedChannelIds.value.has(channel.id))
))
const selectedMembersOnlyState = computed(() => selectedState(channel => (
  channelSettings(channel).showMembersOnly
)))
const selectedDailyVideoLimit = computed(() => {
  const [first, ...others] = selectedChannels.value.map(channel => channelSettings(channel).dailyVideoLimit)
  return others.every(limit => limit === first) ? first : 'mixed'
})

watch(channels, (channelList) => {
  const channelIds = new Set(channelList.map(channel => channel.id))
  const nextSelection = new Set(
    [...selectedChannelIds.value].filter(channelId => channelIds.has(channelId))
  )

  if (nextSelection.size !== selectedChannelIds.value.size) {
    selectedChannelIds.value = nextSelection
  }
})

/**
 * @typedef {object} SubscriptionChannel
 * @property {string} id
 * @property {string[]|undefined} feedTypes
 * @property {string[]|undefined} notificationFeedTypes
 * @property {number|null|undefined} dailyVideoLimit
 * @property {boolean|undefined} showMembersOnly
 */

/**
 * @param {SubscriptionChannel} channel
 */
function channelLimitValue(channel) {
  return formatSubscriptionDailyVideoLimit(channelSettings(channel).dailyVideoLimit)
}

/**
 * @param {SubscriptionChannel} channel
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {'feedTypes' | 'notificationFeedTypes'} [key]
 */
function isFeedTypeEnabled(channel, feedType, key = 'feedTypes') {
  return channelSettings(channel)[key].includes(feedType)
}

/**
 * Only fetched feed types can notify.
 * @param {object} channel
 * @param {string} feedType
 */
function isNotifying(channel, feedType) {
  return isFeedTypeEnabled(channel, feedType) && isFeedTypeEnabled(channel, feedType, 'notificationFeedTypes')
}

/**
 * @param {SubscriptionChannel} channel
 * @param {'feedTypes' | 'notificationFeedTypes'} [key]
 */
function channelFeedTypeStates(channel, key = 'feedTypes') {
  return Object.fromEntries(feedTypes.value.map(({ id }) => [
    id,
    key === 'feedTypes' ? isFeedTypeEnabled(channel, id) : isNotifying(channel, id)
  ]))
}

/**
 * @param {string} channelId
 */
function isChannelSelected(channelId) {
  return selectedChannelIds.value.has(channelId)
}

/**
 * @param {string} channelId
 */
function toggleChannelSelection(channelId) {
  const nextSelection = new Set(selectedChannelIds.value)
  if (nextSelection.has(channelId)) {
    nextSelection.delete(channelId)
  } else {
    nextSelection.add(channelId)
  }
  selectedChannelIds.value = nextSelection
}

function selectAllVisibleChannels() {
  selectedChannelIds.value = new Set([
    ...selectedChannelIds.value,
    ...visibleChannels.value.map(channel => channel.id)
  ])
}

function clearChannelSelection() {
  selectedChannelIds.value = new Set()
}

/**
 * @param {(channel: SubscriptionChannel) => boolean} isEnabled
 * @returns {boolean | 'mixed'}
 */
function selectedState(isEnabled, channels = selectedChannels.value) {
  const enabledCount = channels.filter(isEnabled).length

  if (enabledCount === 0) return false
  if (enabledCount === channels.length) return true
  return 'mixed'
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {'feedTypes' | 'notificationFeedTypes'} [key]
 * @returns {boolean | 'mixed'}
 */
function selectedFeedTypeState(feedType, key = 'feedTypes') {
  return selectedState(channel => (
    isFeedTypeEnabled(channel, feedType, key)
  ), selectedChannelsForFeedType(feedType, key))
}

/**
 * Notifications only apply to channels that show the feed type.
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {'feedTypes' | 'notificationFeedTypes'} key
 */
function selectedChannelsForFeedType(feedType, key) {
  return key === 'notificationFeedTypes'
    ? selectedChannels.value.filter(channel => isFeedTypeEnabled(channel, feedType))
    : selectedChannels.value
}

const selectedFeedTypeStates = computed(() => Object.fromEntries(
  feedTypes.value.map(({ id }) => [id, selectedFeedTypeState(id)])
))
const selectedNotificationFeedTypeStates = computed(() => Object.fromEntries(
  feedTypes.value.map(({ id }) => [id, selectedFeedTypeState(id, 'notificationFeedTypes')])
))

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {'feedTypes' | 'notificationFeedTypes'} [key]
 */
function updateSelectedFeedType(feedType, key = 'feedTypes') {
  const enabled = selectedFeedTypeState(feedType, key) !== true
  persistChannelSettingsUpdates(selectedChannelsForFeedType(feedType, key)
    .filter(channel => isFeedTypeEnabled(channel, feedType, key) !== enabled)
    .map(channel => ({
      channel,
      patch: {
        [key]: getUpdatedSubscriptionFeedTypes(channelSettings(channel)[key], feedType, enabled)
      }
    })))
}

/**
 * @param {boolean} enabled
 */
function updateSelectedShowMembersOnly(enabled) {
  persistChannelSettingsUpdates(selectedChannels.value
    .filter(channel => channelSettings(channel).showMembersOnly !== enabled)
    .map(channel => ({ channel, patch: { showMembersOnly: enabled } })))
}

/**
 * @param {string} value
 */
function updateSelectedChannelLimit(value) {
  persistChannelSettingsUpdates(selectedChannels.value
    .filter(channel => channelLimitValue(channel) !== value)
    .map(channel => ({ channel, patch: { dailyVideoLimit: parseSubscriptionDailyVideoLimit(value) } })))
}

/**
 * @param {SubscriptionChannel} channel
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {boolean} enabled
 * @param {'feedTypes' | 'notificationFeedTypes'} [key]
 */
function updateFeedType(channel, feedType, enabled, key = 'feedTypes') {
  persistChannelSettings(channel, {
    [key]: getUpdatedSubscriptionFeedTypes(
      channelSettings(channel)[key],
      feedType,
      enabled
    )
  })
}

/**
 * @param {SubscriptionChannel} channel
 * @param {string} value
 */
function updateChannelLimit(channel, value) {
  persistChannelSettings(channel, {
    dailyVideoLimit: parseSubscriptionDailyVideoLimit(value)
  })
}

/**
 * @param {SubscriptionChannel} channel
 * @param {boolean} value
 */
function updateShowMembersOnly(channel, value) {
  persistChannelSettings(channel, { showMembersOnly: value })
}

/**
 * @param {SubscriptionChannel} channel
 */
function channelSettings(channel) {
  const optimisticSettings = optimisticChannelSettings.value.get(channel.id)
  if (optimisticSettings !== undefined) return optimisticSettings
  return normalizeSubscriptionChannelSettings(channel)
}

/**
 * @param {SubscriptionChannel} channel
 * @param {{ feedTypes?: string[], notificationFeedTypes?: string[], dailyVideoLimit?: number|null|undefined, showMembersOnly?: boolean }} patch
 */
function persistChannelSettings(channel, patch) {
  persistChannelSettingsUpdates([{ channel, patch }])
}

/**
 * @param {{ channel: SubscriptionChannel, patch: object }[]} updates
 */
function persistChannelSettingsUpdates(updates) {
  if (updates.length === 0) return
  const sequence = ++updateSequence
  pendingChannelSettingsUpdates += 1
  const optimisticSettings = new Map(optimisticChannelSettings.value)
  for (const { channel, patch } of updates) {
    optimisticSettings.set(channel.id, { ...channelSettings(channel), ...patch })
    latestUpdateByChannel.set(channel.id, sequence)
  }
  optimisticChannelSettings.value = optimisticSettings

  channelSettingsUpdateQueue = channelSettingsUpdateQueue.then(async () => {
    let saved = false
    try {
      const payload = updates.map(({ channel, patch }) => ({ channelId: channel.id, settings: patch }))
      saved = updates.length === 1
        ? await store.dispatch('updateChannelSettings', payload[0])
        : await store.dispatch('batchUpdateChannelSettings', payload)
    } catch (error) {
      console.error(error)
    } finally {
      const nextSettings = new Map(optimisticChannelSettings.value)
      for (const { channel } of updates) {
        if (latestUpdateByChannel.get(channel.id) === sequence) {
          nextSettings.delete(channel.id)
          latestUpdateByChannel.delete(channel.id)
        }
      }
      optimisticChannelSettings.value = nextSettings
      if (!saved) hasFailedChannelSettingsUpdate = true
      pendingChannelSettingsUpdates -= 1
      if (pendingChannelSettingsUpdates === 0 && hasFailedChannelSettingsUpdate) {
        hasFailedChannelSettingsUpdate = false
        showToast({
          message: t('Channel.Failed to save subscription settings'),
          icon: ['fas', 'circle-exclamation']
        })
      }
    }
  })
}
</script>

<style scoped src="./SubscriptionChannelSettings.css" />
