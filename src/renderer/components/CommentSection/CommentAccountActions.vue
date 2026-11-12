<template>
  <span class="commentAccountActions">
    <button
      type="button"
      class="commentAccountAction"
      :aria-pressed="rating === 'LIKE'"
      :aria-label="hideCount
        ? t('YouTube Account.Like')
        : t('Display Label', { label: t('YouTube Account.Like'), value: formatViewCount(likeCount, shortenViewCounts) })"
      :title="t('YouTube Account.Like')"
      @click="rate('LIKE')"
    >
      <FtIcon
        :icon="['fas', rating === 'LIKE' ? 'thumbs-up-filled' : 'thumbs-up']"
        aria-hidden="true"
      />
      <span v-if="!hideCount">{{ formatViewCount(likeCount, shortenViewCounts) }}</span>
    </button>
    <button
      type="button"
      class="commentAccountAction"
      :aria-pressed="rating === 'DISLIKE'"
      :aria-label="t('YouTube Account.Dislike')"
      :title="t('YouTube Account.Dislike')"
      @click="rate('DISLIKE')"
    >
      <FtIcon
        :icon="['fas', rating === 'DISLIKE' ? 'thumbs-down-filled' : 'thumbs-down']"
        aria-hidden="true"
      />
    </button>
    <button
      type="button"
      class="commentAccountAction"
      :aria-expanded="comments.replyingTo.value === comment.id"
      @click="toggleReply"
    >
      <FtIcon
        :icon="['fas', 'reply']"
        aria-hidden="true"
      />
      {{ t('YouTube Account.Reply') }}
    </button>
    <button
      v-if="isOwnComment"
      type="button"
      class="commentAccountAction"
      :aria-label="t('YouTube Account.Delete Comment')"
      :title="t('YouTube Account.Delete Comment')"
      :disabled="deleting"
      @click="showDeletePrompt = true"
    >
      <FtIcon
        :icon="['fas', 'trash']"
        aria-hidden="true"
      />
    </button>
    <FtPrompt
      v-if="showDeletePrompt"
      :label="t('YouTube Account.Delete Comment Confirmation')"
      :option-names="[t('YouTube Account.Delete Comment'), t('Cancel')]"
      :option-values="['delete', 'cancel']"
      :option-icons="[['fas', 'trash'], ['fas', 'xmark']]"
      is-first-option-destructive
      autosize
      @click="handleDeletePrompt"
    />
  </span>
</template>

<script setup>
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtPrompt from '../FtPrompt/FtPrompt.vue'

import store from '../../store/index'
import { ERROR_TOAST_ICON, formatViewCount, showToast } from '../../helpers/utils'
import { performYouTubeCommentAction } from '../../helpers/api/youtube-account'
import { getYouTubeChannelKey } from '../../helpers/youtube-account-state'
import { youTubeCommentsKey } from './youTubeComments'

const props = defineProps({
  comment: { type: Object, required: true },
  hideCount: { type: Boolean, default: false },
  shortenViewCounts: { type: Boolean, default: false }
})
const { t } = useI18n()
const comments = inject(youTubeCommentsKey)

// Comments load without the account, so a rating made elsewhere is unknown
// and only ratings made here show.
const rating = computed(() => comments.ratings.get(props.comment.id) ?? 'INDIFFERENT')
const likeCount = computed(() => (props.comment.likes ?? 0) + (rating.value === 'LIKE' ? 1 : 0))
const isOwnComment = computed(() => comments.channelId.value !== null && props.comment.authorId === comments.channelId.value)

const deleting = ref(false)
const showDeletePrompt = ref(false)

// Ratings go out one at a time, in the order they were clicked.
let pendingRating = Promise.resolve()
let pendingRatings = 0
// The rating YouTube has, which a failed rating returns to, and its channel.
let confirmed = { channelKey: null, rating: 'INDIFFERENT' }

/** @param {'LIKE' | 'DISLIKE'} type */
function rate(type) {
  const commentId = props.comment.id
  const videoId = comments.videoId.value
  const previous = rating.value
  const next = previous === type ? 'INDIFFERENT' : type
  const channelKey = getYouTubeChannelKey(store.getters.getYouTubeAccount)
  const sameChannel = () => getYouTubeChannelKey(store.getters.getYouTubeAccount) === channelKey
  // Another channel's rating from earlier clicks does not apply.
  if (pendingRatings === 0 || confirmed.channelKey !== channelKey) confirmed = { channelKey, rating: previous }
  setRating(commentId, next)

  // Liking replaces a dislike and the reverse, like on YouTube.
  const action = next === 'LIKE' ? 'like' : next === 'DISLIKE' ? 'dislike' : previous === 'LIKE' ? 'unlike' : 'undislike'
  pendingRatings++
  pendingRating = pendingRating.then(async () => {
    try {
      // Switching channels or accounts before an earlier rating finished
      // drops this one, so it cannot rate as the other channel.
      if (!sameChannel()) return
      await performYouTubeCommentAction(action, commentId, videoId)
      if (sameChannel()) confirmed = { channelKey, rating: next }
    } catch (error) {
      console.error(error)
      showToast({
        message: t('YouTube Account.Rating Failed', { error: error?.message ?? String(error) }),
        icon: ERROR_TOAST_ICON
      })
    } finally {
      pendingRatings--
      // Once every click went out, show the rating YouTube has.
      if (pendingRatings === 0 && sameChannel()) setRating(commentId, confirmed.rating)
    }
  })
}

/**
 * @param {string} commentId
 * @param {'LIKE' | 'DISLIKE' | 'INDIFFERENT'} value
 */
function setRating(commentId, value) {
  if (value === 'INDIFFERENT') {
    comments.ratings.delete(commentId)
  } else {
    comments.ratings.set(commentId, value)
  }
}

function toggleReply() {
  comments.replyingTo.value = comments.replyingTo.value === props.comment.id ? null : props.comment.id
}

/** @param {'delete' | 'cancel' | null} value */
async function handleDeletePrompt(value) {
  showDeletePrompt.value = false
  if (value !== 'delete') return

  deleting.value = true
  try {
    await performYouTubeCommentAction('delete', props.comment.id, comments.videoId.value)
    comments.removeComment(props.comment.id)
    showToast({ message: t('YouTube Account.Comment Deleted'), icon: ['fas', 'trash'] })
  } catch (error) {
    console.error(error)
    showToast({
      message: t('YouTube Account.Delete Comment Failed', { error: error?.message ?? String(error) }),
      icon: ERROR_TOAST_ICON
    })
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.commentAccountActions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.commentAccountAction {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-block-size: 32px;
  padding-block: 4px;
  padding-inline: 8px;
  border: 0;
  border-radius: var(--shape-corner-full);
  background: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.commentAccountAction:hover:not(:disabled),
.commentAccountAction:focus-visible {
  background-color: var(--side-nav-hover-color);
}

.commentAccountAction:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.commentAccountAction[aria-pressed='true'] {
  color: var(--primary-color);
}

.commentAccountAction:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
