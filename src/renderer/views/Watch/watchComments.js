/**
 * @param {{ isLive: boolean, isPremiere: boolean, hideComments: boolean, localFilePlayback?: boolean, channelId?: string, isOffline?: boolean }} state
 */
export function areCommentsAvailable({ isLive, isPremiere, hideComments, localFilePlayback, channelId, isOffline }) {
  return !isOffline && (!isLive || isPremiere) && !hideComments && !(localFilePlayback && !channelId)
}
