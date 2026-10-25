import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../../store/index'
import {
  createCommentPinSnapshot,
  getCommentPinStorageKey,
  getCommentReplyPinMarker,
  hasPinnedCommentReply,
  loadCommentPins,
  mergePinnedCommentSnapshots,
  saveCommentPins
} from '../../../helpers/commentPins'

/**
 * Comments the user pinned for the active profile on this video or post. Pinned
 * threads stay listed through their snapshots and sort above the others.
 *
 * @param {{ getContentId: () => string, isPostComments: () => boolean, commentData: import('vue').Ref<object[]>, onPinsChanged: () => void }} options
 */
export function useCommentPins({ getContentId, isPostComments, commentData, onPinsChanged }) {
  const { t } = useI18n()
  const activeProfileId = computed(() => store.getters.getActiveProfile._id)
  const commentPinStorageKey = computed(() => {
    return getCommentPinStorageKey(activeProfileId.value, getContentId(), isPostComments())
  })
  const initialCommentPinState = loadCommentPins(commentPinStorageKey.value)
  const personalPinnedCommentIds = ref(initialCommentPinState.commentIds)
  const personalPinnedCommentSnapshots = ref(initialCommentPinState.commentSnapshots)

  function isCommentPersonallyPinned(commentId) {
    return personalPinnedCommentIds.value.has(commentId)
  }

  function personalPinActionLabel(comment) {
    if (isCommentPersonallyPinned(comment.id)) {
      return t('Comments.Unpin comment by author', { author: comment.author })
    }

    return t('Comments.Pin comment by author', { author: comment.author })
  }

  function togglePersonalCommentPin(commentId, rootComment) {
    const commentIds = new Set(personalPinnedCommentIds.value)
    const isReply = commentId !== rootComment.id
    if (commentIds.has(commentId)) {
      commentIds.delete(commentId)
      if (isReply) {
        commentIds.delete(getCommentReplyPinMarker(rootComment.id, commentId))
      }
    } else {
      commentIds.add(commentId)
      if (isReply) {
        commentIds.add(getCommentReplyPinMarker(rootComment.id, commentId))
      }
    }

    const commentSnapshots = personalPinnedCommentSnapshots.value
      .filter(comment => comment.id !== rootComment.id)
    if (commentIds.has(rootComment.id) || hasPinnedCommentReply(commentIds, rootComment.id)) {
      commentSnapshots.push(createCommentPinSnapshot(rootComment))
    }

    personalPinnedCommentIds.value = commentIds
    personalPinnedCommentSnapshots.value = commentSnapshots
    saveCommentPins(commentPinStorageKey.value, { commentIds, commentSnapshots })
    onPinsChanged()
  }

  function replyNodeHasPersonalPin(node) {
    return isCommentPersonallyPinned(node.reply.id) || node.children.some(replyNodeHasPersonalPin)
  }

  function sortReplyNodesByPersonalPins(nodes) {
    return nodes
      .map(node => ({
        ...node,
        children: sortReplyNodesByPersonalPins(node.children)
      }))
      .sort((first, second) => {
        return Number(replyNodeHasPersonalPin(second)) - Number(replyNodeHasPersonalPin(first))
      })
  }

  function commentTreeHasPersonalPin(comment) {
    return isCommentPersonallyPinned(comment.id) ||
      hasPinnedCommentReply(personalPinnedCommentIds.value, comment.id) ||
      comment.replies.some(commentTreeHasPersonalPin)
  }

  const commentEntries = computed(() => {
    return mergePinnedCommentSnapshots(commentData.value, personalPinnedCommentSnapshots.value)
  })

  /**
   * @param {string} contentKey
   */
  function reloadCommentPins(contentKey) {
    const pinState = loadCommentPins(contentKey)
    personalPinnedCommentIds.value = pinState.commentIds
    personalPinnedCommentSnapshots.value = pinState.commentSnapshots
  }

  return {
    commentEntries,
    commentPinStorageKey,
    commentTreeHasPersonalPin,
    isCommentPersonallyPinned,
    personalPinActionLabel,
    personalPinnedCommentIds,
    reloadCommentPins,
    sortReplyNodesByPersonalPins,
    togglePersonalCommentPin
  }
}
