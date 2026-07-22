/**
 * @param {unknown} channels
 * @returns {{ id: string, name?: string }[]}
 */
export function getValidSubscriptionChannels(channels) {
  if (!Array.isArray(channels)) {
    return []
  }

  return channels.filter(channel => (
    typeof channel?.id === 'string' && channel.id.length > 0
  ))
}
