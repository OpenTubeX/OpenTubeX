import Autolinker from 'autolinker'

import { escapeHTML } from '../../helpers/feed-metadata.js'
import { getSelectedYouTubeProfile } from '../../helpers/youtube-account-state.js'

/**
 * Comment threads nest replies, so the comment section provides the
 * signed-in account's comment actions instead of passing them down.
 * @type {import('vue').InjectionKey<{
 *   enabled: import('vue').ComputedRef<boolean>,
 *   videoId: import('vue').ComputedRef<string>,
 *   channelId: import('vue').ComputedRef<string | null>,
 *   replyingTo: import('vue').Ref<string | null>,
 *   editing: import('vue').Ref<string | null>,
 *   ratings: Map<string, 'LIKE' | 'DISLIKE'>,
 *   postedBy: Map<string, string | null>,
 *   clampScroll: () => void,
 *   closeReply: (commentId: string) => void,
 *   closeEdit: (commentId: string) => void,
 *   addComment: (posted: { id: string, author: string, authorThumb: string }, text: string, parentId: string | null, account: import('../../helpers/api/youtube-account').YouTubeAccount | null) => void,
 *   updateComment: (commentId: string, text: string) => void,
 *   removeComment: (commentId: string) => void
 * }>}
 */
export const youTubeCommentsKey = Symbol('youTubeComments')

/**
 * The top-level comment of a comment or reply. Replies are `parentId.replyId`.
 * @param {string} commentId
 */
export function getRootCommentId(commentId) {
  return commentId.split('.')[0]
}

/**
 * A comment's text as written, for editing. Loaded comments keep it for
 * translation; comments posted here only have the shown text.
 * @param {{ text: string, translationText?: string | null }} comment
 */
export function getCommentEditText(comment) {
  if (typeof comment.translationText === 'string') return comment.translationText
  return new DOMParser().parseFromString(comment.text, 'text/html').body.textContent ?? ''
}

/**
 * What an edit here changes on a comment, shown until the comments load again.
 * @param {{ translationText?: string | null }} comment
 * @param {string} text
 */
export function getEditedCommentFields(comment, text) {
  return {
    text: Autolinker.link(escapeHTML(text)),
    // A translation of the old text no longer applies.
    translationText: typeof comment.translationText === 'string' ? text : null,
    showTranslated: false,
    isEdited: true
  }
}

/**
 * A comment the account just posted, in the shape of the parsed comments.
 * @param {{ id: string, author: string, authorThumb: string }} posted
 * @param {string} text
 * @param {import('../../helpers/api/youtube-account').YouTubeAccount | null} account
 */
export function createPostedComment(posted, text, account) {
  const authorId = account?.channelId ?? ''
  const profile = getSelectedYouTubeProfile(account)
  return {
    id: posted.id,
    dataType: 'local',
    authorLink: authorId,
    author: posted.author || profile?.handle || profile?.name || '',
    authorId,
    authorThumb: posted.authorThumb || profile?.thumbnail || '',
    isPinned: false,
    isOwner: false,
    isMember: false,
    // Comment text keeps its line breaks with pre-wrap. Links work like in
    // loaded comments.
    text: Autolinker.link(escapeHTML(text)),
    translationText: null,
    imageAttachment: null,
    isHearted: false,
    hasOwnerReplied: false,
    hasReplyToken: false,
    showReplies: false,
    replies: [],
    memberIconUrl: '',
    time: '',
    published: Date.now(),
    isEdited: false,
    likes: 0,
    numReplies: 0
  }
}
