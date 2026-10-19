export const SORT_BY_VALUES = {
  DateAddedNewest: 'date_added_descending',
  DateAddedOldest: 'date_added_ascending',
  PublishedNewest: 'published_descending',
  PublishedOldest: 'published_ascending',
  AuthorAscending: 'author_ascending',
  AuthorDescending: 'author_descending',
  VideoTitleAscending: 'video_title_ascending',
  VideoTitleDescending: 'video_title_descending',
  VideoDurationAscending: 'video_duration_ascending',
  VideoDurationDescending: 'video_duration_descending',
  Custom: 'custom'
}

export function getSortedPlaylistItems(playlistItems, sortOrder, locale, reversed = false) {
  if (sortOrder === SORT_BY_VALUES.Custom) {
    return reversed ? playlistItems.toReversed() : playlistItems
  }

  let collator

  if (
    sortOrder === SORT_BY_VALUES.VideoTitleAscending ||
    sortOrder === SORT_BY_VALUES.VideoTitleDescending ||
    sortOrder === SORT_BY_VALUES.AuthorAscending ||
    sortOrder === SORT_BY_VALUES.AuthorDescending ||
    sortOrder === SORT_BY_VALUES.VideoDurationAscending ||
    sortOrder === SORT_BY_VALUES.VideoDurationDescending
  ) {
    collator = new Intl.Collator([locale, 'en'])
  }

  return playlistItems.toSorted((a, b) => {
    const first = !reversed ? a : b
    const second = !reversed ? b : a
    return compareTwoPlaylistItems(first, second, sortOrder, collator)
  })
}

export const USER_PLAYLISTS_SORT_BY_OPTIONS = {
  NameAscending: 'name_ascending',
  NameDescending: 'name_descending',

  LatestCreatedFirst: 'latest_created_first',
  EarliestCreatedFirst: 'earliest_created_first',

  LatestUpdatedFirst: 'latest_updated_first',
  EarliestUpdatedFirst: 'earliest_updated_first',

  LatestPlayedFirst: 'latest_played_first',
  EarliestPlayedFirst: 'earliest_played_first',

  Custom: 'custom',
}

/** @param {{ _id?: string, playlistId?: string }} playlist */
export function playlistKey(playlist) {
  return playlist._id ?? playlist.playlistId
}

/**
 * Sorts playlists the way the Playlists page shows them.
 * @param {any[]} playlists
 * @param {string} sortBy a USER_PLAYLISTS_SORT_BY_OPTIONS value
 * @param {string[]} customOrder playlist keys in the custom order
 * @param {Intl.Collator} collator
 */
