<template>
  <FtSettingsSection :title="t('Settings.Subscription Settings.Platforms.Other Platforms')">
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Subscription Settings.Platforms.Notify When Live')"
        :default-value="liveNotifications"
        setting-key="twitchLiveNotifications"
        :tooltip="t('Tooltips.Subscription Settings.Twitch Notify When Live')"
        :compact="true"
        @change="value => store.dispatch('updateTwitchLiveNotifications', value)"
      />
    </FtFlexBox>
    <FtFlexBox>
      <div class="autoRefreshInterval">
        <FtSelect
          :placeholder="t('Settings.Subscription Settings.Platforms.Auto Refresh Interval')"
          :value="autoRefreshInterval"
          setting-key="platformFeedAutoRefreshInterval"
          :select-names="autoRefreshIntervalNames"
          :select-values="AUTO_REFRESH_INTERVAL_VALUES"
          :tooltip="t('Tooltips.Subscription Settings.Platforms Auto Refresh Interval')"
          :icon="['fas', 'clock']"
          @change="value => store.dispatch('updatePlatformFeedAutoRefreshInterval', value)"
        />
      </div>
    </FtFlexBox>
    <FtFlexBox>
      <FtButton
        :label="t('Settings.Subscription Settings.Platforms.Manage Channels')"
        :icon="['fas', 'user-check']"
        data-settings-subpage="platform-channels"
        @click="showManager = true"
      />
    </FtFlexBox>
    <FtSettingsSubpage
      :open="showManager"
      :title="t('Settings.Subscription Settings.Platforms.Other Platforms')"
      :icon="['fas', 'user-check']"
      @close="showManager = false"
    >
      <div class="channelsHeader">
        <p>{{ t('Subscriptions.Platforms.Description') }}</p>
        <div class="channelInput">
          <FtInput
            ref="channelInput"
            :label="t('Subscriptions.Platforms.Add Channel')"
            :placeholder="t('Subscriptions.Platforms.Channel URL')"
            :icon="['fas', 'link']"
            :show-label="true"
            :show-action-button="true"
            :action-button-label="t('Subscriptions.Platforms.Add Channel')"
            :force-action-button-icon-name="['fas', 'plus']"
            :disabled="isAdding"
            @click="addChannel"
          />
          <div
            v-if="isAdding"
            class="addChannelProgress"
            role="progressbar"
            :aria-label="t('Subscriptions.Platforms.Add Channel')"
          />
        </div>
      </div>
      <div
        ref="channelScroller"
        v-overlay-scrollbars
        class="channelsScroller"
      >
        <div ref="channelContent">
          <p
            v-if="channels.length === 0"
            class="emptyState"
          >
            {{ t('Subscriptions.Platforms.No Channels') }}
          </p>
          <ul
            v-else
            class="channelList"
            :aria-label="t('Subscriptions.Platforms.Followed Channels')"
          >
            <li
              v-for="channel in channels"
              :key="`${channel.platform}:${channel.id}`"
              class="channelRow"
            >
              <FtRetryImage
                v-if="channel.avatar"
                class="channelAvatar"
                :src="channel.avatar"
                :fallback-icon="['fas', 'circle-user']"
                alt=""
              />
              <FtIcon
                v-else
                class="channelAvatar"
                :icon="['fas', 'circle-user']"
                aria-hidden="true"
              />
              <div class="channelText">
                <bdi class="channelName">{{ channel.name }}</bdi>
                <span class="channelPlatform">
                  <FtIcon
                    :icon="PLATFORM_ICONS[channel.platform] ?? ['fas', 'globe']"
                    aria-hidden="true"
                  />
                  {{ getPlatform(channel.platform)?.name ?? channel.platform }}
                </span>
              </div>
              <FtIconButton
                :title="t('Subscriptions.Platforms.Go To Channel', { channel: channel.name })"
                :icon="['fas', 'arrow-right']"
                theme="base-no-default"
                :size="16"
                :padding="8"
                @click="openChannel(channel)"
              />
              <FtIconButton
                :title="t('Subscriptions.Platforms.Unfollow Channel', { channel: channel.name })"
                :icon="['fas', 'trash']"
                theme="base-no-default"
                :size="16"
                :padding="8"
                @click="unfollowPlatformChannel(channel)"
              />
            </li>
          </ul>
        </div>
      </div>
    </FtSettingsSubpage>
  </FtSettingsSection>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../../FtIconButton/FtIconButton.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtRetryImage from '../../FtRetryImage.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSettingsSubpage from '../../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'
import { AUTO_REFRESH_INTERVAL_VALUES, getAutoRefreshIntervalNames } from '../../../helpers/autoRefreshIntervals'
import { clampOverlayScrollTop } from '../../../helpers/overlayScrollbars'
import { followChannelByUrl, getFollowedChannels, PlatformChannelInputError, unfollowPlatformChannel } from '../../../helpers/platformFeed'
import { showToast } from '../../../helpers/utils'
import { getPlatform, getPlatformChannelRoute, PLATFORM_ICONS } from '../../../../platforms/index'

const { t } = useI18n()
const router = useRouter()

const liveNotifications = computed(() => store.getters.getTwitchLiveNotifications)
const autoRefreshInterval = computed(() => store.getters.getPlatformFeedAutoRefreshInterval)
const autoRefreshIntervalNames = computed(() => getAutoRefreshIntervalNames(t))
const channels = computed(() => getFollowedChannels())

const showManager = ref(false)
const isAdding = ref(false)
const channelInput = useTemplateRef('channelInput')
const channelScroller = useTemplateRef('channelScroller')
const channelContent = useTemplateRef('channelContent')

// Unfollowing shortens the list, which can leave the viewport past its end
let contentResizeObserver = null
let observationGeneration = 0

watch(showManager, async (open) => {
  const generation = ++observationGeneration
  stopObservingContent()
  if (!open) return

  await nextTick()
  if (generation !== observationGeneration || !showManager.value) return
  const scroller = channelScroller.value
  const content = channelContent.value
  if (!scroller || !content) return

  const clampScroll = () => clampOverlayScrollTop(scroller, content)
  contentResizeObserver = new ResizeObserver(clampScroll)
  contentResizeObserver.observe(scroller)
  contentResizeObserver.observe(content)
  clampScroll()
})

onBeforeUnmount(() => {
  observationGeneration += 1
  stopObservingContent()
})

function stopObservingContent() {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
}

/**
 * Opens the channel's page in the app, in place of the settings.
 * @param {{ platform: string, id: string }} channel
 */
async function openChannel(channel) {
  await store.dispatch('hideSettingsWindow')
  router.push(getPlatformChannelRoute(channel.platform, channel.id))
}

/**
 * @param {string} message
 */
function showError(message) {
  showToast({ message, icon: ['fas', 'circle-exclamation'] })
}

/**
 * @param {string} text
 */
async function addChannel(text) {
  if (isAdding.value) return
  isAdding.value = true
  try {
    const result = await followChannelByUrl(text)
    if (result === null) {
      showError(t('Subscriptions.Platforms.Channel Not Found'))
    } else if (!result.followed) {
      showError(t('Subscriptions.Platforms.Channel Already Followed'))
    } else {
      channelInput.value?.clear()
    }
  } catch (error) {
    if (!(error instanceof PlatformChannelInputError)) console.error('Failed to follow the channel', error)
    showError(error instanceof PlatformChannelInputError
      ? t('Subscriptions.Platforms.Invalid Channel')
      : t('Subscriptions.Platforms.Channel Could Not Be Loaded'))
  } finally {
    isAdding.value = false
  }
}
</script>

<style scoped src="./PlatformSettings.css" />
