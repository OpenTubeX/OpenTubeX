<template>
  <div
    v-if="!hideVideoLikesAndDislikes && (likeCount !== null || dislikeCount !== null)"
    class="likeBarContainer"
  >
    <div class="likeSection">
      <div
        v-if="likePercentageRatio !== null"
        class="likeBar"
        :style="{ background: `linear-gradient(to right, var(--accent-color) ${likePercentageRatio}%, #9E9E9E ${likePercentageRatio}%)` }"
      />
      <div class="likeCounts">
        <span
          v-if="likeCount !== null"
          class="likeCount"
          role="img"
          :aria-label="t('Global.Counts.Like Count', { count: parsedLikeCount }, likeCount)"
        ><FtIcon
          :icon="['fas', 'thumbs-up']"
          aria-hidden="true"
        /> {{ parsedLikeCount }}</span>
        <span
          v-if="dislikeCount !== null"
          class="dislikeCount"
          role="img"
          :aria-label="`${parsedDislikeCount} ${t('Video.External Media.Dislikes', {}, dislikeCount)}`"
        ><FtIcon
          :icon="['fas', 'thumbs-down']"
          aria-hidden="true"
        /> {{ parsedDislikeCount }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'
import { formatNumber } from '../../helpers/utils'
import store from '../../store'

const props = defineProps({
  likeCount: { type: Number, default: null },
  dislikeCount: { type: Number, default: null }
})
const { t } = useI18n()
const hideVideoLikesAndDislikes = computed(() => store.getters.getHideVideoLikesAndDislikes)
const parsedLikeCount = computed(() => props.likeCount === null ? null : formatNumber(props.likeCount))
const parsedDislikeCount = computed(() => props.dislikeCount === null ? null : formatNumber(props.dislikeCount))
const likePercentageRatio = computed(() => {
  if (props.likeCount === null || props.dislikeCount === null) return null
  const total = props.likeCount + props.dislikeCount
  return total === 0 ? null : Math.round((props.likeCount / total) * 100)
})
</script>

<style scoped src="./WatchVideoLikes.css" />
