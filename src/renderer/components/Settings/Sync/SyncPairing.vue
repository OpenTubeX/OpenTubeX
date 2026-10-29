<template>
  <FtButton
    v-if="connected && supported"
    :label="t('Settings.Sync Settings.Pair Another Device')"
    :icon="['fas', 'key']"
    :disabled="disabled"
    @click="openScanner"
  />
  <FtButton
    v-else-if="!connected && supported"
    :label="t('Settings.Sync Settings.Pair With Existing Device')"
    :icon="['fas', 'key']"
    :disabled="disabled"
    @click="openReceiver"
  />

  <FtPrompt
    v-if="receivePromptOpen"
    :label="t('Settings.Sync Settings.Pair With Existing Device')"
    :inert="receiveStage === 'finishing'"
    theme="readable-width"
    fixed-layout
    @click="closeReceiver"
  >
    <div
      class="pairingContent"
      :class="{ pairingWaiting: receiveStage === 'waiting' }"
    >
      <template v-if="receiveStage === 'name'">
        <p>{{ t('Settings.Sync Settings.Pairing Device Name Hint') }}</p>
        <FtInput
          :icon="['fas', 'devices']"
          :label="t('Settings.Sync Settings.Device Name')"
          :placeholder="t('Form Inputs.Example', { example: t('Settings.Sync Settings.Desktop Device') })"
          :show-action-button="false"
          :value="deviceName"
          show-label
          @input="deviceName = $event"
          @keydown.enter="startReceiving()"
        />
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Create Pairing Code')"
            :icon="['fas', 'key']"
            :disabled="deviceName.trim() === ''"
            @click="startReceiving()"
          />
          <FtButton
            :label="t('Settings.Sync Settings.Use Pairing Invite')"
            :icon="['fas', 'qrcode']"
            :disabled="deviceName.trim() === ''"
            @click="scanInvite"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="receiveStage === 'scanning'">
        <SyncPairingScanner
          :key="receiveScanAttempt"
          :hint="t('Settings.Sync Settings.Pairing Invite Scan Hint')"
          @scan="submitInvite"
          @cancel="openInviteEntry"
          @unavailable="openInviteEntry(t('Settings.Sync Settings.Camera Unavailable'))"
        />
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Enter Pairing Code')"
            :icon="['fas', 'keyboard']"
            @click="openInviteEntry()"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="receiveStage === 'manual'">
        <p>{{ t('Settings.Sync Settings.Pairing Invite Entry Hint') }}</p>
        <FtInput
          ref="manualInviteCodeInput"
          :label="t('Settings.Sync Settings.Pairing Code')"
          :icon="['fas', 'key']"
          :value="manualInviteCode"
          :placeholder="t('Form Inputs.Example', { example: 'opentubex-pairing-invite:…' })"
          :maxlength="2048"
          :show-action-button="false"
          multiline
          @input="manualInviteCode = $event"
        />
        <p
          v-if="receiveError"
          class="pairingError"
          role="alert"
        >
          {{ receiveError }}
        </p>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Check Pairing Code')"
            :icon="['fas', 'check']"
            :disabled="manualInviteCode.trim() === ''"
            @click="submitInvite(manualInviteCode)"
          />
          <FtButton
            :label="t('Settings.Sync Settings.Scan QR Code')"
            :icon="['fas', 'qrcode']"
            @click="scanInvite"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="receiveStage === 'creating'">
        <FtLoader />
        <p aria-live="polite">
          {{ receiveComparisonCode === null
            ? t('Settings.Sync Settings.Creating Pairing Code')
            : t('Settings.Sync Settings.Checking Pairing Request') }}
        </p>
      </template>
      <template v-else-if="receiveStage === 'waiting' && receiveComparisonCode">
        <p class="pairingWarning">
          {{ t('Settings.Sync Settings.Compare Pairing Codes') }}
        </p>
        <p class="pairingVerificationCode">
          {{ receiveComparisonCode }}
        </p>
        <p>{{ t('Settings.Sync Settings.Pairing Invite Code Hint') }}</p>
        <div
          class="pairingPollStatus pairingSecondary"
          aria-live="polite"
        >
          <FtLoader />
          <span>{{ t('Settings.Sync Settings.Pairing Expires', { time: receiveExpiryLabel }) }}</span>
        </div>
      </template>
      <template v-else-if="receiveStage === 'waiting'">
        <template v-if="showTextCode">
          <FtInput
            ref="pairingCodeInput"
            :label="t('Settings.Sync Settings.Pairing Code')"
            :icon="['fas', 'key']"
            :value="pairingCode"
            :placeholder="t('Form Inputs.Example', { example: 'opentubex-pairing:…' })"
            :show-action-button="false"
            readonly
            select-on-click
            @focus="pairingCodeInput?.select()"
          />
          <p>{{ t('Settings.Sync Settings.Text Pairing Code Hint') }}</p>
        </template>
        <template v-else>
          <img
            class="pairingQr"
            :src="qrImage"
            :alt="t('Settings.Sync Settings.Pairing QR Alt', { device: deviceName })"
          >
          <p>{{ t('Settings.Sync Settings.Scan Pairing Code') }}</p>
        </template>
        <FtFlexBox class="pairingActions pairingModeActions">
          <FtButton
            :label="showTextCode
              ? t('Settings.Sync Settings.Show QR Code')
              : t('Settings.Sync Settings.Use Text Pairing Code')"
            :icon="showTextCode ? ['fas', 'qrcode'] : ['fas', 'keyboard']"
            @click="showTextCode = !showTextCode"
          />
        </FtFlexBox>
        <p class="pairingWarning">
          {{ t('Settings.Sync Settings.Pairing QR Warning') }}
        </p>
        <div
          class="pairingPollStatus pairingSecondary"
          aria-live="polite"
        >
          <FtLoader />
          <span>{{ t('Settings.Sync Settings.Pairing Expires', { time: receiveExpiryLabel }) }}</span>
        </div>
      </template>
      <template v-else-if="receiveStage === 'confirm'">
        <p class="pairingWarning">
          {{ t('Settings.Sync Settings.Compare Pairing Codes') }}
        </p>
        <p class="pairingVerificationCode">
          {{ receiveVerificationCode }}
        </p>
        <p>{{ t('Settings.Sync Settings.Pairing Code Match Hint') }}</p>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Pairing Codes Match')"
            :icon="['fas', 'check']"
            @click="confirmReceiver"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="receiveStage === 'finishing'">
        <FtLoader />
        <p aria-live="polite">
          {{ receiveVerificationCode
            ? t('Settings.Sync Settings.Completing Pairing')
            : t('Settings.Sync Settings.Verifying Pairing') }}
        </p>
      </template>
      <template v-else>
        <p
          class="pairingError"
          role="alert"
        >
          {{ receiveError }}
        </p>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Try Again')"
            :icon="['fas', 'sync']"
            @click="resetReceiver"
          />
        </FtFlexBox>
      </template>
    </div>
    <template #footer>
      <FtFlexBox class="pairingFooter">
        <FtButton
          :label="t('Cancel')"
          :icon="['fas', 'xmark']"
          @click="closeReceiver"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>

  <FtPrompt
    v-if="approvePromptOpen"
    :label="t('Settings.Sync Settings.Pair Another Device')"
    theme="readable-width"
    fixed-layout
    @click="closeScanner"
  >
    <div
      class="pairingContent"
      :class="{ pairingWaiting: approveStage === 'invite' }"
    >
      <template v-if="approveStage === 'scanning'">
        <SyncPairingScanner
          :key="approveScanAttempt"
          :hint="t('Settings.Sync Settings.Pairing Scan Hint')"
          @scan="handleScan"
          @cancel="openManualEntry"
          @unavailable="approveScannerUnavailable"
        />
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Enter Pairing Code')"
            :icon="['fas', 'keyboard']"
            @click="openManualEntry"
          />
          <FtButton
            :label="t('Settings.Sync Settings.Show Pairing Invite')"
            :icon="['fas', 'qrcode']"
            @click="showInvite"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="approveStage === 'manual'">
        <p>{{ t('Settings.Sync Settings.Pairing Code Entry Hint') }}</p>
        <FtInput
          ref="manualPairingCodeInput"
          :label="t('Settings.Sync Settings.Pairing Code')"
          :icon="['fas', 'key']"
          :value="manualPairingCode"
          :placeholder="t('Form Inputs.Example', { example: 'opentubex-pairing:…' })"
          :maxlength="2048"
          :show-action-button="false"
          multiline
          @input="manualPairingCode = $event"
        />
        <p
          v-if="approveError"
          class="pairingError"
          role="alert"
        >
          {{ approveError }}
        </p>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Check Pairing Code')"
            :icon="['fas', 'check']"
            :disabled="manualPairingCode.trim() === ''"
            @click="submitManualCode"
          />
          <FtButton
            :label="t('Settings.Sync Settings.Scan QR Code')"
            :icon="['fas', 'qrcode']"
            @click="restartScanner"
          />
          <FtButton
            :label="t('Settings.Sync Settings.Show Pairing Invite')"
            :icon="['fas', 'qrcode']"
            @click="showInvite"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="approveStage === 'invite'">
        <template v-if="showInviteText">
          <FtInput
            ref="inviteCodeInput"
            :label="t('Settings.Sync Settings.Pairing Code')"
            :icon="['fas', 'key']"
            :value="inviteCode"
            :placeholder="t('Form Inputs.Example', { example: 'opentubex-pairing-invite:…' })"
            :show-action-button="false"
            readonly
            select-on-click
            @focus="inviteCodeInput?.select()"
          />
          <p>{{ t('Settings.Sync Settings.Pairing Invite Text Hint') }}</p>
        </template>
        <template v-else>
          <img
            class="pairingQr"
            :src="inviteQrImage"
            :alt="t('Settings.Sync Settings.Pairing Invite QR Alt')"
          >
          <p>{{ t('Settings.Sync Settings.Scan Pairing Invite') }}</p>
        </template>
        <FtFlexBox class="pairingActions pairingModeActions">
          <FtButton
            :label="showInviteText
              ? t('Settings.Sync Settings.Show QR Code')
              : t('Settings.Sync Settings.Use Text Pairing Code')"
            :icon="showInviteText ? ['fas', 'qrcode'] : ['fas', 'keyboard']"
            @click="showInviteText = !showInviteText"
          />
          <FtButton
            :label="t('Settings.Sync Settings.Scan QR Code')"
            :icon="['fas', 'qrcode']"
            @click="restartScanner"
          />
        </FtFlexBox>
        <p class="pairingWarning">
          {{ t('Settings.Sync Settings.Pairing Invite Warning') }}
        </p>
        <div
          class="pairingPollStatus pairingSecondary"
          aria-live="polite"
        >
          <FtLoader />
          <span>{{ t('Settings.Sync Settings.Pairing Expires', { time: inviteExpiryLabel }) }}</span>
        </div>
      </template>
      <template v-else-if="approveStage === 'inviting' || approveStage === 'checking' || approveStage === 'approving'">
        <FtLoader />
        <p aria-live="polite">
          {{ approveStage === 'inviting'
            ? t('Settings.Sync Settings.Creating Pairing Code')
            : approveStage === 'checking'
              ? t('Settings.Sync Settings.Checking Pairing Request')
              : t('Settings.Sync Settings.Approving Pairing Request') }}
        </p>
      </template>
      <template v-else-if="approveStage === 'confirm'">
        <template v-if="approveComparisonCode">
          <p class="pairingWarning">
            {{ t('Settings.Sync Settings.Compare Pairing Codes') }}
          </p>
          <p class="pairingVerificationCode">
            {{ approveComparisonCode }}
          </p>
          <p>{{ t('Settings.Sync Settings.Pairing Invite Approval Hint') }}</p>
        </template>
        <p
          v-else
          class="pairingWarning"
        >
          {{ t('Settings.Sync Settings.Pairing Approval Warning') }}
        </p>
        <dl class="pairingDetails">
          <div>
            <dt>{{ t('Settings.Sync Settings.Server URL') }}</dt>
            <dd>{{ pairingRequest.origin }}</dd>
          </div>
          <div>
            <dt>{{ t('Settings.Sync Settings.Username') }}</dt>
            <dd>{{ username }}</dd>
          </div>
          <div>
            <dt>{{ t('Settings.Sync Settings.Device Name') }}</dt>
            <dd>{{ pairingRequest.recipientDeviceName }}</dd>
          </div>
        </dl>
        <FtFlexBox class="pairingActions">
          <FtButton
            :label="t('Settings.Sync Settings.Approve Pairing')"
            :icon="['fas', 'key']"
            @click="approvePairing"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="approveStage === 'approved' && approveComparisonCode">
        <p aria-live="polite">
          {{ t('Settings.Sync Settings.Pairing Invite Approved') }}
        </p>
      </template>
      <template v-else-if="approveStage === 'approved'">
        <p class="pairingWarning">
          {{ t('Settings.Sync Settings.Compare Pairing Codes') }}
        </p>
        <p class="pairingVerificationCode">
          {{ approvalVerificationCode }}
        </p>
        <p>{{ t('Settings.Sync Settings.Pairing Approval Code Hint') }}</p>
      </template>
      <template v-else>
        <p
          class="pairingError"
          role="alert"
        >
          {{ approveError }}
        </p>
        <FtFlexBox class="pairingActions">
          <FtButton
            v-if="pairingApproval"
            :label="t('Settings.Sync Settings.Try Again')"
            :icon="['fas', 'sync']"
            @click="approvePairing"
          />
          <FtButton
            v-else-if="approveMode === 'invite'"
            :label="t('Settings.Sync Settings.Try Again')"
            :icon="['fas', 'sync']"
            @click="showInvite"
          />
          <template v-else>
            <FtButton
              :label="t('Settings.Sync Settings.Scan Again')"
              :icon="['fas', 'sync']"
              @click="restartScanner"
            />
            <FtButton
              :label="t('Settings.Sync Settings.Enter Pairing Code')"
              :icon="['fas', 'keyboard']"
              @click="openManualEntry"
            />
            <FtButton
              :label="t('Settings.Sync Settings.Show Pairing Invite')"
              :icon="['fas', 'qrcode']"
              @click="showInvite"
            />
          </template>
        </FtFlexBox>
      </template>
    </div>
    <template #footer>
      <FtFlexBox class="pairingFooter">
        <FtButton
          :label="approveStage === 'approved' ? t('Close') : t('Cancel')"
          :icon="['fas', 'xmark']"
          @click="closeScanner"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
