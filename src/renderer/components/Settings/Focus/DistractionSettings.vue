<template>
  <FtSettingsSection
    :title="t('Settings.Distraction Free Settings.Distraction Free Settings')"
    hide-title
  >
    <h4 class="groupTitle">
      {{ t('Settings.Distraction Free Settings.Sections.General') }}
    </h4>
    <div class="settingsRows">
      <FtSettingsRow
        v-slot="{ titleId }"
        :title="t('Settings.Distraction Free Settings.Rows.Video Lists')"
        :description="t('Settings.Distraction Free Settings.Rows.Video Lists Description')"
        :icon="['fas', 'layer-group']"
        stacked
      >
        <FtSettingChips
          :items="videoListChips"
          :labelledby="titleId"
          @change="updateChip"
        />
      </FtSettingsRow>
      <FtSettingsRow
        v-slot="{ titleId }"
        :title="t('Settings.Distraction Free Settings.Rows.App Interface')"
        :icon="['fas', 'display']"
        stacked
      >
        <FtSettingChips
          :items="appChips"
          :labelledby="titleId"
          @change="updateChip"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Tooltips.Distraction Free Settings.Shorten View Counts')"
        :title="t('Settings.Distraction Free Settings.Shorten View Counts')"
        :icon="['fas', 'hashtag']"
      >
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Shorten View Counts')"
          hide-label
          :default-value="store.getters.getShortenViewCounts"
          setting-key="shortenViewCounts"
          @change="store.dispatch('updateShortenViewCounts', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.Distraction Free Settings.Display Titles Without Excessive Capitalisation')"
        :icon="['fas', 'font']"
      >
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Display Titles Without Excessive Capitalisation')"
          hide-label
          :default-value="store.getters.getShowDistractionFreeTitles"
          setting-key="showDistractionFreeTitles"
          @change="store.dispatch('updateShowDistractionFreeTitles', $event)"
        />
      </FtSettingsRow>
    </div>
    <h4 class="groupTitle">
      {{ t('Settings.Distraction Free Settings.Sections.Subscriptions and Channels') }}
    </h4>
    <div class="settingsRows">
      <FtSettingsRow
        v-slot="{ titleId }"
        :title="t('Settings.Distraction Free Settings.Sections.Subscriptions Page')"
        :icon="['fas', 'subscriptions']"
        stacked
      >
        <FtSettingChips
          :items="subscriptionsPageChips"
          :labelledby="titleId"
          @change="updateChip"
        />
      </FtSettingsRow>
      <FtSettingsRow
        v-slot="{ titleId }"
        :title="t('Settings.Distraction Free Settings.Sections.Channel Page')"
        :icon="['fas', 'circle-user']"
        stacked
      >
        <FtSettingChips
          :items="channelPageChips"
          :labelledby="titleId"
          @change="updateChip"
        />
      </FtSettingsRow>
    </div>
    <h4 class="groupTitle">
      {{ t('Settings.Distraction Free Settings.Sections.Watch Page') }}
    </h4>
    <div class="settingsRows">
      <FtSettingsRow
        v-for="row in watchPageRows"
        :key="row.title"
        v-slot="{ titleId }"
        :title="row.title"
        :icon="row.icon"
        stacked
      >
        <FtSettingChips
          :items="row.chips"
          :labelledby="titleId"
          @change="updateChip"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.Distraction Free Settings.AI Video Summaries')"
        :icon="['fas', 'robot']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.AI Video Summaries')"
          :value="store.getters.getAiVideoSummaryMode"
          setting-key="aiVideoSummaryMode"
          :select-names="visibilityModeNames"
          :select-values="VISIBILITY_MODES"
          @change="store.dispatch('updateAiVideoSummaryMode', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.Distraction Free Settings.Video Descriptions')"
        :icon="['fas', 'file-lines']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Video Descriptions')"
          :value="store.getters.getVideoDescriptionMode"
          setting-key="videoDescriptionMode"
          :select-names="videoDescriptionModeNames"
          :select-values="VISIBILITY_MODES"
          @change="store.dispatch('updateVideoDescriptionMode', $event)"
        />
      </FtSettingsRow>
    </div>
    <h4 class="groupTitle">
      {{ t('Settings.Distraction Free Settings.Sections.Blocked Content') }}
    </h4>
    <div class="settingsRows">
      <FtSettingsRow
        :description="t('Tooltips.Distraction Free Settings.Blocked Items')"
        :title="t('Settings.Distraction Free Settings.Blocked Items.Blocked Items')"
        :icon="['fas', 'eye-slash']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Blocked Items.Blocked Items')"
          :value="store.getters.getBlockedItemsMode"
          setting-key="blockedItemsMode"
          :select-names="blockedItemsModeNames"
          :select-values="BLOCKED_ITEMS_MODES"
          @change="store.dispatch('updateBlockedItemsMode', $event)"
        />
      </FtSettingsRow>
    </div>
    <FtFlexBox>
      <FtInputTags
        :disabled="channelHiderDisabled"
        setting-key="channelsHidden"
        :disabled-msg="t('Settings.Distraction Free Settings.Hide Channels Disabled Message')"
        :label="t('Settings.Distraction Free Settings.Hide Channels')"
        :tag-name-placeholder="t('Settings.Distraction Free Settings.Hide Channels Placeholder')"
        :tag-list="channelsHidden"
        :tooltip="t('Tooltips.Distraction Free Settings.Hide Channels')"
        :validate-tag-name="checkYoutubeChannelId"
        :find-tag-info="findChannelTagInfoWrapper"
        :are-channel-tags="true"
        :show-tags="showAddedChannelsHidden"
        @invalid-name="handleInvalidChannel"
        @error-find-tag-info="handleChannelAPIError"
        @change="handleChannelsHidden"
        @already-exists="handleChannelsExists"
        @toggle-show-tags="handleAddedChannelsHidden"
      />
    </FtFlexBox>
    <FtFlexBox class="containingTextFlexBox">
      <FtInputTags
        :label="t('Settings.Distraction Free Settings.Hide Videos, Playlists and Channels Containing Text')"
        setting-key="forbiddenTitles"
        :tag-name-placeholder="t('Settings.Distraction Free Settings.Hide Videos, Playlists and Channels Containing Text Placeholder')"
        :show-tags="showAddedForbiddenTitles"
        :tag-list="forbiddenTitles"
        :min-input-length="1"
        :tooltip="t('Tooltips.Distraction Free Settings.Hide Videos, Playlists and Channels Containing Text')"
        @change="handleForbiddenTitles"
        @toggle-show-tags="handleAddedForbiddenTitles"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'
