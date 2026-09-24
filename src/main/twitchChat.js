import { net } from 'electron'
import { isOpenTubeXUrl } from './utils'
import { createTwitchChatReplayRequest, TWITCH_CHAT_CLIENT_ID } from '../twitchChatReplayRequest'

export async function handleTwitchChatReplayPage(event, videoId, position) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !/^\d{1,20}$/.test(videoId)) return null
  const isCursor = typeof position === 'string' && position.length < 2048
  if (!isCursor && !(Number.isInteger(position) && position >= 0 && position <= 864000)) return null

  const response = await net.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CHAT_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(createTwitchChatReplayRequest(videoId, position))
  })
  if (!response.ok) throw new Error(`Twitch chat replay returned HTTP ${response.status}`)
  if (Number(response.headers.get('content-length')) > 1_000_000) throw new Error('Twitch chat replay response is too large')
  const body = await response.text()
  if (body.length > 1_000_000) throw new Error('Twitch chat replay response is too large')
  return JSON.parse(body)[0]
}
