<template>
  <section
    class="accountManagement"
    :aria-labelledby="headingId"
  >
    <div class="managementHeader">
      <div class="managementTitle">
        <span
          class="managementIcon"
          aria-hidden="true"
        >
          <FtIcon :icon="['fas', 'display']" />
        </span>
        <div>
          <h3 :id="headingId">
            {{ t('Settings.Sync Settings.Devices') }}
          </h3>
          <p>{{ t('Settings.Sync Settings.Devices Hint') }}</p>
        </div>
      </div>
      <FtIconButton
        class="managementAction"
        :title="t('Settings.Sync Settings.Refresh Devices')"
        :icon="['fas', 'sync']"
        :disabled="loading || actionBusy"
        :use-shadow="false"
        :padding="11"
        :size="20"
        theme="base-no-default"
        @click="loadSessions"
      />
    </div>

    <FtLoader v-if="loading" />
    <p
      v-else-if="error"
      class="managementError"
      role="alert"
    >
      {{ error }}
    </p>
    <ul
      v-else
      class="sessionList"
    >
      <li
        v-for="session in sessions"
        :key="session.id"
        class="sessionCard"
        :class="{ currentSession: session.current }"
      >
        <span
          class="sessionDeviceIcon"
          aria-hidden="true"
        >
          <FtIcon :icon="deviceIcon(session.deviceInfo.platform)" />
        </span>
        <div class="sessionContent">
          <div class="sessionSummary">
            <h4>{{ session.deviceInfo.name }}</h4>
            <span
              v-if="session.current"
              class="currentBadge"
            >
              {{ t('Settings.Sync Settings.Current Device') }}
            </span>
          </div>
          <dl class="sessionDetails">
            <div v-if="systemLabel(session.deviceInfo)">
              <dt>
                <FtIcon
                  :icon="['fas', 'display']"
                  aria-hidden="true"
                />
                {{ t('Settings.Sync Settings.Operating System') }}
              </dt>
              <dd>{{ systemLabel(session.deviceInfo) }}</dd>
            </div>
            <div>
              <dt>
                <FtIcon
                  :icon="['fas', 'calendar-days']"
                  aria-hidden="true"
                />
                {{ t('Settings.Sync Settings.Session Created') }}
              </dt>
              <dd><time :datetime="isoDate(session.created_at)">{{ dateLabel(session.created_at) }}</time></dd>
            </div>
            <div>
              <dt>
                <FtIcon
                  :icon="['fas', 'clock']"
                  aria-hidden="true"
                />
                {{ t('Settings.Sync Settings.Last Active') }}
              </dt>
              <dd>
                <time
                  :datetime="isoDate(session.last_active_at)"
                  :title="dateLabel(session.last_active_at)"
                >{{ relativeDateLabel(session.last_active_at) }}</time>
              </dd>
            </div>
            <div>
              <dt>
                <FtIcon
                  :icon="['fas', 'clock-rotate-left']"
                  aria-hidden="true"
                />
                {{ t('Settings.Sync Settings.Session Expires') }}
              </dt>
              <dd><time :datetime="isoDate(session.expires_at)">{{ dateLabel(session.expires_at) }}</time></dd>
            </div>
          </dl>
        </div>
        <div class="sessionActions">
          <FtIconButton
            class="sessionAction"
            :title="t('Settings.Sync Settings.Rename Device')"
            :icon="['fas', 'edit']"
            :disabled="actionBusy"
            :use-shadow="false"
            :padding="11"
            :size="20"
            theme="base-no-default"
            @click="openRenamePrompt(session)"
          />
          <FtIconButton
            class="sessionAction revokeAction"
            :title="t('Settings.Sync Settings.Revoke Session')"
            :icon="['fas', 'trash']"
            :disabled="actionBusy"
            :use-shadow="false"
            :padding="11"
            :size="20"
            theme="base-no-default"
            @click="sessionToRevoke = session"
          />
        </div>
      </li>
    </ul>

    <FtPrompt
      v-if="sessionToRename"
      :label="t('Settings.Sync Settings.Rename Device')"
      theme="readable-width"
      @click="closeRenamePrompt"
    >
      <div class="promptContent renameForm">
        <FtInput
          :placeholder="t('Settings.Sync Settings.Device Name')"
          :show-action-button="false"
          :value="renamedDeviceName"
          show-label
          @input="renamedDeviceName = $event"
          @keydown.enter="renameDevice"
        />
        <p
          v-if="promptError"
          class="managementError"
          role="alert"
        >
          {{ promptError }}
        </p>
        <FtFlexBox class="promptActions">
          <FtButton
            :label="t('Settings.Sync Settings.Save Device Name')"
            :icon="['fas', 'floppy-disk']"
            :disabled="actionBusy"
            @click="renameDevice"
          />
          <FtButton
            :label="t('Cancel')"
            :icon="['fas', 'xmark']"
            :disabled="actionBusy"
            @click="closeRenamePrompt"
          />
        </FtFlexBox>
      </div>
    </FtPrompt>

    <FtPrompt
      v-if="sessionToRevoke"
      :label="t('Settings.Sync Settings.Revoke Session Confirmation')"
      theme="readable-width"
      @click="closeRevokePrompt"
    >
      <div class="promptContent">
        <p>
          {{ sessionToRevoke.current
            ? t('Settings.Sync Settings.Revoke Current Session Warning')
            : t('Settings.Sync Settings.Revoke Session Warning', { device: sessionToRevoke.deviceInfo.name })
          }}
        </p>
        <p
          v-if="promptError"
          class="managementError"
          role="alert"
        >
          {{ promptError }}
        </p>
        <FtFlexBox class="promptActions">
          <FtButton
            :label="t('Settings.Sync Settings.Confirm Revoke Session')"
            :icon="['fas', 'trash']"
            theme="destructive"
            :disabled="actionBusy"
            @click="revokeSession"
          />
          <FtButton
            :label="t('Cancel')"
            :icon="['fas', 'xmark']"
            :disabled="actionBusy"
            @click="closeRevokePrompt"
          />
        </FtFlexBox>
      </div>
    </FtPrompt>
  </section>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { formatDateTime } from '../../helpers/dateFormat'
