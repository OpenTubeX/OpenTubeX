<template>
  <div>
    <FtCard class="card">
      <h2>
        {{ $t("Profile.Other Channels") }}
      </h2>
      <FtFlexBox>
        <FtSelect
          :placeholder="$t('Profile.Profile Filter')"
          :value="profileIdList[filteredProfileIndex]"
          :select-names="profileNameList"
          :select-values="profileIdList"
          :icon="['fas', 'filter']"
          @change="handleProfileFilterChange"
        />
      </FtFlexBox>
      <p
        v-if="showUnsubscribeButton"
        class="selected"
      >
        {{ selectedText }}
      </p>
      <p
        v-if="visibleChannels.length === 0 && channels.length > 0"
        class="noResults"
      >
        {{ $t('Settings.Channel Settings.No Matching Channels') }}
      </p>
      <FtFlexBox ref="channelGrid">
        <FtChannelBubble
          v-for="channel in displayedChannels"
          :key="channel.id"
          :channel-id="channel.id"
          :channel-name="channel.name"
          :channel-thumbnail="channel.thumbnail"
          :selectable="showUnsubscribeButton"
          :selected="selected.has(channel.id)"
          @change="handleChannelToggle(channel.id)"
        />
      </FtFlexBox>
      <!-- Mounting every subscription at once takes seconds on slower devices -->
      <FtAutoLoadNextPageWrapper
        v-if="hasMoreChannels"
        :key="channelPage"
        @load-next-page="channelPage++"
      >
        <FtFlexBox>
          <FtButton
            :label="$t('Channels.Load More Channels')"
            :icon="['fas', 'arrow-down']"
            @click="loadMoreChannels"
          />
        </FtFlexBox>
      </FtAutoLoadNextPageWrapper>
      <FtFlexBox
        v-if="showUnsubscribeButton"
      >
        <FtButton
          :label="$t('Profile.Select All')"
          :icon="['fas', 'check']"
          @click="selectAll"
        />
        <FtButton
          :label="$t('Profile.Select None')"
          :icon="['fas', 'xmark']"
          @click="selectNone"
        />
        <FtButton
          :label="$t('Profile.Add Selected To Profile')"
          :icon="['fas', 'user-plus']"
          text-color="var(--text-with-main-color)"
          background-color="var(--primary-color)"
          @click="addChannelsToProfile"
        />
      </FtFlexBox>
    </FtCard>
  </div>
</template>

<script setup>
import { computed, reactive, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../ft-card/ft-card.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtChannelBubble from '../FtChannelBubble/FtChannelBubble.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtAutoLoadNextPageWrapper from '../FtAutoLoadNextPageWrapper.vue'

import store from '../../store/index'

import { useListPagination } from '../../composables/useListPagination'
import { deepCopy, showToast } from '../../helpers/utils'
import { matchesChannelQuery } from '../../helpers/subscription-channels'
import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { MAIN_PROFILE_ID } from '../../../constants'

/**
 * @typedef {object} Profile
 * @property {string} _id
 * @property {string} name
 * @property {string} bgColor
 * @property {string} textColor
 * @property {object[]} subscriptions
 * @property {string} subscriptions[].id
 * @property {string|undefined} subscriptions[].name
 * @property {string|undefined} subscriptions[].thumbnail
 */

const { locale, t } = useI18n()

const props = defineProps({
  profile: {
    type: Object,
    required: true
  },
  query: {
    type: String,
    default: ''
  }
})

/** @type {import('vue').ComputedRef<Profile[]>} */
const profileList = computed(() => {
  return store.getters.getProfileList
})

/** @type {import('vue').ShallowRef<string[]>} */
const profileIdList = shallowRef([])

/** @type {import('vue').ShallowRef<string[]>} */
const profileNameList = shallowRef([])

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
})

const intlCollator = computed(() => {
  return new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' })
})

/** @type {import('vue').ComputedRef<boolean>} */
const showUnsubscribeButton = computed(() => {
  return !store.getters.getHideUnsubscribeButton
})

const filteredProfileIndex = ref(0)

/** @type {import('vue').ShallowRef<Profile['subscriptions']>} */
const channels = shallowRef([])

