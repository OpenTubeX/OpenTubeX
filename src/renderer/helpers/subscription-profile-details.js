import { normalizeChannelHandle } from './feed-metadata.js'

/**
 * Applies refreshed channel names, thumbnails and handles to one profile
 * without repeatedly scanning its subscription list.
 *
 * @param {object} profile
 * @param {{ channelId: string, channelName?: string, channelThumbnailUrl?: string, channelHandle?: string | null }[]} channels
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

    for (const { channelName, channelThumbnailUrl, channelHandle } of updates) {
      const channel = (updatedProfile ?? profile).subscriptions[index]
      const thumbnail = channelThumbnailUrl
        ?.replace(/=s\d*/, '=s176')
        .replace(/^https?:\/\/[^/]+\/ggpht/, 'https://yt3.googleusercontent.com')
      const nameChanged = channelName != null && channel.name !== channelName
      const thumbnailChanged = Boolean(channelThumbnailUrl) && channel.thumbnail !== thumbnail
      // Responses without a handle keep the saved one.
      const handle = normalizeChannelHandle(channelHandle)
      const handleChanged = handle !== null && channel.handle !== handle

      if (!nameChanged && !thumbnailChanged && !handleChanged) {
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
      if (handleChanged) {
        updatedProfile.subscriptions[index].handle = handle
      }
    }
  }

  return updatedProfile
}
