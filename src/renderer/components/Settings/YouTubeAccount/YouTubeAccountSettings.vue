<template>
  <FtSettingsSection
    :title="t('Settings.YouTube Account Settings.YouTube Account Settings')"
    :icon="['fas', 'circle-user']"
  >
    <p class="accountWarning settingsNotice">
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
      <div class="settingsRows">
        <FtSettingsRow
          :description="t('Tooltips.YouTube Account Settings.Sync Subscriptions')"
          :title="t('Settings.YouTube Account Settings.Sync Subscriptions')"
          :icon="['fas', 'subscriptions']"
        >
          <FtToggleSwitch
            :label="t('Settings.YouTube Account Settings.Sync Subscriptions')"
            hide-label
            :default-value="syncSubscriptions"
            setting-key="youTubeAccountSyncSubscriptions"
            @change="store.dispatch('updateYouTubeAccountSyncSubscriptions', $event)"
          />
        </FtSettingsRow>
        <FtSettingsRow
          :tooltip="t('Tooltips.YouTube Account Settings.Sync Playlists')"
          :title="t('Settings.YouTube Account Settings.Sync Playlists')"
          :icon="['fas', 'playlist-merge']"
        >
          <FtToggleSwitch
            :label="t('Settings.YouTube Account Settings.Sync Playlists')"
            hide-label
            :default-value="syncPlaylists"
            setting-key="youTubeAccountSyncPlaylists"
            controlled
            @change="changeSyncPlaylists"
          />
        </FtSettingsRow>
        <FtSettingsRow
          :description="t('Tooltips.YouTube Account Settings.YouTube Watch History')"
          :title="t('Settings.YouTube Account Settings.YouTube Watch History')"
          :icon="['fas', 'clock-rotate-left']"
        >
          <FtToggleSwitch
            :label="t('Settings.YouTube Account Settings.YouTube Watch History')"
            hide-label
            :default-value="historyPaused === false"
            :disabled="historyPaused === null || pausingHistory"
            controlled
            @change="setHistoryPaused(!$event)"
          />
        </FtSettingsRow>
        <FtSettingsRow
          :description="t('Tooltips.YouTube Account Settings.Add to YouTube Watch History')"
          :title="t('Settings.YouTube Account Settings.Add to YouTube Watch History')"
          :icon="['fas', 'circle-play']"
        >
          <FtToggleSwitch
            :label="t('Settings.YouTube Account Settings.Add to YouTube Watch History')"
            hide-label
            :default-value="watchHistory"
            setting-key="youTubeAccountWatchHistory"
            :disabled="historyPaused === true"
            @change="store.dispatch('updateYouTubeAccountWatchHistory', $event)"
          />
        </FtSettingsRow>
        <FtSettingsRow
          :tooltip="t('Tooltips.YouTube Account Settings.Rate Videos')"
          :title="t('Settings.YouTube Account Settings.Rate Videos')"
          :icon="['fas', 'thumbs-up']"
        >
          <FtToggleSwitch
            :label="t('Settings.YouTube Account Settings.Rate Videos')"
            hide-label
            :default-value="videoRatings"
            setting-key="youTubeAccountVideoRatings"
            @change="store.dispatch('updateYouTubeAccountVideoRatings', $event)"
          />
        </FtSettingsRow>
        <FtSettingsRow
          v-if="supportsNotificationHistory"
          :description="t('Tooltips.YouTube Account Settings.Watch Posted Comments')"
          :title="t('Settings.YouTube Account Settings.Watch Posted Comments')"
          :icon="['fas', 'comment-unread']"
        >
          <FtToggleSwitch
            :label="t('Settings.YouTube Account Settings.Watch Posted Comments')"
            hide-label
            :default-value="store.getters.getYouTubeAccountReplyNotifications"
            setting-key="youTubeAccountReplyNotifications"
            :disabled="!isCommentWatchingEnabled()"
            @change="store.dispatch('updateYouTubeAccountReplyNotifications', $event)"
          />
        </FtSettingsRow>
      </div>
      <FtFlexBox>
        <FtButton
          :label="t('Settings.YouTube Account Settings.Sync Now')"
          :icon="['fas', 'arrows-rotate']"
          :disabled="syncing || (!syncSubscriptions && !syncPlaylists)"
          @click="syncNow"
        />
        <FtButton
          :label="t('Settings.YouTube Account Settings.Import Watch History')"
          :icon="['fas', 'clock-rotate-left']"
          :disabled="importingHistory"
          @click="importPromptOpen = true"
        />
        <FtButton
          :label="t('Settings.YouTube Account Settings.Sign Out')"
          :icon="['fas', 'right-from-bracket']"
          @click="signOut"
        />
      </FtFlexBox>
      <FtPrompt
        v-if="importPromptOpen"
        :label="t('Settings.YouTube Account Settings.Import Watch History')"
        :extra-labels="[t('Settings.YouTube Account Settings.Import Watch History Confirmation')]"
        :option-names="[t('Settings.YouTube Account Settings.Import Watch History'), t('Cancel')]"
        :option-values="['import', 'cancel']"
        :option-icons="[['fas', 'clock-rotate-left'], ['fas', 'xmark']]"
        autosize
        @click="handleImportPrompt"
      />
      <FtPrompt
        v-if="keepPlaylistsPrompt"
        :label="t('Settings.YouTube Account Settings.Keep Playlists Confirmation')"
        :extra-labels="[t('Settings.YouTube Account Settings.Keep Playlists Details')]"
        :option-names="[t('Settings.YouTube Account Settings.Keep Playlists'), t('Settings.YouTube Account Settings.Remove Playlists'), t('Cancel')]"
        :option-values="['keep', 'remove', 'cancel']"
        :option-icons="[['fas', 'floppy-disk'], ['fas', 'trash'], ['fas', 'xmark']]"
        autosize
        @click="handleKeepPlaylistsPrompt"
      />
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
import { computed, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtPrompt from '../../FtPrompt/FtPrompt.vue'
import FtRetryImage from '../../FtRetryImage.vue'
import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import YouTubeSignInPrompt from './YouTubeSignInPrompt.vue'

import store from '../../../store/index'
import { ERROR_TOAST_ICON, showToast } from '../../../helpers/utils'
import { getSelectedYouTubeProfile, getYouTubeSyncKey } from '../../../helpers/youtube-account-state'
import { supportsNotificationHistory } from '../../../helpers/notificationHistory'
import { isCommentWatchingEnabled } from '../../../helpers/commentReplyNotifications'
import {
  enableYouTubePlaylistSync,
  hasYouTubePlaylists,
  importYouTubeWatchHistory,
  keepYouTubePlaylists,
  syncWithYouTube
} from '../../../helpers/youtube-sync'
import {
  isYouTubeWatchHistoryPaused,
  refreshYouTubeProfiles,
  setYouTubeWatchHistoryPaused,
  signOutOfYouTubeAccount
} from '../../../helpers/api/youtube-account'
import { useYouTubeProfileSwitch } from '../../../composables/useYouTubeProfileSwitch'

const { t } = useI18n()

/** @type {import('vue').ComputedRef<import('../../../helpers/api/youtube-account').YouTubeAccount | null>} */
const account = computed(() => store.getters.getYouTubeAccount)
const syncSubscriptions = computed(() => store.getters.getYouTubeAccountSyncSubscriptions)
const syncPlaylists = computed(() => store.getters.getYouTubeAccountSyncPlaylists)
const watchHistory = computed(() => store.getters.getYouTubeAccountWatchHistory)
const videoRatings = computed(() => store.getters.getYouTubeAccountVideoRatings)

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

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

// Whether the channel in use has its YouTube watch history paused, on every
// device. Null until known.
const historyPaused = ref(/** @type {boolean | null} */ (null))
const pausingHistory = ref(false)

// Counts the reads of the pause state and its saved changes, so an older
// read can't replace a newer result, also across account switches.
let historyPauseUpdate = 0

watch(() => getYouTubeSyncKey(account.value), async (key) => {
  const update = ++historyPauseUpdate
  historyPaused.value = null
  if (!key) return
  try {
    const paused = await isYouTubeWatchHistoryPaused()
    if (update === historyPauseUpdate) historyPaused.value = paused
  } catch (error) {
    console.warn('Could not read whether the YouTube watch history is paused', error)
  }
}, { immediate: true })

/** @param {boolean} paused */
async function setHistoryPaused(paused) {
  const key = getYouTubeSyncKey(account.value)
  pausingHistory.value = true
  try {
    await setYouTubeWatchHistoryPaused(paused)
    // Holds for this channel, even when a read for it started meanwhile.
    if (getYouTubeSyncKey(account.value) === key) {
      historyPauseUpdate++
      historyPaused.value = paused
    }
  } catch (error) {
    console.error(error)
    showToast({
      message: t('Settings.YouTube Account Settings.Watch History Change Failed', { error: errorMessage(error) }),
      icon: ERROR_TOAST_ICON
    })
  } finally {
    pausingHistory.value = false
  }
}

const importPromptOpen = ref(false)
const importingHistory = ref(false)

/** @param {string | null} choice */
async function handleImportPrompt(choice) {
  importPromptOpen.value = false
  if (choice !== 'import' || importingHistory.value) return
  importingHistory.value = true
  try {
    const count = await importYouTubeWatchHistory()
    showToast({ message: t('Settings.YouTube Account Settings.Watch History Imported', { count }, count), icon: ['fas', 'clock-rotate-left'] })
  } catch (error) {
    console.error(error)
    showToast({
      message: t('Settings.YouTube Account Settings.Import Watch History Failed', { error: errorMessage(error) }),
      icon: ERROR_TOAST_ICON
    })
  } finally {
    importingHistory.value = false
  }
}

// Signing out and turning playlist sync off remove the synced playlists from
// this device, unless the user keeps them.
const keepPlaylistsPrompt = ref(/** @type {(() => Promise<boolean>) | null} */ (null))

/**
 * @param {() => Promise<boolean>} end signs out or turns playlist sync off, and resolves to whether it succeeded
 */
async function endPlaylistSync(end) {
  // Asks when unsure, as ending the sync without asking removes the playlists.
  let hasPlaylists = true
  try {
    hasPlaylists = await hasYouTubePlaylists()
  } catch (error) {
    console.error(error)
  }
  if (hasPlaylists) {
    keepPlaylistsPrompt.value = end
  } else {
    await end()
  }
}

/** @param {string | null} choice */
async function handleKeepPlaylistsPrompt(choice) {
  const end = keepPlaylistsPrompt.value
  keepPlaylistsPrompt.value = null
  if (!end) return
  if (choice === 'remove') {
    await end()
  } else if (choice === 'keep') {
    try {
      await keepYouTubePlaylists(end)
    } catch (error) {
      console.error(error)
      showToast({
        message: t('Settings.YouTube Account Settings.Keep Playlists Failed', { error: errorMessage(error) }),
        icon: ERROR_TOAST_ICON
      })
    }
  }
}

/** @param {boolean} value */
function changeSyncPlaylists(value) {
  if (value) enableYouTubePlaylistSync()
  else endPlaylistSync(() => store.dispatch('updateYouTubeAccountSyncPlaylists', false))
}

function signOut() {
  endPlaylistSync(finishSignOut)
}

/** @returns {Promise<boolean>} whether the account was removed from this device */
async function finishSignOut() {
  try {
    const revoked = await signOutOfYouTubeAccount()
    showToast({
      message: revoked ? t('Settings.YouTube Account Settings.Signed Out') : t('Settings.YouTube Account Settings.Revoke Failed'),
      icon: ['fas', 'right-from-bracket']
    })
    return true
  } catch (error) {
    console.error(error)
    showToast({
      message: t('Settings.YouTube Account Settings.Sign Out Failed', { error: error?.message ?? String(error) }),
      icon: ERROR_TOAST_ICON
    })
    return false
  }
}

async function syncNow() {
  syncing.value = true
  try {
    if (await syncWithYouTube({ manual: true })) {
      showToast({ message: t('Settings.YouTube Account Settings.Synced'), icon: ['fas', 'arrows-rotate'] })
    }
  } finally {
    syncing.value = false
  }
}
</script>

<style scoped>
.accountWarning {
  --warning-color: oklch(78% 0.16 75deg);

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

  /* Follows the text's lightness, so the icon stays readable on light and dark cards. */
  color: oklch(from var(--primary-text-color) clamp(0.5, l, 0.82) 0.15 75deg);
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

/* Only the button form can be enabled, disabled, or focused. */
.profileOption:enabled {
  cursor: pointer;
}

.profileOption:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.profileOption:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.profileOption:enabled:hover {
  background-color: var(--side-nav-hover-color);
}

.selectedProfile,
.selectedProfile:enabled:hover {
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
