<template>
  <div
    ref="root"
    class="channelErrors"
    :class="{ hasErrors: rows.length > 0 }"
    tabindex="-1"
  >
    <div class="channelErrorsHeader">
      <FtIcon
        v-if="rows.length > 0"
        class="channelErrorsIcon"
        :icon="['fas', 'triangle-exclamation']"
        aria-hidden="true"
      />
      <!-- Stays mounted so that screen readers announce the failures when they appear -->
      <p
        class="channelErrorsSummary"
        role="status"
      >
        {{ rows.length > 0 ? t('Subscriptions.Channel Errors.Summary', { count: rows.length }, rows.length) : '' }}
      </p>
      <template v-if="rows.length > 0">
        <FtButton
          v-if="retryableRows.length > 1"
          class="channelErrorsRetryAll"
          :title="t('Subscriptions.Channel Errors.Retry All')"
          :icon="['fas', 'arrows-rotate']"
          :disabled="refreshInProgress"
          variant="text"
          @click="retrySubscriptionChannels(retryableRows, t)"
        >
          <template #label>
            <span class="channelErrorsRetryAllLabel">{{ t('Subscriptions.Channel Errors.Retry All') }}</span>
          </template>
        </FtButton>
        <FtIconButton
          :title="t('Subscriptions.Copy Error Details')"
          :icon="['fas', 'copy']"
          theme="base-no-default"
          :size="16"
          :padding="6"
          @click="copyDetails"
        />
        <FtIconButton
          :title="t('Close')"
          :icon="['fas', 'xmark']"
          theme="base-no-default"
          :size="16"
          :padding="6"
          @click="dismiss"
        />
      </template>
    </div>
    <ul
      v-if="rows.length > 0"
      class="channelErrorList"
    >
      <li
        v-for="row in shownRows"
        :key="row.id"
        class="channelError"
      >
        <router-link
          class="channelLink"
          :to="`/channel/${row.id}`"
          :data-tab-title="row.name"
        >
          <FtChannelAvatar :thumbnail="row.thumbnail" />
          <span
            class="channelName"
            dir="auto"
          >{{ row.name }}</span>
        </router-link>
        <!-- The technical reasons of a missing channel don't help to decide, they stay in the copied details -->
        <p class="channelErrorReasons">
          {{ row.unavailable ? t('Channel.This channel does not exist') : row.reasons.join('\n') }}
        </p>
        <div class="channelErrorActions">
          <FtSubscribeButton
            v-if="row.unavailable"
            :channel-id="row.id"
            :channel-name="row.name"
            :channel-thumbnail="row.thumbnail"
            hide-profile-dropdown-toggle
            :open-dropdown-on-subscribe="false"
          />
          <FtButton
            v-else
            :label="t('User Playlists.SinglePlaylistView.Retry')"
            :aria-label="t('Subscriptions.Channel Errors.Retry Channel', { channel: row.name })"
            :icon="['fas', 'arrows-rotate']"
            :disabled="refreshInProgress"
            :background-color="null"
            :text-color="null"
            @click="retrySubscriptionChannels([row], t)"
          />
          <!-- For channels the user keeps on purpose, such as terminated ones that might come back -->
          <FtIconButton
            :title="t('Subscriptions.Channel Errors.Hide Channel', { channel: row.name })"
            :icon="['fas', 'eye-slash']"
            theme="base-no-default"
            :size="16"
            :padding="8"
            @click="setChannelErrorsShown(row, false)"
          />
        </div>
      </li>
    </ul>
    <FtButton
      v-if="rows.length > COLLAPSED_ROW_COUNT"
      class="channelErrorsToggle"
      :label="expanded ? t('Subscriptions.Channel Errors.Show Fewer') : t('Subscriptions.Channel Errors.Show All')"
      :icon="['fas', expanded ? 'angle-up' : 'angle-down']"
      :aria-expanded="expanded"
      variant="text"
      @click="expanded = !expanded"
    />
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onActivated, onDeactivated, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtChannelAvatar from '../FtChannelAvatar/FtChannelAvatar.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtSubscribeButton from '../FtSubscribeButton/FtSubscribeButton.vue'

