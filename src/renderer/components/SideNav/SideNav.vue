<template>
  <FtFlexBox
    class="sideNav"
    :class="[{ opened: isOpen, expanded: isOpen || props.forceExpanded }, applyHiddenLabels]"
    data-tutorial="navigation"
    role="navigation"
  >
    <div
      ref="innerRef"
      v-overlay-scrollbars
      class="inner"
      :class="applyHiddenLabels"
    >
      <div
        v-show="indicatorStyle"
        class="activeIndicator"
        :style="indicatorStyle"
        aria-hidden="true"
      />
      <router-link
        class="navOption topNavOption mobileShow "
        role="button"
        to="/subscriptions"
        :title="$t('Subscriptions.Subscriptions')"
      >
        <div
          class="thumbnailContainer"
        >
          <FtIcon
            :icon="['fas', 'rss']"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <p
          class="navLabel"
        >
          {{ $t("Subscriptions.Subscriptions") }}
        </p>
      </router-link>
      <router-link
        class="navOption mobileHidden"
        role="button"
        to="/subscribedchannels"
        :title="$t('Channels.Channels')"
      >
        <div
          class="thumbnailContainer"
        >
          <FtIcon
            :icon="['fas', 'user-check']"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <p
          class="navLabel"
        >
          {{ $t("Channels.Channels") }}
        </p>
      </router-link>
      <router-link
        v-if="trendingAvailable && !hideTrendingVideos"
        class="navOption mobileHidden"
        role="button"
        to="/trending"
        :title="$t('Trending.Trending')"
      >
        <div
          class="thumbnailContainer"
        >
          <FtIcon
            :icon="['fas', 'fire']"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <p
          class="navLabel"
        >
          {{ $t("Trending.Trending") }}
        </p>
      </router-link>
      <router-link
        v-if="popularAvailable && !hidePopularVideos"
        class="navOption mobileHidden"
        role="button"
        to="/popular"
        :title="$t('Most Popular')"
      >
        <div
          class="thumbnailContainer"
        >
          <FtIcon
            :icon="['fas', 'users']"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <p
          class="navLabel"
        >
          {{ $t("Most Popular") }}
        </p>
      </router-link>
      <router-link
        v-if="!hidePlaylists"
        class="navOption mobileShow"
        role="button"
        to="/userplaylists"
        :title="$t('Playlists')"
      >
        <div
          class="thumbnailContainer"
        >
          <FtIcon
            :icon="['fas', 'bookmark']"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <p
          class="navLabel"
        >
          {{ $t("Playlists") }}
        </p>
      </router-link>
      <SideNavMoreOptions />
      <router-link
        class="navOption mobileShow"
        role="button"
        to="/history"
        :title="historyTitle"
      >
        <div
          class="thumbnailContainer"
        >
          <FtIcon
            :icon="['fas', 'history']"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <p
          class="navLabel"
        >
          {{ $t("History.History") }}
        </p>
      </router-link>
      <router-link
        v-if="showWatchStats"
        class="navOption mobileHidden"
        role="button"
        to="/stats"
        :title="$t('Stats.Stats')"
      >
        <div class="thumbnailContainer">
          <FtIcon
            :icon="['fas', 'chart-line']"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <p class="navLabel">
          {{ $t('Stats.Stats') }}
        </p>
      </router-link>
      <hr>
      <div
        v-if="!hideActiveSubscriptions"
        class="mobileHidden"
      >
        <component
          :is="enableChannelLinks ? 'router-link' : 'span'"
          v-for="channel in displayedActiveSubscriptions"
          :key="channel.id"
          :to="`/channel/${channel.id}`"
          :class="enableChannelLinks ? '' : 'disabledIcon'"
          class="navChannel channelLink mobileHidden"
          :title="channel.name"
          role="button"
        >
          <div
            class="thumbnailContainer"
          >
            <img
              v-if="channel.thumbnail != null"
              class="channelThumbnail"
              height="35"
              width="35"
              loading="lazy"
              :src="channel.thumbnail"
              :alt="isOpen ? '' : channel.name"
            >
            <FtIcon
              v-else
              class="channelThumbnail noThumbnail"
              :icon="['fas', 'circle-user']"
            />
          </div>
          <p
            v-if="isOpen"
            class="navLabel"
            dir="auto"
          >
            {{ channel.name }}
          </p>
        </component>
        <div
          v-if="hasMoreActiveSubscriptions"
          :key="activeSubscriptionLimit"
          v-observe-visibility="{
            callback: onActiveSubscriptionsVisibilityChanged
          }"
          class="subscriptionLoadSentinel"
          aria-hidden="true"
        />
      </div>
    </div>
  </FtFlexBox>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import SideNavMoreOptions from '../SideNavMoreOptions/SideNavMoreOptions.vue'

import store from '../../store/index'

import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { isMostPopularAvailable, isTrendingAvailable } from '../../helpers/navigationAvailability'
import { deepCopy, localizeAndAddKeyboardShortcutToActionTitle } from '../../helpers/utils'
import { getConfiguredKeyboardShortcuts } from '../../../constants'

const { locale, t } = useI18n()
const appKeyboardShortcuts = computed(() => getConfiguredKeyboardShortcuts(
  store.getters.getKeyboardShortcuts
).APP.GENERAL)

const SUPPORTS_LOCAL_API = process.env.SUPPORTS_LOCAL_API
const activeSubscriptionsPerPage = 50

