<template>
  <div>
    <FtCard class="card">
      <h2>
        {{ $t("Profile.Subscription List") }}
      </h2>
      <p
        v-if="showUnsubscribeButton"
        class="selectedCount"
      >
        {{ selectedText }}
      </p>
      <FtFlexBox
        v-if="showUnsubscribeButton"
        class="selectionActions"
      >
        <FtButton
          :label="$t('Profile.Select All')"
          :icon="['fas', 'check']"
          :disabled="allVisibleSelected"
          @click="selectAll"
        />
        <FtButton
          :label="$t('Profile.Select None')"
          :icon="['fas', 'xmark']"
          :disabled="selected.size === 0"
          @click="selectNone"
        />
        <FtButton
          :label="$t('Profile.Delete Selected')"
          :icon="['fas', 'trash']"
          theme="destructive"
          :disabled="selected.size === 0"
          @click="displayDeletePrompt"
        />
      </FtFlexBox>
      <p
        v-if="visibleSubscriptions.length === 0 && subscriptions.length > 0"
        class="noResults"
      >
        {{ $t('Settings.Channel Settings.No Matching Channels') }}
      </p>
      <div
        ref="channelScroller"
        v-overlay-scrollbars
        class="channelScroller"
      >
        <FtFlexBox ref="channelGrid">
          <FtChannelBubble
            v-for="channel in displayedSubscriptions"
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
          v-if="hasMoreSubscriptions"
          :key="subscriptionPage"
          class="loadMore"
          @load-next-page="subscriptionPage++"
        >
          <FtFlexBox>
            <FtButton
              :label="$t('Channels.Load More Channels')"
              :icon="['fas', 'arrow-down']"
              @click="loadMoreSubscriptions"
            />
          </FtFlexBox>
        </FtAutoLoadNextPageWrapper>
      </div>
    </FtCard>
    <FtPrompt
      v-if="showDeletePrompt"
      autosize
      :label="deletePromptMessage"
      :option-names="deletePromptNames"
      :option-values="DELTE_PROMPT_VALUES"
      :option-icons="[['fas', 'trash'], ['fas', 'xmark']]"
      :is-first-option-destructive="true"
      @click="handleDeletePromptClick"
    />
  </div>
</template>

<script setup>
import { computed, reactive, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../ft-card/ft-card.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtChannelBubble from '../FtChannelBubble/FtChannelBubble.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtAutoLoadNextPageWrapper from '../FtAutoLoadNextPageWrapper.vue'

import store from '../../store/index'

import { useListPagination } from '../../composables/useListPagination'
import { deepCopy, showToast } from '../../helpers/utils'
import { matchesChannelQuery } from '../../helpers/subscription-channels'
import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { mirrorYouTubeSubscription } from '../../helpers/youtube-sync'

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
  /** @type {import('vue').PropType<Profile>} */
  profile: {
    type: Object,
    required: true
  },
  isMainProfile: {
    type: Boolean,
    required: true
  },
  query: {
    type: String,
    default: ''
  }
})

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

/** @type {import('vue').ShallowRef<Profile['subscriptions']>} */
const subscriptions = shallowRef([])

function loadSubscriptions() {
  const subscriptions_ = deepCopy(props.profile.subscriptions)

  const collator = intlCollator.value

  subscriptions_.sort((a, b) => collator.compare(a.name, b.name))

  if (backendPreference.value === 'invidious') {
    const instanceUrl = currentInvidiousInstanceUrl.value

    subscriptions_.forEach((channel) => {
      channel.thumbnail = youtubeImageUrlToInvidious(channel.thumbnail, instanceUrl)
    })
  }

  subscriptions.value = subscriptions_
}

if (typeof props.profile.subscriptions !== 'undefined') {
  loadSubscriptions()
}

const visibleSubscriptions = computed(() => {
  const query = props.query.trim().toLowerCase()
  if (query === '') return subscriptions.value
  return subscriptions.value.filter(channel => matchesChannelQuery(channel, query))
})

const allVisibleSelected = computed(() => {
  return visibleSubscriptions.value.every(channel => selected.has(channel.id))
})

const channelGrid = useTemplateRef('channelGrid')
const { page: subscriptionPage, displayedItems: displayedSubscriptions, hasMore: hasMoreSubscriptions, loadMore: loadMoreSubscriptions } = useListPagination(visibleSubscriptions, {
  pageSize: 100,
  append: true,
  resetOn: () => props.query,
  scrollTarget: useTemplateRef('channelScroller'),
  focusItem: index => channelGrid.value?.$el.querySelectorAll('.bubblePadding')[index]?.focus()
})

watch(() => props.profile, (profile, oldProfile) => {
  loadSubscriptions()
  if (profile._id !== oldProfile._id) {
    selectNone()
    return
  }
  // Feed refreshes update channel names and thumbnails, so only drop channels that are gone
  const channelIds = new Set(subscriptions.value.map(channel => channel.id))
  selected.forEach(channelId => {
    if (!channelIds.has(channelId)) selected.delete(channelId)
  })
}, { deep: 2 })

/** @type {import('vue').Reactive<Set<string>>} */
const selected = reactive(new Set())

const selectedText = computed(() => {
  return t('Profile.{number} selected', { number: selected.size })
})

// Selections outside the search results stay, so channels can be gathered across searches
function selectAll() {
  visibleSubscriptions.value.forEach(channel => {
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

const DELTE_PROMPT_VALUES = ['delete', 'cancel']

const deletePromptNames = computed(() => [
  t('Yes, Delete'),
  t('Cancel')
])

/** @type {import('vue').ComputedRef<Profile[]>} */
const profileList = computed(() => {
  return store.getters.getProfileList
})

const showDeletePrompt = ref(false)

const deletePromptMessage = computed(() => {
  if (props.isMainProfile) {
    return t('Profile["This is your primary profile.  Are you sure you want to delete the selected channels?  The same channels will be deleted in any profile they are found in."]')
  } else {
    return t('Profile["Are you sure you want to delete the selected channels?  This will not delete the channel from any other profile."]')
  }
})

function displayDeletePrompt() {
  if (selected.size === 0) {
    showToast({ message: t('Profile.No channel(s) have been selected'), icon: ['fas', 'circle-exclamation'] })
  } else {
    showDeletePrompt.value = true
  }
}

/**
 * @param {'delete' | 'cancel' | null} value
 */
function handleDeletePromptClick(value) {
  if (value === 'delete') {
    const channelIds = [...selected]
    subscriptions.value = subscriptions.value.filter((channel) => {
      return !selected.has(channel.id)
    })

    // Removing channels from the primary profile unsubscribes from them in every profile
    const profiles = props.isMainProfile
      ? profileList.value.filter(profile => profile.subscriptions.some(channel => selected.has(channel.id)))
      : [props.profile]
    const profileIds = profiles.map(profile => profile._id)

    // Pull only the selected channels, like unsubscribing, so channels added elsewhere stay
    store.dispatch('removeChannelFromProfiles', { channelIds, profileIds })
    if (props.isMainProfile) {
      mirrorYouTubeSubscription(channelIds, false)
    }

    showToast({ message: t('Profile.Profile has been updated'), icon: ['fas', 'user-check'] })
    selectNone()
  }

  showDeletePrompt.value = false
}
</script>

<style scoped src="./FtProfileChannelList.css" />
