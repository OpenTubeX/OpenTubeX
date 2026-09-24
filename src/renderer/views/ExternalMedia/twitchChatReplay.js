import { capacitorHttpFetch } from '../../helpers/api/capacitor-http'
import { createTwitchChatReplayRequest, TWITCH_CHAT_CLIENT_ID } from '../../../twitchChatReplayRequest'

export async function getTwitchReplayPage(videoId, position) {
  if (!process.env.IS_CAPACITOR) return window.ftElectron.twitchChatReplayPage(videoId, position)

  const response = await capacitorHttpFetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'Client-ID': TWITCH_CHAT_CLIENT_ID,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(createTwitchChatReplayRequest(videoId, position))
  })
  if (!response.ok) throw new Error(`Twitch chat replay returned HTTP ${response.status}`)
  return (await response.json())[0]
}
