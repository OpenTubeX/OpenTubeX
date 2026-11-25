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
 * @param {{
 *   target: import('vue').ComputedRef<import('../../helpers/api/youtube-account-parsers').YouTubeCommentTarget | null>,
 *   videoTitle: import('vue').ComputedRef<string>,
 *   watchable: import('vue').ComputedRef<boolean>
 * }} [comments]
 *   the comment section's comment state, injected unless the comment section itself calls this
 */
export function useCommentWatching(comments = inject(youTubeCommentsKey)) {
  const { t } = useI18n()

  const canWatchComments = computed(() => supportsNotificationHistory && comments.watchable.value && isCommentWatchingEnabled())

  /** @param {{ id: string, authorId: string }} comment */
  function isCommentWatched(comment) {
    return comments.target.value !== null && findWatchedComment(comments.target.value, comment) !== null
  }

  /** @param {{ id: string, authorId: string }} comment */
  function watchLabel(comment) {
    return isCommentWatched(comment) ? t('Comments.Stop Watching for Replies') : t('Comments.Watch for Replies')
  }

  /** @param {{ id: string, authorId: string, author: string, text: string }} comment */
  async function toggleCommentWatch(comment) {
    const target = comments.target.value
    if (pending.has(comment.id) || target === null) return
    pending.add(comment.id)
    const watched = findWatchedComment(target, comment)
    try {
      if (watched) {
        // Saved on this device, so this fails only when storage does.
        await unwatchComment(watched)
      } else if (!await watchComment(target, comments.videoTitle.value, comment)) {
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