import FtSettingChips from '../../FtSettingChips/FtSettingChips.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtInputTags from '../../FtInputTags/FtInputTags.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'

import store from '../../../store/index'

import { showToast } from '../../../helpers/utils'
import { checkYoutubeChannelId, findChannelTagInfo } from '../../../helpers/channels'

const { t } = useI18n()
const SHOWS_STARTUP_SPLASH = !!(process.env.IS_ELECTRON || process.env.IS_CAPACITOR)
const VISIBILITY_MODES = ['hide', 'collapsed', 'expanded']

const channelHiderDisabled = ref(false)

/**
 * @param {string} settingKey
 * @returns {string}
 */
function upperFirst(settingKey) {
  return settingKey.charAt(0).toUpperCase() + settingKey.slice(1)
}

/**
 * A chip for a switch that hides something. The full label names the chip's
 * checkbox and finds it in Settings search; the short label is shown.
 * @param {string} settingKey
 * @param {string} label
 * @param {string} shortLabel
 * @param {{ value?: boolean, disabled?: boolean, tooltip?: string }} [overrides]
 * @returns {{ settingKey: string, label: string, shortLabel: string, value: boolean, disabled?: boolean, tooltip?: string }}
 */
function chip(settingKey, label, shortLabel, overrides = {}) {
  return {
    settingKey,
    label,
    shortLabel,
    value: store.getters[`get${upperFirst(settingKey)}`],
    ...overrides
  }
}

const hideLiveStreams = computed(() => store.getters.getHideLiveStreams)
const hideRecommendedVideos = computed(() => store.getters.getHideRecommendedVideos)
const hideComments = computed(() => store.getters.getHideComments)

