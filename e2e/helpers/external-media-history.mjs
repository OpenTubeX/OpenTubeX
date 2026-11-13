/** The history record of media from another site, which history keys by its normalized URL. */
export function externalHistoryEntry(page, url) {
  return page.evaluate(videoId => {
    const entry = window.$store.getters.getHistoryCacheById[videoId]
    return entry ? JSON.parse(JSON.stringify(entry)) : null
  }, new URL(url).href)
}

/** Where the external media page resumes the media, or null when it starts over. */
export async function externalResumePosition(page, url) {
  const entry = await externalHistoryEntry(page, url)
  const seconds = entry?.watchProgress
  return seconds > 0 && !(entry.lengthSeconds > 0 && seconds >= entry.lengthSeconds - 2) ? seconds : null
}

/** Saves a history record for media from another site, as if it was watched before. */
export function saveExternalHistoryEntry(page, url, fields = {}) {
  return page.evaluate(record => window.$store.dispatch('updateHistory', record), {
    videoId: new URL(url).href,
    title: 'Saved media',
    author: '',
    authorId: '',
    published: 0,
    description: '',
    lengthSeconds: 0,
    watchProgress: 0,
    isWatched: false,
    timeWatched: Date.now(),
    isLive: false,
    isUpcoming: false,
    type: 'video',
    ...fields,
  })
}
