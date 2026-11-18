import { Player, Utils } from 'youtubei.js'

// Shorts preload the next video while the current one loads, so both would
// otherwise download and parse the same uncached script at the same time.
const pendingExtractions = new Map()

function extractPlayer(fetch, playerId, runJob) {
  let extraction = pendingExtractions.get(playerId)
  if (!extraction) {
    extraction = (async () => {
      const response = await fetch(new URL(`https://www.youtube.com/s/player/${playerId}/player_es6.vflset/en_US/base.js`), {
        headers: { 'user-agent': Utils.getRandomUserAgent('desktop') }
      })
      if (!response.ok) throw new Error(`Failed to get player data: ${response.status}`)
      return runJob('extractPlayer', { playerId, source: await response.text() })
    })()
    pendingExtractions.set(playerId, extraction)
    const forget = () => pendingExtractions.delete(playerId)
    extraction.then(forget, forget)
  }
  return extraction
}

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

  // Each load sets its own PO token, so only the extracted data is shared.
  const data = await extractPlayer(fetch, playerId, runJob)
  return Player.fromSource(playerId, { cache, ...data })
}
