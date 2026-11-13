<template>
  <FtSettingsSection
    :title="t('Settings.YouTube Account Settings.YouTube Account Settings')"
  >
    <p class="accountWarning">
      <FtIcon
        :icon="['fas', 'triangle-exclamation']"
        class="accountWarningIcon"
        aria-hidden="true"
      />
      <span>{{ t('Settings.YouTube Account Settings.Unofficial App Warning') }}</span>
    </p>
    <template v-if="account">
      <p
        v-if="canSwitch"
        :id="channelLabelId"
        class="profileLabel"
      >
        {{ t('Settings.YouTube Account Settings.YouTube Channel') }}
      </p>
      <div
        class="profileList"
        :role="canSwitch ? 'group' : null"
        :aria-labelledby="canSwitch ? channelLabelId : null"
      >
        <component
          :is="canSwitch ? 'button' : 'div'"
          v-for="profile in profiles"
          :key="profile.pageId ?? 'own'"
          :type="canSwitch ? 'button' : null"
          class="profileOption"
          :class="{ selectedProfile: canSwitch && profile === selectedProfile }"
          :aria-pressed="canSwitch ? profile === selectedProfile : null"
          :disabled="canSwitch && switching ? true : null"
          @click="canSwitch && selectProfile(profile)"
        >
          <FtRetryImage
            :src="profile.thumbnail ?? ''"
            :fallback-icon="['fas', 'circle-user']"
            class="profileAvatar"
            alt=""
          />
          <span class="profileNames">
            <span class="profileName">{{ profile.name }}</span>
            <span
              v-if="profile.handle"
              class="profileHandle"
            >{{ profile.handle }}</span>
          </span>
          <FtIcon
            v-if="canSwitch && profile === selectedProfile"
            :icon="['fas', 'check']"
            class="profileCheck"
            aria-hidden="true"
          />
        </component>
      </div>
      <FtFlexBox>
        <FtToggleSwitch
          :label="t('Settings.YouTube Account Settings.Sync Subscriptions')"
          :default-value="syncSubscriptions"
          setting-key="youTubeAccountSyncSubscriptions"
          :tooltip="t('Tooltips.YouTube Account Settings.Sync Subscriptions')"
          compact
          @change="store.dispatch('updateYouTubeAccountSyncSubscriptions', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.YouTube Account Settings.Sync Playlists')"
          :default-value="syncPlaylists"
          setting-key="youTubeAccountSyncPlaylists"
          :tooltip="t('Tooltips.YouTube Account Settings.Sync Playlists')"
          compact
          @change="store.dispatch('updateYouTubeAccountSyncPlaylists', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.YouTube Account Settings.Add to YouTube Watch History')"
          :default-value="watchHistory"
          setting-key="youTubeAccountWatchHistory"
          :tooltip="t('Tooltips.YouTube Account Settings.Add to YouTube Watch History')"
          compact
          @change="store.dispatch('updateYouTubeAccountWatchHistory', $event)"
        />
      </FtFlexBox>
      <FtFlexBox>
        <FtButton
          :label="t('Settings.YouTube Account Settings.Sync Now')"
          :icon="['fas', 'sync']"
          :disabled="syncing || (!syncSubscriptions && !syncPlaylists)"
          @click="syncNow"
        />
        <FtButton
          :label="t('Settings.YouTube Account Settings.Sign Out')"
          :icon="['fas', 'right-from-bracket']"
          @click="signOut"
        />
      </FtFlexBox>
    </template>
    <FtFlexBox v-else>
      <FtButton
        :label="t('Settings.YouTube Account Settings.Sign In')"
        :icon="['fas', 'right-to-bracket']"
        @click="signInOpen = true"
      />
    </FtFlexBox>
    <YouTubeSignInPrompt
      v-if="signInOpen"
      @close="signInOpen = false"
    />
  </FtSettingsSection>
</template>

