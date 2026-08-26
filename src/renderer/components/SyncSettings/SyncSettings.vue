<template>
  <FtSettingsSection :title="t('Settings.Sync Settings.Sync Settings')">
    <p class="description">
      {{ t('Settings.Sync Settings.Description') }}
    </p>
    <FtFlexBox class="toggles">
      <FtToggleSwitch
        :label="t('Settings.Sync Settings.Enable Sync')"
        :default-value="syncEnabled"
        compact
        @change="setSyncEnabled"
      />
    </FtFlexBox>
    <template v-if="syncEnabled">
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
          :value="connected ? savedUsername : username"
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
          v-if="settingsSupported === false"
          class="compatibilityWarning"
        >
          {{ t('Settings.Sync Settings.Settings not supported') }}
        </p>
        <FtFlexBox class="actions">
          <SyncPairing
            :connected="connected"
            :supported="pairingSupported"
            :disabled="busy || privacyMode !== 'enhanced' || !privacyKey || !privacySalt"
            :server-url="serverUrl"
            :username="savedUsername"
            :privacy-key="privacyKey"
            :privacy-salt="privacySalt"
            @paired="pairingCompleted"
          />
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
            theme="destructive"
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
        <SyncPairing
          :connected="connected"
          :supported="pairingSupported"
          :disabled="pairingActionDisabled"
          :server-url="serverUrl"
          :username="username"
          @paired="pairingCompleted"
        />
        <FtButton
          :label="t('Settings.Sync Settings.Log In')"
          :icon="['fas', 'right-to-bracket']"
          :disabled="authenticationActionsDisabled"
          @click="authenticate('login')"
        />
        <FtButton
          :label="t('Settings.Sync Settings.Register')"
          :icon="['fas', 'user-plus']"
          :disabled="authenticationActionsDisabled"
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
              theme="destructive"
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
              theme="destructive"
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
    </template>
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
import SyncPairing from './SyncPairing.vue'

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
const serverPairingSupported = ref(false)
const serverCheckStatus = ref('idle')
const serverCheckError = ref('')
const localError = ref('')
const authenticating = ref(false)
const showDeleteAccountPrompt = ref(false)
const deleteAccountPassword = ref('')
const deleteAccountError = ref('')
const dataLossWarning = ref(null)

const savedUsername = computed(() => store.getters.getSyncServerUsername)
const syncEnabled = computed(() => store.getters.getSyncServerEnabled)
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
const accountCredentialsReady = computed(() => (
  username.value.trim() !== '' && password.value !== ''
))
const pairingActionDisabled = computed(() => (
  serverCredentialsDisabled.value
))
const authenticationActionsDisabled = computed(() => (
  serverCredentialsDisabled.value ||
  !accountCredentialsReady.value ||
  (serverPrivacySupported.value === true && privacyPassphrase.value === '')
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
const syncProfilesEnabled = computed(() => store.getters.getSyncServerSyncProfiles)
const syncSessionsEnabled = computed(() => store.getters.getSyncServerSyncSessions)
const syncSettingsEnabled = computed(() => store.getters.getSyncServerSyncSettings)
const historySupported = computed(() => store.getters.getSyncServerHistorySupported)
const privacyMode = computed(() => store.getters.getSyncServerPrivacyMode)
const privacyKey = computed(() => store.getters.getSyncServerPrivacyKey)
const privacySalt = computed(() => store.getters.getSyncServerPrivacySalt)
const pairingSupported = computed(() => {
  try {
    return serverPairingSupported.value && normalizeSyncServerUrl(serverUrl.value).startsWith('https://')
  } catch {
    return false
  }
})
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
let serverCheckClient = null

watch([serverUrl, connected, syncEnabled], ([value, isConnected, isEnabled], [previousValue, wasConnected] = []) => {
  clearTimeout(serverCheckTimer)
  serverCheckClient?.cancel()
  serverCheckClient = null
  const sequence = ++serverCheckSequence
  const disconnected = wasConnected && !isConnected && value === previousValue
  serverPrivacySupported.value = null
  serverPairingSupported.value = false
  serverCheckStatus.value = disconnected ? 'valid' : 'idle'
  serverCheckError.value = ''
  if (!isEnabled || !value.trim()) return

  serverCheckTimer = setTimeout(async () => {
    if (!disconnected && !isConnected) serverCheckStatus.value = 'checking'
    const client = new SyncServerClient(
      value,
      isConnected ? store.getters.getSyncServerToken : ''
    )
    serverCheckClient = client
    try {
      const capabilities = await client.getCapabilities()
      if (sequence !== serverCheckSequence) return
      serverPrivacySupported.value = capabilities.encrypted_sync === 1
      serverPairingSupported.value = capabilities.key_pairing === 1
      serverCheckStatus.value = 'valid'
    } catch {
      if (sequence !== serverCheckSequence) return
      if (isConnected) return
      serverCheckStatus.value = 'error'
      serverCheckError.value = t('Settings.Sync Settings.Server Unavailable')
    } finally {
      if (serverCheckClient === client) serverCheckClient = null
    }
  }, 400)
}, { immediate: true })

onBeforeUnmount(() => {
  clearTimeout(serverCheckTimer)
  serverCheckClient?.cancel()
})

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
  if (busy.value || authenticationActionsDisabled.value) return
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
    const result = await store.dispatch('syncWithSyncServer')
    if (result !== null) {
      showToast({ message: t('Settings.Sync Settings.Sync completed'), icon: ['fas', 'sync'] })
    }
  } catch (error) {
    if (error instanceof SyncServerDataLossError) {
      dataLossWarning.value = error
      return
    }
    localError.value = error.message
  }
}

function pairingCompleted(result) {
  serverUrl.value = store.getters.getSyncServerUrl
  username.value = store.getters.getSyncServerUsername
  password.value = ''
  privacyPassphrase.value = ''
  const message = result === 'approved'
    ? t('Settings.Sync Settings.Pairing Approved')
    : t('Settings.Sync Settings.Pairing Completed')
  showToast({
    message,
    icon: ['fas', 'key'],
  })
}

async function confirmDataLossSync() {
  if (busy.value) return
  dataLossWarning.value = null
  localError.value = ''
  try {
    const result = await store.dispatch('syncWithSyncServer', { allowDataLoss: true })
    if (result !== null) {
      showToast({ message: t('Settings.Sync Settings.Sync completed'), icon: ['fas', 'sync'] })
    }
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

function setSyncEnabled(enabled) {
  localError.value = ''
  store.dispatch('setSyncServerEnabled', enabled)
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