</template>

<script setup>
import QRCode from 'qrcode'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtLoader from '../../FtLoader/FtLoader.vue'
import FtPrompt from '../../FtPrompt/FtPrompt.vue'
import SyncPairingScanner from './SyncPairingScanner.vue'

import {
  bindPairingRequestToAccount,
  createPairingInvite,
  createPairingInvitePayload,
  createPairingQrPayload,
  createPairingRecipient,
  createPairingRequest,
  decryptPairingKey,
  encryptPairingKey,
  pairingComparisonCode,
  pairingRequestFromInviteSession,
  pairingSessionMatchesRequest,
  parsePairingInvitePayload,
  parsePairingQrPayload,
  randomPairingVerificationCode,
  syncServerTokenAccountId,
} from '../../../helpers/sync-server-pairing'
import {
  PRIVACY_VERSION,
  decryptLegacySyncDocument,
  decryptSyncDocument,
} from '../../../helpers/sync-server-privacy'
import { SyncServerClient, normalizeSyncServerUrl } from '../../../helpers/sync-server'
import {
  encryptSyncServerDeviceInfo,
  getCurrentSyncServerDeviceInfo,
} from '../../../helpers/sync-server-sessions'
import { formatTime } from '../../../helpers/dateFormat'
import store from '../../../store/index'

