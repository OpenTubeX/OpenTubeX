import { LocalNotifications } from '@capacitor/local-notifications'
import { ref } from 'vue'

import store from '../store/index'
import i18n from '../i18n/index'
import { createLocalCommentsClient } from './api/local'
import {
  deliverAndroidNotification,
  isAndroidBackgroundRenderer,
  onPeriodicBackgroundTask,
  setPeriodicBackgroundTask
} from './androidBackgroundSync.js'
import { clearLegacyAndroidNotificationChecks, readLegacyAndroidWatchedComments } from './androidSubscriptionRefresh'
import { isAppHidden } from './appVisibility'
import { capacitorNotificationHistory } from './capacitorNotificationHistory'
import { getCommentLocalNotificationId } from './capacitorSystemNotifications'
import { openNotificationEntry, showInAppNotification, withThumbnail } from './notificationHistory'
import { requestCapacitorNotificationPermission } from './platformFeed'
import { getSelectedYouTubeProfile, isSignedInToYouTube } from './youtube-account-state'
import {
  checkCommentHearts,
  cleanCommentText,
  COMMENT_TEXT_LIMIT,
  findCommentHeart,
  findCommentsToLink,
  findNewReplies,
  getHeartComments,
  getCommentNotificationTarget,
  getWatchedCommentId,
  isOwnWatchedComment,
  isSameWatchedComment,
  markThreadOpened,
  normalizeTrackedCommentThreads,
  trackComment,
  untrackComment
} from '../../commentReplyTracking.js'

const STORAGE_KEY = 'commentReplyThreads'
const LOCK_NAME = 'opentubex-comment-reply-check'
const CHECK_INTERVAL_MS = 15 * 60 * 1000
// Reply pages hold 10 replies each.
const MAX_REPLY_PAGES = 10
const CHANNEL_ID = 'comment-replies'
const isAndroid = !!process.env.IS_CAPACITOR && !process.env.IS_IOS

/** @typedef {import('../../commentReplyTracking.js').TrackedCommentThread} TrackedCommentThread */

/**
 * The watched comments as last loaded, for the watch buttons on comments.
 * @type {import('vue').Ref<TrackedCommentThread[]>}
 */
export const watchedComments = ref([])

