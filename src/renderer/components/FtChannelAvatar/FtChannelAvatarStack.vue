<template>
  <span class="channelAvatars">
    <FtChannelAvatar
      v-for="(thumbnail, index) in thumbnails"
      :key="index"
      :thumbnail="thumbnail"
    />
  </span>
</template>

<script setup>
import FtChannelAvatar from './FtChannelAvatar.vue'

defineProps({
  thumbnails: {
    type: Array,
    required: true
  }
})
</script>

<style scoped>
.channelAvatars {
  display: inline-flex;
  flex-shrink: 0;

  > .channelAvatar {
    background: var(--card-bg-color);
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--card-bg-color);
  }

  > .channelAvatar + .channelAvatar {
    margin-inline-start: -8px;
  }
}
</style>