const videoListChips = computed(() => [
  chip('hideVideoViews', t('Settings.Distraction Free Settings.Hide Video Views'), t('Video.Views')),
  chip('hideChannelAvatars', t('Settings.Distraction Free Settings.Hide Channel Avatars'), t('Settings.Distraction Free Settings.Chips.Channel Avatars')),
  chip('hideChannelSubscriptions', t('Settings.Distraction Free Settings.Hide Channel Subscribers'), t('Settings.Distraction Free Settings.Chips.Subscriber Counts')),
  chip('hideLiveStreams', t('Settings.Distraction Free Settings.Hide Live Streams'), t('Settings.Distraction Free Settings.Chips.Live Streams')),
  chip('hideUpcomingPremieres', t('Settings.Distraction Free Settings.Hide Upcoming Premieres'), t('Settings.Distraction Free Settings.Chips.Upcoming Premieres')),
  chip('hidePlaylists', t('Settings.Distraction Free Settings.Hide Playlists'), t('Playlists')),
  chip('hidePlaylistStats', t('Settings.Distraction Free Settings.Hide Playlist Stats'), t('Settings.Distraction Free Settings.Chips.Playlist Stats'), {
    tooltip: t('Tooltips.Distraction Free Settings.Hide Playlist Stats')
  }),
  chip('hideRecommendationDetails', t('Settings.Distraction Free Settings.Hide Recommendation Details'), t('Settings.Distraction Free Settings.Chips.Recommendation Details')),
  chip('hideSharingActions', t('Settings.Distraction Free Settings.Hide Sharing Actions'), t('Settings.Distraction Free Settings.Chips.Sharing Actions')),
  chip('hideWatchedSubs', t('Settings.Distraction Free Settings.Hide Videos on Watch'), t('Settings.Distraction Free Settings.Chips.Watched in Subscriptions'), {
    tooltip: t('Tooltips.Distraction Free Settings.Hide Videos on Watch')
  }),
  chip('hideWatchedInSearchAndRecommendations', t('Settings.Distraction Free Settings.Hide Watched in Search and Recommendations'), t('Settings.Distraction Free Settings.Chips.Watched in Search and Recommendations'), {
    tooltip: t('Tooltips.Distraction Free Settings.Hide Watched in Search and Recommendations')
  })
])

const appChips = computed(() => [
  ...(SHOWS_STARTUP_SPLASH ? [chip('hideStartupSplash', t('Settings.Distraction Free Settings.Hide Startup Splash'), t('Settings.Distraction Free Settings.Chips.Startup Splash'))] : []),
  chip('hideHeaderSyncIndicator', t('Settings.Distraction Free Settings.Hide Header Sync Indicator'), t('Settings.Distraction Free Settings.Chips.Header Sync Indicator'))
])

const hideSubscriptionsLiveTooltip = computed(() => {
  return t('Tooltips.Distraction Free Settings.Hide Subscriptions Live', {
    appWideSetting: t('Settings.Distraction Free Settings.Hide Live Streams'),
    subsection: t('Settings.Distraction Free Settings.Sections.General'),
    settingsSection: t('Settings.Distraction Free Settings.Distraction Free Settings')
  })
})

const subscriptionsPageChips = computed(() => [
  chip('hideSubscriptionsVideos', t('Settings.Distraction Free Settings.Hide Subscriptions Videos'), t('Global.Videos')),
  chip('hideSubscriptionsShorts', t('Settings.Distraction Free Settings.Hide Subscriptions Shorts'), t('Global.Shorts')),
  chip('hideSubscriptionsLive', t('Settings.Distraction Free Settings.Hide Subscriptions Live'), t('Global.Live'), hideLiveStreams.value
    ? { value: true, disabled: true, tooltip: hideSubscriptionsLiveTooltip.value }
    : {}),
  chip('hideSubscriptionsCommunity', t('Settings.Distraction Free Settings.Hide Subscriptions Posts'), t('Global.Posts'))
])

const channelPageChips = computed(() => [
  chip('hideChannelHome', t('Settings.Distraction Free Settings.Hide Channel Home'), t('Channel.Home.Home')),
  chip('hideChannelShorts', t('Settings.Distraction Free Settings.Hide Channel Shorts'), t('Global.Shorts')),
  chip('hideChannelPlaylists', t('Settings.Distraction Free Settings.Hide Channel Playlists'), t('Channel.Playlists.Playlists')),
  chip('hideChannelPodcasts', t('Settings.Distraction Free Settings.Hide Channel Podcasts'), t('Channel.Podcasts.Podcasts')),
  chip('hideChannelShows', t('Settings.Distraction Free Settings.Hide Channel Shows'), t('Channel.Shows.Shows')),
  chip('hideChannelCommunity', t('Settings.Distraction Free Settings.Hide Channel Posts'), t('Global.Posts')),
  chip('hideChannelReleases', t('Settings.Distraction Free Settings.Hide Channel Releases'), t('Channel.Releases.Releases')),
  chip('hideChannelCourses', t('Settings.Distraction Free Settings.Hide Channel Courses'), t('Channel.Courses.Courses')),
  chip('hideFeaturedChannels', t('Settings.Distraction Free Settings.Hide Featured Channels'), t('Settings.Distraction Free Settings.Chips.Featured Channels'))
])

