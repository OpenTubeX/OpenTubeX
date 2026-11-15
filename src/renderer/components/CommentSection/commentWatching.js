import { computed, inject, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import { youTubeCommentsKey } from './youTubeComments'
import { supportsNotificationHistory } from '../../helpers/notificationHistory'
import { ERROR_TOAST_ICON, showToast } from '../../helpers/utils'
import {
  findWatchedComment,
  isCommentWatchingEnabled,
  unwatchComment,
  watchComment
} from '../../helpers/commentReplyNotifications'

// Comments whose watching is changing, so repeated clicks wait for it.
const pending = reactive(new Set())

/**
 * The bell button on comments, which watches them for replies.
 * @param {{ videoId: import('vue').ComputedRef<string>, videoTitle: import('vue').ComputedRef<string>, watchable: import('vue').ComputedRef<boolean> }} [comments]
 *   the comment section's comment state, injected unless the comment section itself calls this
 */
export function useCommentWatching(comments = inject(youTubeCommentsKey)) {
  const { t } = useI18n()

  const canWatchComments = computed(() => supportsNotificationHistory && comments.watchable.value && isCommentWatchingEnabled())

  /** @param {{ id: string, authorId: string }} comment */
  function isCommentWatched(comment) {
    return findWatchedComment(comments.videoId.value, comment) !== null
  }

  /** @param {{ id: string, authorId: string }} comment */
  function watchLabel(comment) {
    return isCommentWatched(comment) ? t('Comments.Stop Watching for Replies') : t('Comments.Watch for Replies')
  }

  /** @param {{ id: string, authorId: string, author: string, text: string }} comment */
  async function toggleCommentWatch(comment) {
    if (pending.has(comment.id)) return
    pending.add(comment.id)
    const watched = findWatchedComment(comments.videoId.value, comment)
    try {
      if (watched) {
        // Saved on this device, so this fails only when storage does.
        await unwatchComment(watched)
      } else if (!await watchComment(comments.videoId.value, comments.videoTitle.value, comment)) {
        throw new Error('The comment is gone')
      }
    } catch (error) {
      console.error('Failed to change whether a comment is watched', error)
      if (!watched) showToast({ message: t('Comments.Watch Failed'), icon: ERROR_TOAST_ICON })
    } finally {
      pending.delete(comment.id)
    }
  }

  return { canWatchComments, isCommentWatched, watchLabel, toggleCommentWatch }
}
