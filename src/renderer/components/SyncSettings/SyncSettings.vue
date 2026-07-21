<template>
  <FtSettingsSection :title="t('Settings.Sync Settings.Sync Settings')">
    <p class="description">
      {{ t('Settings.Sync Settings.Description') }}
    </p>
    <FtFlexBox class="fields">
      <FtInput
        :placeholder="t('Settings.Sync Settings.Server URL')"
        :show-action-button="false"
        :value="serverUrl"
        :disabled="connected"
        show-label
        @input="serverUrl = $event"
      />
      <FtInput
        :placeholder="t('Settings.Sync Settings.Username')"
        :show-action-button="false"
        :value="username"
        :disabled="connected"
        show-label
        @input="username = $event"
      />
      <FtInput
        v-if="!connected"
        :placeholder="t('Settings.Sync Settings.Password')"
        :show-action-button="false"
        :value="password"
        input-type="password"
        show-label
        @input="password = $event"
        @keydown.enter="authenticate('login')"
      />
    </FtFlexBox>

    <FtLoader v-if="busy" />
    <p
      v-if="errorMessage"
      class="error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <template v-if="connected">
      <p class="connectionStatus">
        {{ t('Settings.Sync Settings.Connected as', { username: savedUsername }) }}
      </p>
      <FtFlexBox class="toggles">
        <FtToggleSwitch
          :label="t('Settings.Sync Settings.Automatic Sync')"
          :default-value="autoSync"
          compact
          @change="setAutoSync"
        />
        <FtToggleSwitch
          :label="t('Subscriptions.Subscriptions')"
          :default-value="syncSubscriptionsEnabled"
          compact
          @change="store.dispatch('updateSyncServerSyncSubscriptions', $event)"
        />
        <FtToggleSwitch
          :label="t('Playlists')"
          :default-value="syncPlaylistsEnabled"
          compact
          @change="store.dispatch('updateSyncServerSyncPlaylists', $event)"
        />
        <FtToggleSwitch
          :label="t('History.History')"
          :default-value="syncHistoryEnabled"
          compact
          @change="store.dispatch('updateSyncServerSyncHistory', $event)"
        />
      </FtFlexBox>
      <p
        v-if="lastSyncLabel"
        class="lastSync"
      >
        {{ t('Settings.Sync Settings.Last synced', { date: lastSyncLabel }) }}
      </p>
      <p
        v-if="historySupported === false && syncHistoryEnabled"
        class="compatibilityWarning"
      >
        {{ t('Settings.Sync Settings.History not supported') }}
      </p>
      <FtFlexBox class="actions">
        <FtButton
          :label="t('Settings.Sync Settings.Sync Now')"
          :icon="['fas', 'sync']"
          @click="syncNow"
        />
        <FtButton
          :label="t('Settings.Sync Settings.Disconnect')"
          :icon="['fas', 'right-from-bracket']"
          @click="disconnect"
        />
      </FtFlexBox>
    </template>
    <FtFlexBox
      v-else-if="!busy"
      class="actions"
    >
      <FtButton
        :label="t('Settings.Sync Settings.Log In')"
        :icon="['fas', 'right-to-bracket']"
        @click="authenticate('login')"
      />
      <FtButton
        :label="t('Settings.Sync Settings.Register')"
        :icon="['fas', 'user-plus']"
        @click="authenticate('register')"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import { showToast } from '../../helpers/utils'

const { locale, t } = useI18n()

const serverUrl = ref(store.getters.getSyncServerUrl)
const username = ref(store.getters.getSyncServerUsername)
const password = ref('')
const localError = ref('')

const savedUsername = computed(() => store.getters.getSyncServerUsername)
const connected = computed(() => store.getters.getSyncServerToken !== '')
const status = computed(() => store.getters.getSyncServerStatus)
const busy = computed(() => status.value === 'syncing')
const errorMessage = computed(() => localError.value || store.getters.getSyncServerError)
const autoSync = computed(() => store.getters.getSyncServerAutoSync)
const syncSubscriptionsEnabled = computed(() => store.getters.getSyncServerSyncSubscriptions)
const syncPlaylistsEnabled = computed(() => store.getters.getSyncServerSyncPlaylists)
const syncHistoryEnabled = computed(() => store.getters.getSyncServerSyncHistory)
const historySupported = computed(() => store.getters.getSyncServerHistorySupported)
const lastSyncLabel = computed(() => {
  const timestamp = store.getters.getSyncServerLastSyncAt
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp)
})

async function authenticate(mode) {
  if (busy.value) return
  localError.value = ''
  try {
    await store.dispatch('authenticateSyncServer', {
      mode,
      serverUrl: serverUrl.value,
      username: username.value,
      password: password.value,
    })
    serverUrl.value = store.getters.getSyncServerUrl
    username.value = store.getters.getSyncServerUsername
    password.value = ''
    showToast(t('Settings.Sync Settings.Sync completed'))
  } catch (error) {
    localError.value = error.message
  }
}

async function syncNow() {
  if (busy.value) return
  localError.value = ''
  try {
    await store.dispatch('syncWithSyncServer')
    showToast(t('Settings.Sync Settings.Sync completed'))
  } catch (error) {
    localError.value = error.message
  }
}

async function disconnect() {
  if (busy.value) return
  await store.dispatch('disconnectSyncServer')
}

function setAutoSync(enabled) {
  store.dispatch('setSyncServerAutoSync', enabled)
}
</script>

<style scoped src="./SyncSettings.css" />