import {
  SyncServerClient,
  isSessionExpiredError,
} from '../../helpers/sync-server'
import {
  decryptSyncServerDeviceInfo,
  encryptSyncServerDeviceInfo,
  getCurrentSyncServerSystemInfo,
  isValidSyncServerDeviceId,
  isValidSyncServerDeviceName,
} from '../../helpers/sync-server-sessions'
import { getRelativeTimeFromDate, showToast } from '../../helpers/utils'
import store from '../../store/index'

const props = defineProps({
  serverUrl: {
    type: String,
    required: true,
  },
  token: {
    type: String,
    required: true,
  },
  privacyKey: {
    type: String,
    required: true,
  },
  deviceId: {
    type: String,
    required: true,
  },
  deviceName: {
    type: String,
    required: true,
  },
})
const emit = defineEmits(['current-revoked', 'password-login-changed'])

const { locale, t } = useI18n()
const headingId = useId()
const dateFormat = computed(() => store.getters.getDateFormat)
const timeFormat = computed(() => store.getters.getTimeFormat)
const relativeTimeNow = useRelativeTimeClock()
const loading = ref(true)
const actionBusy = ref(false)
const error = ref('')
const sessions = ref([])
const sessionToRename = ref(null)
const renamedDeviceName = ref('')
const sessionToRevoke = ref(null)
const promptError = ref('')

function client(token = props.token) {
  return new SyncServerClient(props.serverUrl, token)
}

function dateLabel(timestamp) {
  return formatDateTime(
    timestamp,
    locale.value,
    dateFormat.value,
    { dateStyle: 'medium' },
    { timeStyle: 'medium' },
    timeFormat.value
  )
}

function relativeDateLabel(timestamp) {
  return getRelativeTimeFromDate(timestamp, true, true, relativeTimeNow.value)
}

function isoDate(timestamp) {
  return new Date(timestamp).toISOString()
}

function systemLabel(deviceInfo) {
  const platformNames = {
    aix: 'AIX',
    android: 'Android',
    darwin: 'macOS',
    freebsd: 'FreeBSD',
    linux: 'Linux',
    openbsd: 'OpenBSD',
    sunos: 'SunOS',
    web: 'Web',
    win32: 'Windows',
  }
  const platform = platformNames[deviceInfo.platform] || deviceInfo.platform
  return [platform && `${platform}${deviceInfo.release ? ` ${deviceInfo.release}` : ''}`, deviceInfo.architecture]
    .filter(Boolean)
    .join(' · ')
}

function deviceIcon(platform) {
  return platform === 'web' ? ['fas', 'globe'] : ['fas', 'display']
}

async function handleRequestError(requestError, requestToken, target = error) {
  if (isSessionExpiredError(requestError)) {
    if (requestToken !== store.getters.getSyncServerToken) return
    await store.dispatch('expireSyncServerSession')
    emit('current-revoked')
    return
  }
  target.value = requestError?.message || t('Settings.Sync Settings.Account Management Failed')
}

