// Community lists of AI slop channels: https://github.com/Override92/AiSList
// They are licensed CC BY-NC 4.0, so they are downloaded at runtime instead of being bundled.
export const AI_SLOP_LIST_URLS = {
  blocked: 'https://raw.githubusercontent.com/Override92/AiSList/main/AiSList/aislist_blocklist.txt',
  warned: 'https://raw.githubusercontent.com/Override92/AiSList/main/AiSList/aislist_warnlist.txt',
}

export const AI_SLOP_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000

const CACHE_KEY = 'aiSlopList'
const CHANNEL_ID_REGEX = /^UC[\w-]{22}$/

/**
 * Handles are case-insensitive and some list entries are percent-encoded, channel IDs are used as is.
 * @param {string} handle including the leading `@`
 */
export function normalizeChannelHandle(handle) {
  let decoded = handle
  try {
    decoded = decodeURIComponent(handle)
  } catch { }

  return decoded.normalize('NFC').toLowerCase()
}

/**
 * @param {string} text
 * @returns {string[]} normalized handles and channel IDs
 */
export function parseAiSlopList(text) {
  const entries = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()

    if (line.startsWith('@')) {
      entries.push(normalizeChannelHandle(line))
    } else if (CHANNEL_ID_REGEX.test(line)) {
      entries.push(line)
    }
  }

  return entries
}

/**
 * @param {Set<string>} entries
 * @param {{ authorId?: string | null, authorHandle?: string | null }} video
 */
export function isOnAiSlopList(entries, { authorId, authorHandle }) {
  if (entries.size === 0) {
    return false
  }

  return (authorId != null && entries.has(authorId)) ||
    (authorHandle != null && entries.has(normalizeChannelHandle(authorHandle)))
}

/**
 * @returns {{ fetchedAt: number, blocked: string[], warned: string[] } | null}
 */
export function loadCachedAiSlopList() {
  try {
    const cached = localStorage.getItem(CACHE_KEY)

    if (cached === null) {
      return null
    }

    const { fetchedAt, blocked, warned } = JSON.parse(cached)

    if (typeof fetchedAt !== 'number' || typeof blocked !== 'string' || typeof warned !== 'string') {
      return null
    }

    return {
      fetchedAt,
      blocked: blocked === '' ? [] : blocked.split('\n'),
      warned: warned === '' ? [] : warned.split('\n'),
    }
  } catch {
    return null
  }
}

/**
 * @param {{ fetchedAt: number, blocked: string[], warned: string[] }} lists
 */
export function saveCachedAiSlopList({ fetchedAt, blocked, warned }) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      fetchedAt,
      blocked: blocked.join('\n'),
      warned: warned.join('\n'),
    }))
  } catch (error) {
    console.error('Failed to cache the AiSList channel lists', error)
  }
}

export function removeCachedAiSlopList() {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch (error) {
    console.error('Failed to remove the cached AiSList channel lists', error)
  }
}
