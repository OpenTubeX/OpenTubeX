import Autolinker from 'autolinker'

import { escapeHTML } from '../../helpers/feed-metadata.js'
import { getSelectedYouTubeProfile } from '../../helpers/youtube-account-state.js'

/**
 * Comment threads nest replies, so the comment section provides the
 * signed-in account's comment actions instead of passing them down.
 * @type {import('vue').InjectionKey<{
 *   enabled: import('vue').ComputedRef<boolean>,
 *   target: import('vue').ComputedRef<import('../../helpers/api/youtube-account-parsers.js').YouTubeCommentTarget | null>,
 *   videoTitle: import('vue').ComputedRef<string>,
 *   watchable: import('vue').ComputedRef<boolean>,
 *   channelId: import('vue').ComputedRef<string | null>,
 *   replyingTo: import('vue').Ref<string | null>,
 *   editing: import('vue').Ref<string | null>,
 *   ratings: Map<string, 'LIKE' | 'DISLIKE'>,
 *   postedBy: Map<string, string | null>,
 *   clampScroll: () => void,
 *   closeReply: (commentId: string) => void,
 *   closeEdit: (commentId: string) => void,
 *   getMentionCandidates: (threadId: string | null) => MentionCandidate[],
 *   addComment: (posted: { id: string, author: string, authorThumb: string }, text: string, mentions: CommentMention[], parentId: string | null, account: import('../../helpers/api/youtube-account').YouTubeAccount | null) => void,
 *   updateComment: (commentId: string, text: string, mentions: CommentMention[]) => void,
 *   removeComment: (commentId: string) => void
 * }>}
 */
export const youTubeCommentsKey = Symbol('youTubeComments')

/**
 * A channel a comment mentions by its handle, which links to the channel.
 * @typedef {{ handle: string, channelId: string }} CommentMention
 */

/**
 * A channel the comment box suggests for a mention.
 * @typedef {CommentMention & { thumbnail: string }} MentionCandidate
 */

/**
 * The top-level comment of a comment or reply. Replies are `parentId.replyId`.
 * @param {string} commentId
 */
export function getRootCommentId(commentId) {
  return commentId.split('.')[0]
}

// Handles are letters, digits, underscores, hyphens, periods and middle dots.
const HANDLE_CHARACTER = /[\p{L}\p{M}\p{N}_.\-·]/u
/** Where a mention can start, like after a space or an opening parenthesis. */
export const MENTION_START = /(?:^|[^\p{L}\p{M}\p{N}_.\-·@])$/u
// YouTube wraps handles in mentions in isolates.
const ISOLATES = /[\u2066-\u2069]/g

/**
 * Where the mentions are in a text: every whole-word occurrence of their
 * handles, which is how the comment box keeps them while the text changes.
 * @param {string} text
 * @param {CommentMention[]} mentions
 * @returns {{ start: number, end: number, mention: CommentMention }[]}
 */
export function findCommentMentions(text, mentions) {
  const ranges = []
  for (const mention of mentions) {
    let start = text.indexOf(mention.handle)
    while (start !== -1) {
      const end = start + mention.handle.length
      // Periods after a handle can end the sentence.
      let next = end
      while (text[next] === '.') next++
      if (MENTION_START.test(text.slice(Math.max(0, start - 1), start)) && (next === text.length || !HANDLE_CHARACTER.test(text[next]))) {
        ranges.push({ start, end, mention })
      }
      start = text.indexOf(mention.handle, end)
    }
  }
  return ranges.sort((a, b) => a.start - b.start)
    // A shorter handle can be the start of a longer one.
    .filter((range, index, sorted) => index === 0 || range.start >= sorted[index - 1].end)
}

/**
 * A comment's text as written and its mentions, for editing. Loaded comments
 * keep the text for translation; comments posted here only have the shown text.
 * @param {{ text: string, translationText?: string | null }} comment
 * @returns {{ text: string, mentions: CommentMention[] }}
 */
export function getCommentEditDraft(comment) {
  const body = new DOMParser().parseFromString(comment.text, 'text/html').body
  const text = (typeof comment.translationText === 'string' ? comment.translationText : body.textContent ?? '')
    .replaceAll(ISOLATES, '')
  /** @type {CommentMention[]} */
  const mentions = []
  for (const link of body.querySelectorAll('a')) {
    const channelId = /^https:\/\/www\.youtube\.com\/channel\/([^/?#]+)$/.exec(link.getAttribute('href') ?? '')?.[1]
    const handle = (link.textContent ?? '').replaceAll(ISOLATES, '').trim()
    if (channelId && handle.startsWith('@') && !mentions.some(mention => mention.handle === handle)) {
      mentions.push({ handle, channelId })
    }
  }
  return { text, mentions }
}

/**
 * A comment's text as HTML, linking its mentions like loaded comments do.
 * @param {string} text
 * @param {CommentMention[]} mentions
 */
function formatCommentText(text, mentions) {
  let html = ''
  let index = 0
  for (const { start, end, mention } of findCommentMentions(text, mentions)) {
    html += `${escapeHTML(text.slice(index, start))}<a href="https://www.youtube.com/channel/${encodeURIComponent(mention.channelId)}">${escapeHTML(mention.handle)}</a>`
    index = end
  }
  // Autolinker leaves the mention links alone.
  return Autolinker.link(html + escapeHTML(text.slice(index)))
}

/**
 * The text YouTube gets for a comment. Like YouTube's web client, it mentions
 * by channel ID, which YouTube links and shows as the handle. A handle typed
 * without picking a suggestion stays plain text.
 * @param {string} text
 * @param {CommentMention[]} mentions
 */
export function getCommentSubmitText(text, mentions) {
  let submitText = ''
  let index = 0
  for (const { start, end, mention } of findCommentMentions(text, mentions)) {
    submitText += `${text.slice(index, start)}@${mention.channelId}`
    index = end
  }
  return submitText + text.slice(index)
}

/**
 * What an edit here changes on a comment, shown until the comments load again.
 * @param {{ translationText?: string | null }} comment
 * @param {string} text
 * @param {CommentMention[]} mentions
 */
export function getEditedCommentFields(comment, text, mentions) {
  return {
    text: formatCommentText(text, mentions),
    // A translation of the old text no longer applies.
    translationText: typeof comment.translationText === 'string' ? text : null,
    translatedText: null,
    translatedLanguage: null,
    showTranslated: false,
    isEdited: true
  }
}

/**
 * A comment the account just posted, in the shape of the parsed comments.
 * @param {{ id: string, author: string, authorThumb: string }} posted
 * @param {string} text
 * @param {CommentMention[]} mentions
 * @param {import('../../helpers/api/youtube-account').YouTubeAccount | null} account
 */
export function createPostedComment(posted, text, mentions, account) {
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
    text: formatCommentText(text, mentions),
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