const props = defineProps({
  connected: Boolean,
  supported: Boolean,
  disabled: Boolean,
  serverUrl: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  privacyKey: {
    type: String,
    default: '',
  },
  privacySalt: {
    type: String,
    default: '',
  },
  deviceId: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['paired'])
const { locale, t } = useI18n()
const usingNativeScanner = Boolean(process.env.IS_CAPACITOR)
const timeFormat = computed(() => store.getters.getTimeFormat)

// Invites stay valid longer than the server's two-minute session because the
// device being added still has to open its settings and scan the code.
const INVITE_TTL_MS = 5 * 60 * 1000
const POLL_INTERVAL_MS = 2000

const receivePromptOpen = ref(false)
const receiveStage = ref('name')
const receiveError = ref('')
const fallbackDeviceName = t('Settings.Sync Settings.This Device')
const deviceName = ref(fallbackDeviceName)
const qrImage = ref('')
const pairingCode = ref('')
const showTextCode = ref(false)
const receiveExpiresAt = ref(0)
const receiveVerificationCode = ref('')
const receiveComparisonCode = ref(null)
const receiveScanAttempt = ref(0)
const manualInviteCode = ref('')
const approvePromptOpen = ref(false)
const approveMode = ref('scan')
const approveStage = ref('scanning')
const approveError = ref('')
const approveScanAttempt = ref(0)
const manualPairingCode = ref('')
const pairingRequest = ref(null)
const approvalVerificationCode = ref('')
const approveComparisonCode = ref('')
const inviteQrImage = ref('')
const inviteCode = ref('')
const showInviteText = ref(false)
const inviteExpiresAt = ref(0)
const pairingCodeInput = useTemplateRef('pairingCodeInput')
const manualPairingCodeInput = useTemplateRef('manualPairingCodeInput')
const manualInviteCodeInput = useTemplateRef('manualInviteCodeInput')
const inviteCodeInput = useTemplateRef('inviteCodeInput')

const receiveExpiryLabel = computed(() => formatExpiry(receiveExpiresAt.value))
const inviteExpiryLabel = computed(() => formatExpiry(inviteExpiresAt.value))

function formatExpiry(timestamp) {
  return formatTime(timestamp, locale.value, timeFormat.value, { timeStyle: 'medium' })
}

let receiver = null
let pollTimer = null
let receiveSequence = 0
let approveSequence = 0
let pairingClient = null
let activeInvite = null
let inviteTimer = null
const pairingApproval = ref(null)

const currentDeviceInfoPromise = getCurrentSyncServerDeviceInfo().catch(() => ({ name: '' }))
currentDeviceInfoPromise.then(({ name }) => {
  const trimmedName = name?.trim()
  if (trimmedName && deviceName.value === fallbackDeviceName) {
    deviceName.value = trimmedName
  }
})

function openReceiver() {
  resetReceiver()
  receivePromptOpen.value = true
}

function resetReceiver() {
  receiveStage.value = 'name'
  receiveError.value = ''
  qrImage.value = ''
  pairingCode.value = ''
  showTextCode.value = false
  receiveExpiresAt.value = 0
  receiveVerificationCode.value = ''
  receiveComparisonCode.value = null
  manualInviteCode.value = ''
}

function scanInvite() {
  receiveError.value = ''
  receiveScanAttempt.value++
  receiveStage.value = 'scanning'
}

async function openInviteEntry(error = '') {
  receiveError.value = error
  receiveStage.value = 'manual'
  await nextTick()
  manualInviteCodeInput.value?.focus()
}

function submitInvite(code) {
  if (receiveStage.value !== 'scanning' && receiveStage.value !== 'manual') return
  let invite
  try {
    invite = parsePairingInvitePayload(code.trim())
    if (invite.origin !== normalizeSyncServerUrl(props.serverUrl)) {
      throw new Error(t('Settings.Sync Settings.Pairing Server Mismatch'))
    }
  } catch (error) {
    openInviteEntry(error.message)
    return
  }
  manualInviteCode.value = ''
  startReceiving(invite)
}

/**
 * Registers this device's key with the sync server. Without an invite, this
 * device shows a code for a connected device to scan. With an invite from a
 * connected device, it joins that device's session and shows a comparison code.
 */
async function startReceiving(invite = null) {
  const sequence = ++receiveSequence
  receiveStage.value = 'creating'
  receiveError.value = ''
  receiveComparisonCode.value = invite ? '' : null

  const { name } = await currentDeviceInfoPromise
  if (sequence !== receiveSequence || !receivePromptOpen.value) return
  const trimmedSystemName = name?.trim()
  if (trimmedSystemName && deviceName.value === fallbackDeviceName) {
    deviceName.value = trimmedSystemName
  }
  const requestedName = deviceName.value.trim()
  if (!requestedName) {
    receiveError.value = t('Settings.Sync Settings.Device Name Required')
    receiveStage.value = 'error'
    return
  }
  deviceName.value = requestedName

  const client = new SyncServerClient(props.serverUrl)
  try {
    const capabilities = await client.getCapabilities()
    if (capabilities.key_pairing !== 1 || capabilities.encrypted_sync !== 1) {
      throw new Error(t('Settings.Sync Settings.Pairing Unsupported'))
    }
    const recipient = await createPairingRecipient(requestedName, props.deviceId, invite)
    let session
    try {
      session = await client.createPairingSession(recipient)
    } catch (error) {
      // Another device already used this invite.
      if (invite && error?.status === 409) {
        throw new Error(t('Settings.Sync Settings.Pairing Request Changed'), { cause: error })
      }
      throw error
    }
    if (sequence !== receiveSequence || !receivePromptOpen.value) {
      try {
        await client.cancelPairingSession(recipient.sessionId, recipient.recipientToken)
      } catch {}
      client.cancel()
      return
    }
    const origin = normalizeSyncServerUrl(props.serverUrl)
    const request = createPairingRequest(recipient, origin)
    if (!pairingSessionMatchesRequest(session, request)) throw new Error()

    receiver = { client, recipient, request, invite, consumed: false, transfer: null, comparisonCode: '' }
    receiveExpiresAt.value = session.expires_at
    if (invite) {
      const comparisonCode = await pairingComparisonCode(request)
      if (sequence !== receiveSequence || receiver?.client !== client || !receivePromptOpen.value) {
        return
      }
      receiver.comparisonCode = comparisonCode
      receiveComparisonCode.value = comparisonCode
    } else {
      const code = createPairingQrPayload(recipient, origin)
      const image = await QRCode.toDataURL(code, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
      })
      if (sequence !== receiveSequence || receiver?.client !== client || !receivePromptOpen.value) {
        return
      }
      qrImage.value = image
      pairingCode.value = code
    }
    receiveStage.value = 'waiting'
    schedulePoll()
  } catch (error) {
    client.cancel()
    receiver = null
    if (sequence !== receiveSequence || !receivePromptOpen.value) return
    receiveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    receiveStage.value = 'error'
  }
}

