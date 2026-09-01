<template>
  <FtButton
    :label="t('Channel.Subscription settings')"
    :icon="['fas', 'sliders-h']"
    @click="showManager = true"
  />
  <FtSettingsSubpage
    :open="showManager"
    :title="t('Channel.Subscription settings')"
    :icon="['fas', 'sliders-h']"
    @close="showManager = false"
  >
    <div class="channelSettingsHeader">
      <FtInput
        :placeholder="t('Settings.Channel Settings.Search Channels')"
        :show-action-button="false"
        :show-clear-text-button="true"
        :value="searchQuery"
        @input="searchQuery = $event"
        @clear="searchQuery = ''"
      />
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
            v-for="(channel, index) in visibleChannels"
            :key="channel.id"
            class="channelSettings"
            role="group"
            :aria-labelledby="`${id}-channel-${index}`"
          >
            <div class="channelIdentity">
              <img
                v-if="channel.thumbnail"
                class="channelThumbnail"
                :src="channel.thumbnail"
                alt=""
              >
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
            <div
              class="feedTypeSettings"
              role="group"
              :aria-labelledby="`${id}-channel-${index}-feed-types`"
            >
              <p
                :id="`${id}-channel-${index}-feed-types`"
                class="settingLabel"
              >
                {{ t('Channel.Show in subscription feed') }}
              </p>
              <div class="feedTypeOptions">
                <button
                  v-for="feedType in feedTypes"
                  :key="feedType.id"
                  type="button"
                  class="feedTypeOption"
                  :class="{ enabled: isFeedTypeEnabled(channel, feedType.id) }"
                  role="checkbox"
                  :aria-checked="isFeedTypeEnabled(channel, feedType.id)"
                  @click="updateFeedType(
                    channel,
                    feedType.id,
                    !isFeedTypeEnabled(channel, feedType.id)
                  )"
                >
                  <FtIcon
                    :icon="feedType.icon"
                    aria-hidden="true"
                  />
                  <span>{{ feedType.label }}</span>
                  <FtIcon
                    v-if="isFeedTypeEnabled(channel, feedType.id)"
                    class="feedTypeCheck"
                    :icon="['fas', 'check']"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
            <div
              v-if="restrictedPlaybackConfigured"
              class="membersOnlySetting"
            >
              <FtToggleSwitch
                :label="t('Search Listing.Label.Members Only')"
                :default-value="channelSettings(channel).showMembersOnly"
                compact
                @change="value => updateShowMembersOnly(channel, value)"
              />
            </div>
            <div class="dailyLimitSetting">
              <FtSelect
                class="dailyLimitSelect"
                :placeholder="t('Channel.Videos per day')"
                :value="channelLimitValue(channel)"
                :select-names="limitNames"
                :select-values="limitValues"
                :icon="['fas', 'clock']"
                @change="value => updateChannelLimit(channel, value)"
              />
            </div>
          </li>
        </ul>
      </div>
    </div>
  </FtSettingsSubpage>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import { showToast } from '../../helpers/utils'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import {
  formatSubscriptionDailyVideoLimit,
  getSubscriptionDailyVideoLimitOptions,
  getSubscriptionFeedTypeOptions,
  getUpdatedSubscriptionFeedTypes,
  normalizeSubscriptionChannelSettings,
  parseSubscriptionDailyVideoLimit
} from '../../helpers/subscription-channels'

const { locale, t } = useI18n()
const id = useId()
const showManager = ref(false)
const searchQuery = ref('')
const channelSettingsScroller = useTemplateRef('channelSettingsScroller')
const channelSettingsContent = useTemplateRef('channelSettingsContent')
const optimisticChannelSettings = shallowRef(new Map())
const restrictedPlaybackConfigured = computed(() => (
  hasConfiguredRestrictedPlaybackAuthentication(store.getters)
))

let contentResizeObserver = null
let observationGeneration = 0
let updateSequence = 0
let channelSettingsUpdateQueue = Promise.resolve()
const latestUpdateByChannel = new Map()

watch(showManager, async (open) => {
  const generation = ++observationGeneration
  stopObservingContent()
  if (!open) return

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

const feedTypes = computed(() => getSubscriptionFeedTypeOptions(t))
const limitOptions = computed(() => getSubscriptionDailyVideoLimitOptions(t))
const limitNames = computed(() => limitOptions.value.map(option => option.label))
const limitValues = computed(() => limitOptions.value.map(option => option.value))

/**
 * @typedef {object} SubscriptionChannel
 * @property {string} id
 * @property {string[]|undefined} feedTypes
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
 */
function isFeedTypeEnabled(channel, feedType) {
  return channelSettings(channel).feedTypes.includes(feedType)
}

/**
 * @param {SubscriptionChannel} channel
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {boolean} enabled
 */
function updateFeedType(channel, feedType, enabled) {
  persistChannelSettings(channel, {
    feedTypes: getUpdatedSubscriptionFeedTypes(
      channelSettings(channel).feedTypes,
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
 * @param {{ feedTypes?: string[], dailyVideoLimit?: number|null|undefined, showMembersOnly?: boolean }} patch
 */
function persistChannelSettings(channel, patch) {
  const settings = { ...channelSettings(channel), ...patch }
  const sequence = ++updateSequence
  latestUpdateByChannel.set(channel.id, sequence)
  optimisticChannelSettings.value = new Map(optimisticChannelSettings.value)
    .set(channel.id, settings)

  channelSettingsUpdateQueue = channelSettingsUpdateQueue.then(async () => {
    let saved = false
    try {
      saved = await store.dispatch('updateChannelSettings', {
        channelId: channel.id,
        settings: patch
      })
    } catch (error) {
      console.error(error)
    } finally {
      if (latestUpdateByChannel.get(channel.id) === sequence) {
        const nextSettings = new Map(optimisticChannelSettings.value)
        nextSettings.delete(channel.id)
        optimisticChannelSettings.value = nextSettings
        latestUpdateByChannel.delete(channel.id)
        if (!saved) {
          showToast({
            message: t('Channel.Failed to save subscription settings'),
            icon: ['fas', 'circle-exclamation']
          })
        }
      }
    }
  })
}
</script>

<style scoped src="./SubscriptionChannelSettings.css" />
