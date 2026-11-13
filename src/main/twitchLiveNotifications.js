// @ts-check
import { readFile, rm } from 'node:fs/promises'

import { writeFileAtomic } from './writeFileAtomic.js'
import { fetchTwitchChannels, getTwitchLiveNotificationTarget, takeNewTwitchStreams } from '../twitchFollows.js'

const CHECK_INTERVAL_MS = 3 * 60_000
/** Windows configure the checks one after another when they open */
const CONFIGURE_DELAY_MS = 1000
const ID_PATTERN = /^\d{1,20}$/
const LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/
const MAX_CHANNELS = 2000

/**
 * @typedef {{ enabled: boolean, channels: { id: string, login: string, name: string }[], title: string }} TwitchLiveConfiguration
 * @typedef {import('../twitchFollows.js').TwitchFeedItem} TwitchFeedItem
 */

/**
 * @param {any} value
 * @returns {TwitchLiveConfiguration}
 */
export function normalizeTwitchLiveConfiguration(value) {
  const channels = Array.isArray(value?.channels)
    ? value.channels.slice(0, MAX_CHANNELS).flatMap(channel => (
        typeof channel?.id === 'string' && ID_PATTERN.test(channel.id) &&
        typeof channel.login === 'string' && LOGIN_PATTERN.test(channel.login)
          ? [{ id: channel.id, login: channel.login, name: typeof channel.name === 'string' && channel.name ? channel.name.slice(0, 100) : channel.login }]
          : []
      ))
    : []
  const title = typeof value?.title === 'string' && value.title.includes('{channel}') ? value.title.slice(0, 200) : '{channel}'
  return { enabled: value?.enabled === true && channels.length > 0, channels, title }
}

/**
 * Checks whether followed Twitch channels went live while the app runs, also
 * while it has no windows, and announces each broadcast once.
 * @param {{
 *   file: string,
 *   fetch: (url: string, options: RequestInit) => Promise<Response>,
 *   show: (notification: { title: string, body: string, url: string, thumbnail?: string, target: import('../notificationHistory.js').NotificationHistoryTarget }) => Promise<unknown> | unknown,
 *   onLive?: (live: TwitchFeedItem[]) => void,
 *   intervalMs?: number,
 *   configureDelayMs?: number,
 *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }
 * }} options
 */
export function createTwitchLiveNotifier({
  file, fetch, show, onLive, intervalMs = CHECK_INTERVAL_MS, configureDelayMs = CONFIGURE_DELAY_MS,
  timers = { setTimeout, clearTimeout }
}) {
  /** @type {TwitchLiveConfiguration} */
  let configuration = normalizeTwitchLiveConfiguration(null)
  let configurationKey = ''
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null
  /** @type {Promise<void> | null} */
  let checking = null
  let stopped = false
  /** @type {Record<string, string[]> | null} */
  let known = null

  async function loadKnown() {
    if (known) return known
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'))
      known = saved?.known && typeof saved.known === 'object' && !Array.isArray(saved.known) ? saved.known : {}
    } catch {
      known = {}
    }
    return /** @type {Record<string, string[]>} */ (known)
  }

  async function saveKnown() {
    try {
      await writeFileAtomic(file, JSON.stringify({ known }), { mode: 0o600 })
    } catch (error) {
      // Reload the last saved state, so the next check finds these streams again
      known = null
      throw error
    }
  }

  /**
   * @param {number} delay
   */
  function schedule(delay) {
    if (timer) timers.clearTimeout(timer)
    timer = null
    if (stopped || !configuration.enabled) return
    timer = timers.setTimeout(() => {
      timer = null
      // A check that runs schedules the next one when it ends
      if (!checking) checking = check().finally(() => { checking = null })
    }, delay)
  }

  async function check() {
    const checked = configuration
    try {
      const channelIds = checked.channels.map(channel => channel.id)
      const { feed } = await fetchTwitchChannels(fetch, channelIds, { liveOnly: true })
      // Channels or notifications may have changed meanwhile, and the next
      // check, which comes soon, covers the new channels
      if (stopped || checked !== configuration) return
      onLive?.(feed.live)
      const state = await loadKnown()
      // Notifications turned off meanwhile stay off, without recreating the state
      if (!configuration.enabled) return
      const fresh = takeNewTwitchStreams(state, channelIds, feed.live)
      await saveKnown()
      for (const stream of fresh) {
        // Nothing is announced once notifications are off, nor for channels unfollowed meanwhile
        const current = configuration
        if (!current.enabled) return
        const channel = current.channels.find(({ id }) => id === stream.channelId)
        const target = channel && getTwitchLiveNotificationTarget(channel.login, stream.id)
        if (!target) continue
        try {
          await show({
            title: current.title.replaceAll('{channel}', channel.name),
            body: stream.title,
            url: target.query.url,
            ...(stream.thumbnail ? { thumbnail: stream.thumbnail } : {}),
            target
          })
        } catch (error) {
          // One failed notification must not skip the others
          console.error('Failed to announce a Twitch stream', error)
        }
      }
    } catch (error) {
      console.error('Failed to check the live Twitch channels', error)
    } finally {
      schedule(checked === configuration ? intervalMs : configureDelayMs)
    }
  }

  return {
    /**
     * @param {unknown} value
     */
    async configure(value) {
      const next = normalizeTwitchLiveConfiguration(value)
      const key = JSON.stringify(next)
      if (key === configurationKey) return
      configurationKey = key
      configuration = next
      if (!next.enabled) {
        // Turning notifications on again starts from the streams that are live then
        known = {}
        await rm(file, { force: true })
      }
      if (!checking) schedule(configureDelayMs)
    },
    stop() {
      stopped = true
      if (timer) timers.clearTimeout(timer)
      timer = null
    }
  }
}
