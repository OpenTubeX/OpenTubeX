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
 * unknown. `published` is in milliseconds, `duration` in seconds.
 *
 * @typedef {{
 *   platform: string,
 *   id: string,
 *   url: string,
 *   title: string,
 *   author: string,
 *   channelId: string,
 *   thumbnail: string,
 *   itemCount?: number
 * }} PlatformPlaylist
 *
 * @typedef {{
 *   platform: string,
 *   id: string,
 *   name: string,
 *   url: string,
 *   thumbnail: string,
 *   viewerCount?: number
 * }} PlatformCategory A game or topic that live streams belong to.
 * `thumbnail` is portrait box art. `viewerCount` counts the viewers of its live streams.
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
 *   parseChannelUrl: (url: string) => string | null,
 *   getChannel: (fetch: PlatformFetch, id: string, signal?: AbortSignal) => Promise<PlatformChannel | null>,
 *   getChannelPage: (fetch: PlatformFetch, channel: PlatformChannel, tab: PlatformChannelTab, continuation: string | null, signal?: AbortSignal) => Promise<PlatformPage>,
 *   getChannelWithPage: (fetch: PlatformFetch, id: string, tab: PlatformChannelTab, signal?: AbortSignal) => Promise<{ channel: PlatformChannel, page: Promise<PlatformPage> } | null>,
 *   getLatestItems: (fetch: PlatformFetch, channel: PlatformChannel, signal?: AbortSignal) => Promise<PlatformItem[]>,
 *   search: (fetch: PlatformFetch, query: string, type: PlatformSearchType, continuation: string | null, signal?: AbortSignal) => Promise<PlatformPage>,
 *   getPlaylist: (fetch: PlatformFetch, id: string, continuation: string | null, signal?: AbortSignal) => Promise<{ playlist: PlatformPlaylist | null, page: PlatformPage }>,
 *   getFeed?: (fetch: PlatformFetch, channels: PlatformChannel[], signal?: AbortSignal) => Promise<{ channels: PlatformChannel[], items: PlatformItem[], clips: PlatformItem[] }>,
 *   getCategory?: (fetch: PlatformFetch, id: string, signal?: AbortSignal) => Promise<{ category: PlatformCategory, items: PlatformItem[] } | null>,
 *   getBrowse?: (fetch: PlatformFetch, signal?: AbortSignal) => Promise<{ categories: PlatformCategory[], items: PlatformItem[] }>
 * }} Platform
 * - `liveStreams` tells whether its channels stream live.
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
 *   a PlatformCategory with its live streams, most viewers first, or returns
 *   null for unknown categories.
 * - `getBrowse`, where a platform has it, loads its most watched categories
 *   and live streams for its own page.
 */

export {}
