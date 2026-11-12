<template>
  <div
    v-if="canRate || (!hideVideoLikesAndDislikes && (likeCount !== null || dislikeCount !== null))"
    class="likeBarContainer"
  >
    <div class="likeSection">
      <div
        v-if="likePercentageRatio !== null && !hideVideoLikesAndDislikes"
        class="likeBar"
        :style="{ background: `linear-gradient(to right, var(--accent-color) ${likePercentageRatio}%, #9E9E9E ${likePercentageRatio}%)` }"
      />
      <div
        v-if="canRate"
        class="likeCounts"
      >
        <button
          type="button"
          class="likeCount rateButton"
          :aria-pressed="rating === 'LIKE'"
          :aria-label="t('YouTube Account.Like')"
          :title="t('YouTube Account.Like')"
          :disabled="rating === null"
          @click="rate('LIKE')"
        >
          <FtIcon
            :icon="['fas', rating === 'LIKE' ? 'thumbs-up-filled' : 'thumbs-up']"
            aria-hidden="true"
          />
          <span v-if="shownLikeCount !== null && !hideVideoLikesAndDislikes">{{ formatNumber(shownLikeCount) }}</span>
        </button>
        <button
          type="button"
          class="dislikeCount rateButton"
          :aria-pressed="rating === 'DISLIKE'"
          :aria-label="t('YouTube Account.Dislike')"
          :title="t('YouTube Account.Dislike')"
          :disabled="rating === null"
          @click="rate('DISLIKE')"
        >
          <FtIcon
            :icon="['fas', rating === 'DISLIKE' ? 'thumbs-down-filled' : 'thumbs-down']"
            aria-hidden="true"
          />
          <span v-if="shownDislikeCount !== null && !hideVideoLikesAndDislikes">{{ formatNumber(shownDislikeCount) }}</span>
        </button>
      </div>
      <div
        v-else
        class="likeCounts"
      >
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
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'
import { ERROR_TOAST_ICON, formatNumber, showToast } from '../../helpers/utils'
import { isSignedInToYouTube } from '../../helpers/youtube-account-state'
import { getYouTubeVideoRating, rateYouTubeVideo } from '../../helpers/api/youtube-account'
import store from '../../store'

const props = defineProps({
  likeCount: { type: Number, default: null },
  dislikeCount: { type: Number, default: null },
  // Rating needs a YouTube video and a signed-in YouTube account.
  videoId: { type: String, default: '' }
})
const { t } = useI18n()
const hideVideoLikesAndDislikes = computed(() => store.getters.getHideVideoLikesAndDislikes)
const parsedLikeCount = computed(() => props.likeCount === null ? null : formatNumber(props.likeCount))
const parsedDislikeCount = computed(() => props.dislikeCount === null ? null : formatNumber(props.dislikeCount))

const canRate = computed(() => props.videoId !== '' && isSignedInToYouTube(store.getters))
/** @type {import('vue').Ref<import('../../helpers/api/youtube-account-parsers').YouTubeRating | null>} */
const rating = ref(null)
// The public counts include the rating the account had when they loaded.
/** @type {import('vue').Ref<import('../../helpers/api/youtube-account-parsers').YouTubeRating | null>} */
const loadedRating = ref(null)

const shownLikeCount = computed(() => adjustCount(props.likeCount, 'LIKE'))
const shownDislikeCount = computed(() => adjustCount(props.dislikeCount, 'DISLIKE'))
const likePercentageRatio = computed(() => {
  const likes = canRate.value ? shownLikeCount.value : props.likeCount
  const dislikes = canRate.value ? shownDislikeCount.value : props.dislikeCount
  if (likes === null || dislikes === null) return null
  const total = likes + dislikes
  return total === 0 ? null : Math.round((likes / total) * 100)
})

/**
 * @param {number | null} count
 * @param {'LIKE' | 'DISLIKE'} type
 */
function adjustCount(count, type) {
  if (count === null) return null
  return Math.max(0, count + (rating.value === type ? 1 : 0) - (loadedRating.value === type ? 1 : 0))
}

let ratingLoad = 0

// Each channel of the account has its own rating. Separate sources, so a
// token refresh that replaces the account does not reload it.
watch([() => props.videoId, canRate, () => store.getters.getYouTubeAccount?.pageId], async ([videoId, signedIn]) => {
  const load = ++ratingLoad
  rating.value = null
  loadedRating.value = null
  if (!signedIn) return

  let current
  try {
    current = await getYouTubeVideoRating(videoId)
  } catch (error) {
    console.error(error)
  }
  // A newer video or channel started its own load.
  if (load !== ratingLoad) return
  // Without the earlier rating, rating still works.
  rating.value = current ?? 'INDIFFERENT'
  loadedRating.value = rating.value
}, { immediate: true })

// Ratings go out one at a time, in the order they were clicked.
let pendingRating = Promise.resolve()

/** @param {'LIKE' | 'DISLIKE'} type */
function rate(type) {
  const videoId = props.videoId
  const previous = rating.value
  const next = previous === type ? 'INDIFFERENT' : type
  rating.value = next

  const load = ratingLoad
  const pageId = store.getters.getYouTubeAccount?.pageId ?? null
  pendingRating = pendingRating.then(async () => {
    // Switching channels before an earlier rating finished drops this one,
    // so it cannot rate as the other channel.
    if ((store.getters.getYouTubeAccount?.pageId ?? null) !== pageId) return
    try {
      await rateYouTubeVideo(videoId, next)
    } catch (error) {
      console.error(error)
      if (load === ratingLoad && rating.value === next) rating.value = previous
      showToast({
        message: t('YouTube Account.Rating Failed', { error: error?.message ?? String(error) }),
        icon: ERROR_TOAST_ICON
      })
    }
  })
}
</script>

<style scoped src="./WatchVideoLikes.css" />
