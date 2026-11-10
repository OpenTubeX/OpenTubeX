export const TWITCH_CHAT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const MAX_TWITCH_REPLAY_BYTES = 1_000_000

export async function readTwitchReplayResponse(response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (declaredLength > MAX_TWITCH_REPLAY_BYTES) throw new Error('Twitch chat replay response is too large')
  if (response.body === null) throw new Error('Twitch chat replay response has no body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_TWITCH_REPLAY_BYTES) {
        await reader.cancel()
        throw new Error('Twitch chat replay response is too large')
      }
      body += decoder.decode(value, { stream: true })
    }
    return JSON.parse(body + decoder.decode())[0]
  } finally {
    reader.releaseLock()
  }
}

export function createTwitchChatReplayRequest(videoId, position) {
  return [{
    operationName: 'VideoCommentsByOffsetOrCursor',
    variables: { videoID: videoId, [typeof position === 'string' ? 'cursor' : 'contentOffsetSeconds']: position },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a' } }
  }]
}
