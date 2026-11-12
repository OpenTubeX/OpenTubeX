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
        <FtSubscribeButton
          v-if="row.unavailable"
          class="channelErrorAction"
          :channel-id="row.id"
          :channel-name="row.name"
          :channel-thumbnail="row.thumbnail"
          hide-profile-dropdown-toggle
          :open-dropdown-on-subscribe="false"
        />
        <FtButton
          v-else
          class="channelErrorAction"
          :label="t('User Playlists.SinglePlaylistView.Retry')"
          :aria-label="t('Subscriptions.Channel Errors.Retry Channel', { channel: row.name })"
          :icon="['fas', 'sync']"
          :disabled="refreshInProgress"
          :background-color="null"
          :text-color="null"
          @click="retrySubscriptionChannel(row.id, row.feeds, t)"
        />
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
import { retrySubscriptionChannel } from '../../helpers/subscriptions'
import { copyToClipboard } from '../../helpers/utils'
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
    const feeds = props.feeds.filter(feed => errors[feed] !== undefined)
    if (channel === undefined || feeds.length === 0) continue

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

const shownRows = computed(() => expanded.value ? rows.value : rows.value.slice(0, COLLAPSED_ROW_COUNT))

function copyDetails() {
  copyToClipboard(rows.value.map(row => row.trace).join('\n'))
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
    onCleanup(registerShownSubscriptionErrorBox(() => props.feeds))
  }
}, { immediate: true })
</script>

<style scoped src="./SubscriptionChannelErrors.css" />
