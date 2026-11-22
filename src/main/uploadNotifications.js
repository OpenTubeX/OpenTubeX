import { rm } from 'node:fs/promises'
import { getUploadTarget } from '../notificationHistory.js'
import { getUploadThumbnailUrl, createUploadNotificationState, forgetUnconfiguredFeeds, getUploadUrl, isWithinQuietHours, takeVisibleUploads } from '../newUploadNotifications.js'
import { readJsonState } from './readJsonState.js'
import { createSerialQueue } from './serialQueue.js'
import { writeFileAtomic } from './writeFileAtomic.js'

const ORIGINAL_TITLE_TIMEOUT_MS = 5000

/**
 * Whether saved state lists the known upload IDs per feed and the notified ones.
 * @param {unknown} value
 */
function isUploadNotificationState(value) {
  const { known, notified } = /** @type {{ known?: unknown, notified?: unknown } | null | undefined} */ (value) ?? {}
  return typeof known === 'object' && known !== null && !Array.isArray(known) &&
    Object.values(known).every(Array.isArray) && Array.isArray(notified)
}

/**
 * Feeds can carry YouTube's auto-translated titles; oEmbed returns the original one.
 * @param {typeof fetch} fetchUrl
 * @param {string} videoId
 * @returns {Promise<string | null>}
 */
async function fetchOriginalTitle(fetchUrl, videoId) {
  try {
    const video = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    const response = await fetchUrl(`https://www.youtube.com/oembed?url=${encodeURIComponent(video)}`, {
      // Without cookies, YouTube cannot link the lookups to the user.
      credentials: 'omit',
      signal: AbortSignal.timeout(ORIGINAL_TITLE_TIMEOUT_MS)
    })
    if (!response.ok) return null
    const { title } = await response.json()
    return typeof title === 'string' && title.length > 0 ? title : null
  } catch {
    // Keep the feed title when the video is unavailable or the request fails.
    return null
  }
}

/**
 * Single desktop source of truth for new-upload notifications, shared by
 * foreground refreshes and the background refresh process.
 * @param {{
 *   file: string,
 *   show: (notification: { title: string, body: string, url: string, silent: boolean, target: import('../notificationHistory.js').NotificationHistoryTarget | null, thumbnail: string | undefined }) => void | Promise<void>,
 *   fetch?: typeof fetch,
 *   isWatched?: (videoId: string) => Promise<boolean>
 * }} options
 */
export function createUploadNotifier({ file, show, fetch: fetchUrl = fetch, isWatched = async () => false }) {
  let configuration = null
  let state = null
  const run = createSerialQueue(error => console.error('Upload notification state failed', error))
  // Alerts for uploads already saved as notified, which shutdown waits for.
  const alerts = new Set()

  async function load() {
    if (state) return state
    // Other read errors propagate, so a later save cannot overwrite the state.
    state = (await readJsonState(file, 'upload notification state', isUploadNotificationState)) ??
      createUploadNotificationState()
    return state
  }

  async function save() {
    try {
      await writeFileAtomic(file, JSON.stringify(state), { mode: 0o600 })
    } catch (error) {
      // Reload the last saved state, so a later refresh detects these uploads again.
      state = null
      throw error
    }
  }

  return {
    configure(value) {
      return run(async () => {
        configuration = value
        if (value?.enabled === true) {
          if (forgetUnconfiguredFeeds(await load(), value)) await save()
          return
        }
        // Start from a fresh baseline when notifications are enabled again.
        state = createUploadNotificationState()
        await rm(file, { force: true })
      })
    },
    /**
     * @param {{ channelId: string, feedType: string, entries: ReturnType<typeof import('../newUploadNotifications.js').normalizeUploadEntries> }} value
     */
    observe({ channelId, feedType, entries }) {
      const configuredChannel = () => {
        const channel = configuration?.enabled === true ? configuration.channels?.[channelId] : null
        return channel?.feedTypes?.includes(feedType) ? channel : null
      }
      const alert = run(async () => {
        const channel = configuredChannel()
        if (!channel) return []

        const uploads = takeVisibleUploads(await load(), channelId, feedType, entries, channel.membersOnly === true)
        await save()
        return uploads
      }).then(async found => {
        if (found.length === 0) return
        // Looked up outside the queue, so slow requests do not hold up other feeds.
        const titles = configuration?.originalTitles === true && feedType !== 'posts'
          ? await Promise.all(found.map(async upload => await fetchOriginalTitle(fetchUrl, upload.id) ?? upload.title))
          : found.map(upload => upload.title)
        // Videos in the watch history, also ones watched on another device during
        // the lookup, need no notification.
        const watched = feedType === 'posts'
          ? []
          : await Promise.all(found.map(upload => isWatched(upload.id).catch(error => {
              console.error('Failed to check the watch history for an upload', error)
              return false
            })))
        const uploads = found.filter((_, index) => !watched[index])
        const bodies = titles.filter((_, index) => !watched[index])
        if (uploads.length === 0) return
        // Notifications may have been turned off during the lookup.
        const channel = configuredChannel()
        if (!channel) return

        const silent = isWithinQuietHours(configuration.quietHours)
        // Delivery waits for the history and thumbnails, and settling waits for delivery.
        await Promise.all(uploads.map(async (upload, index) => {
          // Ended streams in the live feed are announced like videos.
          const type = upload.live ? 'live' : feedType === 'live' ? 'videos' : feedType
          try {
            await show({
              title: (configuration.titles?.[type] ?? '{channel}').replaceAll('{channel}', channel.name || channelId),
              body: bodies[index],
              url: getUploadUrl(feedType, upload.id),
              silent,
              target: getUploadTarget(feedType, upload.id, upload.live),
              thumbnail: getUploadThumbnailUrl(configuration, feedType, upload.id)
            })
          } catch (error) {
            // One failed notification must not skip the others.
            console.error('Failed to show an upload notification', error)
          }
        }))
      })
      alerts.add(alert)
      const forget = () => alerts.delete(alert)
      alert.then(forget, forget)
      return alert
    },
    /** Resolves once every pending alert is shown or dropped. */
    async settle() {
      // Alerts can start while earlier ones are pending.
      while (alerts.size > 0) await Promise.allSettled(alerts)
    }
  }
}
