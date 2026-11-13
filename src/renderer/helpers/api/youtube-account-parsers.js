import { calculatePublishedDate } from '../feed-metadata.js'
import { createLocalFeedParsers } from './local-feed-parsers.js'

// Signed-in requests use the YouTube TV client, the only one that accepts
// tokens from the TV sign-in. Its responses use TV renderers, which
// youtubei.js does not parse.

const { parseLocalSubscriberCount } = createLocalFeedParsers(() => false)

/**
 * @typedef {'LIKE' | 'DISLIKE' | 'INDIFFERENT'} YouTubeRating
 * @typedef {'like' | 'unlike' | 'dislike' | 'undislike' | 'delete'} YouTubeCommentAction
 */

/**
 * @param {unknown} text a TV text object with `simpleText` or `runs`
 * @returns {string}
 */
function readText(text) {
  if (!text || typeof text !== 'object') return ''
  if (typeof text.simpleText === 'string') return text.simpleText
  if (Array.isArray(text.runs)) return text.runs.map(run => run?.text ?? '').join('')
  return ''
}

/**
 * @param {{ url?: string, width?: number }[] | undefined} thumbnails
 * @returns {string | null}
 */
function bestThumbnail(thumbnails) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null
  const url = thumbnails.reduce((best, thumbnail) => (thumbnail.width ?? 0) > (best.width ?? 0) ? thumbnail : best).url
  if (typeof url !== 'string' || url === '') return null
  return url.startsWith('//') ? `https:${url}` : url
}

// Protobuf, only as much as the comment parameters need: varints, strings and
// nested messages, written in the order given.

/**
 * @param {number[]} out
 * @param {number} value
 */
function writeVarint(out, value) {
  let remaining = value
  while (remaining > 0x7f) {
    out.push((remaining & 0x7f) | 0x80)
    remaining = Math.floor(remaining / 128)
  }
  out.push(remaining)
}

/**
 * @typedef {[number, number | string | ProtoField[]]} ProtoField
 * @param {ProtoField[]} fields
 * @returns {number[]}
 */
function encodeProto(fields) {
  const out = []
  for (const [field, value] of fields) {
    if (typeof value === 'number') {
      writeVarint(out, field << 3)
      writeVarint(out, value)
      continue
    }

    const bytes = typeof value === 'string' ? [...new TextEncoder().encode(value)] : encodeProto(value)
    writeVarint(out, (field << 3) | 2)
    writeVarint(out, bytes.length)
    out.push(...bytes)
  }
  return out
}

/**
 * Standard base64, URL-encoded, as YouTube's clients send these parameters.
 * @param {ProtoField[]} fields
 */
function encodeParams(fields) {
  return encodeURIComponent(btoa(String.fromCharCode(...encodeProto(fields))))
}

/** @param {string} videoId */
export function createCommentParams(videoId) {
  return encodeParams([[2, videoId], [5, []], [10, 7]])
}

/**
 * Parent fields in `createCommentParams` would post a top-level comment.
 * @param {string} videoId
 * @param {string} parentCommentId the top-level comment's ID
 */
export function createReplyParams(videoId, parentCommentId) {
  return encodeParams([[2, videoId], [4, parentCommentId], [5, [[1, 0]]], [10, 7]])
}

/**
 * Comments and replies take the same parameters, in the layout of YouTube's
 * website, the only client that offers editing.
 * @param {string} videoId
 * @param {string} commentId a reply's ID is `parentId.replyId`
 */
export function updateCommentParams(videoId, commentId) {
  return encodeParams([[1, commentId], [4, videoId], [5, [[1, 0]]], [8, 12], [18, []]])
}

const COMMENT_ACTION_TYPES = { like: 5, unlike: 5, dislike: 4, undislike: 4, delete: 6 }

/**
 * The TV client reads these from each comment. They only identify the
 * comment, so they are built here for comments from any client.
 * @param {YouTubeCommentAction} action
 * @param {string} commentId a reply's ID is `parentId.replyId`
 * @param {string} videoId
 */
export function commentActionParams(action, commentId, videoId) {
  /** @type {ProtoField[]} */
  const fields = [[1, COMMENT_ACTION_TYPES[action]], [2, 2], [3, commentId], [5, videoId]]
  if (action === 'unlike' || action === 'undislike') fields.push([7, 1])
  return encodeParams(fields)
}

