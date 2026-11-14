import { LocalNotifications } from '@capacitor/local-notifications'
import { ref } from 'vue'
import { Constants } from 'youtubei.js'

import store from '../store/index'
import i18n from '../i18n/index'
import { getLocalComments } from './api/local'
import { createLinkedCommentsContinuation } from './api/youtube-account-parsers'
import {
  configureAndroidCommentReplies,
  listAndroidCommentReplies,
  trackAndroidCommentReplies,
  untrackAndroidCommentReplies
} from './androidSubscriptionRefresh'
import { isAppHidden } from './appVisibility'
import { capacitorNotificationHistory } from './capacitorNotificationHistory'
import { getCommentReplyLocalNotificationId } from './capacitorSystemNotifications'
import { getNotificationThumbnailUrl, openNotificationEntry, showInAppNotification, withThumbnail } from './notificationHistory'
import { requestCapacitorNotificationPermission } from './platformFeed'
import { getSelectedYouTubeProfile, isSignedInToYouTube } from './youtube-account-state'
import {
  COMMENT_TEXT_LIMIT,
  findNewReplies,
  getCommentReplyTarget,
  isOwnWatchedComment,
  isSameWatchedComment,
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
// Android checks natively, also while the app is closed.
const isAndroid = !!process.env.IS_CAPACITOR && !process.env.IS_IOS

/** @typedef {import('../../commentReplyTracking.js').TrackedCommentThread} TrackedCommentThread */

/**
 * The watched comments as last loaded, for the watch buttons on comments.
 * @type {import('vue').Ref<TrackedCommentThread[]>}
 */
export const watchedComments = ref([])

/** @returns {TrackedCommentThread[]} */
function loadThreads() {
  try {
    return normalizeTrackedCommentThreads(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'))
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
    videoTitle
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
  // The replies so far count as seen, so only new ones are announced.
  const result = await fetchThread({ ...watched, postedAt: 0, replyCount: -1, seen: [] })
  if (!result) return false
  await saveComment({ ...watched, replyCount: result.replyCount, seen: result.replies.map(reply => reply.id) })
  return true
}

/** @param {Parameters<typeof trackComment>[1]} comment */
async function saveComment(comment) {
  // Watching is on unless turned off, so the first watched comment asks for the permission.
  if (process.env.IS_CAPACITOR) requestCapacitorNotificationPermission()
  if (isAndroid) {
    const token = createLinkedCommentsContinuation(comment.videoId, comment.threadId)
    await trackAndroidCommentReplies({ ...comment, token })
    await getWatchedComments()
  } else {
    saveThreads(trackComment(loadThreads(), comment))
  }
}

/**
 * Stops watching a comment, with its author's other comments in the thread.
 * @param {Pick<TrackedCommentThread, 'videoId' | 'threadId' | 'channelId'>} comment
 */
export async function unwatchComment({ videoId, threadId, channelId }) {
  if (isAndroid) {
    await untrackAndroidCommentReplies({ videoId, threadId, channelId })
    await getWatchedComments()
  } else {
    saveThreads(untrackComment(loadThreads(), { videoId, threadId, channelId }))
  }
}

/**
 * The watched comment that covers a loaded comment, if any.
 * @param {string} videoId
 * @param {{ id: string, authorId: string }} comment
 */
export function findWatchedComment(videoId, { id, authorId }) {
  const key = { videoId, threadId: id.split('.')[0], channelId: authorId }
  return watchedComments.value.find(thread => isSameWatchedComment(thread, key)) ?? null
}

/** @returns {Promise<TrackedCommentThread[]>} the watched comments, newest first */
export async function getWatchedComments() {
  const threads = isAndroid ? normalizeTrackedCommentThreads(await listAndroidCommentReplies()) : loadThreads()
  watchedComments.value = threads
  return threads
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
 * Hands the checks to Android, which announces replies like uploads.
 * @returns {() => void} stops updating the configuration
 */
function startAndroidCommentReplyNotifications() {
  return store.watch(() => {
    // An 11-character placeholder, as the thumbnail settings expect a video ID.
    const thumbnail = getNotificationThumbnailUrl('VIDEOIDXXXX')?.replace('VIDEOIDXXXX', '%VIDEO%') ?? ''
    return JSON.stringify({
      enabled: isCommentWatchingEnabled(),
      accountId: getSignedInChannelId(),
      mode: store.getters.getNotificationMode,
      closedApp: store.getters.getEnableClosedAppSubscriptionRefresh,
      title: i18n.global.t('YouTube Account.{author} replied to your comment', { author: '{author}' }),
      otherTitle: i18n.global.t('YouTube Account.{author} replied to {commentAuthor}', { author: '{author}', commentAuthor: '{commentAuthor}' }),
      thumbnail,
      request: {
        url: 'https://www.youtube.com/youtubei/v1/next?prettyPrint=false',
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: Constants.CLIENTS.WEB.VERSION, hl: 'en', gl: store.getters.getRegion || 'US' } },
          continuation: '%CONTINUATION%'
        })
      }
    })
  }, value => {
    configureAndroidCommentReplies(JSON.parse(value))
      .catch(error => console.error('Failed to configure the comment reply checks', error))
  }, { immediate: true })
}