function schedulePoll() {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(pollReceiver, POLL_INTERVAL_MS)
}

async function pollReceiver() {
  const active = receiver
  if (!active || receiveStage.value !== 'waiting') return
  try {
    const session = await active.client.getPairingSession(
      active.request.sessionId,
      active.recipient.recipientToken
    )
    if (receiver !== active || !receivePromptOpen.value) return
    // Only the inviting account may claim a session created from its invite.
    if (active.invite && session.account_id !== null && session.account_id !== active.invite.accountId) {
      throw new Error(t('Settings.Sync Settings.Pairing Request Changed'))
    }
    const boundRequest = session.account_id === null
      ? active.request
      : bindPairingRequestToAccount(active.request, session.account_id)
    if (!pairingSessionMatchesRequest(session, boundRequest, session.approved === true)) {
      throw new Error(t('Settings.Sync Settings.Pairing Request Changed'))
    }
    if (!session.approved) {
      schedulePoll()
      return
    }

    receiveStage.value = 'finishing'
    const transfer = await active.client.consumePairingSession(
      active.request.sessionId,
      active.recipient.recipientToken
    )
    if (receiver !== active || !receivePromptOpen.value) return
    active.consumed = true
    const privacy = await decryptPairingKey(
      boundRequest,
      transfer.approving_device_id,
      active.recipient.recipientKey,
      transfer.encrypted_payload
    )
    if (receiver !== active || !receivePromptOpen.value) return
    const verificationClient = new SyncServerClient(boundRequest.origin, privacy.token)
    try {
      await verifyPrivacyKey(verificationClient, privacy.key)
    } finally {
      verificationClient.cancel()
    }
    if (receiver !== active || !receivePromptOpen.value) return
    active.request = boundRequest
    active.transfer = privacy
    if (active.comparisonCode) {
      // The user already compared this code before approving on the connected device.
      if (privacy.verificationCode !== active.comparisonCode) {
        throw new Error(t('Settings.Sync Settings.Pairing Request Changed'))
      }
      await completeReceiver(active)
      return
    }
    receiveVerificationCode.value = privacy.verificationCode
    receiveStage.value = 'confirm'
  } catch (error) {
    receiveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    receiveStage.value = 'error'
    releaseReceiver()
  }
}

