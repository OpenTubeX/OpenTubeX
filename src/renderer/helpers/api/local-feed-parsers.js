import { Parser, YTNodes, Utils, YT, Mixins, Misc } from 'youtubei.js'
import Autolinker from 'autolinker'
import { extractNumberFromString, calculatePublishedDate, escapeHTML, CHANNEL_HANDLE_REGEX } from '../feed-metadata.js'
import { isCollaborativeVideoAuthor } from '../video-collaborators.js'
import { getThumbnailPreviewUrl } from '../thumbnailPreview.js'
import { getResultAuthorThumbnailUrl } from '../result-channel-avatar.js'

// YouTube moved Shorts grid images from `thumbnail` to
// `thumbnailViewModel.thumbnailViewModel.image.sources`. Preserve that exact
// source while youtubei.js still expects the old field.
if (process.env.SUPPORTS_LOCAL_API) {
  class ShortsLockupViewWithThumbnail extends YTNodes.ShortsLockupView {
    constructor(data) {
      const sources = data.thumbnailViewModel?.thumbnailViewModel?.image?.sources
      const hasThumbnail = data.thumbnail?.thumbnails?.length > 0
      super(hasThumbnail || !sources
        ? data
        : { ...data, thumbnail: { thumbnails: sources } })
    }
  }

  Parser.addRuntimeParser('ShortsLockupView', ShortsLockupViewWithThumbnail)
}

