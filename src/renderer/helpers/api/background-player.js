import { Player, Utils } from 'youtubei.js'

/** Fetch and cache in the renderer; parse the large script in a worker. */
export async function createBackgroundPlayer(cache, fetch, playerId, runJob) {
  if (!playerId) {
    const response = await fetch(new URL('https://www.youtube.com/iframe_api'))
    if (!response.ok) throw new Error(`Failed to get player id: ${response.status}`)
    playerId = Utils.getStringBetweenStrings(await response.text(), 'player\\/', '\\/')
    if (!playerId) throw new Error('Failed to get player id')
  }
  const cached = await Player.fromCache(cache, playerId)
  if (cached) return cached

  const response = await fetch(new URL(`https://www.youtube.com/s/player/${playerId}/player_es6.vflset/en_US/base.js`), {
    headers: { 'user-agent': Utils.getRandomUserAgent('desktop') }
  })
  if (!response.ok) throw new Error(`Failed to get player data: ${response.status}`)
  const data = await runJob('extractPlayer', { playerId, source: await response.text() })
  return Player.fromSource(playerId, { cache, ...data })
}
