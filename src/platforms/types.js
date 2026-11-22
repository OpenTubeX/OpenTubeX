// @ts-check

/**
 * The shapes every platform module in this directory returns. Platform modules
 * are pure: they get a fetch function, so the app can route requests through
 * its proxy or the native HTTP client, and tests can answer them.
 *
 * @typedef {(url: string, init: RequestInit) => Promise<Response>} PlatformFetch
 *
 * @typedef {{
 *   platform: string,
 *   id: string,
 *   name: string,
 *   url: string,
 *   avatar?: string,
 *   banner?: string,
 *   description?: string,
 *   followerCount?: number
 * }} PlatformChannel `id` identifies the channel for following and routing and
 * stays the same when the channel is renamed where the platform allows that.
 * `url` is the channel's web page.
 *
 * @typedef {{
 *   platform: string,
 *   id: string,
 *   url: string,
 *   title: string,
 *   author: string,
 *   channelId: string,
 *   authorAvatar?: string,
 *   thumbnail: string,
 *   published: number | null,
 *   duration?: number,
 *   viewCount?: number,
 *   isLive?: true,
 *   isUpcoming?: true,
 *   isAudio?: true,
 *   archiveId?: string,
 *   isNew?: boolean
 * }} PlatformItem A video, track, clip or live stream. `url` is the page that
 * yt-dlp plays. `channelId` is the `id` of its PlatformChannel, or empty when
 * unknown. `authorAvatar` is the channel's avatar, where the response that
 * lists the item includes it. `published` is in milliseconds, `duration` in seconds.
 *
 * @typedef {{
 *   platform: string,
 *   id: string,
 *   url: string,
 *   title: string,
 *   author: string,
 *   channelId: string,
 *   authorAvatar?: string,
 *   thumbnail: string,
 *   itemCount?: number
 * }} PlatformPlaylist `authorAvatar` as for PlatformItem
 *
 * @typedef {{
 *   platform: string,
 *   id: string,
 *   name: string,
 *   url: string,
 *   thumbnail: string,
 *   viewerCount?: number,
 *   followerCount?: number,
 *   description?: string,
 *   tags?: string[]
 * }} PlatformCategory A game or topic that live streams belong to.
 * `thumbnail` is portrait box art. `viewerCount` counts the viewers of its live streams.
 * Lists leave out `followerCount`, `description` and `tags`, which only its own page loads.
 *
 * @typedef {'live' | 'videos' | 'clips'} PlatformCategoryTab
 * @typedef {'viewers' | 'viewers_ascending' | 'started' | 'relevance' | 'published' | 'views' | 'top_day' | 'top_week' | 'top_month' | 'top_all'} PlatformCategorySort
 * @typedef {'archive' | 'highlight' | 'upload'} PlatformVideoType
 * @typedef {{ sort?: PlatformCategorySort, type?: PlatformVideoType, languages?: string[], tags?: string[] }} PlatformFilters
 * `languages` holds codes from `filterLanguages`. Items match any of the
 * languages and every tag. Without a `type`, videos of every type match.
 * @typedef {{ sorts: PlatformCategorySort[], defaultSort: PlatformCategorySort, types?: PlatformVideoType[], tags?: true }} PlatformFilterOptions
 * The orders and video types a list takes, and whether tags filter it.
 *
 * @typedef {'videos' | 'tracks' | 'clips' | 'playlists'} PlatformChannelTab
 * @typedef {'videos' | 'tracks' | 'channels' | 'playlists' | 'categories'} PlatformSearchType
 *
 * @typedef {{ kind: 'item', item: PlatformItem } | { kind: 'channel', channel: PlatformChannel } | { kind: 'playlist', playlist: PlatformPlaylist } | { kind: 'category', category: PlatformCategory }} PlatformResult
 * @typedef {{ results: PlatformResult[], continuation: string | null }} PlatformPage
 * `continuation` loads the next page, null at the end.
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   channelTabs: PlatformChannelTab[],
 *   searchTypes: PlatformSearchType[],
 *   liveStreams: boolean,
 *   heavyChannels?: true,
 *   parseChannelUrl: (url: string) => string | null,
 *   getChannel: (fetch: PlatformFetch, id: string, signal?: AbortSignal) => Promise<PlatformChannel | null>,
 *   getChannelPage: (fetch: PlatformFetch, channel: PlatformChannel, tab: PlatformChannelTab, continuation: string | null, signal?: AbortSignal) => Promise<PlatformPage>,
 *   getChannelWithPage: (fetch: PlatformFetch, id: string, tab: PlatformChannelTab, signal?: AbortSignal) => Promise<{ channel: PlatformChannel, page: Promise<PlatformPage> } | null>,
 *   getLatestItems: (fetch: PlatformFetch, channel: PlatformChannel, signal?: AbortSignal) => Promise<PlatformItem[]>,
 *   search: (fetch: PlatformFetch, query: string, type: PlatformSearchType, continuation: string | null, signal?: AbortSignal) => Promise<PlatformPage>,
 *   getPlaylist: (fetch: PlatformFetch, id: string, continuation: string | null, signal?: AbortSignal) => Promise<{ playlist: PlatformPlaylist | null, page: PlatformPage }>,
 *   getFeed?: (fetch: PlatformFetch, channels: PlatformChannel[], signal?: AbortSignal) => Promise<{ channels: PlatformChannel[], items: PlatformItem[], clips: PlatformItem[] }>,
 *   getCategory?: (fetch: PlatformFetch, id: string, tab: PlatformCategoryTab, filters?: PlatformFilters, signal?: AbortSignal) => Promise<{ category: PlatformCategory, items: PlatformItem[] } | null>,
 *   categoryTabs?: Partial<Record<PlatformCategoryTab, PlatformFilterOptions>>,
 *   getTopCategories?: (fetch: PlatformFetch, signal?: AbortSignal) => Promise<PlatformCategory[]>,
 *   getLiveStreams?: (fetch: PlatformFetch, filters?: PlatformFilters, signal?: AbortSignal) => Promise<PlatformItem[]>,
 *   liveStreamFilters?: PlatformFilterOptions,
 *   filterLanguages?: string[],
 *   searchStreamTags?: (fetch: PlatformFetch, query: string, signal?: AbortSignal) => Promise<string[]>
 * }} Platform
 * - `liveStreams` tells whether its channels stream live.
 * - `heavyChannels` marks platforms whose channels load as whole web pages,
 *   which lists don't load just for the avatars of their items' channels.
 * - `parseChannelUrl` returns the ID of the channel a page belongs to, for
 *   pages of the channel itself, not for its videos, or null.
 * - `getChannel` takes an ID from `parseChannelUrl` or from an earlier
 *   PlatformChannel, and returns null for unknown channels.
 * - `getChannelWithPage` loads a channel and the first page of a tab for the
 *   channel's page, from one response or with the page loading alongside the
 *   channel where its ID allows that. It returns null for unknown channels.
 * - `getLatestItems` returns the newest uploads for the subscription feed,
 *   newest first, a page of them, and the live stream first where the platform has one.
 * - `getFeed`, where a platform has it, loads the feed of many channels in a
 *   few requests, with their current details, instead of `getLatestItems`.
 * - `getCategory`, where a platform has categories, loads one by the `id` of
 *   a PlatformCategory with the items of one of its `categoryTabs`, or
 *   returns null for unknown categories.
 * - `getTopCategories`, where a platform has it, loads its most watched
 *   categories, and `getLiveStreams` live streams of every category, for its
 *   own page.
 * - Lists come in their `defaultSort` unless `filters` name another of their
 *   `sorts`, and only items matching `filters` come. `filterLanguages` lists
 *   the languages they filter by, and `searchStreamTags` suggests tags for
 *   lists with `tags`.
 */

export {}