<script setup>
import { computed, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtRetryImage from '../../FtRetryImage.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import YouTubeSignInPrompt from './YouTubeSignInPrompt.vue'

import store from '../../../store/index'
import { ERROR_TOAST_ICON, showToast } from '../../../helpers/utils'
import { getSelectedYouTubeProfile } from '../../../helpers/youtube-account-state'
import { syncWithYouTube } from '../../../helpers/youtube-sync'
import {
  refreshYouTubeProfiles,
  signOutOfYouTubeAccount
} from '../../../helpers/api/youtube-account'
import { useYouTubeProfileSwitch } from '../../../composables/useYouTubeProfileSwitch'

const { t } = useI18n()

/** @type {import('vue').ComputedRef<import('../../../helpers/api/youtube-account').YouTubeAccount | null>} */
const account = computed(() => store.getters.getYouTubeAccount)
const syncSubscriptions = computed(() => store.getters.getYouTubeAccountSyncSubscriptions)
const syncPlaylists = computed(() => store.getters.getYouTubeAccountSyncPlaylists)
const watchHistory = computed(() => store.getters.getYouTubeAccountWatchHistory)

const signInOpen = ref(false)
const syncing = ref(false)
const { switching, switchProfile } = useYouTubeProfileSwitch()
const channelLabelId = useId()

const profiles = computed(() => account.value?.profiles ?? [])
const selectedProfile = computed(() => getSelectedYouTubeProfile(account.value))
const canSwitch = computed(() => profiles.value.length > 1)

/** @param {import('../../../helpers/api/youtube-account-parsers').YouTubeProfile} profile */
function selectProfile(profile) {
  if (profile !== selectedProfile.value) switchProfile(profile)
}

// Picks up channels created or removed since signing in.
onMounted(() => {
  if (account.value) refreshYouTubeProfiles().catch(error => console.warn('Could not refresh the YouTube channels', error))
})

async function signOut() {
  try {
    const revoked = await signOutOfYouTubeAccount()
    showToast({
      message: revoked ? t('Settings.YouTube Account Settings.Signed Out') : t('Settings.YouTube Account Settings.Revoke Failed'),
      icon: ['fas', 'right-from-bracket']
    })
  } catch (error) {
    console.error(error)
    showToast({
      message: t('Settings.YouTube Account Settings.Sign Out Failed', { error: error?.message ?? String(error) }),
      icon: ERROR_TOAST_ICON
    })
  }
}

async function syncNow() {
  syncing.value = true
  try {
    if (await syncWithYouTube({ manual: true })) {
      showToast({ message: t('Settings.YouTube Account Settings.Synced'), icon: ['fas', 'sync'] })
    }
  } finally {
    syncing.value = false
  }
}
</script>

<style scoped>
.accountWarning {
  --warning-color: oklch(0.78 0.16 75);

  display: flex;
  align-items: flex-start;
  gap: 12px;
  box-sizing: border-box;
  margin-block: 0 1rem;
  margin-inline: auto;
  max-inline-size: 680px;
  padding-block: 12px;
  padding-inline: 14px;
  border: 1px solid color-mix(in srgb, var(--warning-color) 45%, transparent);
  border-radius: var(--shape-corner-medium);
  background-color: color-mix(in srgb, var(--warning-color) 12%, var(--card-bg-color));
  color: var(--primary-text-color);
  line-height: 1.4;
}

.accountWarningIcon {
  flex: none;
  margin-block-start: 0.15em;
  color: var(--warning-color);
}

/* Lines up with the section's controls, which are padded divs. */
.profileLabel {
  font-weight: 600;
  margin-block: 1rem 0.5rem;
  padding-inline: 20px;
}

.profileList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-block: 1rem;
}

.profileLabel + .profileList {
  margin-block-start: 0;
}

.profileOption {
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  inline-size: 100%;
  padding-block: 8px;
  padding-inline: 12px;
  border: 0;
  border-radius: var(--shape-corner-medium, 12px);
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
}

button.profileOption {
  cursor: pointer;
}

button.profileOption:disabled {
  cursor: default;
  opacity: 0.6;
}

button.profileOption:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

button.profileOption:hover:not(:disabled) {
  background-color: var(--side-nav-hover-color);
}

.selectedProfile,
button.selectedProfile:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--primary-color) 14%, transparent);
}

.profileAvatar {
  block-size: 40px;
  border-radius: 50%;
  flex: none;
  font-size: 40px;
  inline-size: 40px;
  object-fit: cover;
}

.profileNames {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-inline-size: 0;
}

.profileName,
.profileHandle {
  overflow-wrap: anywhere;
}

.profileName {
  font-weight: 600;
}

.profileHandle {
  color: var(--secondary-text-color);
}

.profileCheck {
  color: var(--primary-color);
  flex: none;
}
</style>