/** @returns {TrackedCommentThread[]} */
/** @param {number} [now] when the watches must still run */
function loadThreads(now = Date.now()) {
  try {
    return normalizeTrackedCommentThreads(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'), now)
  } catch {
    return []
  }
}

/** @param {TrackedCommentThread[]} threads */
function saveThreads(threads) {
  if (threads.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(threads))
  else localStorage.removeItem(STORAGE_KEY)
  watchedComments.value = threads
}

/** Whether comments can be watched for replies, which the settings turn on. */
export function isCommentWatchingEnabled() {
  return store.getters.getCommentReplyNotifications && store.getters.getNotificationMode !== 'off'
}

/**
 * Watches the thread of a comment the account just posted for replies.
 * @param {string} videoId
 * @param {string} threadId the top-level comment
 * @param {string} commentId the posted comment, the same as `threadId` unless it is a reply
 * @param {import('./api/youtube-account').YouTubeAccount | null} account the channel that posted it
 * @param {string} text the posted text, shown in the list of watched comments
 * @param {string} videoTitle
 */
export function trackCommentReplies(videoId, threadId, commentId, account, text, videoTitle) {
  // Without its channel, the account's own replies would be announced too.
  if (!isCommentWatchingEnabled() || !store.getters.getYouTubeAccountReplyNotifications || !account?.channelId) return
  const comment = {
    videoId,
    threadId,
    commentId,
    channelId: account.channelId,
    handle: getSelectedYouTubeProfile(account)?.handle ?? null,
    accountId: account.channelId,
    text: text.slice(0, COMMENT_TEXT_LIMIT),
    videoTitle,
    // Just posted, so a heart found later is new.
    hearted: false
  }
  // The comment is posted, so failing to watch it must not fail the post.
  saveComment(comment).catch(error => console.error('Failed to watch a comment for replies', error))
}

/**
 * Watches a loaded comment for replies, from the replies it has now.
 * @param {string} videoId
 * @param {string} videoTitle
 * @param {{ id: string, authorId: string, author: string, text: string }} comment `text` is HTML
 * @returns {Promise<boolean>} false when the comment is gone
 */
export async function watchComment(videoId, videoTitle, { id, authorId, author, text }) {
  const account = isSignedInToYouTube(store.getters) ? store.getters.getYouTubeAccount : null
  const threadId = id.split('.')[0]
  const watched = {
    videoId,
    threadId,
    commentId: id,
    channelId: authorId,
    handle: author || null,
    accountId: account?.channelId ?? '',
    text: (new DOMParser().parseFromString(text, 'text/html').body.textContent ?? '').slice(0, COMMENT_TEXT_LIMIT),
    videoTitle
  }
  // The replies so far count as seen, and a heart it has already counts as announced, so only new ones are announced.
  const result = await fetchThread({ ...watched, postedAt: 0, replyCount: -1, seen: [] })
  if (!result) return false
  const heart = result.hearts.get(getWatchedCommentId(watched))
  await saveComment({ ...watched, replyCount: result.replyCount, seen: result.replies.map(reply => reply.id), hearted: heart?.hearted })
  return true
}

/** @param {Parameters<typeof trackComment>[1]} comment */
async function saveComment(comment) {
  // Watching is on unless turned off, so the first watched comment asks for the permission.
  if (process.env.IS_CAPACITOR) requestCapacitorNotificationPermission()
  saveThreads(trackComment(loadThreads(), comment))
}

/**
 * Stops watching a comment, with its author's other comments in the thread.
 * @param {Pick<TrackedCommentThread, 'videoId' | 'threadId' | 'channelId'>} comment
 */
export async function unwatchComment({ videoId, threadId, channelId }) {
  saveThreads(untrackComment(loadThreads(), { videoId, threadId, channelId }))
}

/**
 * Counts opening a thread, as from a notification or the list of watched
 * comments, as activity of the comments watched in it.
 * @param {string} videoId
 * @param {string} commentId a comment in the thread, `threadId.replyId` for a reply
 */
export async function markWatchedThreadOpened(videoId, commentId) {
  const threads = markThreadOpened(loadThreads(), videoId, commentId.split('.')[0])
  if (threads) saveThreads(threads)
}

/**
 * The watched comment that covers a loaded comment, if any.
 * @param {string} videoId
 * @param {{ id: string, authorId: string }} comment
 */
export function findWatchedComment(videoId, { id, authorId }) {
  const key = { videoId, threadId: id.split('.')[0], channelId: authorId }
  // Watching only the author's replies does not cover their top-level comment's whole thread.
  return watchedComments.value.find(thread => isSameWatchedComment(thread, key) &&
    (id !== key.threadId || thread.commentId === key.threadId)) ?? null
}

/** @returns {Promise<TrackedCommentThread[]>} the watched comments, last active first */
export async function getWatchedComments() {
  await migrateAndroidWatchedComments()
  const threads = loadThreads()
  watchedComments.value = threads
  return threads
}

let androidMigration = null

/**
 * Takes over the comments that the native checks of earlier Android versions
 * watched, keeping the entries watched here meanwhile.
 * @returns {Promise<void>}
 */
function migrateAndroidWatchedComments() {
  // The renderer of the periodic job lacks the plugin, and the app migrates once it opens.
  if (!isAndroid || isAndroidBackgroundRenderer) return Promise.resolve()
  androidMigration ??= (async () => {
    const legacy = await readLegacyAndroidWatchedComments()
    if (legacy.length > 0) {
      const threads = loadThreads()
      saveThreads(normalizeTrackedCommentThreads([
        ...threads,
        ...legacy.filter(thread => !threads.some(item => isSameWatchedComment(item, thread)))
      ]))
    }
    // Saved first, so stopping in between takes them over again instead of losing them.
    await clearLegacyAndroidNotificationChecks()
  })().catch(error => {
    androidMigration = null
    console.error('Failed to take over the watched comments', error)
  })
  return androidMigration
}

/**
 * The title of a notification about a reply.
 * @param {TrackedCommentThread} thread
 * @param {string} author
 */
function getReplyTitle(thread, author) {
  return isOwnWatchedComment(thread)
    ? i18n.global.t('YouTube Account.{author} replied to your comment', { author })
    : i18n.global.t('YouTube Account.{author} replied to {commentAuthor}', { author, commentAuthor: thread.handle || '?' })
}

/** The channel signed in now, whose replies are never announced. */
function getSignedInChannelId() {
  return isSignedInToYouTube(store.getters) ? store.getters.getYouTubeAccount?.channelId ?? '' : ''
}

/**
 * The thread's reply count and replies, oldest first, and whether the watched
 * comments are hearted. Loads at most MAX_REPLY_PAGES pages, and none when the
 * count did not change. For a linked thread, YouTube lists answers to replies
 * after them instead of nesting them.
 * @param {import('../../commentReplyTracking.js').TrackedCommentThread} thread
 * @returns {Promise<{
 *   replyCount: number,
 *   replies: import('../../commentReplyTracking.js').CommentReply[],
 *   hearts: Map<string, import('../../commentReplyTracking.js').CommentHeart>
 * } | null>} null when the thread is gone; `hearts` lacks the comments it did not find
 */
async function fetchThread(thread) {
  const ids = getHeartComments(thread).map(comment => comment.id)
  /** @type {Map<string, import('../../commentReplyTracking.js').CommentHeart>} */
  const hearts = new Map()
  // A linked reply comes with its thread, and reply pages with their replies,
  // though youtubei.js leaves out their hearts, so they are read from the responses.
  const innertube = await createLocalCommentsClient(data => {
    for (const id of ids) {
      const heart = hearts.has(id) ? null : findCommentHeart(data, id)
      if (heart) hearts.set(id, heart)
    }
  })
  // The thread of the linked comment comes first.
  const comments = await innertube.getComments(thread.videoId, undefined, getWatchedCommentId(thread))
  const commentThread = comments.contents.find(item => item.comment?.comment_id === thread.threadId)
  if (!commentThread) return null
  const replyCount = Number.parseInt(String(commentThread.comment.reply_count ?? '0').replaceAll(/\D/g, '') || '0')
  const replies = replyCount === thread.replyCount || !commentThread.has_replies ? [] : await fetchReplies(commentThread)
  // Own comments not found so far each need a request that links them.
  for (const { id } of findCommentsToLink(thread, hearts)) {
    await innertube.getComments(thread.videoId, undefined, id)
      .catch(error => console.warn('Could not check a comment for a heart', error))
  }
  return { replyCount, replies, hearts }
}

/**
 * Loads the replies of a thread, oldest first, at most MAX_REPLY_PAGES pages.
 * @param {any} commentThread
 * @returns {Promise<import('../../commentReplyTracking.js').CommentReply[]>}
 */
async function fetchReplies(commentThread) {
  const replies = []
  /** @param {any[] | undefined} items */
  const collect = items => {
    for (const { comment } of items ?? []) {
      if (!comment?.comment_id) continue
      replies.push({
        id: comment.comment_id,
        authorId: comment.author?.id ?? '',
        author: comment.author?.name ?? '',
        text: cleanCommentText(comment.content?.toString() ?? '')
      })
    }
  }
  await commentThread.getReplies()
  collect(commentThread.replies)
  /** @type {any} */
  let page = commentThread
  for (let loaded = 1; page.has_continuation && loaded < MAX_REPLY_PAGES; loaded++) {
    page = await page.getContinuation()
    collect(page.replies)
  }
  return replies
}

/**
 * Shows a notification about a reply or a heart, and adds it to the history.
 * @param {'comment-reply' | 'comment-heart'} kind
 * @param {string} videoId
 * @param {string} commentId the reply's, or the hearted comment's
 * @param {string} title
 * @param {string} body
 */
async function announce(kind, videoId, commentId, title, body) {
  const target = getCommentNotificationTarget(kind, videoId, commentId)
  if (!target) return
  const thumbnail = withThumbnail(videoId).thumbnail

  if (isAndroid) {
    const mode = store.getters.getNotificationMode
    if (!isCommentWatchingEnabled() || mode === 'off') return
    // Android shows it like an upload, or leaves it to the visible app, which
    // adds it to the history.
    await deliverAndroidNotification({
      feedType: kind,
      id: `${videoId}/${commentId}`,
      title,
      body,
      thumbnail,
      history: mode === 'both'
    })
    return
  }

  if (process.env.IS_ELECTRON) {
    await window.ftElectron.notificationHistory.notifyComment({ kind, videoId, commentId, title, body, thumbnail })
    return
  }

  // Checked first, as the system suspends hidden apps, also during the check,
  // so the app may be visible again once it returns
  const granted = (await LocalNotifications.checkPermissions()).display === 'granted'
  // Notifications may have been turned off meanwhile.
  if (!isCommentWatchingEnabled()) return
  if (store.getters.getNotificationMode === 'both') {
    const [entry] = capacitorNotificationHistory.add([{ title, body, ...(thumbnail ? { thumbnail } : {}), ...target }])
    // Read on another device already
    if (!entry || entry.read) return
    if (!isAppHidden()) {
      showInAppNotification(entry)
      return
    }
  }
  if (!granted || store.getters.getNotificationMode === 'off') return
  await LocalNotifications.schedule({
    notifications: [{
      id: getCommentLocalNotificationId(kind, commentId),
      title,
      body,
      channelId: CHANNEL_ID,
      // Shown right away, so it needs no exact alarm, which the system would ask the user to allow
      isExactNotification: false,
      // Named before hearts were announced, and kept for notifications shown before
      extra: { commentReplyTarget: target }
    }]
  })
}

async function checkThreads() {
  // Comments of several authors in a thread can be watched, and a reply can answer more than one.
  const announced = new Set()
  const signedInId = getSignedInChannelId()
  // Watches expire from when the check started, so a reply found after one
  // ran out during the check still keeps it watched.
  const startedAt = Date.now()
  for (const key of loadThreads(startedAt)) {
    if (!isCommentWatchingEnabled()) return
    // Reloaded for each thread, as comments watched meanwhile change the list.
    const thread = loadThreads(startedAt).find(item => isSameWatchedComment(item, key))
    if (!thread) continue
    let result
    try {
      result = await fetchThread(thread)
    } catch (error) {
      console.warn('Could not check a comment for replies', error)
      continue
    }
    // Stopped watching while it loaded
    const current = loadThreads(startedAt).find(item => isSameWatchedComment(item, key))
    if (!current) continue
    const { added, seen, active } = result ? findNewReplies(current, result.replies, signedInId) : { added: [], seen: current.seen, active: false }
    const hearts = checkCommentHearts(current, result?.hearts ?? new Map())
    // Announced before they count as seen, so closing the app in between
    // repeats a reply or heart rather than losing it. Those whose announcement
    // fails count as seen too, as retrying could add them to the history twice,
    // and so do the ones left when notifications turn off.
    let disabled = false
    for (const reply of added) {
      disabled = !isCommentWatchingEnabled()
      if (disabled) break
      if (announced.has(`${thread.videoId}/${reply.id}`)) continue
      announced.add(`${thread.videoId}/${reply.id}`)
      await announce('comment-reply', thread.videoId, reply.id, getReplyTitle(thread, reply.author || '?'), reply.text)
        .catch(error => console.error('Failed to announce a comment reply', error))
    }
    for (const { id, heart } of hearts.announce) {
      disabled ||= !isCommentWatchingEnabled()
      if (disabled) break
      const title = i18n.global.t('YouTube Account.{author} hearted your comment', { author: heart.author || '?' })
      await announce('comment-heart', current.videoId, id, title, heart.text)
        .catch(error => console.error('Failed to announce a comment heart', error))
    }
    const threads = loadThreads(startedAt)
    const index = threads.findIndex(item => isSameWatchedComment(item, key))
    if (index !== -1) {
      if (result) {
        threads[index] = {
          ...threads[index],
          replyCount: result.replyCount,
          seen,
          // Applied to the entry as it is now, which may watch more comments meanwhile.
          comments: checkCommentHearts(threads[index], result.hearts).comments,
          ...(active || hearts.active ? { activeAt: Date.now() } : {})
        }
      } else {
        threads.splice(index, 1)
      }
      saveThreads(threads)
    }
    if (disabled) return
  }
}

/**
 * Whether Android checks while the app is hidden or closed, which it does when
 * it may refresh subscriptions then.
 */
function checksWhileClosed() {
  return isAndroid && isCommentWatchingEnabled() && store.getters.getEnableClosedAppSubscriptionRefresh
}

let activeCheck = null

/** Checks the watched comments, or waits for the check that already runs here. */
function checkOnce() {
  // Windows of the desktop app share the watched comments, so one checks them.
  activeCheck ??= navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async lock => {
    if (lock) await checkThreads()
  }).finally(() => { activeCheck = null })
  return activeCheck
}