function loadChannels() {
  const profileId = profileIdList.value[filteredProfileIndex.value]
  const profile = profileList.value.find((profile) => profile._id === profileId)

  const subscribedIds = new Set(props.profile.subscriptions.map(channel => channel.id))

  /** @type {Profile['subscriptions']} */
  const channels_ = deepCopy(profile.subscriptions.filter(channel => !subscribedIds.has(channel.id)))

  const collator = intlCollator.value

  channels_.sort((a, b) => collator.compare(a.name, b.name))

  if (backendPreference.value === 'invidious') {
    const instanceUrl = currentInvidiousInstanceUrl.value

    channels_.forEach((channel) => {
      channel.thumbnail = youtubeImageUrlToInvidious(channel.thumbnail, instanceUrl)
    })
  }

  channels.value = channels_
}

fillProfileList()

if (typeof props.profile.subscriptions !== 'undefined') {
  loadChannels()
}

watch(() => props.profile, (profile, oldProfile) => {
  loadChannels()
  if (profile._id !== oldProfile._id) {
    selectNone()
    return
  }
  // Feed refreshes update channel names and thumbnails, so only drop channels that are gone
  const channelIds = new Set(channels.value.map(channel => channel.id))
  selected.forEach(channelId => {
    if (!channelIds.has(channelId)) selected.delete(channelId)
  })
}, { deep: 2 })

watch(filteredProfileIndex, loadChannels)

const visibleChannels = computed(() => {
  const query = props.query.trim().toLowerCase()
  if (query === '') return channels.value
  return channels.value.filter(channel => matchesChannelQuery(channel, query))
})

const channelGrid = useTemplateRef('channelGrid')
const { page: channelPage, displayedItems: displayedChannels, hasMore: hasMoreChannels, loadMore: loadMoreChannels } = useListPagination(visibleChannels, {
  pageSize: 100,
  append: true,
  resetOn: [filteredProfileIndex, () => props.query],
  focusItem: index => channelGrid.value?.$el.querySelectorAll('.bubblePadding')[index]?.focus()
})

/** @type {import('vue').Reactive<Set<string>>} */
const selected = reactive(new Set())

const selectedText = computed(() => {
  return t('Profile.{number} selected', { number: selected.size })
})

// Selections outside the search results stay, so channels can be gathered across searches
function selectAll() {
  visibleChannels.value.forEach(channel => {
    return selected.add(channel.id)
  })
}

function selectNone() {
  selected.clear()
}

/**
 * @param {string} channelId
 */
function handleChannelToggle(channelId) {
  if (selected.has(channelId)) {
    selected.delete(channelId)
  } else {
    selected.add(channelId)
  }
}

watch(profileList, fillProfileList, { deep: 2 })
watch(() => props.profile, fillProfileList)

function fillProfileList() {
  const profiles = profileList.value.filter((profile) => profile._id !== props.profile._id)

  profileIdList.value = profiles.map((profile) => profile._id)
  profileNameList.value = profiles.map(translateProfileName)
}

/**
 * @param {Profile} profile
 */
function translateProfileName(profile) {
  return profile._id === MAIN_PROFILE_ID ? t('Profile.All Channels') : profile.name
}

/**
 * @param {string} profileId
 */
function handleProfileFilterChange(profileId) {
  selectNone()
  filteredProfileIndex.value = profileIdList.value.indexOf(profileId)
}

function addChannelsToProfile() {
  if (selected.size === 0) {
    showToast({ message: t('Profile.No channel(s) have been selected'), icon: ['fas', 'circle-exclamation'] })
  } else {
    const profileId = profileIdList.value[filteredProfileIndex.value]
    const subscriptions = profileList.value
      .find((profile) => profile._id === profileId)
      .subscriptions
      .filter((channel) => selected.has(channel.id))

    // Push only the selected channels, like subscribing, so channels changed elsewhere stay
    for (const channel of deepCopy(subscriptions)) {
      store.dispatch('addChannelToProfiles', { channel, profileIds: [props.profile._id] })
    }
    showToast({ message: t('Profile.Profile has been updated'), icon: ['fas', 'user-check'] })
    selectNone()
  }
}
</script>

<style scoped src="./FtProfileFilterChannelsList.css" />