async function loadSessions(token = props.token) {
  loading.value = true
  error.value = ''
  const requestClient = client(token)
  try {
    const response = await requestClient.getAccountSessions()
    if (!response || !Array.isArray(response.sessions)) throw new Error()
    emit('password-login-changed', response.password_login === true)
    const currentSystemInfo = await getCurrentSyncServerSystemInfo()
    sessions.value = await Promise.all(response.sessions.map(async session => {
      if (!session || typeof session.id !== 'string' ||
          !isValidSyncServerDeviceId(session.device_id) ||
          typeof session.current !== 'boolean' ||
          !['created_at', 'last_active_at', 'expires_at'].every(field => (
            Number.isSafeInteger(session[field]) && session[field] > 0
          ))) {
        throw new Error()
      }
      let deviceInfo = {
        name: t('Settings.Sync Settings.Unknown Device'),
        platform: '',
        architecture: '',
        release: '',
      }
      let deviceInfoDecrypted = false
      if (session.current && session.device_id !== props.deviceId) {
        await store.dispatch('updateSyncServerDeviceId', session.device_id)
      }
      if (session.encrypted_device_info) {
        try {
          deviceInfo = await decryptSyncServerDeviceInfo(
            session.encrypted_device_info,
            props.privacyKey,
            session.device_id
          )
          deviceInfoDecrypted = true
        } catch {}
      }
      const currentSystemInfoChanged = session.current && props.deviceName && (
        !deviceInfoDecrypted ||
        deviceInfo.platform !== currentSystemInfo.platform ||
        deviceInfo.architecture !== currentSystemInfo.architecture ||
        deviceInfo.release !== currentSystemInfo.release
      )
      if (currentSystemInfoChanged) {
        deviceInfo = {
          name: deviceInfoDecrypted && isValidSyncServerDeviceName(deviceInfo.name)
            ? deviceInfo.name
            : props.deviceName,
          ...currentSystemInfo,
        }
        session.encrypted_device_info = await encryptSyncServerDeviceInfo(
          deviceInfo,
          props.privacyKey,
          session.device_id
        )
        await requestClient.updateAccountSession(session.id, session.encrypted_device_info)
      }
      return { ...session, deviceInfo }
    }))
  } catch (requestError) {
    await handleRequestError(requestError, requestClient.token)
  } finally {
    requestClient.cancel()
    loading.value = false
  }
}

function openRenamePrompt(session) {
  promptError.value = ''
  sessionToRename.value = session
  renamedDeviceName.value = session.deviceInfo.name
}

function closeRenamePrompt() {
  if (actionBusy.value) return
  sessionToRename.value = null
  renamedDeviceName.value = ''
  promptError.value = ''
}

async function renameDevice() {
  const session = sessionToRename.value
  if (!session || actionBusy.value) return
  const name = renamedDeviceName.value.trim()
  if (!name) {
    promptError.value = t('Settings.Sync Settings.Device Name Required')
    return
  }
  if (!isValidSyncServerDeviceName(name)) {
    promptError.value = t('Settings.Sync Settings.Device Name Invalid')
    return
  }

  actionBusy.value = true
  promptError.value = ''
  const requestClient = client()
  try {
    const encryptedDeviceInfo = await encryptSyncServerDeviceInfo(
      { ...session.deviceInfo, name },
      props.privacyKey,
      session.device_id
    )
    await requestClient.updateAccountSession(session.id, encryptedDeviceInfo)
    if (session.current) await store.dispatch('updateSyncServerDeviceName', name)
    sessionToRename.value = null
    renamedDeviceName.value = ''
    showToast({
      message: t('Settings.Sync Settings.Device Renamed'),
      icon: ['fas', 'edit'],
    })
    await loadSessions()
  } catch (requestError) {
    await handleRequestError(requestError, requestClient.token, promptError)
  } finally {
    requestClient.cancel()
    actionBusy.value = false
  }
}

function closeRevokePrompt() {
  if (actionBusy.value) return
  sessionToRevoke.value = null
  promptError.value = ''
}

async function revokeSession() {
  const session = sessionToRevoke.value
  if (!session || actionBusy.value) return
  actionBusy.value = true
  promptError.value = ''
  const requestClient = client()
  try {
    await requestClient.revokeAccountSession(session.id)
    sessionToRevoke.value = null
    showToast({
      message: t('Settings.Sync Settings.Session Revoked'),
      icon: ['fas', 'trash'],
    })
    if (session.current) {
      emit('current-revoked')
      return
    }
    await loadSessions()
  } catch (requestError) {
    await handleRequestError(requestError, requestClient.token, promptError)
  } finally {
    requestClient.cancel()
    actionBusy.value = false
  }
}

defineExpose({ loadSessions })
onMounted(loadSessions)
</script>

<style scoped src="./SyncAccountManagement.css" />