const props = defineProps({
  forceExpanded: {
    type: Boolean,
    default: false
  }
})

/** @type {import('vue').ComputedRef<boolean>} */
const isOpen = computed(() => {
  return store.getters.getIsSideNavOpen
})

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => {
  return store.getters.getBackendFallback
})

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

const trendingAvailable = computed(() => isTrendingAvailable({
  supportsLocalApi: !!SUPPORTS_LOCAL_API,
  backendPreference: backendPreference.value,
  backendFallback: backendFallback.value,
}))

const popularAvailable = computed(() => isMostPopularAvailable({
  backendPreference: backendPreference.value,
  backendFallback: backendFallback.value,
}))

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
})

/** @type {import('vue').ComputedRef<object>} */
const activeProfile = computed(() => {
  return store.getters.getActiveProfile
})

const activeSubscriptions = computed(() => {
  /** @type {any[]} */
  const subscriptions = deepCopy(activeProfile.value.subscriptions)

  subscriptions.forEach(channel => {
    // Change thumbnail size to 35x35, as that's the size we display it
    // so we don't need to download a bigger image (the default is 176x176)
    channel.thumbnail = channel.thumbnail?.replace(/=s\d+/, '=s35')
  })

  const locale_ = locale.value
  subscriptions.sort((a, b) => {
    return a.name?.toLowerCase().localeCompare(b.name?.toLowerCase(), locale_)
  })

  if (backendPreference.value === 'invidious') {
    const instanceUrl = currentInvidiousInstanceUrl.value

    subscriptions.forEach((channel) => {
      channel.thumbnail = youtubeImageUrlToInvidious(channel.thumbnail, instanceUrl)
    })
  }

  return subscriptions
})

const activeSubscriptionLimit = ref(activeSubscriptionsPerPage)

const displayedActiveSubscriptions = computed(() => {
  return activeSubscriptions.value.slice(0, activeSubscriptionLimit.value)
})

const hasMoreActiveSubscriptions = computed(() => {
  return displayedActiveSubscriptions.value.length < activeSubscriptions.value.length
})

function onActiveSubscriptionsVisibilityChanged(isVisible) {
  if (isVisible) {
    activeSubscriptionLimit.value += activeSubscriptionsPerPage
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const hidePopularVideos = computed(() => {
  return store.getters.getHidePopularVideos
})

/** @type {import('vue').ComputedRef<boolean>} */
const hidePlaylists = computed(() => {
  return store.getters.getHidePlaylists
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideTrendingVideos = computed(() => {
  return store.getters.getHideTrendingVideos
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideActiveSubscriptions = computed(() => {
  return store.getters.getHideActiveSubscriptions
})

/** @type {import('vue').ComputedRef<boolean>} */
const showWatchStats = computed(() => {
  return store.getters.getRememberHistory && store.getters.getEnableWatchStats
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideText = computed(() => {
  return !isOpen.value && !props.forceExpanded && store.getters.getHideLabelsSideBar
})

const applyNavIconExpand = computed(() => {
  return {
    navIconExpand: hideText.value
  }
})

const applyHiddenLabels = computed(() => {
  return {
    hiddenLabels: hideText.value
  }
})

const historyTitle = computed(() => {
  const shortcut = process.platform === 'darwin'
    ? appKeyboardShortcuts.value.NAVIGATE_TO_HISTORY_MAC
    : appKeyboardShortcuts.value.NAVIGATE_TO_HISTORY

  return localizeAndAddKeyboardShortcutToActionTitle(
    t('History.History'),
    shortcut
  )
})

// ===== Sliding active-route indicator =====
const route = useRoute()
const innerRef = useTemplateRef('innerRef')
/** @type {import('vue').Ref<Record<string, string> | null>} */
const indicatorStyle = ref(null)

let remeasureTimeoutId = null

function updateIndicator() {
  const inner = innerRef.value
  // Skip hidden matches (e.g. links inside the collapsed "More" menu)
  const active = inner == null
    ? null
    : Array.from(inner.querySelectorAll('.navOption.router-link-active, .navChannel.router-link-active'))
        .find((el) => el instanceof HTMLElement && el.offsetParent !== null)

  if (!(active instanceof HTMLElement)) {
    indicatorStyle.value = null
    return
  }

  indicatorStyle.value = {
    transform: `translateY(${active.offsetTop}px)`,
    blockSize: `${active.offsetHeight}px`
  }
}

/**
 * Re-measure once the side nav's 150ms width transition has finished,
 * as expanding/collapsing reflows the nav entries.
 */
function updateIndicatorAfterResize() {
  clearTimeout(remeasureTimeoutId)
  remeasureTimeoutId = setTimeout(updateIndicator, 200)
}

watch(() => route.fullPath, () => nextTick(updateIndicator))
watch([
  () => activeProfile.value._id,
  () => activeProfile.value.subscriptions.length
], () => {
  activeSubscriptionLimit.value = activeSubscriptionsPerPage
})

watch([isOpen, hideText, displayedActiveSubscriptions], () => {
  nextTick(updateIndicator)
  updateIndicatorAfterResize()
})

onMounted(() => {
  updateIndicator()
  window.addEventListener('resize', updateIndicatorAfterResize)
})

onBeforeUnmount(() => {
  clearTimeout(remeasureTimeoutId)
  window.removeEventListener('resize', updateIndicatorAfterResize)
})

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)
</script>

<style scoped src="./SideNav.css" />
