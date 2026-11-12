<template>
  <FtPrompt
    :label="t('Settings.YouTube Account Settings.Sign In')"
    theme="readable-width"
    fixed-layout
    @click="close"
  >
    <div class="signInContent">
      <template v-if="stage === 'warning'">
        <p class="signInWarning">
          {{ t('Settings.YouTube Account Settings.Unofficial App Warning') }}
        </p>
        <p>{{ t('Settings.YouTube Account Settings.Sign In Explanation') }}</p>
        <FtFlexBox class="signInActions">
          <FtButton
            :label="t('Settings.YouTube Account Settings.Sign In Anyway')"
            :icon="['fas', 'right-to-bracket']"
            @click="start"
          />
        </FtFlexBox>
      </template>
      <template v-else-if="stage === 'requesting'">
        <FtLoader />
        <p aria-live="polite">
          {{ t('Settings.YouTube Account Settings.Getting Sign-In Code') }}
        </p>
      </template>
      <template v-else-if="stage === 'waiting' && code">
        <p>{{ t('Settings.YouTube Account Settings.Sign In Instructions') }}</p>
        <FtFlexBox class="signInActions">
          <FtButton
            :label="t('Settings.YouTube Account Settings.Open Sign-In Page')"
            :icon="['fas', 'arrow-up-right-from-square']"
            @click="openExternalLink(code.signInUrl)"
          />
        </FtFlexBox>
        <p class="signInOtherDevice">
          {{ t('Settings.YouTube Account Settings.Other Device Instructions') }}
        </p>
        <p class="signInUrl">
          {{ code.verificationUrl }}
        </p>
        <p class="signInCode">
          {{ code.userCode }}
        </p>
        <FtFlexBox class="signInActions">
          <FtButton
            :label="t('Settings.YouTube Account Settings.Copy Code')"
            :icon="['fas', 'copy']"
            @click="copyCode"
          />
        </FtFlexBox>
        <div
          class="signInStatus"
          aria-live="polite"
        >
          <FtLoader
            inline
            size="1.5rem"
          />
          <span>{{ t('Settings.YouTube Account Settings.Waiting for Approval') }}</span>
        </div>
      </template>
      <template v-else>
        <p
          class="signInError"
          role="alert"
        >
          {{ error }}
        </p>
        <FtFlexBox class="signInActions">
          <FtButton
            :label="t('Settings.Sync Settings.Try Again')"
            :icon="['fas', 'sync']"
            @click="start"
          />
        </FtFlexBox>
      </template>
    </div>
    <template #footer>
      <FtFlexBox class="signInFooter">
        <FtButton
          :label="t('Cancel')"
          :icon="['fas', 'xmark']"
          @click="close"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtLoader from '../../FtLoader/FtLoader.vue'
import FtPrompt from '../../FtPrompt/FtPrompt.vue'

import store from '../../../store/index'
import { copyToClipboard, openExternalLink, showToast } from '../../../helpers/utils'
import { getSelectedYouTubeProfile } from '../../../helpers/youtube-account-state'
import {
  completeYouTubeSignIn,
  requestYouTubeSignInCode,
  YouTubeSignInError
} from '../../../helpers/api/youtube-account'

const emit = defineEmits(['close'])
const { t } = useI18n()

/** @type {import('vue').Ref<'warning' | 'requesting' | 'waiting' | 'error'>} */
const stage = ref('warning')
/** @type {import('vue').Ref<import('../../../helpers/api/youtube-account').YouTubeSignInCode | null>} */
const code = ref(null)
const error = ref('')

/** @type {AbortController | null} */
let attempt = null

async function start() {
  attempt?.abort()
  const controller = new AbortController()
  attempt = controller
  stage.value = 'requesting'
  code.value = null

  try {
    const signInCode = await requestYouTubeSignInCode()
    if (controller.signal.aborted) return
    code.value = signInCode
    stage.value = 'waiting'

    await completeYouTubeSignIn(signInCode, controller.signal)
    showToast({
      message: t('Settings.YouTube Account Settings.Signed In As', { name: getSelectedYouTubeProfile(store.getters.getYouTubeAccount)?.name ?? '' }),
      icon: ['fas', 'circle-user']
    })
    emit('close')
  } catch (err) {
    if (controller.signal.aborted) return
    console.error(err)
    if (err instanceof YouTubeSignInError) {
      error.value = err.reason === 'denied'
        ? t('Settings.YouTube Account Settings.Sign-In Denied')
        : t('Settings.YouTube Account Settings.Sign-In Code Expired')
    } else {
      error.value = t('Settings.YouTube Account Settings.Sign-In Failed', { error: err?.message ?? String(err) })
    }
    stage.value = 'error'
  }
}

function copyCode() {
  if (!code.value) return
  copyToClipboard(code.value.userCode, {
    messageOnSuccess: t('Settings.YouTube Account Settings.Code Copied')
  })
}

function close() {
  attempt?.abort()
  emit('close')
}

onBeforeUnmount(() => attempt?.abort())
</script>

<style scoped>
.signInContent {
  box-sizing: border-box;
  margin-inline: auto;
  max-inline-size: 38rem;
  padding-block-end: 1rem;
  text-align: center;
}

.signInActions,
.signInFooter {
  justify-content: center;
}

.signInWarning {
  font-weight: 600;
}

.signInOtherDevice {
  color: var(--secondary-text-color);
  margin-block-start: 1.5rem;
}

.signInUrl {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.signInCode {
  font-family: monospace;
  font-size: clamp(2rem, 10vw, 3rem);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 0.15em;
  margin-block: 0.5rem;
  user-select: all;
}

.signInStatus {
  align-items: center;
  color: var(--secondary-text-color);
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  margin-block-start: 0.5rem;
}

.signInError {
  color: var(--error-color, #c62828);
  overflow-wrap: anywhere;
}
</style>
