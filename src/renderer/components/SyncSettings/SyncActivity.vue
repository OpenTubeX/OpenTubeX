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
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p v-else-if="!entries.length">
      {{ t('Settings.Sync Settings.No Activity') }}
    </p>
    <ol
      v-else
      :id="activityListId"
      class="activityList"
      :class="{ activityPreview: hasHiddenEntries }"
    >
      <li
        v-for="entry in visibleEntries"
        :key="entry.id"
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
    <FtButton
      v-if="!error && hasHiddenEntries"
      class="activityLoadMore"
      :label="t('Theme Discovery.Load More')"
      :icon="['fas', 'angle-down']"
      :aria-controls="activityListId"
      :aria-expanded="false"
      @click="showAll = true"
    />
  </section>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, inject, onMounted, ref, useId } from 'vue'
import { Translation as I18nT, useI18n } from 'vue-i18n'
import store from '../../store'
import FtButton from '../FtButton/FtButton.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import { SYNC_SETTING_LABELS } from '../../helpers/sync-setting-labels'

import { settingsSearchNavigationKey } from '../../helpers/settingsSearch'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { getRelativeTimeFromDate } from '../../helpers/utils'
import { formatDateTime } from '../../helpers/dateFormat'

const navigation = inject(settingsSearchNavigationKey, null)
const relativeTimeNow = useRelativeTimeClock()
const { t, te, locale } = useI18n()
const entries = computed(() => store.getters.getSyncServerActivity)
const activityListId = useId()
const showAll = ref(false)
const hasHiddenEntries = computed(() => !showAll.value && entries.value.length > 3)
const loading = ref(false)
const error = ref('')
const collectionLabels = {
  subscriptions: 'Subscriptions.Subscriptions',
  playlists: 'Playlists',
  profiles: 'Settings.Sync Settings.Profiles',
  playlistBookmarks: 'Playlists',
}

const visibleEntries = computed(() => (showAll.value ? entries.value : entries.value.slice(0, 3)).map(entry => {
  const labelKey = entry.key ? SYNC_SETTING_LABELS[entry.key] : collectionLabels[entry.collection]
  const labels = (Array.isArray(labelKey) ? labelKey : [labelKey])
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    .filter(key => key && te(key)).map(key => t(key))
  const hasValue = entry.key && ['string', 'number', 'boolean'].includes(typeof entry.value)
  return {
    ...entry,
    setting: labels.join(' · ') || entry.key || entry.collection,
    target: entry.key ? navigation?.find(labels, entry.key) : null,
    messageKey: hasValue ? 'Settings.Sync Settings.Setting Changed' : 'Settings.Sync Settings.Item Updated',
    displayValue: typeof entry.value === 'boolean' ? (entry.value ? t('Yes') : t('No')) : String(entry.value),
  }
}))

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
