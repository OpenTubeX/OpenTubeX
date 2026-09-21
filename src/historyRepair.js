const nonEmpty = value => typeof value === 'string' && value.trim().length > 0
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0

export function needsHistoryRepair(record) {
  return !record.isStation && /^[\w-]{11}$/.test(record.videoId) && (
    !nonEmpty(record.title) || !nonEmpty(record.author) || !nonEmpty(record.authorId) ||
    !positive(record.published) || !positive(record.lengthSeconds) || record.isLive === true || record.liveNow === true || record.isUpcoming === true
  )
}

// Only public video metadata belongs here. Watch state and playlist context must
// never be copied from the snapshot taken before the network request.
export function historyRepairPatch(record, metadata) {
  const patch = { videoId: record.videoId }
  for (const key of ['title', 'author', 'authorId', 'description']) {
    if (!nonEmpty(record[key]) && nonEmpty(metadata[key])) patch[key] = metadata[key]
  }
  if (!positive(record.published) && positive(metadata.published)) patch.published = metadata.published
  if (metadata.isLive === true || metadata.isUpcoming === true) {
    patch.isLive = metadata.isLive === true
    patch.liveNow = metadata.isLive === true
    patch.isUpcoming = metadata.isUpcoming === true
  } else if (metadata.isLive === false && metadata.isUpcoming === false && positive(metadata.lengthSeconds)) {
    patch.lengthSeconds = Number(metadata.lengthSeconds)
    patch.isLive = false
    patch.liveNow = false
    patch.isUpcoming = false
  }
  for (const key of Object.keys(patch)) {
    if (key !== 'videoId' && record[key] === patch[key]) delete patch[key]
  }
  return Object.keys(patch).length > 1 ? patch : null
}

class HistoryRepairRateLimitError extends Error {}
export class HistoryRepairUnavailableError extends Error {}

// Capture HTTP status before API clients turn it into an unstructured error.
export function checkHistoryRepairResponse(response) {
  if (!response.ok) {
    throw Object.assign(new Error(`History metadata request failed with HTTP ${response.status}`), { status_code: response.status })
  }
  return response
}

export function parseHistoryRepairPlayer(response, videoId) {
  const details = response?.videoDetails
  if (details?.videoId !== videoId) {
    const status = response?.playabilityStatus
    if (status?.status === 'LOGIN_REQUIRED' && /bot/i.test(status.reason)) {
      throw new HistoryRepairRateLimitError(status.reason)
    }
    throw new HistoryRepairUnavailableError('Video metadata unavailable')
  }
  const microformat = response.microformat?.playerMicroformatRenderer
  return {
    title: details.title,
    author: details.author,
    authorId: details.channelId,
    description: details.shortDescription,
    lengthSeconds: Number(details.lengthSeconds),
    published: Date.parse(microformat?.publishDate),
    // isLiveContent also marks ended streams and cannot identify a live video.
    isLive: details.isUpcoming !== true && (microformat?.liveBroadcastDetails?.isLiveNow ?? details.isLive) === true,
    isUpcoming: details.isUpcoming === true,
  }
}

const HISTORY_REPAIR_OUTPUT_TEMPLATE = '%(.{id,title,channel,uploader,channel_id,description,duration,timestamp,upload_date,is_live,live_status})j'

export function historyRepairYtDlpArguments() {
  return ['--no-playlist', '--no-warnings', '--no-progress', '--socket-timeout', '15', '--skip-download', '--ignore-no-formats-error', '--print', HISTORY_REPAIR_OUTPUT_TEMPLATE]
}

export function historyRepairYtDlpError(message) {
  // Share sanitized errors across native adapters without exposing cookie paths.
  return { error: /429|too many requests|rate.?limit|confirm.*not a bot/i.test(message ?? '') ? 'rate-limit' : 'History metadata unavailable' }
}