/**
 * @typedef {object} YouTubeProfile
 * @property {string} name
 * @property {string | null} handle
 * @property {string | null} thumbnail
 * @property {string | null} pageId identifies a brand account's channel; null for the Google account's own
 */

/**
 * The channels the signed-in Google account can use: its own and those of
 * its brand accounts.
 * @param {any} data `account/accounts_list` response
 * @returns {{ profiles: YouTubeProfile[], selectedPageId: string | null }}
 */
export function parseAccountProfiles(data) {
  const items = (data?.contents ?? [])
    .flatMap(content => content?.accountSectionListRenderer?.contents ?? [])
    .flatMap(section => section?.accountItemSectionRenderer?.contents ?? [])
    .map(item => item?.accountItem)
    .filter(item => item && !item.isDisabled)

  const profiles = items.map(item => {
    const handle = readText(item.channelHandle)
    const pageId = (item.serviceEndpoint?.selectActiveIdentityEndpoint?.supportedTokens ?? [])
      .map(token => token?.pageIdToken?.pageId)
      .find(id => typeof id === 'string' && id !== '') ?? null
    return {
      name: readText(item.accountName),
      handle: handle.startsWith('@') ? handle : null,
      thumbnail: bestThumbnail(item.accountPhoto?.thumbnails),
      pageId
    }
  })
  const selectedPageId = profiles[items.findIndex(item => item.isSelected)]?.pageId ?? null

  return {
    // The Google account's own channel first, then its brand accounts'.
    profiles: profiles.toSorted((a, b) => Number(a.pageId !== null) - Number(b.pageId !== null)),
    selectedPageId
  }
}

/**
 * The TV Subscriptions page lists the channels as tabs, newest first and again
 * from A to Z.
 * @param {any} data TV `browse` response for `FEsubscriptions`
 * @returns {{ id: string, name: string, thumbnail: string | null }[]}
 */
export function parseSubscribedChannels(data) {
  // Sync removes the channels missing here, so a page it cannot read must not count as empty.
  if (!data?.contents?.tvBrowseRenderer) throw new Error('YouTube returned no subscriptions page')
  const nav = data.contents.tvBrowseRenderer.content?.tvSecondaryNavRenderer
  const sections = nav?.sections ?? []
  // The channels on a later page would count as unsubscribed.
  if (nav?.continuations || sections.some(section => section?.tvSecondaryNavSectionRenderer?.continuations ||
    section?.tvSecondaryNavSectionRenderer?.tabs?.some(entry => entry?.continuationItemRenderer))) {
    throw new Error('YouTube listed only some of the subscriptions')
  }
  const channels = new Map()

  for (const section of sections) {
    for (const entry of section?.tvSecondaryNavSectionRenderer?.tabs ?? []) {
      const tab = entry?.tabRenderer ?? entry?.expandableTabRenderer
      const params = tab?.endpoint?.browseEndpoint?.params
      if (typeof params !== 'string') continue

      let decoded
      try {
        decoded = atob(decodeURIComponent(params).replaceAll('-', '+').replaceAll('_', '/'))
      } catch {
        continue
      }
      const id = decoded.match(/UC[\w-]{22}/)?.[0]
      if (!id || channels.has(id)) continue

      channels.set(id, {
        id,
        name: typeof tab.title === 'string' ? tab.title : readText(tab.title),
        thumbnail: bestThumbnail(tab.thumbnail?.thumbnails)
      })
    }
  }

  return [...channels.values()]
}