/**
 * Checks the watched comments once in the renderer that the periodic job loads
 * while the Android app is closed.
 */
export async function checkCommentRepliesInBackground() {
  if (!checksWhileClosed()) {
    setPeriodicBackgroundTask('commentReplies', false)
    return
  }
  await migrateAndroidWatchedComments()
  await checkOnce()
}

/**
 * Checks the watched comments for replies, and the account's for hearts, while the app runs. On
 * iOS, the checks pause while the app is hidden; Android's periodic job checks
 * then, also after the app was closed, if it may refresh subscriptions then.
 * @returns {() => void} stops the checks
 */
export function startCommentReplyNotifications() {
  let stopped = false
  let timer = null
  let lastCheck = 0
  // Also cancels the native checks of earlier versions, whether or not comments are watched.
  const migrated = migrateAndroidWatchedComments()

  const check = async () => {
    clearTimeout(timer)
    timer = null
    if (stopped) return
    if (isCommentWatchingEnabled() && !(process.env.IS_CAPACITOR && isAppHidden())) {
      lastCheck = Date.now()
      await migrated
      await checkOnce().catch(error => console.error('Failed to check comments for replies', error))
    }
    if (!stopped) timer = setTimeout(check, CHECK_INTERVAL_MS)
  }
  check()

  // Windows of the desktop app share the watched comments, so their bells follow each other.
  const reloadWatchedComments = (/** @type {StorageEvent} */ event) => {
    if (event.key === STORAGE_KEY) watchedComments.value = loadThreads()
  }
  window.addEventListener('storage', reloadWatchedComments)

  const checkWhenVisible = () => {
    if (!isAppHidden() && timer !== null && Date.now() - lastCheck >= CHECK_INTERVAL_MS) check()
  }

  let removeTapListener = null
  let stopBackgroundChecks = null
  if (isAndroid) {
    document.addEventListener('visibilitychange', checkWhenVisible)
    stopBackgroundChecks = store.watch(checksWhileClosed, enabled => setPeriodicBackgroundTask('commentReplies', enabled), { immediate: true })
    // While the app is hidden, but not yet closed
    onPeriodicBackgroundTask(async () => {
      if (stopped || !checksWhileClosed()) return
      await migrated
      await checkOnce()
    })
  } else if (process.env.IS_CAPACITOR) {
    document.addEventListener('visibilitychange', checkWhenVisible)
    LocalNotifications.addListener('localNotificationActionPerformed', ({ actionId, notification }) => {
      const target = notification?.extra?.commentReplyTarget
      const checked = getCommentNotificationTarget(target?.kind, target?.path?.split('/')[2], target?.query?.commentId)
      if (!checked) return
      capacitorNotificationHistory.markTargetsRead([checked])
      if (actionId !== 'dismiss') openNotificationEntry({ ...checked, read: true })
    }).then(handle => {
      if (stopped) handle.remove()
      else removeTapListener = () => handle.remove()
    })
  }

  return () => {
    stopped = true
    clearTimeout(timer)
    window.removeEventListener('storage', reloadWatchedComments)
    removeTapListener?.()
    stopBackgroundChecks?.()
    document.removeEventListener('visibilitychange', checkWhenVisible)
  }
}
