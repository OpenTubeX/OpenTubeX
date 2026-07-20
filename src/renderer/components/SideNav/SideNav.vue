<template>
  <FtFlexBox
    class="sideNav"
    :class="[{ opened: isOpen, expanded: isOpen || props.forceExpanded }, applyHiddenLabels]"
    role="navigation"
  >
    <div
      ref="innerRef"
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
          <FontAwesomeIcon
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
          <FontAwesomeIcon
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
        v-if="SUPPORTS_LOCAL_API && !hideTrendingVideos && (backendFallback || backendPreference === 'local')"
        class="navOption mobileHidden"
        role="button"
        to="/trending"
        :title="$t('Trending.Trending')"
      >
        <div
          class="thumbnailContainer"
        >
          <FontAwesomeIcon
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
        v-if="!hidePopularVideos && (backendFallback || backendPreference === 'invidious')"
        class="navOption mobileHidden"
        role="button"
        to="/popular"
        :title="$t('Most Popular')"
      >
        <div
          class="thumbnailContainer"
        >
          <FontAwesomeIcon
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
          <FontAwesomeIcon
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
          <FontAwesomeIcon
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
          <FontAwesomeIcon
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
      <router-link
        class="navOption mobileShow smallMobileOnlyHidden"
        role="button"
        to="/settings"
        :title="settingsTitle"
      >
        <div
          class="thumbnailContainer"
        >
          <FontAwesomeIcon
            :icon="['fas', 'sliders-h']"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <p
          class="navLabel"
        >
          {{ $t('Settings.Settings') }}
        </p>
      </router-link>
      <router-link
        class="navOption mobileHidden"
        role="button"
        to="/about"
        :title="$t('About.About')"
      >
        <div
          class="thumbnailContainer"
        >
          <FontAwesomeIcon
            :icon="['fas', 'info-circle']"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <p
          class="navLabel"
        >
          {{ $t("About.About") }}
        </p>
      </router-link>
      <hr>
      <div
        v-if="!hideActiveSubscriptions"
        class="mobileHidden"
      >
        <router-link
          v-for="channel in activeSubscriptions"
          :key="channel.id"
          :to="`/channel/${channel.id}`"
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
            <FontAwesomeIcon
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
        </router-link>
      </div>
    </div>
  </FtFlexBox>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import SideNavMoreOptions from '../SideNavMoreOptions/SideNavMoreOptions.vue'

import store from '../../store/index'

import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { deepCopy, localizeAndAddKeyboardShortcutToActionTitle } from '../../helpers/utils'
import { getConfiguredKeyboardShortcuts } from '../../../constants'

const { locale, t } = useI18n()
const appKeyboardShortcuts = computed(() => getConfiguredKeyboardShortcuts(
  store.getters.getKeyboardShortcuts
).APP.GENERAL)

const SUPPORTS_LOCAL_API = process.env.SUPPORTS_LOCAL_API

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

const settingsTitle = computed(() => {
  return localizeAndAddKeyboardShortcutToActionTitle(
    t('Settings.Settings'),
    appKeyboardShortcuts.value.NAVIGATE_TO_SETTINGS
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
watch([isOpen, hideText, activeSubscriptions], () => {
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
</script>

<style scoped src="./SideNav.css" />
