<template>
  <div
    ref="rootRef"
    class="profileSettingsContent"
  >
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
      <div
        v-if="!isNewProfileOpen"
        class="profileTabs"
        role="tablist"
        :aria-label="$t('Profile.Profile Settings')"
      >
        <button
          :id="customizationTabId"
          ref="customizationTabRef"
          type="button"
          class="profileTab"
          :class="{ selected: activeTab === 'customization' }"
          role="tab"
          :aria-controls="customizationPanelId"
          :aria-selected="activeTab === 'customization'"
          :tabindex="activeTab === 'customization' ? 0 : -1"
          @click="activateTab('customization')"
          @keydown.left.right.prevent="activateTab('subscriptions', true)"
          @keydown.home.prevent="activateTab('customization', true)"
          @keydown.end.prevent="activateTab('subscriptions', true)"
        >
          <FtIcon
            :icon="['fas', 'palette']"
            aria-hidden="true"
          />
          {{ $t('Profile.Customization') }}
        </button>
        <button
          :id="subscriptionsTabId"
          ref="subscriptionsTabRef"
          type="button"
          class="profileTab"
          :class="{ selected: activeTab === 'subscriptions' }"
          role="tab"
          :aria-controls="subscriptionsPanelId"
          :aria-selected="activeTab === 'subscriptions'"
          :tabindex="activeTab === 'subscriptions' ? 0 : -1"
          @click="activateTab('subscriptions')"
          @keydown.left.right.prevent="activateTab('customization', true)"
          @keydown.home.prevent="activateTab('customization', true)"
          @keydown.end.prevent="activateTab('subscriptions', true)"
        >
          <FtIcon
            :icon="['fas', 'users']"
            aria-hidden="true"
          />
          {{ $t('Profile.Manage Profile Subscriptions') }}
        </button>
      </div>
      <div
        v-show="isNewProfileOpen || activeTab === 'customization'"
        :id="customizationPanelId"
        :role="isNewProfileOpen ? undefined : 'tabpanel'"
        :aria-labelledby="isNewProfileOpen ? undefined : customizationTabId"
      >
        <FtProfileEdit
          :profile="openSettingsProfile"
          :is-active="isNewProfileOpen || activeTab === 'customization'"
          :is-new="isNewProfileOpen"
          :is-main-profile="isMainProfile"
          @new-profile-created="closeProfileCreation"
          @cancel-creation="closeProfileCreation"
          @profile-deleted="handleProfileDeleted"
        />
      </div>
      <div
        v-if="!isNewProfileOpen"
        v-show="activeTab === 'subscriptions'"
        :id="subscriptionsPanelId"
        role="tabpanel"
        :aria-labelledby="subscriptionsTabId"
      >
        <FtProfileChannelList
          :profile="openSettingsProfile"
          :is-main-profile="isMainProfile"
        />
        <FtProfileFilterChannelsList
          v-if="!isMainProfile"
          :profile="openSettingsProfile"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
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
import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'

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
const activeTab = ref('customization')
const rootRef = useTemplateRef('rootRef')
const customizationTabRef = useTemplateRef('customizationTabRef')
const subscriptionsTabRef = useTemplateRef('subscriptionsTabRef')
const customizationTabId = useId()
const customizationPanelId = useId()
const subscriptionsTabId = useId()
const subscriptionsPanelId = useId()

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
  activeTab.value = 'customization'
  openSettingsProfileId.value = profileId
  openSettingsProfile.value = getProfileById(profileId)
}

async function activateTab(tab, focus = false) {
  const changed = activeTab.value !== tab
  activeTab.value = tab
  await nextTick()

  if (focus) {
    const tabElement = tab === 'customization' ? customizationTabRef.value : subscriptionsTabRef.value
    tabElement?.focus({ preventScroll: true })
  }
  if (changed) {
    const scrollViewport = rootRef.value?.closest('.settingsSubpageScroll')
    if (scrollViewport) restoreOverlayScrollTop(scrollViewport, 0)
  }
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