function confirmReceiver() {
  const active = receiver
  if (!active?.transfer || receiveStage.value !== 'confirm') return
  return completeReceiver(active)
}

async function completeReceiver(active) {
  receiveStage.value = 'finishing'
  const privacy = active.transfer
  try {
    const { name, ...deviceSystemInfo } = await getCurrentSyncServerDeviceInfo()
    await store.dispatch('completeSyncServerPairing', {
      serverUrl: active.request.origin,
      username: privacy.username,
      token: privacy.token,
      privacyKey: privacy.key,
      privacySalt: privacy.salt,
      deviceId: active.recipient.recipientDeviceId,
      deviceName: active.recipient.recipientDeviceName,
      deviceSystemInfo,
    })
    await finishReceiver()
    emit('paired', 'completed')
    store.dispatch('syncWithSyncServer').catch(() => {
      // The store exposes normal sync failures in the settings UI. Pairing has
      // already succeeded because the transferred key was verified and saved.
    })
  } catch (error) {
    receiveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    receiveStage.value = 'error'
    releaseReceiver()
  }
}

async function verifyPrivacyKey(client, privacyKey) {
  const manifest = await client.getEncryptedSyncManifest()
  const firstCollection = manifest.collections[0]?.collection
  if (firstCollection) {
    // `since` keeps newer servers from refusing a collection with appended changes.
    const collection = await client.getEncryptedSyncCollection(firstCollection, 0)
    if (!collection.payload) throw new Error(t('Settings.Sync Settings.Pairing Verification Unavailable'))
    await decryptSyncDocument(collection.payload, privacyKey)
    return
  }
  if (manifest.legacy_encrypted_data) {
    const legacy = await client.getLegacyEncryptedSync()
    if (legacy.payload) {
      await decryptLegacySyncDocument(legacy.payload, privacyKey)
      return
    }
  }
  throw new Error(t('Settings.Sync Settings.Pairing Verification Unavailable'))
}

