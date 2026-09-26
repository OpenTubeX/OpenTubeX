<template>
  <section class="syncActivity">
    <div class="activityHeader">
      <div class="activityTitle">
        <span
          class="activityIcon"
          aria-hidden="true"
        >
          <FtIcon :icon="['fas', 'history']" />
        </span>
        <h3>{{ t('Settings.Sync Settings.Activity') }}</h3>
      </div>
      <FtIconButton
        class="activityAction"
        :title="t('Theme Discovery.Refresh')"
        :icon="['fas', 'sync']"
        :disabled="loading"
        :use-shadow="false"
        :padding="11"
        :size="20"
        theme="base-no-default"
        @click="refresh"
      />
    </div>
    <FtLoader v-if="loading" />
    <p
      v-if="!loading && error"
      role="alert"
    >
      {{ error }}
    </p>
    <p v-if="!loading && !error && !entries.length">
      {{ t('Settings.Sync Settings.No Activity') }}
    </p>
    <ol
      v-if="!loading && entries.length"
      :id="activityListId"
      ref="activityList"
      class="activityList"
      :class="{ activityPreview: hasHiddenEntries }"
    >
      <li
        v-for="entry in visibleEntries"
        :key="entry.id"
        tabindex="-1"
      >
        <I18nT
          :keypath="entry.messageKey"
          tag="p"
          scope="global"
        >
          <template #device>
            {{ entry.deviceName }}
          </template>
          <template #setting>
            <button
              v-if="entry.target"
              type="button"
              class="activitySetting"
              @click="navigation.open(entry.target)"
            >
              {{ entry.setting }}
            </button>
            <span v-else>{{ entry.setting }}</span>
          </template>
          <template #item>
            {{ entry.item }}
          </template>
          <template #value>
            {{ entry.displayValue }}
          </template>
        </I18nT>
        <time
          :datetime="new Date(entry.createdAt).toISOString()"
          :title="dateLabel(entry.createdAt)"
        >
          {{ getRelativeTimeFromDate(entry.createdAt, true, true, relativeTimeNow) }}
        </time>
      </li>
    </ol>
    <button
      v-if="!loading && entries.length > 3"
      type="button"
      class="activityDisclosure"
      :aria-controls="activityListId"
      :aria-expanded="showAll"
      @click="toggleActivity"
    >
      <span>{{ showAll ? t('Description.Collapse Description') : t('Settings.Sync Settings.Show More') }}</span>
      <FtIcon
        :icon="['fas', showAll ? 'angle-up' : 'angle-down']"
        aria-hidden="true"
      />
    </button>
  </section>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, inject, nextTick, onMounted, ref, useId, useTemplateRef } from 'vue'
import { Translation as I18nT, useI18n } from 'vue-i18n'
import store from '../../store'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import { SYNC_SETTING_LABELS, SYNC_SETTING_VALUE_LABELS } from '../../helpers/sync-setting-labels'

import { settingsSearchNavigationKey } from '../../helpers/settingsSearch'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { getRelativeTimeFromDate } from '../../helpers/utils'
import { formatDateTime } from '../../helpers/dateFormat'

const navigation = inject(settingsSearchNavigationKey, null)
const relativeTimeNow = useRelativeTimeClock()
const { t, te, locale } = useI18n()
const entries = computed(() => store.getters.getSyncServerActivity)
const activityListId = useId()
const activityList = useTemplateRef('activityList')
const showAll = ref(false)
const hasHiddenEntries = computed(() => !showAll.value && entries.value.length > 3)
const loading = ref(true)
const error = ref('')
const collectionLabels = {
  subscriptions: 'Subscriptions.Subscriptions',
  playlists: 'Playlists',
  profiles: 'Settings.Sync Settings.Profiles',
  playlistBookmarks: 'Settings.Sync Settings.Saved Playlists',
  settings: 'Settings.Settings',
}
const detailLabels = {
  feedTypes: 'Channel.Show in subscription feed',
  dailyVideoLimit: 'Channel.Videos per day',
  showMembersOnly: 'Search Listing.Label.Members Only',
}
const feedTypeLabels = {
  videos: 'Global.Videos', shorts: 'Global.Shorts', live: 'Global.Live', posts: 'Global.Posts',
}

function displayIntlName(value, type) {
  try {
    return new Intl.DisplayNames(locale.value, { type }).of(value) || value
  } catch {
    return value
  }
}

