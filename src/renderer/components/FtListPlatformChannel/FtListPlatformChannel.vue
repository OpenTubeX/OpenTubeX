<template>
  <div
    class="ft-list-channel ft-list-item"
    :class="{ list: layout === 'list', grid: layout !== 'list' }"
  >
    <div class="channelThumbnail">
      <RouterLink
        :to="route"
        class="channelThumbnailLink"
        tabindex="-1"
        aria-hidden="true"
      >
        <FtRetryImage
          :fallback-icon="['fas', 'circle-user']"
          :src="channel.avatar ?? ''"
          class="channelImage"
          alt=""
        />
      </RouterLink>
    </div>
    <div class="infoAndSubscribe">
      <div class="info">
        <RouterLink
          class="title"
          :to="route"
        >
          <h3
            class="h3Title"
            dir="auto"
          >
            {{ channel.name }}
          </h3>
        </RouterLink>
        <div class="infoLine">
          <span class="platformName">
            <FtIcon
              :icon="PLATFORM_ICONS[channel.platform] ?? ['fas', 'globe']"
              aria-hidden="true"
            />
            {{ getPlatform(channel.platform)?.name }}
          </span>
          <span
            v-if="channel.followerCount != null && !hideChannelSubscriptions"
            class="subscriberCount hasMetadataSeparator"
          >
            {{ t('Platforms.Follower Count', { count: formatSubscriberCount(channel.followerCount) }, channel.followerCount) }}
          </span>
        </div>
      </div>
      <PlatformFollowButton
        :platform="channel.platform"
        :channel-id="channel.id"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtRetryImage from '../FtRetryImage.vue'
import PlatformFollowButton from '../PlatformFollowButton/PlatformFollowButton.vue'

import store from '../../store/index'
import { formatSubscriberCount } from '../../helpers/utils'
import { getPlatform, getPlatformChannelRoute, PLATFORM_ICONS } from '../../../platforms/index'

const props = defineProps({
  /** @type {import('vue').PropType<import('../../../platforms/types').PlatformChannel>} */
  channel: {
    type: Object,
    required: true
  },
  layout: {
    type: String,
    default: 'grid'
  }
})

const { t } = useI18n()

const route = computed(() => getPlatformChannelRoute(props.channel.platform, props.channel.id))
const hideChannelSubscriptions = computed(() => store.getters.getHideChannelSubscriptions)
</script>

<style scoped lang="scss" src="../FtListChannel/FtListChannel.scss" />
