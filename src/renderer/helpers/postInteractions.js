import { reactive } from 'vue'

import store from '../store/index'
import i18n from '../i18n/index'
import { getLocalPollResults } from './api/local'
import { rateYouTubePost, voteInYouTubePoll } from './api/youtube-account'
import { ERROR_TOAST_ICON, showToast } from './utils'
import { getYouTubeChannelKey } from './youtube-account-state'

/**
 * What the account did with posts here: votes in polls, answers to quizzes,
 * and ratings. Posts load without the account, so what it did elsewhere is
 * unknown and only what it does here shows. Kept in memory, as the keys
 * contain the sign-in token, and shared, so a post shows them in feeds and on
 * its page alike.
 */
function createPostState() {
  /** @type {Map<string, any>} */
  const values = reactive(new Map())
  /**
   * Changes of a post go out one at a time, in the order they were made. The
   * value YouTube has is what a failed change returns to.
   * @type {Map<string, { pending: number, promise: Promise<void>, confirmed: any }>}
   */
  const queues = new Map()

  /**
   * @param {string} key
   * @param {any} value null for none
   */
  function set(key, value) {
    if (value === null) values.delete(key)
    else values.set(key, value)
  }

  return {
    /** @param {string} key */
    get: key => values.get(key) ?? null,
    /**
     * @param {string} key
     * @param {any} value
     * @param {(confirmed: any) => Promise<void>} send changes YouTube's value, as last confirmed, to `value`
     * @param {(error: string) => string} failedMessage the toast for a failed change
     * @param {() => void} [onSent]
     */
    change(key, value, send, failedMessage, onSent) {
      let queue = queues.get(key)
      if (!queue) {
        queue = { pending: 0, promise: Promise.resolve(), confirmed: values.get(key) ?? null }
        queues.set(key, queue)
      }
      set(key, value)
      queue.pending++
      queue.promise = queue.promise.then(async () => {
        try {
          // From what YouTube has, as an earlier change in the queue can fail.
          if (queue.confirmed !== value) await send(queue.confirmed)
          queue.confirmed = value
          onSent?.()
        } catch (error) {
          console.error(error)
          showToast({ message: failedMessage(error?.message ?? String(error)), icon: ERROR_TOAST_ICON })
        } finally {
          // Once every change went out, show the value YouTube has.
          if (--queue.pending === 0) {
            set(key, queue.confirmed)
            queues.delete(key)
          }
        }
      })
    }
  }
}

const votes = createPostState()
const ratings = createPostState()

/**
 * The public count shown when the account last changed its vote or like here,
 * and whether it includes the account's earlier one.
 * @type {Map<string, { count: number | null, includesOwn: boolean }>}
 */
const shownCounts = reactive(new Map())

/**
 * Remembers the count a change is made with. Counts load without the account,
 * so one loaded before any change here lacks it, and one loaded after an
 * earlier change includes that.
 * @param {string} key
 * @param {number | null} count
 * @param {boolean} hadOwn whether the account had its vote or like before the change
 */
function rememberCount(key, count, hadOwn) {
  const known = shownCounts.get(key)
  shownCounts.set(key, { count, includesOwn: known ? (known.count === count ? known.includesOwn : hadOwn) : false })
}

/**
 * The count shown with the account's vote or like made here. A count loaded
 * since the last change includes it already.
 * @param {string} key
 * @param {number | null} count
 * @param {boolean} hasOwn whether the account has its vote or like
 */
function countWithOwn(key, count, hasOwn) {
  const known = shownCounts.get(key)
  if (count == null || known?.count !== count) return count
  return count + (hasOwn ? 1 : 0) - (known.includesOwn ? 1 : 0)
}

/** @param {string} error */
const voteFailed = error => i18n.global.t('YouTube Account.Vote Failed', { error })
/**
 * @param {import('./api/youtube-account').YouTubeAccount | null} account
 * @param {string} postId
 */
function getKey(account, postId) {
  return `${getYouTubeChannelKey(account)}\n${postId}`
}

/**
 * The choice the channel in use voted for or answered here, if any.
 * @param {string} postId
 * @returns {number | null}
 */
export function getPollVote(postId) {
  return votes.get(getKey(store.getters.getYouTubeAccount, postId))
}

/**
 * Votes for a choice, which moves an earlier vote, or takes the vote back when
 * the choice has it.
 * @param {string} postId
 * @param {string} channelId the post's channel
 * @param {number} choiceIndex
 * @param {number | null} totalVotes the vote count as loaded
 */