import store from '../../store/index'
import {
  clearSubscriptionChannelErrors,
  registerShownSubscriptionErrorBox,
  subscriptionChannelErrors
} from '../../helpers/subscriptionRefreshErrors'
import { listsSubscriptionChannelError } from '../../helpers/subscription-channels'
import { retrySubscriptionChannels } from '../../helpers/subscriptions'
import { copyToClipboard, showToast } from '../../helpers/utils'
import { useTabContext } from '../../tabs/TabContext'

const COLLAPSED_ROW_COUNT = 3

const props = defineProps({
  /** @type {import('vue').PropType<import('../../helpers/subscriptionRefreshErrors').SubscriptionFeed[]>} */
  feeds: {
    type: Array,
    required: true
  }
})

const { t } = useI18n()
const { isTabPresented } = useTabContext()
const root = useTemplateRef('root')
const expanded = ref(false)

const refreshInProgress = computed(() => store.getters.getSubscriptionFeedRefreshInProgress)

const shownChannelsById = computed(() => {
  return new Map(store.getters.getActiveGroupSubscriptions.map(channel => [channel.id, channel]))
})

// Refreshes cover the whole profile, so only the shown channels are listed.
// Channels that do not exist anymore come first, as they need the user's action.
const rows = computed(() => {
  const rows = []
  for (const [channelId, errors] of subscriptionChannelErrors) {
    const channel = shownChannelsById.value.get(channelId)
    if (channel === undefined) continue
    const feeds = props.feeds.filter(feed => errors[feed] !== undefined && listsSubscriptionChannelError(channel, feed))
    if (feeds.length === 0) continue

    const feedErrors = feeds.map(feed => errors[feed])
    rows.push({
      id: channelId,
      name: channel.name || channelId,
      thumbnail: channel.thumbnail || null,
      feeds,
      reasons: [...new Set(feedErrors.flatMap(error => error.reasons))],
      trace: feedErrors.map(error => error.trace).join('\n'),
      unavailable: feedErrors.some(error => error.unavailable)
    })
  }
  return rows.sort((a, b) => Number(b.unavailable) - Number(a.unavailable) || a.name.localeCompare(b.name))
})

// Channels that do not exist anymore need the user's decision instead
const retryableRows = computed(() => rows.value.filter(row => !row.unavailable))

const shownRows = computed(() => expanded.value ? rows.value : rows.value.slice(0, COLLAPSED_ROW_COUNT))

function copyDetails() {
  copyToClipboard(rows.value.map(row => row.trace).join('\n'))
}

/**
 * @param {{ id: string, name: string }} row
 * @param {boolean} show
 */
async function setChannelErrorsShown({ id, name }, show) {
  const saved = await store.dispatch('updateChannelSettings', { channelId: id, settings: { showRefreshErrors: show } })
  if (!saved) {
    showToast({ message: t('Channel.Failed to save subscription settings'), icon: ['fas', 'circle-exclamation'] })
  } else if (!show) {
    showToast({
      message: t('Subscriptions.Channel Errors.Channel Hidden', { channel: name }),
      icon: ['fas', 'eye-slash'],
      action: () => setChannelErrorsShown({ id, name }, true)
    })
  }
}

function dismiss() {
  for (const row of rows.value) {
    clearSubscriptionChannelErrors(row.id, props.feeds)
  }
}

// Keep the focus in the box when the focused row or the whole box goes away
watch(() => rows.value.map(row => row.id).join(), async () => {
  if (!root.value?.contains(document.activeElement)) return
  await nextTick()
  if (document.activeElement === null || document.activeElement === document.body) {
    root.value?.focus({ preventScroll: true })
  }
})

const isActive = ref(true)
onActivated(() => { isActive.value = true })
onDeactivated(() => { isActive.value = false })

// Refreshes only point to errors the user can't see here
watch(() => isActive.value && isTabPresented?.value !== false, (shown, _, onCleanup) => {
  if (shown) {
    onCleanup(registerShownSubscriptionErrorBox((feed, channelId) => (
      props.feeds.includes(feed) && shownChannelsById.value.has(channelId)
    )))
  }
}, { immediate: true })
</script>

<style scoped src="./SubscriptionChannelErrors.css" />