/** @param {string} text */
function durationToSeconds(text) {
  if (!/^\d+(?::\d+){0,2}$/.test(text)) return ''
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

/**
 * @param {any} tile a TV `tileRenderer`
 * @returns {object | null} a video in the shape of the local API's feed parsers
 */
export function parseTile(tile) {
  const isShort = tile?.contentType === 'TILE_CONTENT_TYPE_SHORTS'
  if (tile?.contentType !== 'TILE_CONTENT_TYPE_VIDEO' && !isShort) return null

  const command = tile.onSelectCommand
  const videoId = tile.contentId ?? command?.watchEndpoint?.videoId ?? command?.reelWatchEndpoint?.videoId
  if (typeof videoId !== 'string' || videoId === '') return null

  const metadata = tile.metadata?.tileMetadataRenderer
  const lines = (metadata?.lines ?? []).map(line => (line?.lineRenderer?.items ?? []).map(item => item?.lineItemRenderer))
  const lineTexts = lines.map(items => items.map(item => readText(item?.text)).filter(text => text !== '' && text !== '•'))
  const badges = lines.flat().map(item => item?.badge?.metadataBadgeRenderer).filter(Boolean)

  // The first line names the channel, unless it is the views and date line.
  const isDetail = text => /\b(?:views?|watching|ago)\b/i.test(text)
  const hasAuthorLine = lineTexts.length > 1 && !lineTexts[0].some(isDetail)
  const author = hasAuthorLine ? (lineTexts[0][0] ?? '') : ''
  const details = (hasAuthorLine ? lineTexts.slice(1) : lineTexts).flat()
  const viewsText = details.find(text => /\b(?:views?|watching)\b/i.test(text))
  const publishedText = details.find(text => /\bago\b/i.test(text))

  const timeStatus = (tile.header?.tileHeaderRenderer?.thumbnailOverlays ?? [])
    .map(overlay => overlay?.thumbnailOverlayTimeStatusRenderer)
    .find(Boolean)
  const liveNow = timeStatus?.style === 'LIVE'
  const isUpcoming = timeStatus?.style === 'UPCOMING'

  let viewCount = null
  if (viewsText) {
    const views = parseLocalSubscriberCount(viewsText)
    if (!isNaN(views)) viewCount = views
  }

  return {
    type: 'video',
    dataSource: 'local',
    videoId,
    title: readText(metadata?.title).trim(),
    author,
    viewCount,
    published: calculatePublishedDate(publishedText, liveNow, isUpcoming),
    lengthSeconds: liveNow || isUpcoming || !timeStatus ? '' : durationToSeconds(readText(timeStatus.text)),
    liveNow,
    isUpcoming,
    isShort,
    is4k: badges.some(badge => badge.label === '4K'),
    hasCaptions: badges.some(badge => badge.label === 'CC'),
    isMembersOnly: badges.some(badge => badge.style === 'BADGE_STYLE_TYPE_MEMBERS_ONLY')
  }
}

/**
 * Home rows are shelves of tiles. The first page and its continuations use
 * the same rows.
 * @param {any} data TV `browse` response for `default` or one of its continuations
 * @returns {{ videos: object[], continuation: string | null }}
 */
export function parseHomeFeed(data) {
  const sectionList = data?.continuationContents?.sectionListContinuation ??
    data?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer
  const videos = (sectionList?.contents ?? [])
    .flatMap(section => section?.shelfRenderer?.content?.horizontalListRenderer?.items ?? [])
    .map(item => parseTile(item?.tileRenderer))
    .filter(Boolean)
  const continuation = sectionList?.continuations
    ?.map(entry => entry?.nextContinuationData?.continuation)
    .find(token => typeof token === 'string') ?? null

  return { videos, continuation }
}

/**
 * @typedef {object} YouTubePlaylistSummary
 * @property {string} playlistId
 * @property {string} title
 * @property {number | null} videoCount
 * @property {string} signature changes with the video count and the first video,
 *   the only signs of a change the list shows
 *
 * @typedef {object} YouTubePlaylistVideo
 * @property {string} videoId
 * @property {string | null} setVideoId identifies the entry in the playlist; edits need it
 * @property {string} title
 * @property {string} author
 * @property {string} authorId
 * @property {number | ''} lengthSeconds
 * @property {number | null} published
 * @property {number | null} viewCount
 */

/**
 * The account's playlists, including Watch later (`WL`), Liked videos (`LL`),
 * and playlists saved from other channels.
 * @param {any} data TV `browse` response for `FEplaylist_aggregation` or one of its continuations
 * @returns {{ playlists: YouTubePlaylistSummary[], continuation: string | null }}
 */
export function parsePlaylistLibrary(data) {
  const grid = data?.continuationContents?.tvSurfaceContentContinuation?.content?.gridRenderer ??
    data?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer
  // Sync removes the playlists missing here, so a page it cannot read must not count as empty.
  if (!grid) throw new Error('YouTube returned no playlist list')

  const playlists = (grid.items ?? [])
    .map(item => item?.tileRenderer)
    .filter(tile => tile?.contentType === 'TILE_CONTENT_TYPE_PLAYLIST' && typeof tile.contentId === 'string')
    .map(tile => {
      const header = tile.header?.tileHeaderRenderer
      const count = (header?.thumbnailOverlays ?? [])
        .map(overlay => readText(overlay?.thumbnailOverlayTimeStatusRenderer?.text))
        .find(text => text !== '') ?? ''
      // The thumbnail URL carries signing parameters that change between requests.
      const thumbnail = bestThumbnail(header?.thumbnail?.thumbnails)?.split('?')[0] ?? ''
      // "No videos" has no number.
      const digits = count.replaceAll(/\D/g, '')
      return {
        playlistId: tile.contentId,
        title: readText(tile.metadata?.tileMetadataRenderer?.title).trim(),
        videoCount: digits !== '' ? Number(digits) : count !== '' ? 0 : null,
        signature: `${count}\n${thumbnail}`
      }
    })
  const continuation = grid.continuations
    ?.map(entry => entry?.nextContinuationData?.continuation)
    .find(token => typeof token === 'string') ?? null

  return { playlists, continuation }
}

/**
 * The playlists the account can add videos to: its own and Watch later. The
 * playlist list also has playlists saved from other channels, which look the same.
 * @param {any} data `playlist/get_add_to_playlist` response
 * @returns {Set<string>}
 */
export function parseOwnedPlaylistIds(data) {
  const renderer = (data?.contents ?? []).map(content => content?.addToPlaylistRenderer).find(Boolean)
  const ids = new Set((renderer?.playlists ?? [])
    .map(entry => entry?.playlistAddToOptionRenderer?.playlistId)
    .filter(id => typeof id === 'string'))
  // Watch later is always there. Without it, sync would remove every playlist.
  if (ids.size === 0) throw new Error('YouTube returned no playlists to add to')
  return ids
}

/**
 * @param {any} tile a TV `tileRenderer` of a playlist page
 * @returns {YouTubePlaylistVideo | null}
 */
function parsePlaylistTile(tile) {
  const video = parseTile(tile)
  if (!video) return null

  const authorId = (tile.metadata?.tileMetadataRenderer?.lines ?? [])
    .flatMap(line => line?.lineRenderer?.items ?? [])
    .flatMap(item => item?.lineItemRenderer?.text?.runs ?? [])
    .map(run => run?.navigationEndpoint?.browseEndpoint?.browseId)
    .find(id => typeof id === 'string' && id.startsWith('UC')) ?? ''
  // Only the menu's remove action names the entry.
  const setVideoId = (tile.onLongPressCommand?.showMenuCommand?.menu?.menuRenderer?.items ?? [])
    .flatMap(item => Object.values(item ?? {}))
    .flatMap(item => item?.serviceEndpoint?.playlistEditEndpoint?.actions ?? [])
    .find(action => action?.action === 'ACTION_REMOVE_VIDEO' && typeof action.setVideoId === 'string')
    ?.setVideoId ?? null

  return {
    videoId: video.videoId,
    setVideoId,
    title: video.title,
    author: video.author,
    authorId,
    lengthSeconds: video.lengthSeconds,
    published: video.published ?? null,
    viewCount: video.viewCount
  }
}

/**
 * The TV app shows a description in a popup behind the playlist's Information
 * button, and has an empty `description` without one.
 * @param {any} metadata the playlist page's `entityMetadataRenderer`
 * @returns {string | null} null when the page shows neither
 */
function parsePlaylistDescription(metadata) {
  const messages = (metadata?.buttons ?? [])
    .flatMap(button => button?.buttonRenderer?.command?.openPopupAction?.popup?.overlaySectionRenderer?.overlay
      ?.overlayTwoPanelRenderer?.actionPanel?.overlayPanelRenderer?.content?.scrollPaneRenderer?.content
      ?.scrollPaneItemListRenderer?.items ?? [])
    .map(item => item?.overlayMessageRenderer?.subtitle)
    .filter(Boolean)
  if (messages.length > 0) return messages.map(readText).join('\n').trim()
  if (metadata && Object.hasOwn(metadata, 'description')) return readText(metadata.description).trim()
  return null
}

/**
 * A page of a playlist's videos. The first page also has the title and
 * description, and an empty playlist has no video list at all.
 * @param {any} data TV `browse` response for `VL` and the playlist ID, or one of its continuations
 * @returns {{ title: string | null, description: string | null, videos: YouTubePlaylistVideo[], continuation: string | null }}
 */
export function parsePlaylistPage(data) {
  const continuationList = data?.continuationContents?.playlistVideoListContinuation
  const columns = data?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer
  // Removing what is missing here would empty the playlist.
  if (!continuationList && !columns) throw new Error('YouTube returned no playlist page')

  const list = continuationList ?? columns.rightColumn?.playlistVideoListRenderer
  const metadata = columns?.leftColumn?.entityMetadataRenderer
  const titleText = readText(metadata?.title).trim()
  const videos = (list?.contents ?? [])
    .map(item => parsePlaylistTile(item?.tileRenderer))
    .filter(Boolean)
  const continuation = list?.continuations
    ?.map(entry => entry?.nextContinuationData?.continuation)
    .find(token => typeof token === 'string') ?? null

  return {
    title: titleText === '' ? null : titleText,
    description: parsePlaylistDescription(metadata),
    videos,
    continuation
  }
}

/**
 * @param {any} data TV `next` response for the video
 * @returns {YouTubeRating | null}
 */
export function parseVideoRating(data) {
  const ratings = ['LIKE', 'DISLIKE', 'INDIFFERENT']
  const buttonStatus = (data?.transportControls?.transportControlsRenderer?.buttons ?? [])
    .map(button => button?.button?.likeButtonRenderer?.likeStatus)
    .find(status => ratings.includes(status))
  if (buttonStatus) return buttonStatus

  return (data?.frameworkUpdates?.entityBatchUpdate?.mutations ?? [])
    .map(mutation => mutation?.payload?.likeStatusEntity?.likeStatus)
    .find(status => ratings.includes(status)) ?? null
}

/**
 * @param {any} value
 * @returns {any}
 */
function findCommentRenderer(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.commentRenderer?.commentId === 'string') return value.commentRenderer
  for (const child of Object.values(value)) {
    const found = findCommentRenderer(child)
    if (found) return found
  }
  return null
}

