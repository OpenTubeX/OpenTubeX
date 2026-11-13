<template>
  <div
    class="navigationPreview"
    :class="[layout, { compactLabels: compactNavigationLabels, hiddenLabels: layout === 'desktop' && hideLabelsSideBar }]"
  >
    <div class="previewWindow">
      <header class="previewTopBar">
        <span class="previewTopBarStart">
          <FtIcon
            v-if="layout === 'desktop'"
            class="previewTopBarIcon"
            :icon="['fas', 'bars']"
            aria-hidden="true"
          />
          <FtLogoFull class="previewLogo" />
        </span>
        <span class="previewSearch">
          <FtIcon
            :icon="['fas', 'search']"
            aria-hidden="true"
          />
        </span>
        <span
          class="previewProfile"
          :style="{ background: activeProfile.bgColor, color: activeProfile.textColor }"
        >
          <FtProfileIcon
            class="previewProfileIcon"
            :profile="activeProfile"
            :fallback="profileInitial"
          />
        </span>
      </header>
      <div class="previewBody">
        <nav
          v-if="layout === 'desktop'"
          class="previewRail"
        >
          <div
            v-for="(item, index) in items"
            :key="item.id"
            class="previewNavItem"
            :class="{ active: index === 0 }"
            :data-preview-navigation-item="item.id"
          >
            <span class="previewNavIcon">
              <FtIcon
                :icon="item.icon"
                aria-hidden="true"
              />
            </span>
            <span class="previewNavLabel">{{ item.label }}</span>
          </div>
          <hr>
          <template v-if="!hideActiveSubscriptions">
            <span
              v-for="channel in channels"
              :key="channel.key"
              class="previewChannel"
            >
              <FtRetryImage
                v-if="channel.thumbnail"
                :fallback-icon="['fas', 'circle-user']"
                height="35"
                width="35"
                loading="lazy"
                :src="channel.thumbnail"
                alt=""
              />
            </span>
          </template>
        </nav>
        <div class="previewPage">
          <div
            v-for="card in 6"
            :key="card"
            class="previewCard"
          >
            <span class="previewThumbnail" />
            <span class="previewLine" />
            <span class="previewLine short" />
          </div>
        </div>
      </div>
      <nav
        v-if="layout === 'mobile'"
        class="previewBottomBar"
      >
        <div
          v-for="(item, index) in mobilePrimaryItems"
          :key="item.id"
          class="previewNavItem"
          :class="{ active: index === 0 }"
          :data-preview-navigation-item="item.id"
        >
          <span class="previewNavIcon">
            <FtIcon
              :icon="item.icon"
              aria-hidden="true"
            />
          </span>
          <span class="previewNavLabel">{{ item.shortLabel }}</span>
        </div>
        <div
          v-if="showMobileMore"
          class="previewNavItem"
          data-preview-navigation-item="more"
        >
          <span class="previewNavIcon">
            <FtIcon
              :icon="['fas', 'ellipsis-h']"
              aria-hidden="true"
            />
          </span>
          <span class="previewNavLabel">{{ t('More') }}</span>
        </div>
      </nav>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtLogoFull from '../../../FtLogoFull/FtLogoFull.vue'
import FtRetryImage from '../../../FtRetryImage.vue'
import FtProfileIcon from '../../../FtProfileIcon/FtProfileIcon.vue'

import store from '../../../../store/index'
import { youtubeImageUrlToInvidious } from '../../../../helpers/api/invidious'
import { getFirstCharacter } from '../../../../helpers/strings'
import { translateProfileName } from '../../../../helpers/profileSwitching'
import { filterAvailableNavigationItems } from '../../../../../navigationAvailability'
import { NAVIGATION_ITEM_DEFINITIONS } from '../../../../../navigationItems'

defineProps({
  layout: {
    type: String,
    default: 'desktop',
    validator: value => ['desktop', 'mobile'].includes(value)
  }
})

const { locale, t } = useI18n()

const activeProfile = computed(() => store.getters.getActiveProfile)
const profileInitial = computed(() => activeProfile.value?.name
  ? getFirstCharacter(translateProfileName(activeProfile.value, t), locale.value)
  : '')
const compactNavigationLabels = computed(() => store.getters.getCompactNavigationLabels)
const hideActiveSubscriptions = computed(() => store.getters.getHideActiveSubscriptions)
const hideLabelsSideBar = computed(() => store.getters.getHideLabelsSideBar)

const definitions = new Map(NAVIGATION_ITEM_DEFINITIONS.map(item => [item.id, item]))

// Use the same availability rules as the side navigation.
const items = computed(() => filterAvailableNavigationItems(store.getters.getNavigationItems, {
  supportsLocalApi: !!process.env.SUPPORTS_LOCAL_API,
  backendPreference: store.getters.getBackendPreference,
  backendFallback: store.getters.getBackendFallback,
  showWatchStats: store.getters.getRememberHistory && store.getters.getEnableWatchStats,
})
  .map(id => definitions.get(id))
  .filter(item => item != null)
  .map(item => ({
    ...item,
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    label: t(item.labelKey),
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    shortLabel: t(`Mobile Navigation.${item.id}`),
  })))

// Like the side navigation, pins move the fifth destination into More.
const hasPins = computed(() => {
  if (store.getters.getPinnedChannels.length > 0) return true
  const pinnedIds = new Set(store.getters.getPinnedPlaylistIds)
  return pinnedIds.size > 0 && store.getters.getAllPlaylists.some(playlist => pinnedIds.has(playlist._id))
})
const showMobileMore = computed(() => items.value.length > 5 || hasPins.value)
const mobilePrimaryItems = computed(() => showMobileMore.value ? items.value.slice(0, 4) : items.value)

const channels = computed(() => {
  // Load thumbnails through the selected backend, like the side navigation.
  const instanceUrl = store.getters.getBackendPreference === 'invidious'
    ? store.getters.getCurrentInvidiousInstanceUrl
    : null
  const subscriptions = activeProfile.value.subscriptions.slice(0, 4).map(channel => {
    const thumbnail = channel.thumbnail?.replace(/=s\d+/, '=s35')
    return {
      key: channel.id,
      thumbnail: thumbnail && instanceUrl ? youtubeImageUrlToInvidious(thumbnail, instanceUrl) : thumbnail,
    }
  })
  // Show placeholders so the option remains visible without subscriptions.
  while (subscriptions.length < 4) subscriptions.push({ key: `placeholder-${subscriptions.length}`, thumbnail: null })
  return subscriptions
})
</script>

<style scoped src="./NavigationPreview.css" />
