import { readFile, rm, writeFile, rename } from 'node:fs/promises'
import { createUploadNotificationState, forgetUnconfiguredFeeds, getUploadUrl, isWithinQuietHours, takeVisibleUploads } from '../newUploadNotifications.js'

const ORIGINAL_TITLE_TIMEOUT_MS = 5000

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
 *   show: (notification: { title: string, body: string, url: string, silent: boolean }) => void,
 *   fetch?: typeof fetch
 * }} options
 */
export function createUploadNotifier({ file, show, fetch: fetchUrl = fetch }) {
  let configuration = null
  let state = null
  let pending = Promise.resolve()

  function run(operation) {
    const result = pending.then(operation)
    pending = result.catch(error => console.error('Upload notification state failed', error))
    return result
  }

  async function load() {
    if (state) return state
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      // Other read errors propagate, so a later save cannot overwrite the state.
      if (error.code !== 'ENOENT') throw error
      state = createUploadNotificationState()
      return state
    }
    try {
      const saved = JSON.parse(text)
      state = saved?.known && Array.isArray(saved.notified) ? saved : createUploadNotificationState()
    } catch {
      state = createUploadNotificationState()
    }
    return state
  }

  async function save() {
    try {
      await writeFile(file + '.tmp', JSON.stringify(state), { mode: 0o600 })
      await rename(file + '.tmp', file)
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
      return run(async () => {
        const channel = configuredChannel()
        if (!channel) return []

        const uploads = takeVisibleUploads(await load(), channelId, feedType, entries, channel.membersOnly === true)
        await save()
        return uploads
      }).then(async uploads => {
        if (uploads.length === 0) return
        // Looked up outside the queue, so slow requests do not hold up other feeds.
        const bodies = configuration?.originalTitles === true && feedType !== 'posts'
          ? await Promise.all(uploads.map(async upload => await fetchOriginalTitle(fetchUrl, upload.id) ?? upload.title))
          : uploads.map(upload => upload.title)
        // Notifications may have been turned off during the lookup.
        const channel = configuredChannel()
        if (!channel) return

        const silent = isWithinQuietHours(configuration.quietHours)
        uploads.forEach((upload, index) => {
          // Ended streams in the live feed are announced like videos.
          const type = upload.live ? 'live' : feedType === 'live' ? 'videos' : feedType
          try {
            show({
              title: (configuration.titles?.[type] ?? '{channel}').replaceAll('{channel}', channel.name || channelId),
              body: bodies[index],
              url: getUploadUrl(feedType, upload.id),
              silent
            })
          } catch (error) {
            // One failed notification must not skip the others.
            console.error('Failed to show an upload notification', error)
          }
        })
      })
    }
  }
}
