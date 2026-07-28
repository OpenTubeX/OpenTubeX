<template>
  <FtSettingsSection :title="t('Settings.Sync Settings.Sync Settings')">
    <p class="description">
      {{ t('Settings.Sync Settings.Description') }}
    </p>
    <FtFlexBox class="fields">
      <FtInput
        :placeholder="t('Settings.Sync Settings.Server URL')"
        :show-action-button="false"
        :data-list="syncServerInstances"
        :value="serverUrl"
        :disabled="connected || authenticating"
        show-label
        @input="serverUrl = $event"
        @blur="saveServerUrl"
      />
      <FtInput
        :placeholder="t('Settings.Sync Settings.Username')"
        :show-action-button="false"
        :value="username"
        :disabled="connected || serverCredentialsDisabled"
        show-label
        @input="username = $event"
      />
      <FtInput
        v-if="!connected"
        :placeholder="t('Settings.Sync Settings.Password')"
        :show-action-button="false"
        :value="password"
        :disabled="serverCredentialsDisabled"
        input-type="password"
        show-label
        @input="password = $event"
        @keydown.enter="authenticate('login')"
      />
      <FtInput
        v-if="!connected && serverPrivacySupported !== false"
        :placeholder="t('Settings.Sync Settings.Privacy Passphrase')"
        :show-action-button="false"
        :value="privacyPassphrase"
        :disabled="serverCredentialsDisabled"
        input-type="password"
        show-label
        @input="privacyPassphrase = $event"
        @keydown.enter="authenticate('login')"
      />
    </FtFlexBox>
    <p
      v-if="privacyPolicyUrl"
      class="privacyPolicy"
    >
      <a :href="privacyPolicyUrl">
        {{ t('Settings.Sync Settings.Privacy Policy') }}
      </a>
    </p>
    <p
      v-if="!connected && serverPrivacySupported !== false"
      class="privacyHint"
    >
      {{ t('Settings.Sync Settings.Privacy Passphrase Hint') }}
    </p>
    <p
      v-if="!connected && serverCheckStatus === 'checking'"
      class="serverCheckStatus"
      aria-live="polite"
    >
      {{ t('Settings.Sync Settings.Checking Server') }}
    </p>
    <p
      v-if="!connected && serverPrivacySupported === false"
      class="privacyWarning"
      role="status"
    >
      {{ t('Settings.Sync Settings.Enhanced Privacy Unsupported') }}
    </p>

    <div
      v-if="busy && syncProgress"
      class="syncProgress"
      aria-live="polite"
    >
      <div class="syncProgressLabel">
        <span>{{ syncProgressLabel }}</span>
        <span>
          {{ t('Settings.Sync Settings.Sync progress percentage', {
            percentage: syncProgress.percentage,
          }) }}
        </span>
      </div>
      <div
        class="syncProgressTrack"
        role="progressbar"
        :aria-label="syncProgressLabel"
        :aria-valuenow="syncProgress.percentage"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="syncProgressFill"
          :style="{ inlineSize: `${syncProgress.percentage}%` }"
        />
      </div>
    </div>
    <FtLoader v-else-if="busy" />
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
      <p
        v-if="privacyMode === 'enhanced'"
        class="privacyStatus"
      >
        {{ t('Settings.Sync Settings.Enhanced Privacy Enabled') }}
      </p>
      <p
        v-else-if="privacyMode === 'legacy'"
        class="privacyWarning"
        role="alert"
      >
        {{ t('Settings.Sync Settings.Enhanced Privacy Unsupported') }}
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
          :disabled="busy"
          compact
          @change="store.dispatch('updateSyncServerSyncSubscriptions', $event)"
        />
        <FtToggleSwitch
          :label="t('Playlists')"
          :default-value="syncPlaylistsEnabled"
          :disabled="busy"
          compact
          @change="store.dispatch('updateSyncServerSyncPlaylists', $event)"
        />
        <FtToggleSwitch
          :label="t('History.History')"
          :default-value="syncHistoryEnabled"
          :disabled="busy || historySupported === false"
          compact
          @change="store.dispatch('updateSyncServerSyncHistory', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.Sync Settings.Channel Playback Speeds')"
          :default-value="syncPlaybackSpeedsEnabled"
          :disabled="busy || playbackSpeedsSupported === false"
          compact
          @change="store.dispatch('updateSyncServerSyncPlaybackSpeeds', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.Sync Settings.Profiles')"
          :default-value="syncProfilesEnabled"
          :disabled="busy"
          compact
          @change="store.dispatch('updateSyncServerSyncProfiles', $event)"
        />
        <FtToggleSwitch
          v-if="sessionsSupported"
          :label="t('Settings.Sync Settings.Open Tabs')"
          :default-value="syncSessionsEnabled"
          :disabled="busy"
          compact
          @change="store.dispatch('updateSyncServerSyncSessions', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.Sync Settings.Settings')"
          :default-value="syncSettingsEnabled"
          :disabled="busy || settingsSupported === false"
          compact
          @change="store.dispatch('updateSyncServerSyncSettings', $event)"
        />
      </FtFlexBox>
      <p
        v-if="lastSyncLabel"
        class="lastSync"
      >
        {{ t('Settings.Sync Settings.Last synced', { date: lastSyncLabel }) }}
      </p>
      <p
        v-if="historySupported === false"
        class="compatibilityWarning"
      >
        {{ t('Settings.Sync Settings.History not supported') }}
      </p>
      <p
        v-if="playbackSpeedsSupported === false && settingsSupported"
        class="compatibilityWarning"
      >
        {{ t('Settings.Sync Settings.Playback speeds not supported') }}
      </p>
      <p
        v-else-if="playbackSpeedsSupported === false"
        class="compatibilityWarning"
      >
        {{ t('Settings.Sync Settings.Playback speeds and settings not supported') }}
      </p>
      <p
        v-else-if="settingsSupported === false"
        class="compatibilityWarning"
      >
        {{ t('Settings.Sync Settings.Settings not supported') }}
      </p>
      <FtFlexBox class="actions">
        <FtButton
          :label="t('Settings.Sync Settings.Sync Now')"
          :icon="['fas', 'sync']"
          :disabled="busy"
          @click="syncNow"
        />
        <FtButton
          :label="t('Settings.Sync Settings.Disconnect')"
          :icon="['fas', 'right-from-bracket']"
          :disabled="busy"
          @click="disconnect"
        />
        <FtButton
          :label="t('Settings.Sync Settings.Delete Account')"
          text-color="var(--destructive-text-color)"
          background-color="var(--destructive-color)"
          :icon="['fas', 'trash']"
          :disabled="busy"
          @click="showDeleteAccountPrompt = true"
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
        :disabled="serverCredentialsDisabled"
        @click="authenticate('login')"
      />
      <FtButton
        :label="t('Settings.Sync Settings.Register')"
        :icon="['fas', 'user-plus']"
        :disabled="serverCredentialsDisabled"
        @click="authenticate('register')"
      />
    </FtFlexBox>
    <FtPrompt
      v-if="dataLossWarning"
      :label="t('Settings.Sync Settings.Data Loss Confirmation')"
      theme="readable-width"
      @click="dataLossWarning = null"
    >
      <div class="deleteAccountContent">
        <p class="deleteAccountWarning">
          {{ t('Settings.Sync Settings.Data Loss Warning', {
            deleted: dataLossWarning.deleted,
            previous: dataLossWarning.previous,
            collection: dataLossWarning.collection,
          }) }}
        </p>
        <FtFlexBox class="actions">
          <FtButton
            :label="t('Settings.Sync Settings.Confirm Data Loss')"
            text-color="var(--destructive-text-color)"
            background-color="var(--destructive-color)"
            :icon="['fas', 'triangle-exclamation']"
            @click="confirmDataLossSync"
          />
          <FtButton
            :label="t('Cancel')"
            @click="dataLossWarning = null"
          />
        </FtFlexBox>
      </div>
    </FtPrompt>
    <FtPrompt
      v-if="showDeleteAccountPrompt"
      :label="t('Settings.Sync Settings.Delete Account Confirmation')"
      theme="readable-width"
      @click="closeDeleteAccountPrompt"
    >
      <div class="deleteAccountContent">
        <p class="deleteAccountWarning">
          {{ t('Settings.Sync Settings.Delete Account Warning') }}
        </p>
        <FtInput
          :placeholder="t('Settings.Sync Settings.Password')"
          :show-action-button="false"
          :value="deleteAccountPassword"
          input-type="password"
          show-label
          @input="deleteAccountPassword = $event"
          @keydown.enter="deleteAccount"
        />
        <p
          v-if="deleteAccountError"
          class="error"
          role="alert"
        >
          {{ deleteAccountError }}
        </p>
        <FtFlexBox class="actions">
          <FtButton
            :label="t('Settings.Sync Settings.Confirm Delete Account')"
            text-color="var(--destructive-text-color)"
            background-color="var(--destructive-color)"
            :icon="['fas', 'trash']"
            @click="deleteAccount"
          />
          <FtButton
            :label="t('Cancel')"
            @click="closeDeleteAccountPrompt"
          />
        </FtFlexBox>
      </div>
    </FtPrompt>
  </FtSettingsSection>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import {
  SyncServerClient,
  SyncServerDataLossError,
  normalizeSyncServerUrl,
} from '../../helpers/sync-server'
import { showToast } from '../../helpers/utils'