export function sortUserPlaylists(playlists, sortBy, customOrder, collator) {
  if (!Object.values(USER_PLAYLISTS_SORT_BY_OPTIONS).includes(sortBy)) {
    console.error(`Unknown sortBy: ${sortBy}`)
    return playlists
  }

  if (sortBy === USER_PLAYLISTS_SORT_BY_OPTIONS.Custom) {
    const positions = new Map(customOrder.map((id, index) => [id, index]))
    // Playlists missing from the saved order, such as new ones, come first.
    return playlists.toSorted((a, b) => {
      return (positions.get(playlistKey(a)) ?? -1) - (positions.get(playlistKey(b)) ?? -1) || b.createdAt - a.createdAt
    })
  }

  return playlists.toSorted((a, b) => {
    switch (sortBy) {
      case USER_PLAYLISTS_SORT_BY_OPTIONS.NameAscending:
        return collator.compare(a.playlistName, b.playlistName)
      case USER_PLAYLISTS_SORT_BY_OPTIONS.NameDescending:
        return collator.compare(b.playlistName, a.playlistName)
      case USER_PLAYLISTS_SORT_BY_OPTIONS.LatestCreatedFirst:
        if (a.createdAt > b.createdAt) { return -1 }
        if (a.createdAt < b.createdAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      case USER_PLAYLISTS_SORT_BY_OPTIONS.EarliestCreatedFirst:
        if (a.createdAt < b.createdAt) { return -1 }
        if (a.createdAt > b.createdAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      case USER_PLAYLISTS_SORT_BY_OPTIONS.LatestUpdatedFirst:
        if (a.lastUpdatedAt > b.lastUpdatedAt) { return -1 }
        if (a.lastUpdatedAt < b.lastUpdatedAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      case USER_PLAYLISTS_SORT_BY_OPTIONS.EarliestUpdatedFirst:
        if (a.lastUpdatedAt < b.lastUpdatedAt) { return -1 }
        if (a.lastUpdatedAt > b.lastUpdatedAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      case USER_PLAYLISTS_SORT_BY_OPTIONS.LatestPlayedFirst:
        if (a.lastPlayedAt == null && b.lastPlayedAt == null) {
          return collator.compare(a.playlistName, b.playlistName)
        }

        // Never played playlist = move to last
        if (a.lastPlayedAt == null) { return 1 }
        if (b.lastPlayedAt == null) { return -1 }
        if (a.lastPlayedAt > b.lastPlayedAt) { return -1 }
        if (a.lastPlayedAt < b.lastPlayedAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      case USER_PLAYLISTS_SORT_BY_OPTIONS.EarliestPlayedFirst:
        // Never played playlist = first
        if (a.lastPlayedAt == null && b.lastPlayedAt == null) {
          return collator.compare(a.playlistName, b.playlistName)
        }

        // Never played playlist = move to first
        if (a.lastPlayedAt == null) { return -1 }
        if (b.lastPlayedAt == null) { return 1 }
        if (a.lastPlayedAt < b.lastPlayedAt) { return -1 }
        if (a.lastPlayedAt > b.lastPlayedAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      default:
        // should never happen as we detect this before calling toSorted
        return 0
    }
  })
}

/**
 * Whether the playlist has a video to skip to from the current position,
 * so that the player only offers the skip buttons that actually do something.
 * @param {object} options
 * @param {number} options.itemCount amount of videos in the order the playlist is played back in
 * @param {number} options.currentIndex index of the current video, -1 when it isn't part of the playlist
 * @param {boolean} options.loopEnabled loop makes both directions wrap around
 * @param {number} [options.previousVideoSourceIndex] index the previous video is looked up from,
 * which differs from the current index when the current video was deleted from the playlist
 * @returns {{ canPlayNext: boolean, canPlayPrevious: boolean }}
 */
export function getPlaylistSkipAvailability({ itemCount, currentIndex, loopEnabled, previousVideoSourceIndex = currentIndex }) {
  if (itemCount === 0) {
    return { canPlayNext: false, canPlayPrevious: false }
  }

  // A video that isn't part of the playlist plays the first video next and the last one previously
  if (loopEnabled || currentIndex === -1) {
    return { canPlayNext: true, canPlayPrevious: true }
  }

  return {
    canPlayNext: currentIndex < itemCount - 1,
    canPlayPrevious: previousVideoSourceIndex > 0
  }
}

export function videoDurationPresent(video) {
  if (typeof video.lengthSeconds !== 'number') { return false }

  return !(isNaN(video.lengthSeconds) || video.lengthSeconds === 0)
}

export function videoDurationWithFallback(video) {
  if (videoDurationPresent(video)) { return video.lengthSeconds }

  // Fallback
  return 0
}

/**
 * Fills playlist durations from matching history entries when possible.
 * @param {object[]} playlistItems
 * @param {Record<string, object>} historyCacheById
 * @returns {boolean} whether any playlist item still lacks a duration
 */
export function fillMissingPlaylistVideoDurations(playlistItems, historyCacheById) {
  let anyVideoMissingDuration = false

  for (const video of playlistItems) {
    if (videoDurationPresent(video)) { continue }

    const videoHistory = historyCacheById[video.videoId]
    const fetchedLengthSeconds = videoHistory == null
      ? 0
      : videoDurationWithFallback(videoHistory)

    video.lengthSeconds = fetchedLengthSeconds
    if (fetchedLengthSeconds === 0) {
      anyVideoMissingDuration = true
    }
  }

  return anyVideoMissingDuration
}

function publishedWithFallback(video) {
  const published = video.published
  return typeof published === 'number' && !isNaN(published) && published !== 0 ? published : 0
}

function compareTwoPlaylistItems(a, b, sortOrder, collator) {
  switch (sortOrder) {
    case SORT_BY_VALUES.DateAddedNewest:
      return b.timeAdded - a.timeAdded
    case SORT_BY_VALUES.DateAddedOldest:
      return a.timeAdded - b.timeAdded
    case SORT_BY_VALUES.PublishedNewest:
      return publishedWithFallback(b) - publishedWithFallback(a)
    case SORT_BY_VALUES.PublishedOldest:
      return publishedWithFallback(a) - publishedWithFallback(b)
    case SORT_BY_VALUES.VideoTitleAscending:
      return collator.compare(a.title, b.title)
    case SORT_BY_VALUES.VideoTitleDescending:
      return collator.compare(b.title, a.title)
    case SORT_BY_VALUES.AuthorAscending:
      return collator.compare(a.author, b.author)
    case SORT_BY_VALUES.AuthorDescending:
      return collator.compare(b.author, a.author)
    case SORT_BY_VALUES.VideoDurationAscending: {
      return videoDurationWithFallback(a) - videoDurationWithFallback(b)
    }
    case SORT_BY_VALUES.VideoDurationDescending: {
      return videoDurationWithFallback(b) - videoDurationWithFallback(a)
    }
    default:
      console.error(`Unknown sortOrder: ${sortOrder}`)
      return 0
  }
}

export const generateRandomUniqueId = crypto.randomUUID
  ? crypto.randomUUID.bind(crypto)
  : () => `id-${Date.now()}-${Math.floor(Math.random() * 10000)}`

/**
 * @param {any} videoData
 */
export function processToBeAddedPlaylistVideo(videoData) {
  if (videoData.timeAdded == null) {
    videoData.timeAdded = Date.now()
  }

  if (videoData.playlistItemId == null) {
    videoData.playlistItemId = generateRandomUniqueId()
  }

  // For backward compatibility
  if (videoData.type == null) {
    videoData.type = 'video'
  }
}