export function togglePollVote(postId, channelId, choiceIndex, totalVotes) {
  // Votes as the channel that clicked, even after a switch while they go out.
  const account = store.getters.getYouTubeAccount
  const key = getKey(account, postId)
  const previous = votes.get(key)
  rememberCount(`votes\n${key}`, totalVotes, previous !== null)
  const next = previous === choiceIndex ? null : choiceIndex
  // Voting for another choice moves the vote, and taking it back names the choice.
  votes.change(key, next, confirmed => next === null
    ? voteInYouTubePoll(postId, channelId, confirmed, false, account)
    : voteInYouTubePoll(postId, channelId, next, true, account),
  voteFailed, () => { if (next !== null) loadPollResults(postId, channelId) })
}

/**
 * Answers a quiz. Like on YouTube, the answer is final.
 * @param {string} postId
 * @param {string} channelId the post's channel
 * @param {number} choiceIndex
 * @param {boolean} isCorrect
 * @param {number | null} totalVotes the answer count as loaded
 */
export function answerQuiz(postId, channelId, choiceIndex, isCorrect, totalVotes) {
  const account = store.getters.getYouTubeAccount
  const key = getKey(account, postId)
  if (votes.get(key) !== null) return
  rememberCount(`votes\n${key}`, totalVotes, false)
  votes.change(key, choiceIndex, () => voteInYouTubePoll(postId, channelId, choiceIndex, true, account, isCorrect), voteFailed)
}

/**
 * The vote or answer count with the account's vote or answer made here.
 * @param {string} postId
 * @param {number | null} totalVotes as loaded
 */
export function getShownVoteCount(postId, totalVotes) {
  const key = getKey(store.getters.getYouTubeAccount, postId)
  return countWithOwn(`votes\n${key}`, totalVotes, votes.get(key) !== null)
}

/** @type {Map<string, import('./api/youtube-account-parsers').PollChoiceResult[]>} */
const pollResults = reactive(new Map())
const loadingPollResults = new Set()

/**
 * The share of the votes of each choice, once the account voted here.
 * @param {string} postId
 */
export function getPollResults(postId) {
  return pollResults.get(postId) ?? null
}

/**
 * @param {string} postId
 * @param {string} channelId
 */
async function loadPollResults(postId, channelId) {
  // Only the local API can load them. They include both states of each choice, so one load serves later votes too.
  if (!process.env.SUPPORTS_LOCAL_API || pollResults.has(postId) || loadingPollResults.has(postId)) return
  loadingPollResults.add(postId)
  try {
    const results = await getLocalPollResults(postId, channelId)
    if (results) pollResults.set(postId, results)
  } catch (error) {
    // The vote counted, so it shows without the results.
    console.warn('Could not load the results of a poll', error)
  } finally {
    loadingPollResults.delete(postId)
  }
}

/**
 * The account's rating of a post, as made here.
 * @param {string} postId
 * @returns {'LIKE' | 'DISLIKE' | null}
 */
export function getPostRating(postId) {
  return ratings.get(getKey(store.getters.getYouTubeAccount, postId))
}

/**
 * Likes or dislikes a post, or takes the rating back when it has it.
 * @param {string} postId
 * @param {string} channelId the post's channel
 * @param {'LIKE' | 'DISLIKE'} type
 * @param {number | null} likeCount the like count as loaded
 */
export function ratePost(postId, channelId, type, likeCount) {
  const account = store.getters.getYouTubeAccount
  const key = getKey(account, postId)
  const previous = ratings.get(key)
  rememberCount(`likes\n${key}`, likeCount, previous === 'LIKE')
  const next = previous === type ? null : type
  ratings.change(key, next, confirmed => {
    // Liking replaces a dislike and the reverse, like on YouTube.
    const action = next === 'LIKE' ? 'like' : next === 'DISLIKE' ? 'dislike' : confirmed === 'LIKE' ? 'unlike' : 'undislike'
    return rateYouTubePost(postId, channelId, action, account)
  }, error => i18n.global.t('YouTube Account.Rating Failed', { error }))
}

/**
 * The like count with the account's like made here.
 * @param {string} postId
 * @param {number | null} likeCount as loaded
 */
export function getShownLikeCount(postId, likeCount) {
  const key = getKey(store.getters.getYouTubeAccount, postId)
  return countWithOwn(`likes\n${key}`, likeCount, ratings.get(key) === 'LIKE')
}
