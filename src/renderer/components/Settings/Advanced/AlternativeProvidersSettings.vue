<template>
  <FtSettingsSection
    :title="t('Settings.Categories.Alternative providers')"
  >
    <div class="switchColumnGrid switchFlowGrid">
      <FtToggleSwitch
        v-if="supportsYtDlp"
        :label="t('Settings.General Settings.Automatically switch stream extraction methods')"
        :default-value="store.getters.getPlaybackEngineFallback"
        setting-key="playbackEngineFallback"
        :compact="true"
        :tooltip="t('Tooltips.General Settings.Automatically switch stream extraction methods')"
        @change="store.dispatch('updatePlaybackEngineFallback', $event)"
      />
      <FtToggleSwitch
        v-if="SUPPORTS_LOCAL_API"
        :label="t('Settings.General Settings.Fallback to Non-Preferred Backend on Failure')"
        :default-value="backendFallback"
        setting-key="backendFallback"
        :compact="true"
        :tooltip="t('Tooltips.General Settings.Fallback to Non-Preferred Backend on Failure')"
        @change="updateBackendFallback"
      />
      <FtToggleSwitch
        v-if="SUPPORTS_LOCAL_API"
        :label="t('Settings.General Settings.Always Use Backup Media Server')"
        :default-value="store.getters.getAlwaysUseBackupMediaServer"
        setting-key="alwaysUseBackupMediaServer"
        :compact="true"
        :tooltip="t('Tooltips.General Settings.Always Use Backup Media Server')"
        @change="store.dispatch('updateAlwaysUseBackupMediaServer', $event)"
      />
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Proxy Videos Through Invidious')"
        :compact="true"
        :default-value="showProxyVideosAsDisabled ? false : proxyVideos"
        :disabled="showProxyVideosAsDisabled"
        :tooltip="t('Tooltips.Player Settings.Proxy Videos Through Invidious')"
        @change="updateProxyVideos"
      />
      <FtToggleSwitch
        v-if="backendPreference === 'yattee'"
        :label="t('Settings.General Settings.Yattee Server.Proxy Videos')"
        :compact="true"
        :default-value="yatteeProxyVideos"
        setting-key="yatteeProxyVideos"
        :tooltip="t('Tooltips.General Settings.Proxy Videos Through Yattee Server')"
        @change="updateYatteeProxyVideos"
      />
    </div>
    <div class="switchGrid generalSelectGrid">
      <FtSelect
        v-if="supportsYtDlp"
        size-to-content
        :placeholder="t('Settings.General Settings.Stream Extraction Method.Stream Extraction Method')"
        :value="videoPlaybackEngine"
        setting-key="videoPlaybackEngine"
        :select-names="playbackEngineNames"
        :select-values="PLAYBACK_ENGINE_VALUES"
        :tooltip="t('Tooltips.General Settings.Stream Extraction Method')"
        :icon="['fas', 'circle-play']"
        @change="updateVideoPlaybackEngine"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.General Settings.Preferred API Backend.Preferred API Backend')"
        :value="backendPreference"
        :select-names="backendNames"
        :select-values="BACKEND_VALUES"
        :tooltip="t('Tooltips.General Settings.Preferred API Backend')"
        :icon="['fas', 'server']"
        @change="updateBackendPreference"
      />
    </div>
    <FtFlexBox v-if="USING_ELECTRON">
      <FtSelect
        class="codecSelect"
        :placeholder="t('Settings.General Settings.Preferred Video Codec')"
        :value="store.getters.getPreferredVideoCodec"
        setting-key="preferredVideoCodec"
        :select-names="[t('Settings.Player Settings.Default Quality.Auto'), 'AV1', 'VP9', 'H.264']"
        :select-values="['auto', 'av1', 'vp9', 'h264']"
        :tooltip="t('Tooltips.General Settings.Preferred Video Codec')"
        :icon="['fas', 'file-video']"
        @change="store.dispatch('updatePreferredVideoCodec', $event)"
      />
    </FtFlexBox>
    <div v-if="usesInvidiousInstance(backendPreference, backendFallback)">
      <FtFlexBox class="settingsFlexStart460px">
        <FtInput
          :icon="['fas', 'link']"
          :label="t('Settings.General Settings.Current Invidious Instance')"
          placeholder="https://your-instance.example"
          :show-action-button="false"
          :show-label="true"
          :value="currentInvidiousInstance"
          setting-key="defaultInvidiousInstance"
          :data-list="invidiousInstancesList"
          :tooltip="t('Tooltips.General Settings.Invidious Instance')"
          @input="handleInvidiousInstanceInput"
        />
      </FtFlexBox>
      <FtFlexBox>
        <div>
          <a
            href="https://api.invidious.io"
          >
            {{ t('Settings.General Settings.View all Invidious instance information') }}
          </a>
        </div>
      </FtFlexBox>
      <p
        v-if="defaultInvidiousInstance !== ''"
        class="center"
      >
        {{ t('Settings.General Settings.The currently set default instance is {instance}', { instance: defaultInvidiousInstance }) }}
      </p>
      <template v-else>
        <p class="center">
          {{ t('Settings.General Settings.No default instance has been set') }}
        </p>
        <p class="center">
          {{ t('Settings.General Settings.Current instance will be randomized on startup') }}
        </p>
      </template>
      <FtFlexBox>
        <FtButton
          :label="t('Settings.General Settings.Set Current Instance as Default')"
          :icon="['fas', 'thumbtack']"
          @click="handleSetDefaultInstanceClick"
        />
        <FtButton
          :label="t('Settings.General Settings.Clear Default Instance')"
          :icon="['fas', 'thumbtack-slash']"
          @click="handleClearDefaultInstanceClick"
        />
      </FtFlexBox>
    </div>
    <div v-if="backendPreference === 'yattee'">
      <FtFlexBox class="settingsFlexStart460px">
        <FtInput
          :icon="['fas', 'link']"
          :label="t('Settings.General Settings.Yattee Server.Server URL')"
          placeholder="https://yattee.example"
          :show-action-button="false"
          :show-label="true"
          :value="yatteeServerUrl"
          setting-key="yatteeServerUrl"
          :tooltip="t('Tooltips.General Settings.Yattee Server')"
          @input="handleYatteeServerUrlInput"
          @keydown.enter="testYatteeConnection"
        />
      </FtFlexBox>
      <FtFlexBox>
        <FtInput
          :icon="['fas', 'circle-user']"
          :label="t('Settings.General Settings.Yattee Server.Username')"
          :show-action-button="false"
          :show-label="true"
          :value="yatteeUsername"
          setting-key="yatteeUsername"
          @input="handleYatteeUsernameInput"
          @keydown.enter="testYatteeConnection"
        />
        <FtInput
          :icon="['fas', 'lock']"
          :label="t('Settings.General Settings.Yattee Server.Password')"
          :placeholder="t('Form Inputs.Enter Password Hint')"
          :show-action-button="false"
          :show-label="true"
          :value="yatteePassword"
          input-type="password"
          setting-key="yatteePassword"
          @input="handleYatteePasswordInput"
          @keydown.enter="testYatteeConnection"
        />
      </FtFlexBox>
      <FtFlexBox>
        <FtButton
          :label="t('Settings.General Settings.Yattee Server.Test Connection')"
          :icon="['fas', 'flask']"
          :disabled="yatteeConnectionTesting"
          @click="testYatteeConnection"
        />
      </FtFlexBox>
      <p
        v-if="yatteeConnectionStatus !== ''"
        class="center"
        role="status"
      >
        {{ yatteeConnectionStatus }}
      </p>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { supportsYtDlp } from '../../../helpers/ytDlpCapabilities'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtButton from '../../FtButton/FtButton.vue'