function releaseReceiver() {
  clearTimeout(pollTimer)
  pollTimer = null
  receiver?.client.cancel()
  receiver = null
  qrImage.value = ''
  pairingCode.value = ''
  showTextCode.value = false
}

async function finishReceiver() {
  releaseReceiver()
  receivePromptOpen.value = false
  resetReceiver()
}

async function closeReceiver() {
  receiveSequence++
  receivePromptOpen.value = false
  clearTimeout(pollTimer)
  pollTimer = null
  const active = receiver
  receiver = null
  qrImage.value = ''
  pairingCode.value = ''
  showTextCode.value = false
  if (active && !active.consumed) {
    try {
      await active.client.cancelPairingSession(
        active.request.sessionId,
        active.recipient.recipientToken
      )
    } catch {
      // Expiry and concurrent cancellation both leave the session unusable.
    }
  }
  active?.client.cancel()
  resetReceiver()
}

function resetApproval() {
  approveSequence++
  pairingClient?.cancel()
  pairingClient = null
  releaseInvite()
  approveMode.value = 'scan'
  approveError.value = ''
  pairingRequest.value = null
  pairingApproval.value = null
  approvalVerificationCode.value = ''
}

function openScanner() {
  approvePromptOpen.value = true
  restartScanner()
}

function restartScanner() {
  resetApproval()
  manualPairingCode.value = ''
  approveScanAttempt.value++
  approveStage.value = 'scanning'
}

