/**
 * @param {{ isLive: boolean, isPremiere: boolean, hideComments: boolean, localFilePlayback?: boolean, channelId?: string, downloadedPlaybackWithoutMetadata?: boolean }} state
 */
export function areCommentsAvailable({ isLive, isPremiere, hideComments, localFilePlayback, channelId, downloadedPlaybackWithoutMetadata }) {
  return !downloadedPlaybackWithoutMetadata && (!isLive || isPremiere) && !hideComments && !(localFilePlayback && !channelId)
}