export function parseHistoryRepairYtDlp(info, videoId) {
  if (info?.error) {
    if (info.error === 'rate-limit') {
      throw new HistoryRepairRateLimitError('YouTube rate limited history repair')
    }
    throw new Error('yt-dlp could not load history metadata')
  }
  if (info?.id !== videoId) throw new HistoryRepairUnavailableError('Video metadata unavailable')
  const uploadDate = /^(\d{4})(\d{2})(\d{2})$/.exec(info.upload_date ?? '')
  return {
    title: info.title,
    author: info.channel || info.uploader,
    authorId: info.channel_id,
    description: info.description,
    lengthSeconds: Number(info.duration),
    published: positive(info.timestamp) ? Number(info.timestamp) * 1000 : uploadDate ? Date.parse(`${uploadDate[1]}-${uploadDate[2]}-${uploadDate[3]}`) : NaN,
    isLive: info.live_status !== 'is_upcoming' && (info.is_live === true || info.live_status === 'is_live'),
    isUpcoming: info.live_status === 'is_upcoming',
  }
}

function waitForRepair(milliseconds, signal) {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export async function repairHistory({ records, getRecord, fetchMetadata, saveMetadata, signal, onProgress, onPhase = () => {}, wait = waitForRepair }) {
  let pending = records.filter(needsHistoryRepair).map(({ videoId }) => ({ videoId, checked: false, failed: false, failures: 0 }))
  let cooldowns = 0
  let cooldownPending = false
  const result = { total: pending.length, checked: 0, repaired: 0, failed: 0 }
  onProgress({ ...result })
  // Retry ordinary failures at the end, with at most three attempts. Bot checks
  // interrupt the pass so unvisited entries wait for the server to recover.
  const passes = [{ concurrency: 4, delay: 0 }, { concurrency: 2, delay: 1000 }, { concurrency: 1, delay: 3000 }]
  for (let pass = 0; pass < passes.length && pending.length && !signal.aborted;) {
    const concurrency = cooldowns ? 1 : passes[pass].concurrency
    const delay = cooldownPending ? 30000 * cooldowns : passes[pass].delay
    if (delay) {
      onPhase(cooldownPending ? 'waiting' : 'retrying')
      await wait(delay, signal)
    }
    cooldownPending = false
    if (!signal.aborted) onPhase(pass > 0 || cooldowns ? 'retrying' : 'checking')
    let failed = []
    let rateLimitError
    // Save once per batch, avoiding a full history sort and cross-window
    // broadcast for every individual video.
    for (let offset = 0; offset < pending.length && !signal.aborted; offset += concurrency) {
      // Space batches out even when the server replies quickly. After a bot
      // check, keep requests sequential for the rest of this repair.
      if (offset > 0) await wait(1000, signal)
      if (signal.aborted) break
      const batch = pending.slice(offset, offset + concurrency)
      const patches = await Promise.all(batch.map(async target => {
        try {
          if (target.checked) {
            const current = getRecord(target.videoId)
            if (!current || !needsHistoryRepair(current)) {
              if (target.failed) result.failed--
              target.failed = false
              return null
            }
          }
          const metadata = await fetchMetadata(target.videoId, signal)
          if (signal.aborted) return null
          const current = getRecord(target.videoId)
          const patch = current && needsHistoryRepair(current) ? historyRepairPatch(current, metadata) : null
          if (target.failed) result.failed--
          target.failed = false
          return patch
        } catch (error) {
          if (!signal.aborted) {
            if (!target.failed) result.failed++
            target.failed = true
            if (error instanceof HistoryRepairRateLimitError || error?.status_code === 429) {
              rateLimitError = error
            } else if (error instanceof HistoryRepairUnavailableError || error instanceof SyntaxError ||
              (error?.status_code >= 400 && error.status_code < 500)) {
              target.failures = passes.length
            } else {
              target.failures++
            }
            if (target.failures < passes.length) failed.push(target)
          }
          return null
        } finally {
          if (!signal.aborted && !target.checked) {
            result.checked++
            target.checked = true
          }
        }
      }))
      const updates = patches.filter(Boolean)
      if (updates.length && !signal.aborted) {
        try {
          const saved = await saveMetadata(updates)
          result.repaired += saved.repaired
          result.failed += saved.failed
        } catch {
          result.failed += updates.length
        }
      }
      onProgress({ ...result })
      if (rateLimitError && !signal.aborted) {
        // Do not burn through thousands of untouched entries during a block.
        // Retry the rejected batch and unvisited entries after a cooldown.
        if (cooldowns === 2) throw rateLimitError
        failed = failed.concat(pending.slice(offset + batch.length))
        cooldowns++
        cooldownPending = true
        break
      }
    }
    if (!rateLimitError) pass++
    pending = failed
  }
  return result
}
