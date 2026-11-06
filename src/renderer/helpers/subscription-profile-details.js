/**
 * Applies refreshed channel names and thumbnails to one profile without
 * repeatedly scanning its subscription list.
 *
 * @param {object} profile
 * @param {{ channelId: string, channelName?: string, channelThumbnailUrl?: string }[]} channels
 * @returns {object | null} a copied profile when details changed
 */
export function getProfileWithUpdatedSubscriptionDetails(profile, channels) {
  const updatesByChannelId = new Map()

  for (const update of channels) {
    const updates = updatesByChannelId.get(update.channelId)
    if (updates === undefined) {
      updatesByChannelId.set(update.channelId, [update])
    } else {
      updates.push(update)
    }
  }

  let updatedProfile = null

  for (let index = 0; index < profile.subscriptions.length; index++) {
    const updates = updatesByChannelId.get(profile.subscriptions[index].id)
    if (updates === undefined) {
      continue
    }

    for (const { channelName, channelThumbnailUrl } of updates) {
      const channel = (updatedProfile ?? profile).subscriptions[index]
      const thumbnail = channelThumbnailUrl
        ?.replace(/=s\d*/, '=s176')
        .replace(/^https?:\/\/[^/]+\/ggpht/, 'https://yt3.googleusercontent.com')
      const nameChanged = channelName != null && channel.name !== channelName
      const thumbnailChanged = Boolean(channelThumbnailUrl) && channel.thumbnail !== thumbnail

      if (!nameChanged && !thumbnailChanged) {
        continue
      }

      if (updatedProfile === null) {
        updatedProfile = JSON.parse(JSON.stringify(profile))
      }

      if (nameChanged) {
        updatedProfile.subscriptions[index].name = channelName
      }
      if (thumbnailChanged) {
        updatedProfile.subscriptions[index].thumbnail = thumbnail
      }
    }
  }

  return updatedProfile
}