const { locale, t } = useI18n()

const OPENTUBEX_SYNC_SERVER_URL = 'https://sync.d3sox.me'
const OPENTUBEX_SYNC_SERVER_PRIVACY_POLICY_URL =
  'https://github.com/OpenTubeX/sync-server/blob/main/PRIVACY.md'
const syncServerInstances = [
  OPENTUBEX_SYNC_SERVER_URL,
  'https://sync.libretube.dev'
]

const serverUrl = ref(store.getters.getSyncServerUrl)
const username = ref(store.getters.getSyncServerUsername)
const password = ref('')
const privacyPassphrase = ref('')
const serverPrivacySupported = ref(null)
const serverCheckStatus = ref('idle')
const serverCheckError = ref('')
const localError = ref('')
const authenticating = ref(false)
const showDeleteAccountPrompt = ref(false)
const deleteAccountPassword = ref('')
const deleteAccountError = ref('')
const dataLossWarning = ref(null)

const savedUsername = computed(() => store.getters.getSyncServerUsername)
const connected = computed(() => store.getters.getSyncServerToken !== '')
const privacyPolicyUrl = computed(() => {
  try {
    return normalizeSyncServerUrl(serverUrl.value) === OPENTUBEX_SYNC_SERVER_URL
      ? OPENTUBEX_SYNC_SERVER_PRIVACY_POLICY_URL
      : null
  } catch {
    return null
  }
})
const serverCredentialsDisabled = computed(() => (
  authenticating.value ||
  (!connected.value && serverCheckStatus.value !== 'valid')
))
const status = computed(() => store.getters.getSyncServerStatus)
const busy = computed(() => status.value === 'syncing')
const syncProgress = computed(() => store.getters.getSyncServerProgress)
const syncProgressLabel = computed(() => {
  if (!syncProgress.value) return ''
  const labels = {
    download: t('Settings.Sync Settings.Downloading encrypted data'),
    subscriptions: t('Settings.Sync Settings.Syncing subscriptions'),
    playlists: t('Settings.Sync Settings.Syncing playlists'),
    history: t('Settings.Sync Settings.Syncing history'),
    playbackSpeeds: t('Settings.Sync Settings.Syncing playback speeds'),
    profiles: t('Settings.Sync Settings.Syncing profiles'),
    sessions: t('Settings.Sync Settings.Syncing open tabs'),
    settings: t('Settings.Sync Settings.Syncing settings'),
    upload: t('Settings.Sync Settings.Uploading encrypted data'),
    finishing: t('Settings.Sync Settings.Finishing sync'),
  }
  return labels[syncProgress.value.stage]
})
const errorMessage = computed(() => (
  localError.value || serverCheckError.value || store.getters.getSyncServerError
))
const autoSync = computed(() => store.getters.getSyncServerAutoSync)
const syncSubscriptionsEnabled = computed(() => store.getters.getSyncServerSyncSubscriptions)
const syncPlaylistsEnabled = computed(() => store.getters.getSyncServerSyncPlaylists)
const syncHistoryEnabled = computed(() => store.getters.getSyncServerSyncHistory)
const syncPlaybackSpeedsEnabled = computed(() => store.getters.getSyncServerSyncPlaybackSpeeds)
const syncProfilesEnabled = computed(() => store.getters.getSyncServerSyncProfiles)
const syncSessionsEnabled = computed(() => store.getters.getSyncServerSyncSessions)
const syncSettingsEnabled = computed(() => store.getters.getSyncServerSyncSettings)
const historySupported = computed(() => store.getters.getSyncServerHistorySupported)
const playbackSpeedsSupported = computed(
  () => store.getters.getSyncServerPlaybackSpeedsSupported
)
const privacyMode = computed(() => store.getters.getSyncServerPrivacyMode)
const settingsSupported = computed(() => privacyMode.value === 'enhanced')
const sessionsSupported = computed(() => (
  process.env.IS_ELECTRON && privacyMode.value === 'enhanced'
))
const lastSyncLabel = computed(() => {
  const timestamp = store.getters.getSyncServerLastSyncAt
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp)
})

