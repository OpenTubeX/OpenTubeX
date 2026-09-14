const FEED_TYPES = ['videos', 'shorts', 'live', 'posts']

/** Native/background scheduling is independent of renderer timers and visibility. */
export function createSubscriptionBackgroundScheduler({ fetchChannel, saveResult, now = Date.now }) {
  let configuration = null
  let background = false
  let active = null
  const idleWaiters = []
  const deadlines = new Map()
  const intervals = new Map()

  function feeds() {
    return (configuration?.profiles ?? []).flatMap(profile => FEED_TYPES.flatMap(feedType => {
      const interval = Number(configuration.intervals?.[feedType])
      const channelIds = profile.channels?.[feedType]
      if (!Number.isFinite(interval) || interval <= 0 || !Array.isArray(channelIds) || !channelIds.length) return []
      return [{ profileId: profile.id, feedType, interval, channelIds, key: `${profile.id}:${feedType}` }]
    }))
  }

  return {
    configure(value) {
      active?.abort()
      configuration = value
      const wanted = new Set()
      for (const feed of feeds()) {
        wanted.add(feed.key)
        if (intervals.get(feed.key) !== feed.interval) deadlines.set(feed.key, now() + feed.interval)
        intervals.set(feed.key, feed.interval)
      }
      for (const key of deadlines.keys()) {
        if (!wanted.has(key)) {
          deadlines.delete(key)
          intervals.delete(key)
        }
      }
    },
    async setBackground(value) {
      background = value
      if (!value && active) {
        active.abort()
        await new Promise(resolve => idleWaiters.push(resolve))
      }
    },
    completed(profileId, feedType, timestamp) {
      const key = `${profileId}:${feedType}`
      if (intervals.has(key) && Number.isFinite(timestamp)) {
        deadlines.set(key, Math.max(deadlines.get(key) ?? 0, timestamp + intervals.get(key)))
      }
    },
    async tick() {
      if (!background || active || !configuration) return
      const controller = new AbortController()
      active = controller
      const snapshot = configuration
      try {
        for (const feedType of FEED_TYPES) {
          const due = feeds().filter(feed => feed.feedType === feedType && deadlines.get(feed.key) <= now())
          const channelIds = [...new Set(due.flatMap(feed => feed.channelIds))]
          const failed = new Set()
          // Bound concurrent HTTP and memory, and share each response across profiles.
          for (let index = 0; index < channelIds.length && !controller.signal.aborted; index += 4) {
            await Promise.all(channelIds.slice(index, index + 4).map(async channelId => {
              const targets = due.filter(feed => feed.channelIds.includes(channelId))
              try {
                const payload = await fetchChannel(snapshot, feedType, channelId, controller.signal)
                if (controller.signal.aborted) return
                for (const feed of targets) {
                  await saveResult({ kind: 'channel', profileId: feed.profileId, feedType, channelId, timestamp: now(), payload })
                }
              } catch (error) {
                for (const feed of targets) failed.add(feed.key)
                if (!controller.signal.aborted) console.error('Background subscription refresh failed', error)
              }
            }))
          }
          if (controller.signal.aborted) break
          for (const feed of due) {
            const timestamp = now()
            deadlines.set(feed.key, timestamp + (failed.has(feed.key) ? Math.min(feed.interval, 300000) : feed.interval))
            if (!failed.has(feed.key)) {
              await saveResult({ kind: 'completion', profileId: feed.profileId, feedType, timestamp })
            }
          }
        }
      } finally {
        active = null
        for (const resolve of idleWaiters.splice(0)) resolve()
      }
    }
  }
}