async function approveScannerUnavailable() {
  if (usingNativeScanner) {
    await openManualEntry()
  } else {
    approveStage.value = 'error'
  }
  approveError.value = t('Settings.Sync Settings.Camera Unavailable')
}

async function openManualEntry() {
  resetApproval()
  approveStage.value = 'manual'
  await nextTick()
  manualPairingCodeInput.value?.focus()
}

function submitManualCode() {
  const code = manualPairingCode.value.trim()
  if (code) handleScan(code)
}

function handleScan(code) {
  if (approveStage.value !== 'scanning' && approveStage.value !== 'manual') return
  approveStage.value = 'checking'
  try {
    const request = parsePairingQrPayload(code)
    manualPairingCode.value = ''
    if (request.origin !== normalizeSyncServerUrl(props.serverUrl)) {
      throw new Error(t('Settings.Sync Settings.Pairing Server Mismatch'))
    }
    pairingRequest.value = request
    approveStage.value = 'confirm'
  } catch (error) {
    approveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    approveStage.value = 'error'
  }
}

/**
 * Shows a code that lets the device being added register its key with this
 * device's session, for devices that cannot scan the new device's code.
 */
async function showInvite() {
  resetApproval()
  const sequence = approveSequence
  approveMode.value = 'invite'
  approveStage.value = 'inviting'
  try {
    const invite = createPairingInvite(
      normalizeSyncServerUrl(props.serverUrl),
      syncServerTokenAccountId(store.getters.getSyncServerToken)
    )
    const code = createPairingInvitePayload(invite)
    const image = await QRCode.toDataURL(code, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
    })
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    activeInvite = { invite, client: new SyncServerClient(props.serverUrl), approved: false }
    inviteQrImage.value = image
    inviteCode.value = code
    inviteExpiresAt.value = Date.now() + INVITE_TTL_MS
    approveStage.value = 'invite'
    scheduleInvitePoll()
  } catch (error) {
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    approveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    approveStage.value = 'error'
  }
}

function scheduleInvitePoll() {
  clearTimeout(inviteTimer)
  inviteTimer = setTimeout(pollInvite, POLL_INTERVAL_MS)
}

