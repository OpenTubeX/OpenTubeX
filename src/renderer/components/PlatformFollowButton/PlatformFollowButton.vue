<template>
  <!-- Filled until followed, then tonal, like the subscribe button -->
  <FtButton
    :label="followed ? t('Subscriptions.Platforms.Following') : t('Subscriptions.Platforms.Follow')"
    :icon="['fas', followed ? 'check' : 'user-plus']"
    :disabled="busy"
    theme="primary"
    :variant="followed ? 'tonal' : 'filled'"
    @click="toggle"
  />
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'

import { findFollowedChannel, followPlatformChannel, unfollowPlatformChannel } from '../../helpers/platformFeed'
import { showToast } from '../../helpers/utils'

const props = defineProps({
  platform: {
    type: String,
    required: true
  },
  /** The channel's ID, or one from the address of one of its pages */
  channelId: {
    type: String,
    required: true
  }
})

const { t } = useI18n()

const followed = computed(() => findFollowedChannel(props.platform, props.channelId))
const busy = ref(false)

async function toggle() {
  if (busy.value) return
  busy.value = true
  try {
    if (followed.value) {
      await unfollowPlatformChannel(followed.value)
    } else if (await followPlatformChannel(props.platform, props.channelId) === null) {
      showToast({ message: t('Subscriptions.Platforms.Channel Not Found'), icon: ['fas', 'circle-exclamation'] })
    }
  } catch (error) {
    console.error('Failed to follow the channel', error)
    showToast({ message: t('Subscriptions.Platforms.Channel Could Not Be Loaded'), icon: ['fas', 'circle-exclamation'] })
  } finally {
    busy.value = false
  }
}
</script>
