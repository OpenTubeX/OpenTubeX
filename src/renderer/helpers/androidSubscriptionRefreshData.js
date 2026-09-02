const FEED_TYPES = ['videos', 'shorts', 'live', 'posts']

/**
 * Prevents an asynchronous refresh-start handler from restoring progress
 * after the matching refresh already finished.
 */
export function createSubscriptionRefreshStartGuard() {
  let generation = 0

  return {
    begin() {
      const startGeneration = ++generation
      return () => generation === startGeneration
    },
    finish() {
      generation++
    }
  }
}

/**
 * Builds the renderer-to-native snapshot used by closed-app Android workers.
 * The native side receives channel IDs only, never browser datastore files.
 * @param {{
 *   profiles: object[],
 *   intervals: Record<string, string | number>,
 *   hiddenFeedTypes: string[],
 *   instanceUrl: string,
 *   authorization: string | null,
 *   titles: Record<string, string>,
 *   cancelLabel: string
 * }} input
 */
export function createAndroidSubscriptionRefreshConfiguration(input) {
  const hiddenFeedTypes = new Set(input.hiddenFeedTypes)
  const intervals = Object.fromEntries(FEED_TYPES.map(feedType => {
    const interval = Number(input.intervals[feedType])
    return [
      feedType,
      hiddenFeedTypes.has(feedType) || !Number.isFinite(interval) || interval <= 0
        ? 0
        : Math.floor(interval)
    ]
  }))

  const profiles = Array.isArray(input.profiles)
    ? input.profiles.flatMap(profile => {
        if (typeof profile?._id !== 'string' || !Array.isArray(profile.subscriptions)) return []

        const channels = Object.fromEntries(FEED_TYPES.map(feedType => {
          const channelIds = profile.subscriptions
            .filter(channel => (
              typeof channel?.id === 'string' &&
            channel.id.length > 0 &&
            (!Array.isArray(channel.feedTypes) || channel.feedTypes.includes(feedType))
            ))
            .map(channel => channel.id)
          return [feedType, [...new Set(channelIds)]]
        }))
        return [{ id: profile._id, channels }]
      })
    : []

  return {
    instanceUrl: input.instanceUrl,
    authorization: input.authorization,
    intervals,
    profiles,
    titles: input.titles,
    cancelLabel: input.cancelLabel
  }
}