let serverCheckTimer = null
let serverCheckSequence = 0

watch([serverUrl, connected], ([value]) => {
  clearTimeout(serverCheckTimer)
  const sequence = ++serverCheckSequence
  serverPrivacySupported.value = null
  serverCheckStatus.value = 'idle'
  serverCheckError.value = ''
  if (connected.value || !value.trim()) return

  serverCheckTimer = setTimeout(async () => {
    serverCheckStatus.value = 'checking'
    try {
      const capabilities = await new SyncServerClient(value).getCapabilities()
      if (sequence !== serverCheckSequence) return
      serverPrivacySupported.value = capabilities.encrypted_sync === 1
      serverCheckStatus.value = 'valid'
    } catch {
      if (sequence !== serverCheckSequence) return
      serverCheckStatus.value = 'error'
      serverCheckError.value = t('Settings.Sync Settings.Server Unavailable')
    }
  }, 400)
}, { immediate: true })

onBeforeUnmount(() => clearTimeout(serverCheckTimer))

async function saveServerUrl() {
  if (connected.value || !serverUrl.value.trim()) return

  try {
    const normalizedUrl = normalizeSyncServerUrl(serverUrl.value)
    serverUrl.value = normalizedUrl
    await store.dispatch('updateSyncServerUrl', normalizedUrl)
  } catch {
    serverCheckStatus.value = 'error'
    serverCheckError.value = t('Settings.Sync Settings.Server Unavailable')
  }
}

