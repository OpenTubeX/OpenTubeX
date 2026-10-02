<template>
  <div class="profileSettingsContent">
    <FtCard
      v-if="!isNewProfileOpen"
      class="card"
    >
      <h2>{{ $t("Profile.Profile Manager") }}</h2>
      <FtFlexBox
        class="profileList"
      >
        <FtProfileBubble
          v-for="profile in profileList"
          :key="profile._id"
          :is-main-profile="profile._id === MAIN_PROFILE_ID"
          :profile-name="profile.name"
          :background-color="profile.bgColor"
          :text-color="profile.textColor"
          :icon="profile.icon"
          :class="{ openedProfile: openSettingsProfile?._id === profile._id }"
          @click="openSettingsForProfileWithId(profile._id)"
        />
        <button
          type="button"
          class="createProfileOption"
          @click="openSettingsForNewProfile"
        >
          <FtIcon
            class="createProfileIcon"
            :icon="['fas', 'user-plus']"
            aria-hidden="true"
          />
          <span class="createProfileLabel">{{ $t('Profile.Create New Profile') }}</span>
        </button>
      </FtFlexBox>
    </FtCard>
    <h2
      v-else
      class="createProfileHeading"
    >
      <FtIcon
        :icon="['fas', 'user-plus']"
        aria-hidden="true"
      />
      {{ $t('Profile.Create New Profile') }}
    </h2>
    <div
      v-if="openSettingsProfile"
      :key="openSettingsProfileId"
    >
      <FtProfileEdit
        :profile="openSettingsProfile"
        :is-new="isNewProfileOpen"
        :is-main-profile="isMainProfile"
        @new-profile-created="closeProfileCreation"
        @cancel-creation="closeProfileCreation"
        @profile-deleted="handleProfileDeleted"
      />
      <h2
        v-if="!isNewProfileOpen"
        class="profileSubscriptionsHeading"
      >
        {{ $t('Profile.Manage Profile Subscriptions') }}
      </h2>
      <FtProfileChannelList
        v-if="!isNewProfileOpen"
        :profile="openSettingsProfile"
        :is-main-profile="isMainProfile"
      />
      <FtProfileFilterChannelsList
        v-if="!isNewProfileOpen && !isMainProfile"
        :profile="openSettingsProfile"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import { FtIcon } from '@opentubex/icons'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtProfileBubble from '../../components/FtProfileBubble/FtProfileBubble.vue'
import FtProfileEdit from '../../components/FtProfileEdit/FtProfileEdit.vue'
import FtProfileChannelList from '../../components/FtProfileChannelList/FtProfileChannelList.vue'
import FtProfileFilterChannelsList from '../../components/FtProfileFilterChannelsList/FtProfileFilterChannelsList.vue'

import store from '../../store/index'

import { MAIN_PROFILE_ID, THEME_BG_COLOR, THEME_TEXT_COLOR } from '../../../constants'
import { DEFAULT_PROFILE_ICON } from '../../helpers/profileIcons'

/**
 * @typedef {object} Profile
 * @property {string} _id
 * @property {string} name
 * @property {string} bgColor
 * @property {string} textColor
 * @property {{type: 'icon'|'emoji'|'image', value: string}|{type: 'initial'}|null|undefined} icon
 * @property {object[]} subscriptions
 * @property {string} subscriptions[].id
 * @property {string|undefined} subscriptions[].name
 * @property {string|undefined} subscriptions[].thumbnail
 */

const isNewProfileOpen = ref(false)

/** @type {import('vue').Ref<string>} */
const openSettingsProfileId = ref('')

/** @type {import('vue').ShallowRef<Profile|null>} */
const openSettingsProfile = shallowRef(null)

/** @type {import('vue').ComputedRef<Profile[]>} */
const profileList = computed(() => {
  return store.getters.getProfileList
})

watch(profileList, () => {
  openSettingsProfile.value = getProfileById(openSettingsProfileId.value)
}, { deep: true })

const isMainProfile = computed(() => {
  return MAIN_PROFILE_ID === openSettingsProfileId.value
})

function openSettingsForNewProfile() {
  isNewProfileOpen.value = true

  openSettingsProfile.value = {
    name: '',
    bgColor: THEME_BG_COLOR,
    textColor: THEME_TEXT_COLOR,
    icon: { ...DEFAULT_PROFILE_ICON },
    subscriptions: []
  }

  openSettingsProfileId.value = ''
}

/**
 * @param {string} profileId
 */
function openSettingsForProfileWithId(profileId) {
  if (profileId === openSettingsProfileId.value) {
    return
  }

  isNewProfileOpen.value = false
  openSettingsProfileId.value = profileId
  openSettingsProfile.value = getProfileById(profileId)
}

/**
 * @param {string | null} profileId
 */
function getProfileById(profileId) {
  if (!profileId) {
    return null
  }

  return store.getters.profileById(profileId)
}

function closeProfileCreation() {
  isNewProfileOpen.value = false
  openSettingsProfile.value = null
  openSettingsProfileId.value = ''
}

function handleProfileDeleted() {
  openSettingsProfile.value = null
  openSettingsProfileId.value = ''
}
</script>

<style scoped src="./ProfileSettings.css" />
