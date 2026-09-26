import { YTNodes } from 'youtubei.js'
import { parseLocalVideoSummary } from '../video-summary.js'
import { parseLocalVideoGames } from '../video-games.js'
import { parseLocalVideoCollaborators } from '../video-collaborators.js'
import { createLocalFeedParsers } from './local-feed-parsers.js'
import { createInvidiousFeedParsers } from './invidious-feed-parsers.js'

const { parseLocalSubscriberCount, parseLocalTextRuns } = createLocalFeedParsers(() => false)
const { youtubeImageUrlToInvidious } = createInvidiousFeedParsers(() => '')

/**
 * Shared metadata consumed by the Watch view. Stream formats and provider-only
 * features stay on the source response until their playback paths are mapped.
 * @typedef {{
 *   title: string, viewCount: number | null, description: string, chapterDescription: string,
 *   durationSeconds: number, published: number, channel: { id: string, name: string, thumbnail: string, originalThumbnail: string },
 *   subscriberCount: number, category: string, tags: string[], thumbnail: string,
 *   likeCount: number | null, dislikeCount: number | null, familyFriendly: boolean | null,
 *   isLive: boolean, isUpcoming: boolean, isLiveContent: boolean, isPremiere: boolean,
 *   isPostLiveDvr: boolean, isUnlisted: boolean, musicMediaType: string | null,
 *   collaborators: object[], summary: string[], games: object[], license: string | undefined,
 *   hasAiGeneratedContent: boolean,
 *   recommendedVideos: object[], captions: object[],
 * }} WatchVideoMetadata
 */

/**
 * @param {import('./videoApi').LocalVideoInformation} response
 * @param {{videoId: string, avoidTranslation?: boolean, thumbnailPreference?: string,
 *   parseRecommendation?: (video: object) => object | null}} options
 * @returns {WatchVideoMetadata}
 */
export function mapLocalWatchVideo(response, { videoId, avoidTranslation = false, thumbnailPreference = '', parseRecommendation = () => null }) {
  const result = response.info
  const basic = result.basic_info ?? {}
  const page = result.page ?? []
  /** @type {import('youtubei.js').YTNodes.StructuredDescriptionContent | undefined} */
  const structuredDescription = page[1]?.engagement_panels
    ?.find(panel => panel.panel_identifier === 'engagement-panel-structured-description')?.content
  const titleHeader = structuredDescription?.items?.find(item => item.is(YTNodes.VideoTitleHeaderView))
  const descriptionHeader = structuredDescription?.items?.find(item => item.is(YTNodes.VideoDescriptionHeader))
  const descriptionChannel = structuredDescription?.items?.find(item => item.is(YTNodes.VideoDescriptionInfocardsSection))
  const descriptionBody = structuredDescription?.items?.find(item => item.is(YTNodes.ExpandableVideoDescriptionBody))
  const localizedDescription = result.secondary_info?.description?.text?.trim()
    ? result.secondary_info.description
    : descriptionBody?.attributed_description_body_text

  const title = avoidTranslation
    ? basic.title?.trim() ?? ''
    : result.primary_info?.title?.text?.trim() || titleHeader?.video_title.text?.trim() || descriptionHeader?.title.text?.trim() || basic.title?.trim() || ''
  const localizedViews = result.primary_info?.view_count?.text || descriptionHeader?.views.text
  const viewCount = Number.isFinite(basic.view_count)
    ? basic.view_count
    : localizedViews?.toLowerCase() === 'no views'
      ? 0
      : parseLocalSubscriberCount(localizedViews ?? '')

  const collaborators = parseLocalVideoCollaborators(result)
  const primaryCollaborator = collaborators[0]
  const ownerAuthor = result.secondary_info?.owner?.author
  const ownerChannelId = ownerAuthor?.id !== 'N/A' ? ownerAuthor?.id : undefined
  const ownerChannelName = ownerAuthor?.name !== 'N/A' ? ownerAuthor?.name : undefined
  const channel = {
    id: basic.channel_id ?? ownerChannelId ?? primaryCollaborator?.id ?? descriptionHeader?.channel_navigation_endpoint?.payload?.browseId ?? '',
    name: basic.author ?? ownerChannelName ?? primaryCollaborator?.name ?? descriptionHeader?.channel.text ?? '',
    thumbnail: primaryCollaborator?.thumbnail ?? ownerAuthor?.best_thumbnail?.url ?? descriptionHeader?.channel_thumbnail[0]?.url ?? descriptionChannel?.channel_avatar[0]?.url ?? '',
    originalThumbnail: '',
  }
  channel.originalThumbnail = channel.thumbnail

  let published
  if (page[0]?.microformat?.publish_date) {
    published = Date.parse(page[0].microformat.publish_date)
  } else {
    published = Date.parse(result.primary_info?.published?.text || descriptionHeader?.publish_date.text)
  }

  let description = basic.short_description
  if (!avoidTranslation && localizedDescription?.runs) {
    try {
      description = parseLocalTextRuns(localizedDescription.runs)
    } catch (error) {
      console.error('Failed to extract the localised description, falling back to the standard one.', error, JSON.stringify(localizedDescription.runs))
    }
  }

  const thumbnail = ['start', 'middle', 'end'].includes(thumbnailPreference)
    ? `https://i.ytimg.com/vi/${videoId}/maxres${{ start: 1, middle: 2, end: 3 }[thumbnailPreference]}.jpg`
    : basic.thumbnail?.[0].url ?? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
  const descriptionLikes = descriptionHeader?.factoids?.find(item => item.is(YTNodes.Factoid) && item.label.text === 'Likes')
  const parsedLikes = Number.isFinite(basic.like_count)
    ? basic.like_count
    : parseLocalSubscriberCount(descriptionLikes?.accessibility_text ?? descriptionLikes?.value.text ?? '')
  const subscriberCountText = result.secondary_info?.owner?.subscriber_count?.text?.trim() || descriptionChannel?.section_subtitle.text
  const subscriberCount = parseLocalSubscriberCount(subscriberCountText ?? '')
  const isLive = !!basic.is_live

  return {
    title,
    viewCount: Number.isFinite(viewCount) ? viewCount : null,
    description,
    chapterDescription: avoidTranslation
      ? basic.short_description
      : localizedDescription?.text || basic.short_description,
    durationSeconds: basic.duration,
    published: isLive && !basic.is_live_content
      ? basic.start_timestamp?.getTime() ?? 0
      : Number.isFinite(published) ? published : 0,
    channel,
    subscriberCount,
    category: basic.category ?? '',
    tags: basic.keywords ?? [],
    thumbnail,
    likeCount: isNaN(parsedLikes) ? 0 : parsedLikes,
    dislikeCount: null,
    familyFriendly: basic.is_family_safe,
    isLive,
    isUpcoming: !!basic.is_upcoming,
    isLiveContent: !!basic.is_live_content,
    isPremiere: response.isPremiere === true,
    isPostLiveDvr: !!basic.is_post_live_dvr,
    isUnlisted: !!basic.is_unlisted,
    musicMediaType: response.musicMediaType,
    collaborators,
    summary: parseLocalVideoSummary(result),
    games: parseLocalVideoGames(result),
    license: result.secondary_info?.metadata?.rows.find(element => element.title?.text === 'License')?.contents[0]?.text,
    hasAiGeneratedContent: result.primary_info?.badges?.some(badge => badge.label === 'AI') ?? false,
    recommendedVideos: result.watch_next_feed
      ?.filter(item => item.type === 'CompactVideo' || item.type === 'CompactMovie' ||
        (item.type === 'LockupView' && (item.content_type === 'VIDEO' || item.content_type === 'STATION')))
      .map(parseRecommendation).filter(Boolean) ?? [],
    captions: [],
  }
}

