import { LocalNotifications } from '@capacitor/local-notifications'
import { Constants } from 'youtubei.js'

import store from '../store/index'
import i18n from '../i18n/index'
import { getLocalComments } from './api/local'
import { createLinkedCommentsContinuation } from './api/youtube-account-parsers'
import { clearAndroidCommentReplies, configureAndroidCommentReplies, trackAndroidCommentReplies } from './androidSubscriptionRefresh'
import { isAppHidden } from './appVisibility'
import { capacitorNotificationHistory } from './capacitorNotificationHistory'
import { getCommentReplyLocalNotificationId } from './capacitorSystemNotifications'
import { getNotificationThumbnailUrl, openNotificationEntry, showInAppNotification, withThumbnail } from './notificationHistory'
import { getSelectedYouTubeProfile, isSignedInToYouTube } from './youtube-account-state'
import {
  findNewReplies,
  getCommentReplyTarget,
  normalizeTrackedCommentThreads,
  trackPostedComment
} from '../../commentReplyTracking.js'

const STORAGE_KEY = 'commentReplyThreads'
const LOCK_NAME = 'opentubex-comment-reply-check'
const CHECK_INTERVAL_MS = 15 * 60 * 1000
// Reply pages hold 10 replies each.
const MAX_REPLY_PAGES = 10
const CHANNEL_ID = 'comment-replies'
// Android checks natively, also while the app is closed.
const isAndroid = !!process.env.IS_CAPACITOR && !process.env.IS_IOS

/** @returns {import('../../commentReplyTracking.js').TrackedCommentThread[]} */
function loadThreads() {
  try {
    return normalizeTrackedCommentThreads(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'))
  } catch {
    return []
  }
}

/** @param {import('../../commentReplyTracking.js').TrackedCommentThread[]} threads */
function saveThreads(threads) {
  if (threads.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(threads))
  else localStorage.removeItem(STORAGE_KEY)
}

function isEnabled() {
  return isSignedInToYouTube(store.getters) &&
    store.getters.getYouTubeAccountReplyNotifications &&
    store.getters.getNotificationMode !== 'off'
}

/**
 * Watches the thread of a comment the account just posted for replies.
 * @param {string} videoId
 * @param {string} threadId the top-level comment
 * @param {string} commentId the posted comment, the same as `threadId` unless it is a reply
 * @param {import('./api/youtube-account').YouTubeAccount | null} account the channel that posted it
 */
export function trackCommentReplies(videoId, threadId, commentId, account) {
  // Without its channel, the account's own replies would be announced too.
  if (!isEnabled() || !account?.channelId) return
  const handle = getSelectedYouTubeProfile(account)?.handle ?? null
  if (isAndroid) {
    const token = createLinkedCommentsContinuation(videoId, threadId)
    trackAndroidCommentReplies({ videoId, threadId, commentId, channelId: account.channelId, handle, token })
      .catch(error => console.error('Failed to watch a comment for replies', error))
    return
  }
  // The comment is posted, so failing to watch it must not fail the post.
  try {
    saveThreads(trackPostedComment(loadThreads(), { videoId, threadId, commentId, channelId: account.channelId, handle }))
  } catch (error) {
    console.error('Failed to watch a comment for replies', error)
  }
}

/**
 * Hands the checks to Android, which announces replies like uploads.
 * @returns {() => void} stops updating the configuration
 */
function startAndroidCommentReplyNotifications() {
  const stopConfiguring = store.watch(() => {
    // An 11-character placeholder, as the thumbnail settings expect a video ID.
    const thumbnail = getNotificationThumbnailUrl('VIDEOIDXXXX')?.replace('VIDEOIDXXXX', '%VIDEO%') ?? ''
    return JSON.stringify({
      enabled: isEnabled(),
      mode: store.getters.getNotificationMode,
      closedApp: store.getters.getEnableClosedAppSubscriptionRefresh,
      title: i18n.global.t('YouTube Account.{author} replied to your comment', { author: '{author}' }),
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
  // Signing out, also when YouTube ends the sign-in, forgets the watched comments.
  const stopWatchingAccount = store.watch(() => isSignedInToYouTube(store.getters), signedIn => {
    if (!signedIn) clearAndroidCommentReplies().catch(error => console.error('Failed to forget the watched comments', error))
  }, { immediate: true })
  return () => {
    stopConfiguring()
    stopWatchingAccount()
  }
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
 * @param {string} videoId
 * @param {import('../../commentReplyTracking.js').CommentReply} reply
 */
async function announceReply(videoId, reply) {
  const target = getCommentReplyTarget(videoId, reply.id)
  if (!target) return
  const title = i18n.global.t('YouTube Account.{author} replied to your comment', { author: reply.author || '?' })
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
  if (!isEnabled()) return
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
  for (const { videoId, threadId } of loadThreads()) {
    if (!isEnabled()) return
    // Reloaded for each thread, as comments posted meanwhile change the list.
    const thread = loadThreads().find(item => item.videoId === videoId && item.threadId === threadId)
    if (!thread) continue
    let result
    try {
      result = await fetchThread(thread)
    } catch (error) {
      console.warn('Could not check a comment for replies', error)
      continue
    }
    const { added, seen } = result ? findNewReplies(thread, result.replies) : { added: [], seen: thread.seen }
    // Announced before they count as seen, so closing the app in between
    // repeats a reply rather than losing it. Replies left when notifications
    // turn off count as seen too.
    let disabled = false
    for (const reply of added) {
      disabled = !isEnabled()
      if (disabled) break
      await announceReply(videoId, reply).catch(error => console.error('Failed to announce a comment reply', error))
    }
    const threads = loadThreads()
    const index = threads.findIndex(item => item.videoId === videoId && item.threadId === threadId)
    if (index !== -1) {
      if (result) threads[index] = { ...threads[index], replyCount: result.replyCount, seen }
      else threads.splice(index, 1)
      saveThreads(threads)
    }
    if (disabled) return
  }
}

/**
 * Checks the comments the account posted for replies while the app runs. On
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
    if (isEnabled() && !(process.env.IS_CAPACITOR && isAppHidden())) {
      lastCheck = Date.now()
      // Windows of the desktop app share the watched comments, so one checks them.
      await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async lock => {
        if (lock) await checkThreads()
      }).catch(error => console.error('Failed to check comments for replies', error))
    }
    if (!stopped) timer = setTimeout(check, CHECK_INTERVAL_MS)
  }
  check()

  // Signing out, also when YouTube ends the sign-in, forgets the watched comments.
  const stopWatchingAccount = store.watch(() => isSignedInToYouTube(store.getters), signedIn => {
    if (!signedIn) localStorage.removeItem(STORAGE_KEY)
  }, { immediate: true })

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
    stopWatchingAccount()
    removeTapListener?.()
    document.removeEventListener('visibilitychange', checkWhenVisible)
  }
}