const watchPageRows = computed(() => [{
  title: t('Settings.Distraction Free Settings.Rows.Engagement'),
  icon: ['fas', 'thumbs-up'],
  chips: [
    chip('hideVideoLikesAndDislikes', t('Settings.Distraction Free Settings.Hide Video Likes And Dislikes'), t('Settings.Distraction Free Settings.Chips.Likes and Dislikes')),
    chip('hideCommentLikes', t('Settings.Distraction Free Settings.Hide Comment Likes'), t('Settings.Distraction Free Settings.Chips.Comment Likes'), { disabled: hideComments.value }),
    chip('hidePopularityGraph', t('Settings.Distraction Free Settings.Hide Popularity Graph'), t('Settings.Distraction Free Settings.Chips.Popularity Graph')),
    chip('hideRepeatStats', t('Settings.Distraction Free Settings.Hide Repeat Stats'), t('Settings.Distraction Free Settings.Chips.Repeat Stats'))
  ]
}, {
  title: t('Settings.Distraction Free Settings.Rows.Comments and Chat'),
  icon: ['fas', 'comment'],
  chips: [
    chip('hideComments', t('Settings.Distraction Free Settings.Hide Comments'), t('Comments.Comments')),
    chip('hideCommentPhotos', t('Settings.Distraction Free Settings.Hide Profile Pictures in Comments'), t('Settings.Distraction Free Settings.Chips.Profile Pictures in Comments'), { disabled: hideComments.value }),
    chip('hideLiveChat', t('Settings.Distraction Free Settings.Hide Live Chat'), t('Settings.Distraction Free Settings.Chips.Live Chat')),
    chip('hideLiveChatReplay', t('Settings.Distraction Free Settings.Hide Live Chat Replay'), t('Settings.Distraction Free Settings.Chips.Live Chat Replay'))
  ]
}, {
  title: t('Settings.Distraction Free Settings.Rows.Recommendations'),
  icon: ['fas', 'play-next'],
  chips: [
    chip('hideRecommendedVideos', t('Settings.Distraction Free Settings.Hide Recommended Videos'), t('Up Next')),
    chip('hideEndScreenRecommendations', t('Settings.Distraction Free Settings.Hide End-Screen Recommendations'), t('Settings.Distraction Free Settings.Chips.End-Screen Recommendations'), hideRecommendedVideos.value
      ? { value: true, disabled: true }
      : {}),
    chip('hideEndScreenAnnotations', t('Settings.Distraction Free Settings.Hide End-Screen Annotations'), t('Settings.Distraction Free Settings.Chips.End-Screen Annotations')),
    chip('hidePaidPromotion', t('Settings.Distraction Free Settings.Hide Paid Promotion Badge'), t('Settings.Distraction Free Settings.Chips.Paid Promotion Badge'))
  ]
}, {
  title: t('Settings.Distraction Free Settings.Rows.Player Extras'),
  icon: ['fas', 'sliders'],
  chips: [
    chip('hideChapters', t('Settings.Distraction Free Settings.Hide Chapters'), t('Chapters.Chapters')),
    chip('disableAbRepeat', t('Settings.Distraction Free Settings.Disable A-B Repeat'), t('Settings.Distraction Free Settings.Chips.A-B Repeat')),
    chip('hideFullscreenVideoTitle', t('Settings.Distraction Free Settings.Hide Full Screen Video Title'), t('Settings.Distraction Free Settings.Chips.Full Screen Video Title'))
  ]
}])

/**
 * @param {{ settingKey: string }} item
 * @param {boolean} value
 */