function displayActivityValue(entry) {
  if (entry.detail === 'feedTypes') {
    return typeof entry.value === 'string' && entry.value
      // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
      ? entry.value.split(',').map(type => feedTypeLabels[type] ? t(feedTypeLabels[type]) : type).join(', ')
      : t('Settings.Sync Settings.No Feed Types')
  }
  if (entry.detail === 'dailyVideoLimit') {
    if (entry.value === 'global') return t('Channel.Use global setting')
    if (entry.value === 'unlimited') return t('Channel.Unlimited')
  }
  if (entry.key === 'defaultCaptionSettings') {
    if (['Background Opacity', 'Vertical Position', 'Font Size'].includes(entry.detail) &&
        typeof entry.value === 'number') return `${Math.round(entry.value * 100)}%`
    if (entry.detail === 'Edge Style.Edge Style') {
      const name = { none: 'None', outline: 'Outline', dropShadow: 'Drop Shadow' }[entry.value]
      // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
      if (name) return t(`Settings.Player Settings.Caption Appearance.Edge Style.${name}`)
    }
    if (entry.detail === 'Anchor.Anchor' && typeof entry.value === 'string') {
      if (/^(top|bottom)-(left|center|right)$/.test(entry.value)) {
        const name = entry.value.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ')
        const key = `Settings.Player Settings.Caption Appearance.Anchor.${name}`
        // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
        if (te(key)) return t(key)
      }
    }
  }
  if (typeof entry.value === 'string') {
    const valueKey = SYNC_SETTING_VALUE_LABELS[entry.key]?.[entry.value]
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    if (valueKey && te(valueKey)) return t(valueKey)
    if (entry.key === 'statsWeekStartsOn' && /^[0-6]$/.test(entry.value)) {
      return new Intl.DateTimeFormat(locale.value, { weekday: 'long', timeZone: 'UTC' })
        .format(new Date(Date.UTC(2023, 0, Number(entry.value) + 1)))
    }
    if (['subscriptionFeedAutoRefreshInterval', 'subscriptionShortsAutoRefreshInterval',
      'subscriptionLiveAutoRefreshInterval', 'subscriptionPostsAutoRefreshInterval'].includes(entry.key)) {
      if (entry.value === '0') return t('Settings.General Settings.Avoid translation.Disabled')
      const minutes = Number(entry.value) / 60000
      if ([30, 60, 120, 240, 360, 480].includes(minutes)) {
        return new Intl.NumberFormat(locale.value, { style: 'unit', unit: minutes === 30 ? 'minute' : 'hour', unitDisplay: 'short' })
          .format(minutes === 30 ? minutes : minutes / 60)
      }
    }
    if (entry.key === 'screenshotFormat') return { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' }[entry.value] || entry.value
    if (entry.key === 'currentLocale' && entry.value) {
      return displayIntlName(entry.value, 'language')
    }
    if (entry.key === 'region' && entry.value) {
      return displayIntlName(entry.value, 'region')
    }
    if (['baseTheme', 'systemLightTheme', 'systemDarkTheme'].includes(entry.key) && entry.value.startsWith('custom:')) {
      return store.getters.getCustomThemes.find(theme => `custom:${theme.id}` === entry.value)?.name ||
        t('Settings.Theme Settings.Base Theme.Custom')
    }
  }
  return typeof entry.value === 'boolean' ? (entry.value ? t('Yes') : t('No')) : String(entry.value)
}

const visibleEntries = computed(() => (showAll.value ? entries.value : entries.value.slice(0, 3)).map(entry => {
  const labelKey = entry.key ? SYNC_SETTING_LABELS[entry.key] : collectionLabels[entry.collection]
  const labels = (Array.isArray(labelKey) ? labelKey : [labelKey])
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    .filter(key => key && te(key)).map(key => t(key))
  const target = entry.key ? navigation?.find(labels, entry.key) : null
  const detailKey = entry.key === 'subscriptionChannelSettings'
    ? detailLabels[entry.detail]
    : entry.key === 'defaultCaptionSettings' && entry.detail
      ? `Settings.Player Settings.Caption Appearance.${entry.detail}`
      : null
  if (entry.item && entry.key && (entry.key !== 'customThemes' || entry.action === 'updated')) labels.push(entry.item)
  // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
  if (detailKey && te(detailKey)) labels.push(t(detailKey))
  const hasValue = entry.key && ['string', 'number', 'boolean'].includes(typeof entry.value)
  const messageKey = entry.action === 'added'
    ? 'Settings.Sync Settings.Item Added'
    : entry.action === 'removed'
      ? 'Settings.Sync Settings.Item Removed'
      : entry.action === 'renamed'
        ? 'Settings.Sync Settings.Item Renamed'
        : hasValue ? 'Settings.Sync Settings.Setting Changed' : 'Settings.Sync Settings.Item Updated'
  const setting = entry.parent || [labels.join(' · '),
    entry.action === 'updated' && !entry.key ? entry.item : null].filter(Boolean).join(' · ')
  return {
    ...entry,
    setting: setting || entry.key || entry.collection,
    target,
    messageKey,
    displayValue: displayActivityValue(entry),
  }
}))

async function expandActivity() {
  showAll.value = true
  await nextTick()
  activityList.value?.children[3]?.focus()
}

async function toggleActivity() {
  if (showAll.value) {
    showAll.value = false
  } else {
    await expandActivity()
  }
}

function dateLabel(timestamp) {
  return formatDateTime(timestamp, locale.value, store.getters.getDateFormat,
    { dateStyle: 'medium' }, { timeStyle: 'medium' }, store.getters.getTimeFormat)
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    await store.dispatch('refreshSyncServerEvents')
  } catch (failure) {
    error.value = failure.message
  } finally {
    loading.value = false
  }
}
onMounted(refresh)
</script>

<style scoped src="./SyncActivity.css" />