async function authenticate(mode) {
  if (busy.value || serverCredentialsDisabled.value) return
  localError.value = ''
  authenticating.value = true
  try {
    await store.dispatch('authenticateSyncServer', {
      mode,
      serverUrl: serverUrl.value,
      username: username.value,
      password: password.value,
      privacyPassphrase: privacyPassphrase.value,
    })
    serverUrl.value = store.getters.getSyncServerUrl
    username.value = store.getters.getSyncServerUsername
    password.value = ''
    privacyPassphrase.value = ''
    showToast({ message: t('Settings.Sync Settings.Sync completed'), icon: ['fas', 'sync'] })
  } catch (error) {
    localError.value = error.message
  } finally {
    authenticating.value = false
  }
}

async function syncNow() {
  if (busy.value) return
  localError.value = ''
  try {
    await store.dispatch('syncWithSyncServer')
    showToast({ message: t('Settings.Sync Settings.Sync completed'), icon: ['fas', 'sync'] })
  } catch (error) {
    if (error instanceof SyncServerDataLossError) {
      dataLossWarning.value = error
      return
    }
    localError.value = error.message
  }
}

async function confirmDataLossSync() {
  if (busy.value) return
  dataLossWarning.value = null
  localError.value = ''
  try {
    await store.dispatch('syncWithSyncServer', { allowDataLoss: true })
    showToast({ message: t('Settings.Sync Settings.Sync completed'), icon: ['fas', 'sync'] })
  } catch (error) {
    localError.value = error.message
  }
}

async function disconnect() {
  if (busy.value) return
  localError.value = ''
  await store.dispatch('disconnectSyncServer')
}

function setAutoSync(enabled) {
  store.dispatch('setSyncServerAutoSync', enabled)
}

function closeDeleteAccountPrompt() {
  if (busy.value) return
  showDeleteAccountPrompt.value = false
  deleteAccountPassword.value = ''
  deleteAccountError.value = ''
}

async function deleteAccount() {
  if (busy.value) return
  deleteAccountError.value = ''
  if (!deleteAccountPassword.value) {
    deleteAccountError.value = t('Settings.Sync Settings.Password Required')
    return
  }

  try {
    await store.dispatch('deleteSyncServerAccount', deleteAccountPassword.value)
    closeDeleteAccountPrompt()
    showToast({ message: t('Settings.Sync Settings.Account Deleted'), icon: ['fas', 'trash'] })
  } catch (error) {
    deleteAccountError.value = error.message
  }
}
</script>

<style scoped src="./SyncSettings.css" />
