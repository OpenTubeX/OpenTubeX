import { net } from 'electron'
import { isTrustedSender } from './ipc'
import { createTwitchChatReplayRequest, readTwitchReplayResponse, TWITCH_CHAT_CLIENT_ID } from '../twitchChatReplayRequest'
import { fetchTwitchLiveVod, fetchTwitchSubOnlyVod } from '../twitchSubOnlyVod'

export async function handleTwitchSubOnlyVod(event, videoId) {
  if (!isTrustedSender(event) || typeof videoId !== 'string' || !/^\d{1,20}$/.test(videoId)) return null
  return fetchTwitchSubOnlyVod(videoId, (url, options) => net.fetch(url, options))
}

export async function handleTwitchLiveVod(event, login) {
  if (!isTrustedSender(event) || typeof login !== 'string') return null
  return fetchTwitchLiveVod(login, (url, options) => net.fetch(url, options))
}

export async function handleTwitchChatReplayPage(event, videoId, position) {
  if (!isTrustedSender(event) || typeof videoId !== 'string' || !/^\d{1,20}$/.test(videoId)) return null
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