/**
 * YouTube nests the new comment differently for comments and replies.
 * @param {any} data `comment/create_comment` or `comment/create_comment_reply` response
 * @returns {{ id: string, author: string, authorThumb: string, text: string }}
 */
export function parseCreatedComment(data) {
  const result = data?.actionResult
  if (result?.status !== 'STATUS_SUCCEEDED') {
    throw new Error(readText(result?.feedbackText) || 'Comment failed to post.')
  }

  const comment = findCommentRenderer(data?.actions)
  if (!comment) throw new Error('The posted comment is missing from the response.')

  return {
    id: comment.commentId,
    author: readText(comment.authorText),
    authorThumb: bestThumbnail(comment.authorThumbnail?.thumbnails) ?? '',
    text: readText(comment.contentText)
  }
}

/**
 * @param {any} data `comment/perform_comment_action` response
 * @param {YouTubeCommentAction} action
 * @param {string} commentId
 */
export function isCommentActionSuccessful(data, action, commentId) {
  if (action === 'delete') {
    return (data?.actions ?? []).some(entry => entry?.removeCommentAction?.commentId === commentId &&
      entry.removeCommentAction.actionResult?.status === 'STATUS_SUCCEEDED')
  }
  return (data?.actionResults ?? []).some(result => result?.status === 'STATUS_SUCCEEDED')
}

/**
 * @param {any} data TV `player` response
 * @returns {string | null}
 */
export function parseWatchHistoryUrl(data) {
  if (data?.playabilityStatus?.status !== 'OK') return null
  const url = data.playbackTracking?.videostatsPlaybackUrl?.baseUrl
  return typeof url === 'string' && url.startsWith('https://') ? url : null
}
