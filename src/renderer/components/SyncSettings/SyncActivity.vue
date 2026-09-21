<template>
  <section class="syncActivity">
    <div class="activityHeader">
      <h3>{{ t('Settings.Sync Settings.Activity') }}</h3>
      <FtIconButton
        :title="t('Settings.Sync Settings.Sync Now')"
        :icon="['fas', 'sync']"
        :disabled="loading"
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
      class="activityList"
    >
      <li
        v-for="entry in entries.slice(0, visibleCount)"
        :key="entry.id"
      >
        <p>{{ describe(entry) }}</p>
        <time :datetime="new Date(entry.createdAt).toISOString()">
          {{ new Date(entry.createdAt).toLocaleString(locale) }}
        </time>
      </li>
    </ol>
    <FtButton
      v-if="entries.length > visibleCount"
      :label="t('Theme Discovery.Load More')"
      :icon="['fas', 'angle-down']"
      @click="visibleCount += 20"
    />
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import store from '../../store'
import FtButton from '../FtButton/FtButton.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import { SYNC_SETTING_LABELS } from '../../helpers/sync-setting-labels'

const { t, te, locale } = useI18n()
const entries = computed(() => store.getters.getSyncServerActivity)
const visibleCount = ref(20)
const loading = ref(false)
const error = ref('')
const collectionLabels = {
  subscriptions: 'Subscriptions.Subscriptions',
  playlists: 'Playlists',
  profiles: 'Settings.Sync Settings.Profiles',
  playlistBookmarks: 'Playlists',
}

function describe(entry) {
  const labelKey = entry.key ? SYNC_SETTING_LABELS[entry.key] : collectionLabels[entry.collection]
  // The registry contains the existing setting controls' translation keys.

  const setting = (Array.isArray(labelKey) ? labelKey : [labelKey])
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    .filter(key => key && te(key)).map(key => t(key)).join(' · ') || entry.key || entry.collection
  if (entry.key && ['string', 'number', 'boolean'].includes(typeof entry.value)) {
    const value = typeof entry.value === 'boolean' ? (entry.value ? t('Yes') : t('No')) : String(entry.value)
    return t('Settings.Sync Settings.Setting Changed', { device: entry.deviceName, setting, value })
  }
  return t('Settings.Sync Settings.Item Updated', { device: entry.deviceName, setting })
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