import store from '../../../store/index'

import { debounce, randomArrayItem, showToast } from '../../../helpers/utils'
import { usesInvidiousInstance } from '../../../../apiBackends'
import { checkYatteeServer, createYatteeAuthorization, normalizeYatteeServerUrl } from '../../../helpers/api/yattee'
import { capacitorHttpFetch } from '../../../helpers/api/capacitor-http'

const USING_ELECTRON = !!process.env.IS_ELECTRON
const IS_IOS = !!process.env.IS_IOS
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API
const PLAYBACK_ENGINE_VALUES = ['built-in', 'yt-dlp']

const { t } = useI18n()

const playbackEngineNames = computed(() => [
  t('Settings.General Settings.Stream Extraction Method.Built-in'),
  t('Settings.General Settings.Stream Extraction Method.yt-dlp')
])

/** @type {import('vue').ComputedRef<'yt-dlp' | 'built-in'>} */
const videoPlaybackEngine = computed(() => store.getters.getVideoPlaybackEngine)

/**
 * @param {'yt-dlp' | 'built-in'} value
 */
function updateVideoPlaybackEngine(value) {
  store.dispatch('updateVideoPlaybackEngine', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/**
 * @param {boolean} value
 */
function updateBackendFallback(value) {
  store.dispatch('updateBackendFallback', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const proxyVideos = computed(() => store.getters.getProxyVideos)

/**
 * @param {boolean} value
 */
function updateProxyVideos(value) {
  store.dispatch('updateProxyVideos', value)
}

const BACKEND_VALUES = process.env.SUPPORTS_LOCAL_API
  ? ['invidious', 'yattee', 'local']
  : ['invidious', 'yattee']

const backendNames = computed(() => {
  const names = [
    t('Settings.General Settings.Preferred API Backend.Invidious API'),
    t('Settings.General Settings.Preferred API Backend.Yattee Server')
  ]

  if (process.env.SUPPORTS_LOCAL_API) {
    names.push(t('Settings.General Settings.Preferred API Backend.Local API'))
  }

  return names
})

/** @type {import('vue').ComputedRef<'local' | 'invidious' | 'yattee'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

const showProxyVideosAsDisabled = computed(() => {
  return !usesInvidiousInstance(backendPreference.value, backendFallback.value)
})

/**
 * @param {'local' | 'invidious' | 'yattee'} value
 */
function updateBackendPreference(value) {
  store.dispatch('updateBackendPreference', value)
}

// The connection test uses what was typed, even if the settings haven't been saved yet
const yatteeServerUrl = ref(store.getters.getYatteeServerUrl)
const yatteeUsername = ref(store.getters.getYatteeUsername)
const yatteePassword = ref(store.getters.getYatteePassword)
watch(() => store.getters.getYatteeServerUrl, value => { yatteeServerUrl.value = value })
watch(() => store.getters.getYatteeUsername, value => { yatteeUsername.value = value })
watch(() => store.getters.getYatteePassword, value => { yatteePassword.value = value })
const yatteeProxyVideos = computed(() => store.getters.getYatteeProxyVideos)

const yatteeConnectionTesting = ref(false)
const yatteeConnectionStatus = ref('')

/**
 * @param {string} value
 */
function handleYatteeServerUrlInput(value) {
  yatteeServerUrl.value = value.trim()
  yatteeConnectionStatus.value = ''
  store.dispatch('updateYatteeServerUrl', yatteeServerUrl.value)
}

/**
 * @param {string} value
 */
function handleYatteeUsernameInput(value) {
  yatteeUsername.value = value
  yatteeConnectionStatus.value = ''
  store.dispatch('updateYatteeUsername', value)
}

/**
 * @param {string} value
 */
function handleYatteePasswordInput(value) {
  yatteePassword.value = value
  yatteeConnectionStatus.value = ''
  store.dispatch('updateYatteePassword', value)
}

/**
 * @param {boolean} value
 */
function updateYatteeProxyVideos(value) {
  store.dispatch('updateYatteeProxyVideos', value)
}

async function testYatteeConnection() {
  if (yatteeConnectionTesting.value) return

  yatteeConnectionTesting.value = true
  yatteeConnectionStatus.value = t('Settings.General Settings.Yattee Server.Testing')

  try {
    const result = await checkYatteeServer(
      normalizeYatteeServerUrl(yatteeServerUrl.value),
      createYatteeAuthorization(yatteeUsername.value, yatteePassword.value),
      // Like the API requests, the check uses native HTTP on mobile, but the player uses the WebView
      IS_CAPACITOR
        ? { fetch: (url, init) => capacitorHttpFetch(url, { ...init, allowHttp: true }), mediaFetch: fetch, requireHttps: !IS_IOS }
        : undefined
    )

    yatteeConnectionStatus.value = result.ok
      ? t('Settings.General Settings.Yattee Server.Connected', { version: result.version ?? '' }).trim()
      : getYatteeConnectionErrorMessage(result)
  } finally {
    yatteeConnectionTesting.value = false
  }
}

/**
 * @param {{ error: import('../../../helpers/api/yattee').YatteeConnectionError, status?: number }} result
 */
function getYatteeConnectionErrorMessage({ error, status }) {
  switch (error) {
    case 'invalid-url':
      return t('Settings.General Settings.Yattee Server.Errors.Invalid URL')
    case 'unreachable':
      return t('Settings.General Settings.Yattee Server.Errors.Unreachable')
    case 'cors':
      return t('Settings.General Settings.Yattee Server.Errors.Media not allowed', { origins: 'https://localhost,capacitor://localhost' })
    case 'https-required':
      return t('Yattee Server.Errors.HTTPS required')
    case 'not-yattee':
      return t('Settings.General Settings.Yattee Server.Errors.Not a Yattee server')
    case 'credentials-required':
      return t('Settings.General Settings.Yattee Server.Errors.Credentials required')
    case 'invalid-credentials':
      return t('Settings.General Settings.Yattee Server.Errors.Invalid credentials')
    case 'rate-limited':
      return t('Settings.General Settings.Yattee Server.Errors.Rate limited')
    default:
      return t('Settings.General Settings.Yattee Server.Errors.Server error', { status })
  }
}

/** @type {import('vue').ComputedRef<string[]>} */
const invidiousInstancesList = computed(() => store.getters.getInvidiousInstancesList)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstance = computed(() => store.getters.getCurrentInvidiousInstance)

onBeforeUnmount(() => {
  if (currentInvidiousInstance.value === '') {
    // FIXME: If we call an action from here, there's no guarantee it will finish
    // before the component is destroyed, which could bring up some problems
    // Since I can't see any way to await it (because lifecycle hooks must be
    // synchronous), unfortunately, we have to copy/paste the logic
    // from the `setRandomCurrentInvidiousInstance` action onto here
    // Fix when we migrate to Pinia
    const instanceList = invidiousInstancesList.value
    store.commit('setCurrentInvidiousInstance', randomArrayItem(instanceList))
  }
})

const setCurrentInvidiousInstanceBounce = debounce((/** @type {string} */instance) => {
  store.commit('setCurrentInvidiousInstance', instance)
}, 500)

/**
 * @param {string} input
 */
function handleInvidiousInstanceInput(input) {
  let instance = input
  // If NOT something like https:// (1-2 slashes), remove trailing slash
  if (!/^https?:\/{1,2}$/.test(input)) {
    instance = input.replace(/\/$/, '')
  }

  setCurrentInvidiousInstanceBounce(instance)
}

/** @type {import('vue').ComputedRef<string>} */
const defaultInvidiousInstance = computed(() => store.getters.getDefaultInvidiousInstance)

function handleSetDefaultInstanceClick() {
  const instance = currentInvidiousInstance.value
  store.dispatch('updateDefaultInvidiousInstance', instance)

  const message = t('Default Invidious instance has been set to {instance}', { instance })
  showToast({ message: message, icon: ['fas', 'check'] })
}

function handleClearDefaultInstanceClick() {
  store.dispatch('updateDefaultInvidiousInstance', '')
  showToast({ message: t('Default Invidious instance has been cleared'), icon: ['fas', 'trash'] })
}
</script>

<style scoped src="../generalSelectGrid.css" />
<style scoped>
.codecSelect {
  inline-size: min(100%, 360px);
}
</style>