export function createLocalFeedParsers(shouldHideMembersOnly) {
  const TRACKING_PARAM_NAMES = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
  ]

  /**
   * @param {YT.Channel} channel
   * @param {boolean} onlyIdNameThumbnail
   */
  function parseLocalChannelHeader(channel, onlyIdNameThumbnail = false) {
    /** @type {string?} */
    let id
    /** @type {string} */
    let name
    /** @type {string?} */
    let thumbnailUrl
    /** @type {string?} */
    let bannerUrl
    /** @type {string?} */
    let subscriberText
    /** @type {string[]} */
    const tags = []

    switch (channel.header.type) {
      case 'C4TabbedHeader': {
        // example: Linus Tech Tips
        // https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw

        /**
         * @type {import('youtubei.js').YTNodes.C4TabbedHeader}
         */
        const header = channel.header

        id = header.author.id
        name = header.author.name
        thumbnailUrl = header.author.best_thumbnail.url

        if (!onlyIdNameThumbnail) {
          bannerUrl = header.banner?.[0]?.url
          subscriberText = header.subscribers?.text
        }
        break
      }
      case 'CarouselHeader': {
        // examples: Music and YouTube Gaming
        // https://www.youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ
        // https://www.youtube.com/channel/UCOpNcN46UbXVtpKMrmU4Abg

        /**
         * @type {import('youtubei.js').YTNodes.CarouselHeader}
         */
        const header = channel.header

        /**
         * @type {import('youtubei.js').YTNodes.TopicChannelDetails}
         */
        const topicChannelDetails = header.contents.find(node => node.type === 'TopicChannelDetails')
        name = topicChannelDetails.title.text
        thumbnailUrl = topicChannelDetails.avatar[0].url

        if (channel.metadata.external_id) {
          id = channel.metadata.external_id
        } else {
          id = topicChannelDetails.subscribe_button.channel_id
        }

        if (!onlyIdNameThumbnail) {
          subscriberText = topicChannelDetails.subtitle.text
        }
        break
      }
      case 'InteractiveTabbedHeader': {
        // example: Minecraft - Topic
        // https://www.youtube.com/channel/UCQvWX73GQygcwXOTSf_VDVg

        /**
         * @type {import('youtubei.js').YTNodes.InteractiveTabbedHeader}
         */
        const header = channel.header
        name = header.title.text
        thumbnailUrl = header.box_art.at(-1).url
        id = channel.current_tab?.endpoint.payload.browseId

        if (!onlyIdNameThumbnail) {
          bannerUrl = header.banner[0]?.url

          const badges = header.badges.map(badge => badge.label).filter(tag => tag)
          tags.push(...badges)
        }
        break
      }
      case 'PageHeader': {
        // example: YouTube Gaming
        // https://www.youtube.com/channel/UCOpNcN46UbXVtpKMrmU4Abg

        // User channels (an A/B test at the time of writing)

        /**
         * @type {import('youtubei.js').YTNodes.PageHeader}
         */
        const header = channel.header

        name = header.content.title.text.text
        if (header.content.image) {
          if (header.content.image.type === 'ContentPreviewImageView') {
            /** @type {import('youtubei.js').YTNodes.ContentPreviewImageView} */
            const image = header.content.image

            thumbnailUrl = image.image[0].url
          } else {
            /** @type {import('youtubei.js').YTNodes.DecoratedAvatarView} */
            const image = header.content.image
            thumbnailUrl = image.avatar?.image[0].url
          }
        } else if (header.content.animated_image) {
          thumbnailUrl = header.content.animated_image.image[0].url
        }

        if (!thumbnailUrl && channel.metadata.thumbnail) {
          thumbnailUrl = channel.metadata.thumbnail[0].url
        }

        if (!onlyIdNameThumbnail && header.content.banner) {
          bannerUrl = header.content.banner.image[0]?.url
        }

        if (header.content.actions) {
          const modal = header.content.actions.actions_rows[0].actions[0].on_tap.modal

          if (modal && modal.type === 'ModalWithTitleAndButton') {
            /** @type {import('youtubei.js').YTNodes.ModalWithTitleAndButton} */
            const typedModal = modal

            id = typedModal.button.endpoint.next_endpoint?.payload.browseId
          }
        } else if (channel.metadata.external_id) {
          id = channel.metadata.external_id
        }

        if (!onlyIdNameThumbnail && header.content.metadata) {
          // YouTube has already changed the indexes for where the information is stored once,
          // so we should search for it instead of using hardcoded indexes, just to be safe for the future

          subscriberText = header.content.metadata.metadata_rows
            .flatMap(row => row.metadata_parts ? row.metadata_parts : [])
            .find(part => part.text?.text?.includes('subscriber'))
            ?.text?.text
        }

        break
      }
    }

    if (onlyIdNameThumbnail) {
      return {
        id,
        name,
        thumbnailUrl
      }
    }

    return {
      id,
      name,
      thumbnailUrl,
      bannerUrl,
      subscriberText,
      tags
    }
  }

  /**
   * @param {(import('youtubei.js').YTNodes.Video | import('youtubei.js').YTNodes.LockupView)[]} videos
   * @param {string} channelId
   * @param {string} channelName
   */
  function parseLocalChannelVideos(videos, channelId, channelName) {
    const parsedVideos = []

    for (const video of videos) {
      // `BADGE_STYLE_TYPE_MEMBERS_ONLY` used for both `members only` and `members first` videos
      const isMembersOnly = video.is(YTNodes.Video) &&
        video.badges.some(badge => badge.style === 'BADGE_STYLE_TYPE_MEMBERS_ONLY')
      if (shouldHideMembersOnly(isMembersOnly)) {
        continue
      }
      const parsedVideo = parseLocalListVideo(video, channelId, channelName)
      if (parsedVideo != null) {
        parsedVideos.push(parsedVideo)
      }
    }

    return parsedVideos
  }

  /**
   * @param {YTNodes.ReelItem | YTNodes.ShortsLockupView} short
   * @param {string} [channelId]
   * @param {string} [channelName]
   */
  function parseShort(short, channelId, channelName) {
    if (short.type === 'ReelItem') {
      /** @type {import('youtubei.js').YTNodes.ReelItem} */
      const reelItem = short

      return {
        type: 'video',
        videoId: reelItem.id,
        title: reelItem.title.text?.trim(),
        author: channelName,
        authorId: channelId,
        viewCount: reelItem.views.isEmpty() ? null : parseLocalSubscriberCount(reelItem.views.text),
        thumbnailUrl: reelItem.thumbnails.at(-1)?.url,
        isShort: true,
        lengthSeconds: ''
      }
    } else {
      /** @type {import('youtubei.js').YTNodes.ShortsLockupView} */
      const shortsLockupView = short

      return {
        type: 'video',
        videoId: shortsLockupView.on_tap_endpoint.payload.videoId,
        title: shortsLockupView.overlay_metadata.primary_text.text?.trim(),
        author: channelName,
        authorId: channelId,
        viewCount: shortsLockupView.overlay_metadata.secondary_text ? parseLocalSubscriberCount(shortsLockupView.overlay_metadata.secondary_text.text) : null,
        thumbnailUrl: getShortsLockupThumbnailUrl(shortsLockupView),
        isShort: true,
        lengthSeconds: ''
      }
    }
  }

  /**
   * @param {(import('youtubei.js').YTNodes.ReelItem | import('youtubei.js').YTNodes.ShortsLockupView)[]} shorts
   * @param {string} [channelId]
   * @param {string} [channelName]
   */
  function parseLocalChannelShorts(shorts, channelId, channelName) {
    return shorts.map(short => parseShort(short, channelId, channelName))
  }

  /**
   * @param {import('youtubei.js').YTNodes.Playlist|import('youtubei.js').YTNodes.GridPlaylist|import('youtubei.js').YTNodes.LockupView} playlist
   * @param {string} channelId
   * @param {string} channelName
   */
  function parseLocalListPlaylist(playlist, channelId = undefined, channelName = undefined) {
    if (playlist.type === 'LockupView') {
      return parseLockupView(playlist, channelId, channelName)
    } else if (playlist.type === 'CompactStation') {
      /** @type {import('youtubei.js').YTNodes.CompactStation} */
      const compactStation = playlist

      return {
        type: 'playlist',
        dataSource: 'local',
        title: compactStation.title.text,
        thumbnail: compactStation.thumbnail[1].url,
        playlistId: compactStation.endpoint.payload.playlistId,
        videoCount: extractNumberFromString(compactStation.video_count.text)
      }
    } else if (playlist.type === 'GridPlaylist') {
      /** @type {import('youtubei.js').YTNodes.GridPlaylist} */
      const gridPlaylist = playlist

      return {
        type: 'playlist',
        dataSource: 'local',
        title: gridPlaylist.title.text,
        thumbnail: gridPlaylist.thumbnails.at(0).url,
        playlistId: gridPlaylist.id,
        channelName: gridPlaylist.author?.name,
        channelId: gridPlaylist.author?.id,
        authorThumbnailUrl: getResultAuthorThumbnailUrl(gridPlaylist),
        videoCount: extractNumberFromString(gridPlaylist.video_count.text)
      }
    } else {
      let internalChannelName
      let internalChannelId = null

      if (playlist.author && playlist.author.id !== 'N/A') {
        if (playlist.author instanceof Misc.Text) {
          internalChannelName = playlist.author.text

          if (channelId) {
            internalChannelId = channelId
          }
        } else {
          internalChannelName = playlist.author.name
          internalChannelId = playlist.author.id
        }
      } else if (channelId || channelName) {
        internalChannelName = channelName
        internalChannelId = channelId
      } else if (playlist.author?.name) {
        // auto-generated album playlists don't have an author
        // so in search results, the author text is "Playlist" and doesn't have a link or channel ID
        internalChannelName = playlist.author.name
      }

      /** @type {import('youtubei.js').YTNodes.PlaylistVideoThumbnail} */
      const thumbnailRenderer = playlist.thumbnail_renderer

      return {
        type: 'playlist',
        dataSource: 'local',
        title: playlist.title.text,
        thumbnail: thumbnailRenderer ? thumbnailRenderer.thumbnail[0].url : playlist.thumbnails[0].url,
        channelName: internalChannelName,
        channelId: internalChannelId,
        authorThumbnailUrl: getResultAuthorThumbnailUrl(playlist),
        playlistId: playlist.id,
        videoCount: extractNumberFromString(playlist.video_count.text)
      }
    }
  }

  /**
   * @param {import('youtubei.js').YTNodes.PlaylistVideo|import('youtubei.js').YTNodes.ReelItem|import('youtubei.js').YTNodes.ShortsLockupView|import('youtubei.js').YTNodes.LockupView} video
   */
  function parseLocalPlaylistVideo(video) {
    if (video.type === 'LockupView') {
      return parseLockupView(video)
    } else if (video.type === 'ReelItem') {
      /** @type {import('youtubei.js').YTNodes.ReelItem} */
      const short = video

      return {
        type: 'video',
        videoId: short.id,
        title: short.title.text?.trim(),
        viewCount: parseLocalSubscriberCount(short.views.text),
        thumbnailUrl: short.thumbnails.at(-1)?.url,
        isShort: true,
        lengthSeconds: ''
      }
    } else if (video.type === 'ShortsLockupView') {
      /** @type {import('youtubei.js').YTNodes.ShortsLockupView} */
      const shortsLockupView = video

      let viewCount = null

      // the accessiblity text is the only place with the view count
      if (shortsLockupView.accessibility_text) {
        // the `.*\s+` at the start of the regex, ensures we match the last occurence
        // just in case the video title also contains that pattern
        const match = shortsLockupView.accessibility_text.match(/.*\s+(\d+(?:[,.]\d+)?\s?(?:[BKMbkm]|thousand|[bm]illion)?|no)\s+views?/)

        if (match) {
          const count = match[1]

          // as it's rare that a video has no views,
          // checking the length allows us to avoid running toLowerCase unless we have to
          if (count.length === 2 && count === 'no') {
            viewCount = 0
          } else {
            const views = parseLocalSubscriberCount(count)

            if (!isNaN(views)) {
              viewCount = views
            }
          }
        }
      }

      return {
        type: 'video',
        videoId: shortsLockupView.on_tap_endpoint.payload.videoId,
        title: shortsLockupView.overlay_metadata.primary_text.text?.trim(),
        viewCount,
        thumbnailUrl: getShortsLockupThumbnailUrl(shortsLockupView),
        isShort: true,
        lengthSeconds: ''
      }
    } else {
      /** @type {import('youtubei.js').YTNodes.PlaylistVideo} */
      const video_ = video

      let viewCount = null

      const viewsText = video_.video_info.runs?.find(run => isViewCountText(run.text))?.text

      if (viewsText) {
        const views = parseLocalSubscriberCount(viewsText)
        if (!isNaN(views)) {
          viewCount = views
        }
      }

      let publishedText
      // normal videos have 3 text runs with the last one containing the published date
      // OR no runs and just text with the published date (if the view count is missing)
      // live videos have 2 text runs with the number of people watching
      // upcoming either videos don't have any info text or the number of people waiting,
      // but we have the premiere date for those, so we don't need the published date

      if (!video_.is_upcoming && !video_.is_live) {
        const hasRuns = !!video_.video_info.runs

        if (hasRuns && video_.video_info.runs.length === 3) {
          publishedText = video_.video_info.runs[2].text
        } else if (!hasRuns && video_.video_info.text) {
          publishedText = video_.video_info.text
        }
      }

      const published = calculatePublishedDate(
        publishedText,
        video_.is_live,
        video_.is_upcoming,
        video_.upcoming
      )

      return {
        type: 'video',
        videoId: video_.id,
        title: video_.title.text?.trim(),
        author: video_.author.name,
        authorId: (video_.author?.id != null && video_.author.id !== 'N/A') ? video_.author.id : null,
        viewCount,
        published,
        lengthSeconds: isNaN(video_.duration.seconds) ? '' : video_.duration.seconds,
        liveNow: video_.is_live,
        isUpcoming: video_.is_upcoming,
        premiereDate: video_.upcoming
      }
    }
  }

  /**
   * Parses playlist entries and removes members-only videos unless authenticated playback is configured.
   * @param {(import('youtubei.js').YTNodes.PlaylistVideo|import('youtubei.js').YTNodes.ReelItem|import('youtubei.js').YTNodes.ShortsLockupView|import('youtubei.js').YTNodes.LockupView)[]} videos
   */
  function parseLocalPlaylistVideos(videos) {
    return videos.map(parseLocalPlaylistVideo).filter(video => video != null)
  }

  /**
   * @param {import('youtubei.js').YTNodes.ShortsLockupView} short
   * @returns {string | undefined}
   */
  function getShortsLockupThumbnailUrl(short) {
    return short.thumbnail?.at(-1)?.url
  }

  /**
   * @param {import('youtubei.js').YTNodes.Video | import('youtubei.js').YTNodes.Movie} item
   * @param {string} [channelId]
   * @param {string} [channelName]
   */
  function parseLocalListVideo(item, channelId, channelName) {
    if (item.type === 'Movie') {
      /** @type {import('youtubei.js').YTNodes.Movie} */
      const movie = item

      return {
        type: 'video',
        videoId: movie.id,
        thumbnailPreviewUrl: getThumbnailPreviewUrl(movie),
        title: movie.title.text?.trim(),
        author: movie.author.name !== 'N/A' ? movie.author.name : channelName,
        authorId: movie.author.id !== 'N/A' ? movie.author.id : channelId,
        description: movie.description_snippet?.text,
        lengthSeconds: isNaN(movie.duration.seconds) ? '' : movie.duration.seconds,
        liveNow: false,
        isUpcoming: false,
      }
    } else if (item.type === 'GridVideo') {
      /** @type {import('youtubei.js').YTNodes.GridVideo} */
      const video = item

      // This can happen for unavailable clip on channel home page
      if (!video.video_id) {
        return null
      }

      let publishedText

      if (video.published != null && !video.published.isEmpty()) {
        publishedText = video.published.text
      }

      const isLive = video.duration.text === 'LIVE'

      const published = calculatePublishedDate(
        publishedText,
        video.is_live,
        video.is_upcoming || video.is_premiere,
        video.upcoming
      )

      return {
        type: 'video',
        videoId: video.video_id,
        thumbnailPreviewUrl: getThumbnailPreviewUrl(video),
        title: video.title.text?.trim(),
        author: video.author?.name ?? channelName,
        authorId: (video.author?.id != null && video.author.id !== 'N/A') ? video.author.id : channelId,
        viewCount: video.views.text == null ? null : extractNumberFromString(video.views.text),
        published,
        lengthSeconds: isLive ? '' : Utils.timeToSeconds(video.duration.text),
        isUpcoming: video.is_upcoming,
        isPremiere: video.is_premiere,
        premiereDate: video.upcoming,
        liveNow: isLive
      }
    } else if (item.type === 'GridMovie') {
      /** @type {import('youtubei.js').YTNodes.GridMovie} */
      const movie = item
      return {
        type: 'video',
        videoId: movie.id,
        thumbnailPreviewUrl: getThumbnailPreviewUrl(movie),
        title: movie.title.text,
        author: movie.author.name !== 'N/A' ? movie.author.name : channelName,
        authorId: movie.author.id !== 'N/A' ? movie.author.id : channelId,
        lengthSeconds: isNaN(movie.duration.seconds) ? '' : movie.duration.seconds,
        isUpcoming: movie.is_upcoming,
        premiereDate: movie.upcoming
      }
    } else if (item.type === 'LockupView') {
      return parseLockupView(item, channelId, channelName)
    } else {
      /** @type {import('youtubei.js').YTNodes.Video} */
      const video = item
      const isMembersOnly = video.badges.some(badge => badge.style === 'BADGE_STYLE_TYPE_MEMBERS_ONLY')

      // When video is passed in via like community post attachment
      if (video.title?.text === 'This video isn\'t publicly available') {
        return null
      }

      let publishedText

      if (video.published != null && !video.published.isEmpty()) {
        publishedText = video.published.text
      }

      const published = calculatePublishedDate(
        publishedText,
        video.is_live,
        video.is_upcoming || video.is_premiere,
        video.upcoming
      )

      let viewCount = null

      if (video.view_count?.text) {
        viewCount = video.view_count.text.toLowerCase() === 'no views' ? 0 : extractNumberFromString(video.view_count.text)
      } else if (video.short_view_count?.text) {
        viewCount = video.short_view_count.text.toLowerCase() === 'no views' ? 0 : parseLocalSubscriberCount(video.short_view_count.text)
      }

      return {
        type: 'video',
        videoId: video.video_id,
        thumbnailPreviewUrl: getThumbnailPreviewUrl(video),
        title: video.title.text?.trim(),
        author: video.author.name !== 'N/A' ? video.author.name : channelName,
        authorId: video.author.id !== 'N/A' ? video.author.id : channelId,
        authorThumbnailUrl: getResultAuthorThumbnailUrl(video),
        hasCollaborators: video.author.id === 'N/A' && isCollaborativeVideoAuthor(video.author.name),
        description: video.description,
        viewCount,
        published,
        lengthSeconds: isNaN(video.duration.seconds) ? '' : video.duration.seconds,
        liveNow: video.is_live,
        isPremiere: video.is_premiere,
        isUpcoming: video.is_upcoming || video.is_premiere,
        premiereDate: video.upcoming,
        is4k: video.is_4k,
        is8k: video.badges.some(badge => badge.label === '8K'),
        isNew: video.badges.some(badge => badge.label === 'New'),
        isVr180: video.badges.some(badge => badge.label === 'VR180'),
        isVr360: video.badges.some(badge => badge.label === '360°'),
        is3d: video.badges.some(badge => badge.label === '3D'),
        hasCaptions: video.has_captions,
        isMembersOnly
      }
    }
  }

  const VIEWS_OR_WATCHING_REGEX = /views?|watching|waiting/i

  const VIEWS_IN_NUMBER_ONLY = /^\d+(\.\d)?[bkm]?$/i

  const PREMIERE_TIME_REGEX = /^premieres? /i

  const UPCOMING_TIME_REGEX = /^(premieres?|scheduled for) /i

  const PUBLISH_TIME_REGEX = /^(streamed )?\d+ ?\w+? ago/i

  /**
   * @param {string | undefined} text
   */
  function isViewCountText(text) {
    if (typeof text !== 'string') { return false }

    return VIEWS_OR_WATCHING_REGEX.test(text) || VIEWS_IN_NUMBER_ONLY.test(text)
  }

  /**
   * @param {string | undefined} text
   */
  function isPremieresTimeText(text) {
    if (typeof text !== 'string') { return false }

    return UPCOMING_TIME_REGEX.test(text)
  }

  /**
   * @param {string | undefined} text
   */
  function isPublishTimeText(text) {
    if (typeof text !== 'string') { return false }

    return PUBLISH_TIME_REGEX.test(text)
  }

  /**
   * @param {import('youtubei.js').YTNodes.LockupView} lockupView
   * @param {string | undefined} channelId
   * @param {string | undefined} channelName
   */
  function parseLockupView(lockupView, channelId = undefined, channelName = undefined) {
    switch (lockupView.content_type) {
      case 'ALBUM':
      case 'PLAYLIST':
      case 'PODCAST': {
        const thumbnailOverlayBadgeView = lockupView.content_image.primary_thumbnail.overlays
          .find(overlay => overlay.is(YTNodes.ThumbnailOverlayBadgeView))

        const playlistId = lockupView.content_id

        // Filter out mixes without playlist pages (we don't support watch page-only mixes)
        // https://wiki.archiveteam.org/index.php/YouTube/Technical_details#Playlists
        if (playlistId.startsWith('RD') && !playlistId.startsWith('RDCL')) {
          return null
        }

        const maybeChannelText = lockupView.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text

        if (maybeChannelText && maybeChannelText.endpoint?.metadata.page_type === 'WEB_PAGE_TYPE_CHANNEL') {
          channelName = maybeChannelText.text
          channelId = maybeChannelText.endpoint.payload.browseId
        }

        return {
          type: 'playlist',
          dataSource: 'local',
          playlistId,
          title: lockupView.metadata.title.text,
          thumbnail: lockupView.content_image.primary_thumbnail.image[0].url,
          channelName,
          channelId,
          videoCount: extractNumberFromString(thumbnailOverlayBadgeView.badges[0].text)
        }
      }
      case 'SHORT':
      case 'STATION':
      case 'VIDEO': {
        const isStation = lockupView.content_type === 'STATION'
        let publishedText
        let lengthSeconds = ''
        let liveNow = false
        let isPremiere = false
        let isUpcoming = false
        let premiereDate

        const isMemberOnly = lockupView.metadata.metadata?.metadata_rows.some(row => {
          return row.badges.some(badge => badge.style === 'BADGE_MEMBERS_ONLY')
        })
        if (shouldHideMembersOnly(isMemberOnly)) {
          return null
        }

        /** @type {YTNodes.ThumbnailBottomOverlayView | undefined } */
        const thumbnailBottomOverlayView = lockupView.content_image?.overlays?.firstOfType(YTNodes.ThumbnailBottomOverlayView) ??
          lockupView.content_image?.primary_thumbnail?.overlays?.firstOfType(YTNodes.ThumbnailBottomOverlayView)

        // YouTube changed the metadata row structure in 2026. The layout can now be any of:
        //   - 2 rows: [author] [views, date]            (e.g. related videos / Up Next)
        //   - 1 row:  [views, date]                     (e.g. channel video tabs, where the uploader row is omitted)
        //   - 1 row:  [date, views]                     (parts can also appear in reverse order)
        //   - 1 row:  [views]                           (e.g. live streams with watching count only)
        // Detect the uploader row structurally (only when 2+ rows are present),
        // and search every part dynamically for views and dates so the part order doesn't matter.
        const metadataRows = lockupView.metadata?.metadata?.metadata_rows ?? []
        const metadataParts = metadataRows.flatMap(row => row.metadata_parts ?? [])

        const findPartText = (predicate) => metadataParts
          .find(part => part.text?.text && predicate(part.text.text))?.text?.text

        if (thumbnailBottomOverlayView) {
          const liveBadge = thumbnailBottomOverlayView.badges.find(badge =>
            badge.badge_style === 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE' ||
            badge.icon_name === 'LIVE'
          )

          if (liveBadge) {
            liveNow = true
            isPremiere = /premiere/i.test(liveBadge.text ?? '')
          } else if (thumbnailBottomOverlayView.badges.some(badge => badge.text?.toLowerCase() === 'upcoming')) {
            isUpcoming = true
            isPremiere = metadataParts.some(part => PREMIERE_TIME_REGEX.test(part.text?.text ?? ''))

            // The premiere date can be in any non-views, non-relative-time part, often with a
            // "Premieres "/"Scheduled for " prefix that breaks Date.parse. Try every candidate
            // part (with and without the prefix stripped) and keep the first one that parses.
            for (const part of metadataParts) {
              const text = part.text?.text
              if (!text || VIEWS_OR_WATCHING_REGEX.test(text) || text.endsWith('ago')) continue

              let parsed = new Date(text)
              if (isNaN(parsed.getTime())) {
                const stripped = text.replace(/^(premieres?|premiered|scheduled for)\s+/i, '').trim()
                if (stripped && stripped !== text) {
                  parsed = new Date(stripped)
                }
              }

              if (!isNaN(parsed.getTime())) {
                premiereDate = parsed
                break
              }
            }
          } else {
            const durationBadge = thumbnailBottomOverlayView.badges.find(badge => /^[\d:]+$/.test(badge.text))

            if (durationBadge) {
              lengthSeconds = Utils.timeToSeconds(durationBadge.text)
            }

            publishedText = findPartText(isPublishTimeText)
          }
        }

        let viewCount = null

        const viewsText = findPartText(isViewCountText)

        if (viewsText) {
          const views = parseLocalSubscriberCount(viewsText)

          if (!isNaN(views)) {
            viewCount = views
          }
        }

        // Author/channel detection:
        // 1. Prefer a part whose text endpoint links to a channel (subscription feed)
        // 2. When YouTube uses a 2+ row layout without channel endpoints (e.g. recommended),
        //    the uploader name is the first part of the first row if it's not views/date text
        // 3. Otherwise fall back to channelName/channelId from the caller (e.g. channel video tabs)
        let authorPart = metadataParts
          .find(part => part.text?.endpoint?.metadata.page_type === 'WEB_PAGE_TYPE_CHANNEL')
          ?.text

        if (!authorPart && metadataRows.length >= 2) {
          const firstPart = metadataRows[0].metadata_parts?.[0]?.text
          const firstPartText = firstPart?.text

          if (firstPartText && !isViewCountText(firstPartText) && !firstPartText.endsWith('ago') && !isPremieresTimeText(firstPartText)) {
            authorPart = firstPart
          }
        }

        const imageAuthorId = lockupView.metadata.image?.renderer_context?.command_context?.on_tap?.payload?.browseId
        const author = authorPart?.text ?? channelName ??
          metadataParts.find(part => part.avatar_stack?.text?.text)?.avatar_stack.text.text
        const authorId = authorPart?.endpoint?.payload?.browseId ?? imageAuthorId ?? channelId
        const hasCollaborators = authorPart?.endpoint == null && isCollaborativeVideoAuthor(author)

        return {
          type: 'video',
          videoId: lockupView.content_id,
          thumbnailPreviewUrl: getThumbnailPreviewUrl(lockupView),
          title: lockupView.metadata.title.text?.trim(),
          author,
          authorId,
          hasCollaborators,
          viewCount,
          published: calculatePublishedDate(publishedText, liveNow, isUpcoming, premiereDate),
          lengthSeconds,
          liveNow,
          isPremiere,
          isUpcoming,
          premiereDate,
          isStation,
          isShort: lockupView.content_type === 'SHORT',
          isMembersOnly: Boolean(isMemberOnly)
        }
      }
      default:
        console.warn(`Unknown lockup content type: ${lockupView.content_type}`, lockupView)
        return null
    }
  }

  /**
   * @param {(Misc.TextRun|Misc.EmojiRun)[]} runs
   * @param {number} emojiSize
   * @param {{looseChannelNameDetection: boolean}} options
   */
  function parseLocalTextRuns(runs, emojiSize = 16, options = { looseChannelNameDetection: false }) {
    if (!Array.isArray(runs)) {
      throw new Error('not an array of text runs')
    }

    const timestampRegex = /^(?:\d+:){1,2}\d+$/
    const spacesBeforeRegex = /^\s+/
    const spacesAfterRegex = /\s+$/
    const parsedRuns = []

    for (const run of runs) {
      // may contain HTML, so we need to escape it, as we don't render unwanted HTML
      // example: https://youtu.be/Hh_se2Zqsdk (see pinned comment)
      const text = escapeHTML(run.text)

      if (run instanceof Misc.EmojiRun) {
        const { emoji } = run

        // empty array if video creator removes a channel emoji so we ignore.
        // eg: pinned comment here https://youtu.be/v3wm83zoSSY
        if (emoji.image.length > 0) {
          let altText

          if (emoji.is_custom) {
            if (emoji.shortcuts.length > 0) {
              altText = emoji.shortcuts[0]
            } else if (emoji.search_terms.length > 0) {
              altText = emoji.search_terms.join(', ')
            } else {
              altText = 'Custom emoji'
            }
          } else {
            altText = text
          }

          // lazy load the emoji image so it doesn't delay rendering of the text
          // by defining a height and width, that space is reserved until the image is loaded
          // that way we avoid layout shifts when it loads
          parsedRuns.push(`<img src="${emoji.image[0].url}" alt="${altText}" width="${emojiSize}" height="${emojiSize}" loading="lazy" style="vertical-align: middle">`)
        }
      } else {
        const { bold, italics, strikethrough, endpoint } = run

        if (endpoint) {
          switch (endpoint.metadata.page_type) {
            case 'WEB_PAGE_TYPE_WATCH':
              if (timestampRegex.test(text)) {
                parsedRuns.push(text)
              } else {
                parsedRuns.push(`https://www.youtube.com${endpoint.metadata.url}`)
              }
              break
            case 'WEB_PAGE_TYPE_CHANNEL': {
              const trimmedText = text.trim()
              // In comments, mention can be `@Channel Name` (not handle, but name)
              if (CHANNEL_HANDLE_REGEX.test(trimmedText) || options.looseChannelNameDetection) {
                // Note that in regex `\s` must be used since the text contain non-default space (the half-width space char when we press spacebar)
                const spacesBefore = (spacesBeforeRegex.exec(text) || [''])[0]
                const spacesAfter = (spacesAfterRegex.exec(text) || [''])[0]
                parsedRuns.push(`${spacesBefore}<a href="https://www.youtube.com/channel/${endpoint.payload.browseId}">${trimmedText}</a>${spacesAfter}`)
              } else {
                parsedRuns.push(`https://www.youtube.com${endpoint.metadata.url}`)
              }
              break
            }
            case 'WEB_PAGE_TYPE_PLAYLIST':
            case 'WEB_PAGE_TYPE_SHORTS':
              parsedRuns.push(`https://www.youtube.com${endpoint.metadata.url}`)
              break
            case 'WEB_PAGE_TYPE_BROWSE':
              parsedRuns.push(`<a href="https://www.youtube.com${endpoint.metadata.url}">${text}</a>`)
              break
            case 'WEB_PAGE_TYPE_UNKNOWN':
            default: {
              const url = new URL((endpoint.dialog?.type === 'ConfirmDialog' && endpoint.dialog.confirm_button.endpoint.payload.url) || endpoint.payload.url)
              if (url.hostname === 'www.youtube.com' && url.pathname === '/redirect' && url.searchParams.has('q')) {
                // remove utm tracking parameters
                const realURLStr = url.searchParams.get('q')
                const realURL = new URL(realURLStr)
                let urlChanged = false

                TRACKING_PARAM_NAMES.forEach((paramName) => {
                  if (!realURL.searchParams.has(paramName)) { return }

                  realURL.searchParams.delete(paramName)
                  urlChanged = true
                })

                // `searchParams.delete` changes query string unnecessarily
                // Using original unless there is any change
                parsedRuns.push(urlChanged ? realURL.toString() : realURLStr)
              } else {
                // this is probably a special YouTube URL like http://www.youtube.com/approachingnirvana
                parsedRuns.push(endpoint.payload.url)
              }
              break
            }
          }
        } else {
          let formattedText = text
          if (bold) {
            formattedText = `<b>${formattedText}</b>`
          }

          if (italics) {
            formattedText = `<i>${formattedText}</i>`
          }

          if (strikethrough) {
            formattedText = `<s>${formattedText}</s>`
          }

          parsedRuns.push(formattedText)
        }
      }
    }

    return parsedRuns.join('')
  }

  /**
   * @param {string} text
   */
  function parseLocalSubscriberCount(text) {
    const match = text.match(/(\d+)(?:[,.](\d+))?\s?([BKMbkm]|thousand|[bm]illion)\b/)

    if (match) {
      let multiplier = 0

      switch (match[3]) {
        case 'K':
        case 'k':
        case 'thousand':
          multiplier = 3
          break
        case 'M':
        case 'm':
        case 'million':
          multiplier = 6
          break
        case 'B':
        case 'b':
        case 'billion':
          multiplier = 9
          break
      }

      let parsedDecimals
      if (typeof match[2] === 'undefined') {
        parsedDecimals = '0'.repeat(multiplier)
      } else {
        parsedDecimals = match[2].padEnd(multiplier, '0')
      }

      return parseInt(match[1] + parsedDecimals)
    } else {
      return extractNumberFromString(text)
    }
  }

  /**
   * Parse community posts
   * @param {import('youtubei.js').YTNodes.BackstagePost[] | import('youtubei.js').YTNodes.SharedPost[] | import('youtubei.js').YTNodes.Post[] } posts
   */
  function parseLocalCommunityPosts(posts) {
    const foundIds = []
    // `posts` includes the SharedPost's attached post for some reason so we need to filter that out.
    // see: https://github.com/FreeTubeApp/FreeTube/issues/3252#issuecomment-1546675781
    // we don't currently support SharedPost's so that is also filtered out
    for (const post of posts) {
      if (post.type === 'SharedPost') {
        // `original_post` can be null if it was deleted
        if (post.original_post) {
          foundIds.push(post.original_post.id)
        }
        foundIds.push(post.id)
      }
    }

    return posts.filter(post => {
      return !foundIds.includes(post.id)
    }).map(parseLocalCommunityPost)
  }

  /**
   * Parse community post
   * @param {import('youtubei.js').YTNodes.BackstagePost} post
   */
  function parseLocalCommunityPost(post) {
    let replyCount = post.action_buttons?.reply_button?.text ?? null
    if (replyCount !== null) {
      replyCount = parseLocalSubscriberCount(post?.action_buttons.reply_button.text)
    }

    const authorThumbnails = post.author.thumbnails

    authorThumbnails.forEach((thumbnail) => {
      if (thumbnail.url.startsWith('//')) {
        thumbnail.url = 'https:' + thumbnail.url
      }
    })

    return {
      postText: post.content.isEmpty() ? '' : Autolinker.link(parseLocalTextRuns(post.content.runs, 16)),
      postId: post.id,
      authorThumbnails,
      publishedTime: calculatePublishedDate(post.published.text),
      // YouTube hides the vote/like count on posts when it is zero
      voteCount: post.vote_count ? parseLocalSubscriberCount(post.vote_count.text) : 0,
      postContent: parseLocalAttachment(post.attachment),
      commentCount: replyCount,
      authorId: post.author.id,
      author: post.author.name,
      type: 'community'
    }
  }

  function parseLocalAttachment(attachment) {
    if (!attachment) {
      return null
    }
    // image post
    if (attachment.type === 'BackstageImage') {
      return {
        type: 'image',
        content: attachment.image
      }
    } else if (attachment.type === 'Video') {
      const parsedVideo = parseLocalListVideo(attachment)
      if (parsedVideo == null) return null

      return {
        type: 'video',
        content: parsedVideo
      }
    } else if (attachment.type === 'Playlist') {
      return {
        type: 'playlist',
        content: parseLocalListPlaylist(attachment)
      }
    } else if (attachment.type === 'PostMultiImage') {
      return {
        type: 'multiImage',
        content: attachment.images.map(thumbnail => thumbnail.image)
      }
    } else if (attachment.type === 'Poll') {
      return {
        type: 'poll',
        totalVotes: parseLocalSubscriberCount(attachment.total_votes.text) ?? 0,
        content: attachment.choices.map(choice => {
          return {
            text: choice.text.text,
            image: choice.image
          }
        })
      }
    } else if (attachment.type === 'Quiz') {
      return {
        type: 'quiz',
        totalVotes: parseLocalSubscriberCount(attachment.total_votes.text) ?? 0,
        content: Object.values(attachment.choices).map(choice => {
          return {
            text: choice.text.text,
            isCorrect: choice.is_correct,
            image: choice.image
          }
        })
      }
    } else {
      console.error(`Unknown Local community post type: ${attachment.type}`)
      console.error(attachment)
    }
  }

  /** Parse native background HTTP results without making new network requests. */
  function normalizeLocalSubscriptionFeed(feedType, payload, channelId, timestamp = Date.now()) {
    const { data } = payload
    if (payload.backgroundFormat === 'localPlaylist') return parseLocalPlaylistVideos(new YT.Playlist(null, { data }).items)
    const channel = new YT.Channel(null, { data })
    const { name } = parseLocalChannelHeader(channel, true)
    const suffix = { videos: '/videos', shorts: '/shorts', live: '/streams', posts: '/posts' }[feedType]
    if (!channel.current_tab?.endpoint.metadata.url?.endsWith(suffix)) return []
    if (feedType === 'shorts') return parseLocalChannelShorts(channel.videos, channelId, name)
    const page = payload.continuation ? new Mixins.Feed(null, { data: payload.continuation }) : channel
    const entries = feedType === 'posts' ? parseLocalCommunityPosts(channel.posts) : parseLocalChannelVideos(page.videos, channelId, name)
    // Channel pages express publication dates relative to the fetch time.
    const elapsed = Math.max(0, Date.now() - timestamp)
    for (const entry of entries) {
      if (Number.isFinite(entry.published) && !entry.isUpcoming) entry.published -= elapsed
      if (Number.isFinite(entry.publishedTime)) entry.publishedTime -= elapsed
    }
    return entries
  }

  return {
    normalizeLocalSubscriptionFeed,
    parseLocalPlaylistVideos,
    parseLocalPlaylistVideo,
    parseLockupView,
    parseLocalSubscriberCount,
    parseLocalChannelHeader,
    parseLocalChannelShorts,
    parseShort,
    parseLocalCommunityPosts,
    parseLocalCommunityPost,
    parseLocalTextRuns,
    parseLocalListVideo,
    parseLocalListPlaylist,
    parseLocalChannelVideos
  }
}
