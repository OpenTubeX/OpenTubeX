/**
 * @param {{ isLive: boolean, isPremiere: boolean, hideComments: boolean, localFilePlayback?: boolean, channelId?: string, downloadedPlaybackWithoutMetadata?: boolean, isOffline?: boolean, commentsLoaded?: boolean }} state
 */
export function areCommentsAvailable({ isLive, isPremiere, hideComments, localFilePlayback, channelId, downloadedPlaybackWithoutMetadata, isOffline, commentsLoaded }) {
  return (!isOffline || commentsLoaded === true) && !downloadedPlaybackWithoutMetadata && (!isLive || isPremiere) && !hideComments && !(localFilePlayback && !channelId)
}
