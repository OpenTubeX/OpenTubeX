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
     * @param {() => Promise<void>} send
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
          await send()
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
/** @param {string} error */
const voteFailed = error => i18n.global.t('YouTube Account.Vote Failed', { error })
const ratings = createPostState()

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
 */
export function togglePollVote(postId, channelId, choiceIndex) {
  // Votes as the channel that clicked, even after a switch while they go out.
  const account = store.getters.getYouTubeAccount
  const key = getKey(account, postId)
  const vote = votes.get(key) !== choiceIndex
  votes.change(key, vote ? choiceIndex : null, () => voteInYouTubePoll(postId, channelId, choiceIndex, vote, account),
    voteFailed, () => { if (vote) loadPollResults(postId, channelId) })
}

/**
 * Answers a quiz. Like on YouTube, the answer is final.
 * @param {string} postId
 * @param {string} channelId the post's channel
 * @param {number} choiceIndex
 * @param {boolean} isCorrect
 */
export function answerQuiz(postId, channelId, choiceIndex, isCorrect) {
  const account = store.getters.getYouTubeAccount
  const key = getKey(account, postId)
  if (votes.get(key) !== null) return
  votes.change(key, choiceIndex, () => voteInYouTubePoll(postId, channelId, choiceIndex, true, account, isCorrect), voteFailed)
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
 */
export function ratePost(postId, channelId, type) {
  const account = store.getters.getYouTubeAccount
  const key = getKey(account, postId)
  const previous = ratings.get(key)
  const next = previous === type ? null : type
  // Liking replaces a dislike and the reverse, like on YouTube.
  const action = next === 'LIKE' ? 'like' : next === 'DISLIKE' ? 'dislike' : previous === 'LIKE' ? 'unlike' : 'undislike'
  ratings.change(key, next, () => rateYouTubePost(postId, channelId, action, account),
    error => i18n.global.t('YouTube Account.Rating Failed', { error }))
}
