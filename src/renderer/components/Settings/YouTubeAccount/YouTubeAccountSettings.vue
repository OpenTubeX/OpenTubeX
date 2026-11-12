<template>
  <FtSettingsSection
    :title="t('Settings.YouTube Account Settings.YouTube Account Settings')"
  >
    <p class="accountWarning">
      <strong>{{ t('Settings.YouTube Account Settings.Unofficial App Warning') }}</strong>
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
          :label="t('Settings.YouTube Account Settings.Subscribe on YouTube')"
          :default-value="mirrorSubscriptions"
          setting-key="youTubeAccountMirrorSubscriptions"
          :tooltip="t('Tooltips.YouTube Account Settings.Subscribe on YouTube')"
          compact
          @change="store.dispatch('updateYouTubeAccountMirrorSubscriptions', $event)"
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
          :label="t('Settings.YouTube Account Settings.Import Subscriptions')"
          :icon="['fas', 'download']"
          :disabled="importing"
          @click="importSubscriptions"
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
import { MAIN_PROFILE_ID } from '../../../../constants'
import { ERROR_TOAST_ICON, showToast } from '../../../helpers/utils'
import { getSelectedYouTubeProfile } from '../../../helpers/youtube-account-state'
import {
  getYouTubeAccountSubscriptions,
  refreshYouTubeProfiles,
  selectYouTubeProfile,
  signOutOfYouTubeAccount
} from '../../../helpers/api/youtube-account'

const { t } = useI18n()

/** @type {import('vue').ComputedRef<import('../../../helpers/api/youtube-account').YouTubeAccount | null>} */
const account = computed(() => store.getters.getYouTubeAccount)
const mirrorSubscriptions = computed(() => store.getters.getYouTubeAccountMirrorSubscriptions)
const watchHistory = computed(() => store.getters.getYouTubeAccountWatchHistory)

const signInOpen = ref(false)
const importing = ref(false)
const switching = ref(false)
const channelLabelId = useId()

const profiles = computed(() => account.value?.profiles ?? [])
const selectedProfile = computed(() => getSelectedYouTubeProfile(account.value))
const canSwitch = computed(() => profiles.value.length > 1)

/** @param {import('../../../helpers/api/youtube-account-parsers').YouTubeProfile} profile */
async function selectProfile(profile) {
  if (profile === selectedProfile.value || switching.value) return
  switching.value = true
  try {
    await selectYouTubeProfile(profile.pageId)
    showToast({ message: t('Settings.YouTube Account Settings.Using Channel', { name: profile.name }), icon: ['fas', 'circle-user'] })
  } catch (error) {
    console.error(error)
    showToast({
      message: t('Settings.YouTube Account Settings.Switch Channel Failed', { error: error?.message ?? String(error) }),
      icon: ERROR_TOAST_ICON
    })
  } finally {
    switching.value = false
  }
}

// Picks up channels created or removed since signing in.
onMounted(() => {
  if (account.value) refreshYouTubeProfiles().catch(error => console.warn('Could not refresh the YouTube channels', error))
})

async function signOut() {
  await signOutOfYouTubeAccount()
  showToast({ message: t('Settings.YouTube Account Settings.Signed Out'), icon: ['fas', 'right-from-bracket'] })
}

async function importSubscriptions() {
  importing.value = true
  // The profile active when the import started, even if the user switches meanwhile.
  const profileIds = new Set([MAIN_PROFILE_ID, store.getters.getActiveProfile._id])
  try {
    const channels = await getYouTubeAccountSubscriptions()
    if (channels.length === 0) {
      showToast({ message: t('Settings.YouTube Account Settings.No Subscriptions to Import'), icon: ['fas', 'subscriptions'] })
      return
    }

    for (const profileId of profileIds) {
      if (await store.dispatch('mergeImportedProfile', { _id: profileId, subscriptions: channels }) !== true) {
        throw new Error('Could not save the imported subscriptions')
      }
    }
    showToast({
      message: t('Settings.YouTube Account Settings.Imported Subscriptions', { count: channels.length }, channels.length),
      icon: ['fas', 'subscriptions']
    })
  } catch (error) {
    console.error(error)
    showToast({
      message: t('Settings.YouTube Account Settings.Import Subscriptions Failed', { error: error?.message ?? String(error) }),
      icon: ERROR_TOAST_ICON
    })
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
/* Like the yt-dlp cookie hint in the same category. */
.accountWarning {
  margin-block: 0 8px;
  margin-inline: auto;
  max-inline-size: 680px;
  padding-inline: 14px;
  text-align: center;
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
