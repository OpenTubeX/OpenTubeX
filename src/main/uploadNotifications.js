import { readFile, rm, writeFile, rename } from 'node:fs/promises'
import { createUploadNotificationState, forgetUnconfiguredFeeds, getUploadUrl, takeVisibleUploads } from '../newUploadNotifications.js'

/**
 * Single desktop source of truth for new-upload notifications, shared by
 * foreground refreshes and the background refresh process.
 * @param {{ file: string, show: (notification: { title: string, body: string, url: string }) => void }} options
 */
export function createUploadNotifier({ file, show }) {
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
      return run(async () => {
        const channel = configuration?.enabled === true ? configuration.channels?.[channelId] : null
        if (!channel?.feedTypes?.includes(feedType)) return

        const uploads = takeVisibleUploads(await load(), channelId, feedType, entries, channel.membersOnly === true)
        await save()

        for (const upload of uploads) {
          // Ended streams in the live feed are announced like videos.
          const type = upload.live ? 'live' : feedType === 'live' ? 'videos' : feedType
          try {
            show({
              title: (configuration.titles?.[type] ?? '{channel}').replaceAll('{channel}', channel.name || channelId),
              body: upload.title,
              url: getUploadUrl(feedType, upload.id)
            })
          } catch (error) {
            // One failed notification must not skip the others.
            console.error('Failed to show an upload notification', error)
          }
        }
      })
    }
  }
}