async function pollInvite() {
  const active = activeInvite
  if (!active || approveStage.value !== 'invite') return
  try {
    let session = null
    try {
      session = await active.client.getPairingSession(
        active.invite.sessionId,
        active.invite.recipientToken
      )
    } catch (error) {
      // The device being added has not registered its key yet.
      if (error?.status !== 404) throw error
    }
    if (activeInvite !== active) return
    if (!session) {
      if (Date.now() >= inviteExpiresAt.value) {
        throw new Error(t('Settings.Sync Settings.Pairing Request Changed'))
      }
      scheduleInvitePoll()
      return
    }
    let request
    try {
      request = pairingRequestFromInviteSession(active.invite, session)
    } catch {
      throw new Error(t('Settings.Sync Settings.Pairing Request Changed'))
    }
    const comparisonCode = await pairingComparisonCode(request)
    if (activeInvite !== active) return
    pairingRequest.value = request
    approveComparisonCode.value = comparisonCode
    approveStage.value = 'confirm'
  } catch (error) {
    if (activeInvite !== active) return
    releaseInvite()
    approveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    approveStage.value = 'error'
  }
}

function releaseInvite() {
  clearTimeout(inviteTimer)
  inviteTimer = null
  const active = activeInvite
  activeInvite = null
  inviteQrImage.value = ''
  inviteCode.value = ''
  showInviteText.value = false
  approveComparisonCode.value = ''
  if (!active) return
  if (active.approved) {
    active.client.cancel()
    return
  }
  // Delete a session registered under this invite so it cannot be approved later.
  active.client.cancelPairingSession(active.invite.sessionId, active.invite.recipientToken)
    .catch(() => {})
    .finally(() => active.client.cancel())
}

async function approvePairing() {
  const sequence = approveSequence
  approveStage.value = 'approving'
  approveError.value = ''
  try {
    const client = new SyncServerClient(props.serverUrl, store.getters.getSyncServerToken)
    pairingClient = client
    if (!pairingApproval.value) {
      const encryptedDeviceInfo = await encryptSyncServerDeviceInfo(
        {
          name: pairingRequest.value.recipientDeviceName,
          platform: '',
          architecture: '',
          release: '',
        },
        props.privacyKey,
        pairingRequest.value.recipientDeviceId
      )
      const claim = await client.claimPairingSession(pairingRequest.value, encryptedDeviceInfo)
      if (sequence !== approveSequence || !approvePromptOpen.value) return
      const request = bindPairingRequestToAccount(
        pairingRequest.value,
        claim.session.account_id
      )
      if (!pairingSessionMatchesRequest(claim.session, request)) {
        throw new Error(t('Settings.Sync Settings.Pairing Request Changed'))
      }
      pairingApproval.value = {
        request,
        approvingDeviceId: props.deviceId,
        verificationCode: approveComparisonCode.value || randomPairingVerificationCode(),
        token: claim.jwt,
        encryptedPayload: '',
      }
    }
    const approval = pairingApproval.value
    if (!approval.encryptedPayload) {
      approval.encryptedPayload = await encryptPairingKey(
        approval.request,
        approval.approvingDeviceId,
        {
          username: props.username.trim(),
          token: approval.token,
          key: props.privacyKey,
          salt: props.privacySalt,
          version: PRIVACY_VERSION,
          verificationCode: approval.verificationCode,
        }
      )
    }
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    await client.approvePairingSession(
      approval.request.sessionId,
      approval.approvingDeviceId,
      approval.encryptedPayload
    )
    if (pairingClient === client) pairingClient = null
    if (activeInvite) activeInvite.approved = true
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    approvalVerificationCode.value = approval.verificationCode
    approveStage.value = 'approved'
    emit('paired', 'approved')
  } catch (error) {
    pairingClient = null
    if (sequence !== approveSequence || !approvePromptOpen.value) return
    approveError.value = error?.message || t('Settings.Sync Settings.Pairing Failed')
    approveStage.value = 'error'
  }
}

function closeScanner() {
  resetApproval()
  approvePromptOpen.value = false
  approveStage.value = 'scanning'
  manualPairingCode.value = ''
}

onBeforeUnmount(() => {
  receiveSequence++
  pairingClient?.cancel()
  pairingClient = null
  releaseInvite()
  approveSequence++
  clearTimeout(pollTimer)
  receiver?.client.cancel()
  receiver = null
})
</script>

<style scoped src="./SyncPairing.css" />
