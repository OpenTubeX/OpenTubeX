// @ts-check
import {
  fetchTwitchChannels,
  getTwitchChannelUrl,
  parseChannel,
  parseTwitchChannelLogin,
  parseTwitchClip,
  parseTwitchUser,
  parseTwitchVideo,
  requestTwitch
} from '../twitchFollows.js'

/**
 * @typedef {import('./types.js').Platform} Platform
 * @typedef {import('./types.js').PlatformChannel} PlatformChannel
 * @typedef {import('./types.js').PlatformItem} PlatformItem
 * @typedef {import('./types.js').PlatformPage} PlatformPage
 * @typedef {import('./types.js').PlatformFetch} PlatformFetch
 * @typedef {import('./types.js').PlatformCategory} PlatformCategory
 * @typedef {import('./types.js').PlatformCategoryTab} PlatformCategoryTab
 * @typedef {import('./types.js').PlatformCategorySort} PlatformCategorySort
 * @typedef {import('./types.js').PlatformFilters} PlatformFilters
 * @typedef {import('./types.js').PlatformFilterOptions} PlatformFilterOptions
 */

const PAGE_SIZE = 20
// Twitch requires a browser integrity token for later pages of videos and
// clips, so channel pages load as many as one request allows
const CHANNEL_PAGE_SIZE = 100
const ID_PATTERN = /^\d{1,20}$/
/** Clip and video pages name their channel, but aren't its pages */
const CONTENT_PAGE_PATTERN = /^https?:\/\/[^/?#]+\/[^/?#]+\/(?:clip|v|video)(?:[/?#]|$)/i
const CURSOR_PATTERN = /^[\w|:=+/.-]{1,300}$/
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/
// Later pages of streams and categories need a browser integrity token too,
// so these lists are as long as one request allows
const CATEGORY_ITEMS = 100
const CATEGORY_ATTEMPTS = 2
const BROWSE_CATEGORIES = 100
const BROWSE_STREAMS = 30
const CHANNEL_FIELDS = 'id login displayName profileImageURL(width: 300) bannerImageURL description followers { totalCount }'
const STREAM_FIELDS = 'stream { id title createdAt viewersCount previewImageURL(width: 640, height: 360) game { displayName } archiveVideo { id } }'
const VIDEO_FIELDS = 'id title publishedAt createdAt lengthSeconds viewCount previewThumbnailURL(width: 640, height: 360) game { displayName }'
const CLIP_FIELDS = 'slug title createdAt durationSeconds viewCount thumbnailURL(width: 480, height: 272) game { displayName }'
const CATEGORY_FIELDS = 'slug displayName viewersCount boxArtURL(width: 285, height: 380)'
const CATEGORY_PAGE_FIELDS = `${CATEGORY_FIELDS} description followersCount tags(tagType: CONTENT) { localizedName }`
/** @type {PlatformFilterOptions} */
const STREAM_FILTERS = { sorts: ['viewers', 'viewers_ascending', 'started', 'relevance'], defaultSort: 'viewers', tags: true }
/** @type {Record<PlatformCategoryTab, PlatformFilterOptions>} */
const CATEGORY_TABS = {
  live: STREAM_FILTERS,
  videos: { sorts: ['published', 'views'], defaultSort: 'views', types: ['archive', 'highlight', 'upload'] },
  clips: { sorts: ['top_day', 'top_week', 'top_month', 'top_all'], defaultSort: 'top_week' }
}
/** Twitch's stream and video orders, and the periods of its top clips */
const TWITCH_SORTS = {
  viewers: 'VIEWER_COUNT',
  viewers_ascending: 'VIEWER_COUNT_ASC',
  started: 'RECENT',
  relevance: 'RELEVANCE',
  published: 'TIME',
  views: 'VIEWS',
  top_day: 'LAST_DAY',
  top_week: 'LAST_WEEK',
  top_month: 'LAST_MONTH',
  top_all: 'ALL_TIME'
}
/** The languages Twitch streams, videos and clips can be in, by their language codes */
const FILTER_LANGUAGES = [
  'en', 'id', 'ca', 'da', 'de', 'es', 'fr', 'it', 'hu', 'nl', 'no', 'pl', 'pt', 'ro', 'sk', 'fi', 'sv', 'tl', 'vi',
  'tr', 'cs', 'el', 'bg', 'ru', 'uk', 'ar', 'ms', 'hi', 'th', 'zh', 'ja', 'yue', 'ko', 'ase', 'other'
]
/** Twitch's names for the languages whose codes it doesn't use */
const TWITCH_LANGUAGES = { yue: 'ZH_HK', ase: 'ASL' }
const MAX_TAG_LENGTH = 25
const TAG_SUGGESTIONS = 10
const BROADCASTER_FIELDS = 'id login displayName profileImageURL(width: 70)'
const STREAM_NODE_FIELDS = `id title createdAt viewersCount previewImageURL(width: 640, height: 360) game { displayName } archiveVideo { id } broadcaster { ${BROADCASTER_FIELDS} }`

/**
 * @param {unknown} value
 */
function httpsUrl(value) {
  if (typeof value !== 'string') return undefined
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * @param {any} user
 * @returns {PlatformChannel | null}
 */
function toPlatformChannel(user) {
  const channel = parseChannel(user)
  if (!channel) return null
  const banner = httpsUrl(user.bannerImageURL)
  const description = typeof user.description === 'string' ? user.description.trim() : ''
  const followerCount = user.followers?.totalCount
  return {
    platform: 'twitch',
    id: channel.id,
    name: channel.name,
    url: getTwitchChannelUrl(channel.login),
    ...(channel.avatar ? { avatar: channel.avatar } : {}),
    ...(banner ? { banner } : {}),
    ...(description ? { description } : {}),
    ...(Number.isFinite(followerCount) ? { followerCount } : {})
  }
}

/**
 * @param {PlatformItem} item
 * @returns {import('./types.js').PlatformResult}
 */
function itemResult(item) {
  return { kind: 'item', item }
}

/**
 * Lists of many channels' items show the avatar of each item's channel.
 * The feed and channel pages have their channels' avatars already.
 * @param {PlatformItem[]} items
 * @param {{ avatar?: string }} channel
 * @returns {PlatformItem[]}
 */
function withAuthorAvatar(items, { avatar }) {
  return avatar ? items.map(item => ({ ...item, authorAvatar: avatar })) : items
}

/**
 * @param {any} game
 * @returns {PlatformCategory | null}
 */
function toPlatformCategory(game) {
  if (typeof game?.slug !== 'string' || !CATEGORY_PATTERN.test(game.slug)) return null
  const name = typeof game.displayName === 'string' && game.displayName.trim() ? game.displayName.trim() : game.slug
  const viewerCount = game.viewersCount
  return {
    platform: 'twitch',
    id: game.slug,
    name,
    url: `https://www.twitch.tv/directory/category/${game.slug}`,
    thumbnail: httpsUrl(game.boxArtURL) ?? '',
    ...(Number.isFinite(viewerCount) && viewerCount >= 0 ? { viewerCount } : {})
  }
}

/**
 * @param {any} game
 * @returns {PlatformCategory | null}
 */
function toCategoryPage(game) {
  const category = toPlatformCategory(game)
  if (!category) return null
  const description = typeof game.description === 'string' ? game.description.trim() : ''
  const followerCount = game.followersCount
  const tags = Array.isArray(game.tags)
    ? game.tags.flatMap(tag => typeof tag?.localizedName === 'string' && tag.localizedName.trim() ? [tag.localizedName.trim()] : [])
    : []
  return {
    ...category,
    ...(Number.isFinite(followerCount) && followerCount >= 0 ? { followerCount } : {}),
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {})
  }
}

/**
 * Twitch's names for the languages it knows, as its streams and clips name them.
 * @param {string[]} languages codes from FILTER_LANGUAGES
 */
function twitchLanguages(languages) {
  return languages.filter(language => FILTER_LANGUAGES.includes(language))
    .map(language => TWITCH_LANGUAGES[language] ?? language.toUpperCase())
}

/**
 * @param {PlatformFilterOptions} options
 * @param {PlatformFilters['sort']} sort
 */
function twitchSort(options, sort) {
  return TWITCH_SORTS[sort && options.sorts.includes(sort) ? sort : options.defaultSort]
}

/**
 * Twitch's stream options for the filters, leaving out what it doesn't know.
 * @param {PlatformFilters} filters
 */
function streamOptions({ sort, languages = [], tags = [] }) {
  const broadcasterLanguages = twitchLanguages(languages)
  const freeformTags = tags.map(tag => tag.trim()).filter(tag => tag && tag.length <= MAX_TAG_LENGTH)
  return {
    sort: twitchSort(STREAM_FILTERS, sort),
    ...(broadcasterLanguages.length > 0 ? { broadcasterLanguages } : {}),
    ...(freeformTags.length > 0 ? { freeformTags } : {})
  }
}

/**
 * The list of a category's tab, as the query's field, its variables and how
 * to read its items, leaving out filters Twitch doesn't know.
 * @param {PlatformCategoryTab} tab
 * @param {PlatformFilters} filters
 */
function categoryList(tab, filters) {
  const options = CATEGORY_TABS[tab]
  const sort = twitchSort(options, filters.sort)
  const languages = twitchLanguages(filters.languages ?? [])
  if (tab === 'videos') {
    return {
      field: 'videos',
      declarations: '$sort: VideoSort, $types: [BroadcastType!], $languages: [String!]',
      query: `videos(first: ${CATEGORY_ITEMS}, sort: $sort, types: $types, languages: $languages) { edges { node { ${VIDEO_FIELDS} owner { ${BROADCASTER_FIELDS} } } } }`,
      variables: {
        sort,
        types: filters.type && options.types?.includes(filters.type) ? [filters.type.toUpperCase()] : null,
        // Videos name their languages in lowercase, with a hyphen
        languages: languages.length > 0 ? languages.map(language => language.toLowerCase().replace('_', '-')) : null
      },
      /** @param {any} node */
      items: node => {
        const channel = parseChannel(node.owner)
        return channel ? withAuthorAvatar(parseTwitchVideo(node, channel), channel) : []
      }
    }
  }
  if (tab === 'clips') {
    return {
      field: 'clips',
      declarations: '$criteria: GameClipsInput',
      query: `clips(first: ${CATEGORY_ITEMS}, criteria: $criteria) { edges { node { ${CLIP_FIELDS} broadcaster { ${BROADCASTER_FIELDS} } } } }`,
      variables: {
        criteria: { period: sort, sort: 'VIEWS_DESC', ...(languages.length > 0 ? { languages } : {}) }
      },
      /** @param {any} node */
      items: node => {
        const channel = parseChannel(node.broadcaster)
        return channel ? withAuthorAvatar(parseTwitchClip(node, channel), channel) : []
      }
    }
  }
  return {
    field: 'streams',
    declarations: '$options: GameStreamOptions',
    query: `streams(first: ${CATEGORY_ITEMS}, options: $options) { edges { node { ${STREAM_NODE_FIELDS} } } }`,
    variables: { options: streamOptions(filters) },
    items: streamItem
  }
}

/**
 * The live streams of a connection of streams, each with its channel.
 * @param {any} connection
 * @returns {PlatformItem[]}
 */
function streamItems(connection) {
  const edges = Array.isArray(connection?.edges) ? connection.edges : []
  return edges.flatMap(edge => edge?.node ? streamItem(edge.node) : [])
}

/**
 * A live stream with its channel.
 * @param {any} node
 * @returns {PlatformItem[]}
 */
function streamItem(node) {
  const parsed = parseTwitchUser({ ...node.broadcaster, stream: node })
  return parsed ? withAuthorAvatar(parsed.feed.live, parsed.channel) : []
}

/**
 * Selects a user by ID, or by login for `@login` and logins with letters.
 * @param {string} id
 * @returns {{ id: string } | { login: string } | null}
 */
function userVariables(id) {
  if (!id.startsWith('@') && ID_PATTERN.test(id)) return { id }
  const login = parseTwitchChannelLogin(id)
  return login ? { login } : null
}

/**
 * @param {string} fields what the query loads besides the channel
 */
function userQuery(fields) {
  return `query($id: ID, $login: String) { user(id: $id, login: $login) { ${CHANNEL_FIELDS} ${fields} } }`
}

/**
 * @param {import('./types.js').PlatformChannelTab} tab
 */
function tabFields(tab) {
  return tab === 'clips'
    ? `clips(first: ${CHANNEL_PAGE_SIZE}, criteria: { period: ALL_TIME, sort: VIEWS_DESC }) { edges { node { ${CLIP_FIELDS} } } }`
    : `${STREAM_FIELDS} videos(first: ${CHANNEL_PAGE_SIZE}, sort: TIME) { edges { node { ${VIDEO_FIELDS} } } }`
}

/**
 * @param {any} user
 * @param {import('./types.js').PlatformChannelTab} tab
 * @returns {PlatformPage}
 */
function tabPage(user, tab) {
  const parsed = parseTwitchUser(user)
  // The live stream comes first, without the video recording it
  const items = !parsed ? [] : tab === 'clips' ? parsed.feed.clips : [...parsed.feed.live, ...parsed.feed.videos]
  return { results: items.map(itemResult), continuation: null }
}

/** @type {Platform} */
const twitch = {
  id: 'twitch',
  name: 'Twitch',
  channelTabs: ['videos', 'clips'],
  searchTypes: ['videos', 'channels', 'categories'],
  liveStreams: true,

  parseChannelUrl(url) {
    // Names alone are logins too, but here only addresses identify the platform
    const login = /^https?:\/\//i.test(url) && !CONTENT_PAGE_PATTERN.test(url) ? parseTwitchChannelLogin(url) : null
    // All-digit logins exist, and an @ keeps them apart from user IDs
    return login && ID_PATTERN.test(login) ? `@${login}` : login
  },

  async getChannel(fetch, id, signal) {
    const variables = userVariables(id)
    if (!variables) return null
    const data = await requestTwitch(fetch, userQuery(''), variables, signal)
    return toPlatformChannel(data.user)
  },

  // One query has the channel and the whole tab
  async getChannelWithPage(fetch, id, tab, signal) {
    const variables = userVariables(id)
    if (!variables) return null
    const data = await requestTwitch(fetch, userQuery(tabFields(tab)), variables, signal)
    const channel = toPlatformChannel(data.user)
    return channel && { channel, page: Promise.resolve(tabPage(data.user, tab)) }
  },

  async getChannelPage(fetch, channel, tab, continuation, signal) {
    if (!ID_PATTERN.test(channel.id) || continuation !== null) return { results: [], continuation: null }
    const data = await requestTwitch(fetch, userQuery(tabFields(tab)), { id: channel.id }, signal)
    return tabPage(data.user, tab)
  },

  async getLatestItems(fetch, channel, signal) {
    const { feed } = await fetchTwitchChannels(fetch, [channel.id], { signal })
    return [...feed.live, ...feed.videos]
  },

  async getFeed(fetch, channels, signal) {
    const { channels: current, feed } = await fetchTwitchChannels(fetch, channels.map(channel => channel.id), { signal })
    return {
      channels: current.map(channel => ({
        platform: 'twitch',
        id: channel.id,
        name: channel.name,
        url: getTwitchChannelUrl(channel.login),
        ...(channel.avatar ? { avatar: channel.avatar } : {})
      })),
      items: [...feed.live, ...feed.videos],
      clips: feed.clips
    }
  },

  async search(fetch, query, type, continuation, signal) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200 ||
      (continuation !== null && !CURSOR_PATTERN.test(continuation))) return { results: [], continuation: null }
    const { index, section, fields } = {
      channels: { index: 'CHANNEL', section: 'channels', fields: CHANNEL_FIELDS },
      categories: { index: 'GAME', section: 'games', fields: CATEGORY_FIELDS }
    }[type] ?? { index: 'VOD', section: 'videos', fields: `${VIDEO_FIELDS} owner { id login displayName profileImageURL(width: 70) }` }
    const data = await requestTwitch(fetch,
      `query($query: String!, $cursor: String) { searchFor(userQuery: $query, platform: "web", target: { index: ${index}, cursor: $cursor, limit: ${PAGE_SIZE} }) { ${section} { cursor items { ${fields} } } } }`,
      { query: query.trim(), cursor: continuation }, signal)
    const found = data.searchFor?.[section]
    // Twitch sends an empty list when nothing matches, and none when the field failed
    if (!Array.isArray(found?.items)) throw new Error('Twitch returned no search results')
    const items = found.items
    /** @type {import('./types.js').PlatformResult[]} */
    const results = items.flatMap(entry => {
      if (type === 'channels') {
        const channel = toPlatformChannel(entry)
        return channel ? [{ kind: /** @type {const} */ ('channel'), channel }] : []
      }
      if (type === 'categories') {
        const category = toPlatformCategory(entry)
        return category ? [{ kind: /** @type {const} */ ('category'), category }] : []
      }
      const owner = parseChannel(entry?.owner)
      return owner ? withAuthorAvatar(parseTwitchVideo(entry, owner), owner).map(itemResult) : []
    })
    // The cursor keeps coming at the end, so a short page is the last one
    const cursor = typeof found?.cursor === 'string' && items.length >= PAGE_SIZE ? found.cursor : null
    return { results, continuation: cursor }
  },

  categoryTabs: CATEGORY_TABS,
  liveStreamFilters: STREAM_FILTERS,
  filterLanguages: FILTER_LANGUAGES,

  async getCategory(fetch, id, tab, filters = {}, signal) {
    if (!Object.hasOwn(CATEGORY_TABS, tab)) throw new Error(`Twitch categories have no ${tab} tab`)
    if (!CATEGORY_PATTERN.test(id)) return null
    const list = categoryList(tab, filters)
    // Twitch's lists, its clips in particular, now and then fail with a
    // service error that the next request doesn't have. Failed requests
    // throw instead, for the page's Retry button.
    for (let attempt = 1; ; attempt++) {
      const data = await requestTwitch(fetch,
        `query($slug: String!, ${list.declarations}) { game(slug: $slug) { ${CATEGORY_PAGE_FIELDS} ${list.query} } }`,
        { slug: id, ...list.variables }, signal)
      const category = toCategoryPage(data.game)
      if (!category) return null
      const edges = data.game[list.field]?.edges
      if (Array.isArray(edges)) return { category, items: edges.flatMap(edge => edge?.node ? list.items(edge.node) : []) }
      // A failed list must not look like a category nobody streams
      if (attempt === CATEGORY_ATTEMPTS) throw new Error(`Twitch returned no ${list.field}`)
    }
  },

  async searchStreamTags(fetch, query, signal) {
    const userQuery = query.trim()
    if (!userQuery || userQuery.length > MAX_TAG_LENGTH) return []
    const data = await requestTwitch(fetch,
      `query($query: String!) { searchFreeformTags(userQuery: $query, first: ${TAG_SUGGESTIONS}) { edges { node { tagName } } } }`,
      { query: userQuery }, signal)
    const edges = data.searchFreeformTags?.edges
    if (!Array.isArray(edges)) throw new Error('Twitch returned no tags')
    return edges.flatMap(edge => typeof edge?.node?.tagName === 'string' && edge.node.tagName ? [edge.node.tagName] : [])
  },

  async getTopCategories(fetch, signal) {
    const data = await requestTwitch(fetch,
      `query { games(first: ${BROWSE_CATEGORIES}) { edges { node { ${CATEGORY_FIELDS} } } } }`,
      {}, signal)
    // A list fails on its own and leaves its field null, which must not look
    // like an empty list that a retry can't load again
    if (!Array.isArray(data.games?.edges)) throw new Error('Twitch returned no categories')
    return data.games.edges.flatMap(edge => toPlatformCategory(edge?.node) ?? [])
  },

  async getLiveStreams(fetch, filters = {}, signal) {
    const data = await requestTwitch(fetch,
      `query($options: StreamOptions) { streams(first: ${BROWSE_STREAMS}, options: $options) { edges { node { ${STREAM_NODE_FIELDS} } } } }`,
      { options: streamOptions(filters) }, signal)
    if (!Array.isArray(data.streams?.edges)) throw new Error('Twitch returned no streams')
    return streamItems(data.streams)
  },

  async getPlaylist() {
    return { playlist: null, page: { results: [], continuation: null } }
  }
}

export default twitch