/**
 * The thread's reply count and replies, oldest first. Loads at most
 * MAX_REPLY_PAGES pages, and none when the count did not change. For a linked
 * thread, YouTube lists answers to replies after them instead of nesting them.
 * @param {import('../../commentReplyTracking.js').TrackedCommentThread} thread
 * @returns {Promise<{ replyCount: number, replies: import('../../commentReplyTracking.js').CommentReply[] } | null>}
 *   null when the thread is gone
 */
async function fetchThread(thread) {
  // The thread of the linked comment comes first.
  const comments = await getLocalComments(thread.videoId, undefined, thread.threadId)
  const commentThread = comments.contents.find(item => item.comment?.comment_id === thread.threadId)
  if (!commentThread) return null
  const replyCount = Number.parseInt(String(commentThread.comment.reply_count ?? '0').replaceAll(/\D/g, '') || '0')
  if (replyCount === thread.replyCount || !commentThread.has_replies) return { replyCount, replies: [] }

  const replies = []
  /** @param {any[] | undefined} items */
  const collect = items => {
    for (const { comment } of items ?? []) {
      if (!comment?.comment_id) continue
      replies.push({
        id: comment.comment_id,
        authorId: comment.author?.id ?? '',
        author: comment.author?.name ?? '',
        // Mentions come with extra spaces, zero-width spaces, and bidirectional isolates around them.
        text: (comment.content?.toString() ?? '').replaceAll(/[\u200B-\u200D\u2066-\u2069]/g, '').replaceAll(/\s+/g, ' ').trim()
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
  return { replyCount, replies }
}

/**
 * @param {TrackedCommentThread} thread
 * @param {import('../../commentReplyTracking.js').CommentReply} reply
 */
async function announceReply(thread, reply) {
  const videoId = thread.videoId
  const target = getCommentReplyTarget(videoId, reply.id)
  if (!target) return
  const title = getReplyTitle(thread, reply.author || '?')
  const body = reply.text
  const thumbnail = withThumbnail(videoId).thumbnail

  if (process.env.IS_ELECTRON) {
    await window.ftElectron.notificationHistory.notifyCommentReply({ videoId, replyId: reply.id, title, body, thumbnail })
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
      id: getCommentReplyLocalNotificationId(reply.id),
      title,
      body,
      channelId: CHANNEL_ID,
      // Shown right away, so it needs no exact alarm, which the system would ask the user to allow
      isExactNotification: false,
      extra: { commentReplyTarget: target }
    }]
  })
}

async function checkThreads() {
  // Comments of several authors in a thread can be watched, and a reply can answer more than one.
  const announced = new Set()
  const signedInId = getSignedInChannelId()
  for (const key of loadThreads()) {
    if (!isCommentWatchingEnabled()) return
    // Reloaded for each thread, as comments watched meanwhile change the list.
    const thread = loadThreads().find(item => isSameWatchedComment(item, key))
    if (!thread) continue
    let result
    try {
      result = await fetchThread(thread)
    } catch (error) {
      console.warn('Could not check a comment for replies', error)
      continue
    }
    // Stopped watching while it loaded
    const current = loadThreads().find(item => isSameWatchedComment(item, key))
    if (!current) continue
    const { added, seen } = result ? findNewReplies(current, result.replies, signedInId) : { added: [], seen: current.seen }
    // Announced before they count as seen, so closing the app in between
    // repeats a reply rather than losing it. Replies whose announcement fails
    // count as seen too, as retrying could add them to the history twice, and
    // so do the ones left when notifications turn off.
    let disabled = false
    for (const reply of added) {
      disabled = !isCommentWatchingEnabled()
      if (disabled) break
      if (announced.has(`${thread.videoId}/${reply.id}`)) continue
      announced.add(`${thread.videoId}/${reply.id}`)
      await announceReply(thread, reply).catch(error => console.error('Failed to announce a comment reply', error))
    }
    const threads = loadThreads()
    const index = threads.findIndex(item => isSameWatchedComment(item, key))
    if (index !== -1) {
      if (result) threads[index] = { ...threads[index], replyCount: result.replyCount, seen }
      else threads.splice(index, 1)
      saveThreads(threads)
    }
    if (disabled) return
  }
}

/**
 * Checks the watched comments for replies while the app runs. On
 * iOS, the checks pause while the app is hidden; Android checks natively.
 * @returns {() => void} stops the checks
 */
export function startCommentReplyNotifications() {
  if (isAndroid) return startAndroidCommentReplyNotifications()
  let stopped = false
  let timer = null
  let lastCheck = 0

  const check = async () => {
    clearTimeout(timer)
    timer = null
    if (stopped) return
    if (isCommentWatchingEnabled() && !(process.env.IS_CAPACITOR && isAppHidden())) {
      lastCheck = Date.now()
      // Windows of the desktop app share the watched comments, so one checks them.
      await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async lock => {
        if (lock) await checkThreads()
      }).catch(error => console.error('Failed to check comments for replies', error))
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
  if (process.env.IS_CAPACITOR) {
    document.addEventListener('visibilitychange', checkWhenVisible)
    LocalNotifications.addListener('localNotificationActionPerformed', ({ actionId, notification }) => {
      const target = notification?.extra?.commentReplyTarget
      const checked = getCommentReplyTarget(target?.path?.split('/')[2], target?.query?.commentId)
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
    document.removeEventListener('visibilitychange', checkWhenVisible)
  }
}