function updateChip({ settingKey }, value) {
  // Hiding all recommendations also stops playing them next.
  if (settingKey === 'hideRecommendedVideos' && value) {
    store.dispatch('updatePlayNextVideo', false)
  }
  store.dispatch(`update${upperFirst(settingKey)}`, value)
}

const visibilityModeNames = computed(() => [
  t('Settings.Distraction Free Settings.Hide'),
  t('Settings.Distraction Free Settings.Collapsed'),
  t('Settings.Distraction Free Settings.Expanded'),
])

// Separate keys so languages can match the grammatical gender of "descriptions"
const videoDescriptionModeNames = computed(() => [
  t('Settings.Distraction Free Settings.Video Description Modes.Hide'),
  t('Settings.Distraction Free Settings.Video Description Modes.Collapsed'),
  t('Settings.Distraction Free Settings.Video Description Modes.Expanded'),
])

const BLOCKED_ITEMS_MODES = ['hide', 'blur', 'show']

const blockedItemsModeNames = computed(() => [
  t('Settings.Distraction Free Settings.Blocked Items.Hide'),
  t('Settings.Distraction Free Settings.Blocked Items.Blur'),
  t('Settings.Distraction Free Settings.Blocked Items.Show'),
])

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

const backendOptions = computed(() => ({
  preference: backendPreference.value,
  fallback: backendFallback.value
}))

/** @type {import('vue').ComputedRef<boolean>} */
const showAddedChannelsHidden = computed(() => store.getters.getShowAddedChannelsHidden)

function handleAddedChannelsHidden() {
  store.dispatch('updateShowAddedChannelsHidden', !showAddedChannelsHidden.value)
}

/** @type {import('vue').ComputedRef<any[]>} */
const channelsHidden = computed(() => store.getters.getChannelsHiddenParsed)

/**
 * @param {any[]} value
 */
function handleChannelsHidden(value) {
  store.dispatch('updateChannelsHidden', JSON.stringify(value))
}

/** @type {import('vue').ComputedRef<boolean>} */
const showAddedForbiddenTitles = computed(() => store.getters.getShowAddedForbiddenTitles)

function handleAddedForbiddenTitles() {
  store.dispatch('updateShowAddedForbiddenTitles', !showAddedForbiddenTitles.value)
}

/** @type {import('vue').ComputedRef<string[]>} */
const forbiddenTitles = computed(() => JSON.parse(store.getters.getForbiddenTitles))

/**
 * @param {string[]} value
 */
function handleForbiddenTitles(value) {
  store.dispatch('updateForbiddenTitles', JSON.stringify(value))
}

onMounted(() => {
  verifyChannelsHidden()
})

function handleInvalidChannel() {
  showToast({
    message: t('Settings.Distraction Free Settings.Hide Channels Invalid'),
    icon: ['fas', 'circle-exclamation'],
  })
}

function handleChannelAPIError() {
  showToast({
    message: t('Settings.Distraction Free Settings.Hide Channels API Error'),
    icon: ['fas', 'circle-exclamation'],
  })
}

function handleChannelsExists() {
  showToast({
    message: t('Settings.Distraction Free Settings.Hide Channels Already Exists'),
    icon: ['fas', 'circle-exclamation'],
  })
}

/**
 * @param {string} text
 */
async function findChannelTagInfoWrapper(text) {
  return await findChannelTagInfo(text, backendOptions.value)
}

async function verifyChannelsHidden() {
  for (const tag of channelsHidden.value) {
    // if channel has been processed and confirmed as non existent, skip
    if (tag.invalid) continue

    // process if no preferred name and is possibly a YouTube ID
    if ((tag.preferredName === '' || !tag.icon) && checkYoutubeChannelId(tag.name)) {
      channelHiderDisabled.value = true

      const { preferredName, icon, iconHref, invalidId } = await findChannelTagInfoWrapper(tag.name)
      const info = invalidId
        ? { name: tag.name, invalid: invalidId }
        : { name: tag.name, preferredName, icon, iconHref }

      // Update on every tag in case it closes. Patch the saved list, which sync
      // or another window may have changed during the lookup.
      await store.dispatch('updateChannelsHidden', saved => JSON.stringify(JSON.parse(saved).map(channel => (
        (typeof channel === 'string' ? channel : channel.name) === tag.name ? info : channel
      ))))
    }
  }

  channelHiderDisabled.value = false
}
</script>

<style scoped src="./DistractionSettings.css" />
