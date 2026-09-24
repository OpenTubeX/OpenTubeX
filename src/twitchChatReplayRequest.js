export const TWITCH_CHAT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

export function createTwitchChatReplayRequest(videoId, position) {
  return [{
    operationName: 'VideoCommentsByOffsetOrCursor',
    variables: { videoID: videoId, [typeof position === 'string' ? 'cursor' : 'contentOffsetSeconds']: position },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a' } }
  }]
}
