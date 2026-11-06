import { mapConcurrently } from './concurrent-map.js'

/**
 * Treats a source that answers without data as failed, so the other API may
 * answer instead. An empty list is a valid answer.
 * @template T
 * @param {() => Promise<T | null | undefined>} request
 * @returns {() => Promise<T>}
 */
export function requireRecommendationResponse(request) {
  return async () => {
    const response = await request()
    if (response == null) throw new Error('No recommendation response')
    return response
  }
}

/**
 * Fetch a bounded candidate pool. A failed source does not discard the others.
 * Callers invalidate stale work when history, settings, or the page changes.
 * @param {{channels: string[], queries: string[]}} profile
 * @param {object} options
 * @param {(id: string, signal: AbortSignal) => Promise<object[]>} options.fetchChannel
 * @param {(query: string, signal: AbortSignal) => Promise<object[]>} options.search
 * @param {(id: string, signal: AbortSignal) => Promise<object[]>} [options.fetchRelated]
 * @param {(videos: object[]) => void} [options.onCandidates]
 * @param {() => boolean} [options.isCancelled]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 */
export async function collectRecommendationCandidates(profile, {
  fetchChannel,
  search,
  fetchRelated,
  onCandidates,
  isCancelled = () => false,
  signal,
  timeoutMs = 15_000,
}) {
  const tasks = [
    ...(fetchRelated ? (profile.seeds ?? []).slice(0, 4).map(seed => ({ type: 'related', id: seed.videoId, run: signal => fetchRelated(seed.videoId, signal) })) : []),
    ...profile.channels.slice(0, 3).map(id => ({ type: 'channel', id, run: signal => fetchChannel(id, signal) })),
    ...profile.queries.slice(0, 3).map(query => ({ type: 'search', id: query, run: signal => search(query, signal) })),
  ]
  let failedSources = 0
  const results = await mapConcurrently(tasks, 3, async task => {
    if (isCancelled() || signal?.aborted) return []

    const controller = new AbortController()
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const videos = await task.run(requestSignal)
      if (!Array.isArray(videos)) throw new Error('Invalid recommendation response')
      const candidates = videos.filter(video => video?.videoId).slice(0, 30).map(video => ({
        ...video,
        recommendationSources: [{ type: task.type, id: task.id }],
      }))
      if (!isCancelled() && !signal?.aborted) onCandidates?.(candidates)
      return candidates
    } catch {
      failedSources++
      return []
    } finally {
      clearTimeout(timeout)
    }
  })

  return { videos: mergeRecommendationCandidates(results.flat()), failedSources }
}

export function mergeRecommendationCandidates(videos) {
  const byId = new Map()
  for (const video of videos) {
    if (!video?.videoId) continue
    const current = byId.get(video.videoId)
    const sources = [...(current?.recommendationSources ?? []), ...(video.recommendationSources ?? [])]
    byId.set(video.videoId, {
      ...video,
      ...Object.fromEntries(Object.entries(current ?? {}).filter(([, value]) => value != null)),
      recommendationSources: [...new Map(sources.map(source => [`${source.type}:${source.id}`, source])).values()],
    })
  }
  return [...byId.values()]
}