/**
 * @param {import('./videoApi').InvidiousVideoInformation} result
 * @param {{videoId: string, instanceUrl: string, thumbnailPreference?: string}} options
 * @returns {WatchVideoMetadata}
 */
export function mapInvidiousWatchVideo(result, { videoId, instanceUrl, thumbnailPreference = '' }) {
  if (result.error) throw new Error(result.error)
  const rawThumbnail = result.authorThumbnails.at(-1)?.url ?? ''
  const subCount = parseLocalSubscriberCount(result.subCountText)
  const thumbnail = ['start', 'middle', 'end'].includes(thumbnailPreference)
    ? `${instanceUrl}/vi/${videoId}/maxres${{ start: 1, middle: 2, end: 3 }[thumbnailPreference]}.jpg`
    : new URL(result.videoThumbnails[0].url, instanceUrl).toString()

  return {
    title: result.title,
    viewCount: result.viewCount,
    description: result.description ?? '',
    chapterDescription: result.description ?? '',
    durationSeconds: result.lengthSeconds,
    published: result.published * 1000,
    channel: {
      id: result.authorId,
      name: result.author,
      thumbnail: rawThumbnail ? youtubeImageUrlToInvidious(rawThumbnail, instanceUrl) : '',
      originalThumbnail: rawThumbnail,
    },
    subscriberCount: subCount,
    category: result.genre ?? '',
    tags: result.keywords ?? [],
    thumbnail,
    likeCount: result.likeCount,
    dislikeCount: result.dislikeCount,
    familyFriendly: result.isFamilyFriendly,
    isLive: result.liveNow,
    isUpcoming: !!result.isUpcoming,
    isLiveContent: !!result.liveNow,
    isPremiere: result.liveNow && result.premiereTimestamp > 0,
    isPostLiveDvr: !!result.isPostLiveDvr,
    isUnlisted: !result.isListed,
    musicMediaType: result.musicMediaType,
    collaborators: [],
    summary: [],
    games: [],
    license: undefined,
    hasAiGeneratedContent: false,
    recommendedVideos: (result.recommendedVideos ?? []).map(video => ({
      ...video,
      published: typeof video.published === 'string' ? Date.parse(video.published) : video.published,
    })),
    captions: (result.captions ?? []).map(caption => ({
      url: instanceUrl + caption.url,
      label: caption.label,
      language: caption.language_code,
      mimeType: 'text/vtt',
    })),
  }
}
