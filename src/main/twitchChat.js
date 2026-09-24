import { net } from 'electron'
import { isOpenTubeXUrl } from './utils'
import { createTwitchChatReplayRequest, readTwitchReplayResponse, TWITCH_CHAT_CLIENT_ID } from '../twitchChatReplayRequest'

export async function handleTwitchChatReplayPage(event, videoId, position) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !/^\d{1,20}$/.test(videoId)) return null
  const isCursor = typeof position === 'string' && position.length < 2048
  if (!isCursor && !(Number.isInteger(position) && position >= 0 && position <= 864000)) return null

  const response = await net.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CHAT_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(createTwitchChatReplayRequest(videoId, position)),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`Twitch chat replay returned HTTP ${response.status}`)
  return readTwitchReplayResponse(response)
}
