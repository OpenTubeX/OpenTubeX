import { initializeNetworkRecovery, getConnectionState } from '../../helpers/networkRecovery'
import { Utils, YTNodes } from 'youtubei.js'
import {
  formatDurationAsTimestamp,
  formatNumber,
  getCachedOembedTitle,
  getOembedTitle,
  getShortThumbnailUrl,
  showApiErrorToast,
} from '../../helpers/utils'
import {
  areLocalCommentsDisabled,
  mapLocalLegacyFormat,
  parseLocalEndscreen,
} from '../../helpers/api/local'
import {
  getProxyUrl,
  mapInvidiousLegacyFormat,
} from '../../helpers/api/invidious'
import { videoApi } from '../../helpers/api/videoApi'
import {
  findCaptionByLocale,
  sortCaptions,
  MANIFEST_TYPE_DASH,
  MANIFEST_TYPE_HLS,
} from '../../helpers/player/utils'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'

// The component owns presentation state; these methods load provider metadata into it.
export const watchVideoMetadataMethods = {
  loadVideoInformation: function (loadGeneration, options = {}) {
    return videoApi.loadWatchMetadata(this.backendPreference, {
      ...options,
      loadLocal: () => this.getVideoInformationLocal(loadGeneration),
      loadInvidious: () => this.getVideoInformationInvidious(loadGeneration),
    })
  },

  getVideoInformationLocal: async function (loadGeneration = ++this.videoLoadGeneration) {
    if (this.firstLoad) {
      this.isLoading = true
    }

    const videoId = this.tabRoute.params.id
    await initializeNetworkRecovery().ready
    if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return
    if (getConnectionState() === 'offline' && this.finishDownloadedPlaybackWithoutMetadata()) return

    try {
      const { metadata, source: videoInfo } = await videoApi.getWatchVideoInformation(videoId, 'local', {
        videoId,
        avoidTranslation: this.$store.getters.getAvoidTranslation !== 'disabled',
        thumbnailPreference: this.thumbnailPreference,
      })
      if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

      const {
        info: result,
        poToken,
        clientInfo,
        adEndTimeUnixMs,
        paidPromotionDurationMs,
        watchPageIpBlocked,
        androidLiveHlsManifestUrl,
      } = videoInfo

      this.musicMediaType = metadata.musicMediaType

      if (watchPageIpBlocked) {
        this.ipBlockDetectedInCurrentChain = true

        if (process.env.IS_ELECTRON && this.videoPlaybackEngine === 'built-in') {
          this.playbackEngineFallbackAttemptedForCurrentVideo = true
          this.playbackEngineFallbackTarget = 'yt-dlp'
          this.showTabToast({
            message: this.t('Change Format.Built-in Fallback Template', { error: this.t('Video.IP block') }),
            icon: ['fas', 'exchange-alt'],
          })
        }
      }

      const playabilityStatus = result.playability_status
      this.playabilityStatus = playabilityStatus.status

      if (playabilityStatus.status === 'LOGIN_REQUIRED' && playabilityStatus.error_screen?.reason?.text === 'Private video') {
        // Private videos cannot be played in FreeTube, as they require to be logged as the owner of the video
        // so there is no point continuing or trying any other backends as it will always fail
        this.setNonRetryablePlaybackError('private')
        this.thumbnail = this.getUnavailableVideoThumbnail()
        this.isLoading = false
        this.updateTitle()
        return
      }

      this.adEndTimeUnixMs = adEndTimeUnixMs
      this.hasPaidPromotion = paidPromotionDurationMs !== null
      this.paidPromotionDurationMs = paidPromotionDurationMs ?? 10000

      this.isFamilyFriendly = metadata.familyFriendly
      this.commentsDisabled = areLocalCommentsDisabled(result)
      const avoidTranslation = this.$store.getters.getAvoidTranslation !== 'disabled'

      // Place watched recommendations last after the API has normalized them.
      this.recommendedVideos = metadata.recommendedVideos.sort(this.sortWatchedVideosLast)

      this.videoAnnotations = parseLocalEndscreen(result.endscreen)
      if (avoidTranslation) {
        this.videoAnnotations = this.videoAnnotations.map((annotation) => {
          if (!annotation.videoId) {
            return annotation
          }

          const cachedTitle = getCachedOembedTitle(annotation.videoId)
          if (cachedTitle !== null) {
            return { ...annotation, title: cachedTitle }
          }

          getOembedTitle(annotation.videoId).then((title) => {
            if (!title || this.$store.getters.getAvoidTranslation === 'disabled' ||
                  !this.isCurrentVideoLoad(loadGeneration, videoId)) {
              return
            }

            this.videoAnnotations = this.videoAnnotations.map((currentAnnotation) =>
              currentAnnotation.id === annotation.id
                ? { ...currentAnnotation, title }
                : currentAnnotation
            )
          })

          return annotation
        })
      }

      if (this.showFamilyFriendlyOnly && this.isFamilyFriendly === false) {
        this.isLoading = false
        this.handleVideoEnded()
        return
      }

      this.videoSummary = metadata.summary

      this.videoTitle = metadata.title
      this.hasResolvedVideoTitle = this.videoTitle.length > 0
      if (!this.hasResolvedVideoTitle) {
        // Reuse the cache and in-flight request used by original-language list titles.
        getOembedTitle(videoId).then(title => {
          if (!title || this.hasResolvedVideoTitle || !this.isCurrentVideoLoad(loadGeneration, videoId)) return
          this.videoTitle = title
          this.hasResolvedVideoTitle = true
          this.updateTitle()
        })
      }
      this.videoViewCount = metadata.viewCount
      this.license = metadata.license
      this.videoGames = metadata.games
      this.channelCollaborators = metadata.collaborators
      this.channelId = metadata.channel.id
      this.channelName = metadata.channel.name
      this.channelThumbnail = metadata.channel.thumbnail
      this.$store.commit('setVideoAvatar', {
        videoId: this.videoId,
        avatar: this.channelThumbnail
      })
      this.setTabAvatar(this.channelThumbnail)
      this.videoCategory = metadata.category
      this.videoTags = metadata.tags
      this.videoGenreIsMusic = this.videoCategory === 'Music'
      this.updateSubscriptionDetails({
        channelThumbnailUrl: this.channelThumbnail.length === 0 ? null : this.channelThumbnail,
        channelName: this.channelName,
        channelId: this.channelId
      })
      this.initializePlaybackRate()
      this.initializeVideoQuality()
      this.videoPublished = metadata.published
      this.videoDescription = metadata.description
      this.thumbnail = metadata.thumbnail

      if (this.hideVideoLikesAndDislikes) {
        this.videoLikeCount = null
        this.videoDislikeCount = null
      } else {
        this.videoLikeCount = metadata.likeCount
        this.videoDislikeCount = metadata.dislikeCount
        if (this.useReturnYouTubeDislikes) this.fetchVideoDislikes()
      }

      this.isLive = metadata.isLive
      this.isUpcoming = metadata.isUpcoming
      this.isLiveContent = metadata.isLiveContent
      this.isPremiere = metadata.isPremiere
      this.isPostLiveDvr = metadata.isPostLiveDvr
      this.isUnlisted = metadata.isUnlisted
      this.hasAiGeneratedContent = metadata.hasAiGeneratedContent
      this.channelSubscriptionCountText = Number.isFinite(metadata.subscriberCount)
        ? formatNumber(metadata.subscriberCount, metadata.subscriberCount >= 10000 ? { notation: 'compact' } : undefined)
        : ''

      let chapters = []
      let chaptersKind = 'chapters'
      if (!this.hideChapters) {
        const rawChapters = result.player_overlays?.decorated_player_bar?.player_bar?.markers_map
          ?.find(marker => marker.marker_key === 'DESCRIPTION_CHAPTERS')?.value.chapters

        if (rawChapters && !avoidTranslation) {
          for (const chapter of rawChapters) {
            const start = chapter.time_range_start_millis / 1000

            chapters.push({
              title: chapter.title.text,
              timestamp: formatDurationAsTimestamp(start),
              startSeconds: start,
              endSeconds: 0,
              thumbnail: chapter.thumbnail[0]
            })
          }
        } else {
          /** @type {import('youtubei.js').YTNodes.MacroMarkersList | null | undefined} */
          const macroMarkersList = result.page[1]?.engagement_panels
            ?.find(pannel => pannel.panel_identifier === 'engagement-panel-macro-markers-auto-chapters')?.content

          if (macroMarkersList && !avoidTranslation) {
            for (const item of macroMarkersList.contents) {
              if (item instanceof YTNodes.MacroMarkersListItem) {
                chapters.push({
                  title: item.title.text,
                  timestamp: item.time_description.text,
                  startSeconds: Utils.timeToSeconds(item.time_description.text),
                  endSeconds: 0,
                  thumbnail: item.thumbnail[0]
                })
              }
            }
            chaptersKind = 'keyMoments'
          } else {
            chapters = this.extractChaptersFromDescription(metadata.chapterDescription ?? '')
          }
        }

        if (chapters.length > 0) {
          this.finalizeChapters(chapters, result.basic_info.duration)
        } else {
          chapters = await this.getSponsorBlockCommunityChapters(result.basic_info.duration)
          if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
        }
      }

      this.videoChapters = chapters
      this.videoChaptersKind = chaptersKind

      // The apostrophe is intentionally that one (char code 8217), because that is the one YouTube uses
      const BOT_MESSAGE = 'Sign in to confirm you’re not a bot'

      const isDrmProtected = result.streaming_data?.adaptive_formats.some(format => format.drm_families || format.drm_track_type)

      if (playabilityStatus.status === 'UNPLAYABLE' || playabilityStatus.status === 'LOGIN_REQUIRED' || isDrmProtected) {
        if (playabilityStatus.error_screen?.offer_id === 'sponsors_only_video') {
          this.setRestrictedPlaybackError('members')
        } else if (playabilityStatus.reason === 'Sign in to confirm your age' || (result.has_trailer && result.getTrailerInfo() === null)) {
          this.setRestrictedPlaybackError('age')
        } else if (isDrmProtected) {
          // DRM protected videos (e.g. movies) cannot be played in FreeTube,
          // as they require the proprietary and closed source Wideview CDM which is understandably not included in standard Electron builds
          this.setNonRetryablePlaybackError('drm')
          this.isLoading = false
          this.updateTitle()
          return
        }

        if (this.restrictedPlaybackError === null) {
          let errorText

          if (playabilityStatus.reason === BOT_MESSAGE || playabilityStatus.reason === 'Please sign in') {
            errorText = this.t('Video.IP block')
            this.ipBlockDetectedInCurrentChain = true
          } else {
            errorText = `[${playabilityStatus.status}] ${playabilityStatus.reason}`

            if (playabilityStatus.error_screen?.subreason) {
              errorText += `: ${playabilityStatus.error_screen.subreason.text}`
            }
          }

          const tryingYtDlpForIpBlock =
            this.isYtDlpPlaybackRequested() &&
              this.ipBlockDetectedInCurrentChain

          if (tryingYtDlpForIpBlock) {
            console.warn('Built-in metadata is IP blocked; continuing so yt-dlp can provide the playback source')
          } else if (this.backendFallback) {
            throw new Error(errorText)
          } else {
            const didReload = await this.runIpBlockRecoveryScriptAndReload()
            if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
            if (didReload) {
              return
            }

            this.errorMessage = errorText
            this.isLoading = false
            this.updateTitle()
            return
          }
        }
      }

      // Streams that have ended keep their chat around as a replay, which is played back
      // in sync with the video instead of in real time.
      if (result.livechat && (this.isLive || this.isUpcoming || result.livechat.is_replay)) {
        this.liveChat = result.getLiveChat()
        this.liveChatIsReplay = this.liveChat.is_replay
      } else {
        this.liveChat = null
        this.liveChatIsReplay = false
      }

      if ((this.isLive || this.isPostLiveDvr) && !this.isUpcoming) {
        let useRemoteManifest = true

        if (this.isPostLiveDvr) {
          // I wasn't able to get SABR working with Post-Live-DVR yet, so for the moment we'll use YouTube's provided DASH manifest instead.
          // It only contains the last 4 hours of the stream, instead of starting from the beginning but that is better than nothing.
          if (
            result.streaming_data.adaptive_formats[0]?.url ||
              result.streaming_data.adaptive_formats[0]?.signature_cipher ||
              result.streaming_data.adaptive_formats[0]?.cipher
          ) {
            try {
              const manifestSrc = await this.createLocalDashManifest(result, true)
              if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
              this.manifestSrc = manifestSrc
              this.manifestMimeType = MANIFEST_TYPE_DASH
              useRemoteManifest = false
            } catch (error) {
              if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
              console.error(`Failed to generate DASH manifest for this Post Live DVR video ${this.videoId}, falling back to using YouTube's provided one...`, error)
            }
          }
        }

        if (useRemoteManifest) {
          if (result.streaming_data?.dash_manifest_url) {
            this.manifestSrc = result.streaming_data.dash_manifest_url
            this.manifestMimeType = MANIFEST_TYPE_DASH
          } else {
            // A blocked live player response can contain all watch-page metadata
            // without either manifest URL. Keep the missing source as `null`, as
            // expected by the player availability checks, while yt-dlp extracts
            // its independent HLS manifest.
            this.manifestSrc = result.streaming_data?.hls_manifest_url ?? androidLiveHlsManifestUrl
            this.manifestMimeType = MANIFEST_TYPE_HLS
          }
        }

        this.streamingDataExpiryDate = result.streaming_data?.expires ?? null

        if (this.activeFormat === 'legacy') {
          this.activeFormat = 'dash'
        }
      } else if (this.isUpcoming) {
        const upcomingTimestamp = result.basic_info.start_timestamp

        if (upcomingTimestamp) {
          const now = new Date()
          this.premiereDate = upcomingTimestamp
          this.updateUpcomingTimestamp()

          let upcomingTimeLeft = upcomingTimestamp - now

          // Convert from ms to second to minute
          upcomingTimeLeft = (upcomingTimeLeft / 1000) / 60
          let timeUnit = 'minute'

          // Youtube switches to showing time left in minutes at 120 minutes remaining
          if (upcomingTimeLeft > 120) {
            upcomingTimeLeft /= 60
            timeUnit = 'hour'
          }

          if (timeUnit === 'hour' && upcomingTimeLeft > 24) {
            upcomingTimeLeft /= 24
            timeUnit = 'day'
          }

          // Value after decimal not to be displayed
          // e.g. > 2 days = display as `2 days`
          upcomingTimeLeft = Math.floor(upcomingTimeLeft)

          // Displays when less than a minute remains
          // Looks better than `Premieres in x seconds`
          if (upcomingTimeLeft < 1) {
            this.upcomingTimeLeft = this.t('Video.Published.In less than a minute').toLowerCase()
          } else {
            // TODO a I18n entry for time format might be needed here
            this.upcomingTimeLeft = new Intl.RelativeTimeFormat(this.currentLocale).format(upcomingTimeLeft, timeUnit)
          }

          this.scheduleLiveReminderStartInvalidation()
          this.syncLiveReminder(loadGeneration, videoId).catch(error => {
            console.error('Failed to load live stream reminder', error)
          })
        } else {
          this.upcomingTimestamp = null
          this.upcomingTimeLeft = null
          this.premiereDate = undefined
          this.scheduleLiveReminderStartInvalidation()
        }
      }

      if ((!this.isUpcoming && !this.isLive && !this.isPostLiveDvr) || (this.isUpcoming && this.playabilityStatus === 'OK')) {
        this.videoLengthSeconds = result.basic_info.duration
        if (result.streaming_data) {
          this.streamingDataExpiryDate = result.streaming_data.expires

          if (result.streaming_data.formats.length > 0) {
            this.legacyFormats = result.streaming_data.formats.map(mapLocalLegacyFormat)
          }

          if (result.captions) {
            const captionTranslationLanguages = result.captions.translation_languages ?? []
            const captionTracks = result.captions?.caption_tracks?.map((caption) => {
              const url = new URL(caption.base_url)
              url.searchParams.set('fmt', 'vtt')

              return {
                id: caption.vss_id,
                url: url.toString(),
                label: caption.name.text,
                language: caption.language_code,
                mimeType: 'text/vtt'
              }
            }) ?? []

            this.$store.commit('setYouTubeCaptionLanguageCodes', captionTranslationLanguages)
            this.captionTranslations = captionTranslationLanguages.map(language =>
              this.getTranslatedCaption(result.captions, language)
            ).filter(Boolean)

            if (captionTracks.length > 0) {
              const languagesSet = new Set([this.preferredCaptionLocale, this.preferredCaptionLocale.split('-')[0]])

              // special cases
              switch (this.preferredCaptionLocale) {
                case 'nn':
                case 'nb-NO':
                  // according to https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
                  // "no" is the macro language for "nb" and "nn"
                  languagesSet.add('no')
                  break
                case 'he':
                  // according to https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
                  // "iw" is the old/original code for Hewbrew, these days it's "he"
                  languagesSet.add('iw')
                  break
              }

              const hasPreferredCaption = findCaptionByLocale(captionTracks, this.preferredCaptionLocale) ||
                  captionTracks.some(captionTrack => languagesSet.has(captionTrack.language))

              if (!hasPreferredCaption) {
                const translatedCaptionTrack = this.getTranslatedLocaleCaption(result.captions, languagesSet)

                if (translatedCaptionTrack) {
                  captionTracks.push(translatedCaptionTrack)
                }
              }
            }

            this.captions = sortCaptions(captionTracks, this.preferredCaptionLocale)
          }
        } else if (
          this.restrictedPlaybackError === null &&
            !this.isYtDlpPlaybackRequested()
        ) {
          // video might be region locked or something else. This leads to no formats being available
          this.showTabToast({
            message: this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.'),
            time: 7000,
            icon: ['fas', 'circle-exclamation'],
          })
          this.handleVideoEnded()
          return
        } else if (this.restrictedPlaybackError === null) {
          console.warn('Built-in metadata has no streams; continuing so yt-dlp can provide the playback source')
        }

        let storyboard

        if (result.storyboards?.type === 'PlayerStoryboardSpec') {
          /** @type {import('youtubei.js/dist/src/parser/classes/PlayerStoryboardSpec').StoryboardData[]} */
          let source = result.storyboards.boards
          if (window.innerWidth < 500) {
            source = source.filter((board) => board.thumbnail_height <= 90)
          }

          storyboard = source.at(-1)
          this.videoStoryboardSrc = this.createLocalStoryboardUrls(storyboard)
        }

        if (this.restrictedPlaybackError === null && result.streaming_data?.adaptive_formats.length > 0) {
          this.vrProjection = result.streaming_data.adaptive_formats
            .find(format => {
              return format.has_video &&
                  typeof format.projection_type === 'string' &&
                  format.projection_type !== 'RECTANGULAR'
            })
            ?.projection_type ?? null

          if (
            poToken &&
              videoInfo.info.streaming_data?.server_abr_streaming_url &&
              videoInfo.info.player_config.media_common_config.media_ustreamer_request_config
          ) {
            const storyboards = storyboard
              ? [{
                  templateUrl: storyboard.template_url,
                  mimeType: 'image/webp',
                  columns: storyboard.columns,
                  rows: storyboard.rows,
                  thumbnailCount: storyboard.thumbnail_count,
                  thumbnailWidth: storyboard.thumbnail_width,
                  thumbnailHeight: storyboard.thumbnail_height,
                  storyboardCount: storyboard.storyboard_count,
                  interval: storyboard.interval > 0 ? storyboard.interval / 1000 : 0
                }]
              : []

            this.manifestSrc = this.createLocalSabrManifest(result, poToken, clientInfo, storyboards)
            this.manifestMimeType = MANIFEST_TYPE_SABR
          } else if (
            result.streaming_data.adaptive_formats[0]?.url ||
              result.streaming_data.adaptive_formats[0]?.signature_cipher ||
              result.streaming_data.adaptive_formats[0]?.cipher
          ) {
            const manifestSrc = await this.createLocalDashManifest(result)
            if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
            this.manifestSrc = manifestSrc
            this.manifestMimeType = MANIFEST_TYPE_DASH
          } else {
            // Neither a SABR streaming URL nor playable adaptive format URLs,
            // so the only thing left is the 360p legacy stream. This is a
            // silent quality drop, so make it identifiable in the logs.
            console.error(`No SABR or adaptive stream URLs for ${this.videoId}, falling back to the legacy formats...`)
            this.manifestSrc = null
            this.enableLegacyFormat()
          }
        } else if (this.restrictedPlaybackError === null) {
          console.error(`No adaptive formats for ${this.videoId}, falling back to the legacy formats...`)
          this.manifestSrc = null
          this.enableLegacyFormat()
        }
      }

      if (!this.isUpcoming && this.restrictedPlaybackError === null) {
        if (!this.applyDownloadedPlaybackSource()) {
          this.alignActiveFormatWithAvailableSources()

          // Deliberately not awaited, so that the metadata (title, description,
          // comments, recommendations, ...) is shown while yt-dlp is still extracting.
          this.applyYtDlpPlaybackSource(loadGeneration, videoId)
        }
      }

      this.updateShortsPlayerState(
        result.basic_info.duration,
        result.streaming_data?.adaptive_formats
      )
      if (this.customShortsPlayerActive) {
        this.thumbnail = getShortThumbnailUrl(
          this.currentSubscriptionShort ?? { videoId: this.videoId },
          this.backendPreference,
          this.currentInvidiousInstanceUrl,
          this.thumbnailPreference
        ) ?? this.thumbnail
      }
      if (this.isShort) {
        this.loadLocalShortLinkedVideo(this.videoId)
      }
      this.isLoading = false
      this.updateTitle()
    } catch (err) {
      if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

      let handledError = err
      if (err.isIpBlock) {
        this.ipBlockDetectedInCurrentChain = true
        handledError = new Error(this.t('Video.IP block'), { cause: err })
      }

      console.error(handledError)
      await videoApi.loadWatchMetadata(this.backendPreference, {
        failedProvider: 'local',
        error: handledError,
        localAvailable: process.env.SUPPORTS_LOCAL_API,
        fallbackEnabled: this.backendFallback,
        loadLocal: () => this.getVideoInformationLocal(loadGeneration),
        loadInvidious: () => this.getVideoInformationInvidious(loadGeneration),
        onFallback: () => {
          const errorMessage = this.t('Local API Error (Click to copy)')
          showApiErrorToast(errorMessage, handledError, this.showTabToast)
          this.showTabToast({ message: this.t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
        },
        onNoProvider: async () => {
          const didReload = await this.runIpBlockRecoveryScriptAndReload()
          if (!this.isCurrentVideoLoad(loadGeneration, videoId) || didReload) return
          if (this.finishDownloadedPlaybackWithoutMetadata()) return
          this.isLoading = false
          if (!this.thumbnail) this.thumbnail = this.getUnavailableVideoThumbnail()
          this.errorMessage = handledError.message || handledError.toString()
        },
      })
    }
  },

  getVideoInformationInvidious: async function (loadGeneration = ++this.videoLoadGeneration) {
    if (this.firstLoad) {
      this.isLoading = true
    }

    const videoId = this.tabRoute.params.id
    await initializeNetworkRecovery().ready
    if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return
    if (getConnectionState() === 'offline' && this.finishDownloadedPlaybackWithoutMetadata()) return

    videoApi.getWatchVideoInformation(videoId, 'invidious', {
      videoId,
      instanceUrl: this.currentInvidiousInstanceUrl,
      thumbnailPreference: this.thumbnailPreference,
    })
      .then(async ({ metadata, source: result }) => {
        if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

        if (result.error) {
          throw new Error(result.error)
        }

        this.videoTitle = metadata.title
        this.hasResolvedVideoTitle = this.videoTitle.length > 0
        this.videoViewCount = metadata.viewCount
        this.hasPaidPromotion = result.paid
        this.channelSubscriptionCountText = Number.isFinite(metadata.subscriberCount)
          ? formatNumber(metadata.subscriberCount, metadata.subscriberCount >= 10000 ? { notation: 'compact' } : undefined)
          : ''

        if (this.hideVideoLikesAndDislikes) {
          this.videoLikeCount = null
          this.videoDislikeCount = null
        } else {
          this.videoLikeCount = metadata.likeCount
          this.videoDislikeCount = metadata.dislikeCount
          if (this.useReturnYouTubeDislikes) this.fetchVideoDislikes()
        }

        this.videoCategory = metadata.category
        this.videoTags = metadata.tags
        this.videoGenreIsMusic = this.videoCategory === 'Music'
        this.musicMediaType = metadata.musicMediaType
        this.channelId = metadata.channel.id
        this.channelName = metadata.channel.name
        this.channelCollaborators = metadata.collaborators
        this.channelThumbnail = metadata.channel.thumbnail
        this.$store.commit('setVideoAvatar', {
          videoId: this.videoId,
          avatar: this.channelThumbnail
        })
        this.setTabAvatar(this.channelThumbnail)
        this.updateSubscriptionDetails({
          channelThumbnailUrl: metadata.channel.originalThumbnail || undefined,
          channelName: this.channelName,
          channelId: this.channelId
        })
        this.initializePlaybackRate()
        this.initializeVideoQuality()
        this.videoPublished = metadata.published
        this.videoDescription = metadata.description
        this.videoDescriptionHtml = result.descriptionHtml
        this.recommendedVideos = metadata.recommendedVideos.sort(this.sortWatchedVideosLast)
        this.isLive = metadata.isLive
        this.isPremiere = metadata.isPremiere
        this.isFamilyFriendly = metadata.familyFriendly
        this.isPostLiveDvr = metadata.isPostLiveDvr
        this.isUnlisted = metadata.isUnlisted

        this.captions = sortCaptions(metadata.captions, this.preferredCaptionLocale)

        if (!this.isLive && !this.isPostLiveDvr) {
          this.videoStoryboardSrc = `${this.currentInvidiousInstanceUrl}/api/v1/storyboards/${this.videoId}?height=90`
        }

        this.thumbnail = metadata.thumbnail

        let chapters = []
        if (!this.hideChapters) {
          chapters = this.extractChaptersFromDescription(result.description)

          if (chapters.length > 0) {
            this.finalizeChapters(chapters, result.lengthSeconds)
          } else {
            chapters = await this.getSponsorBlockCommunityChapters(result.lengthSeconds)
            if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
          }
        }
        this.videoChapters = chapters
        this.videoChaptersKind = 'chapters'

        if (this.isLive || this.isPostLiveDvr) {
          // The live DASH manifest is currently unusable as it returns 403s after 1 minute of playback
          // so we have to use the HLS one for now.
          // Leaving the code here commented out in case we can use it again in the future
          // const url = `${this.currentInvidiousInstanceUrl}/api/manifest/dash/id/${this.videoId}`

          // // Proxying doesn't work for live or post live DVR DASH, so use HLS instead
          // // https://github.com/iv-org/invidious/pull/4589
          // if (this.proxyVideos) {

          this.streamingDataExpiryDate = this.extractExpiryDateFromStreamingUrl(result.adaptiveFormats[0].url)

          let hlsManifestUrl = result.hlsUrl

          if (this.proxyVideos) {
            const url = new URL(hlsManifestUrl)
            url.searchParams.set('local', 'true')
            hlsManifestUrl = url.toString()
          }

          this.manifestSrc = hlsManifestUrl
          this.manifestMimeType = MANIFEST_TYPE_HLS

          // The HLS manifests only contain combined audio+video streams, so we can't do audio only
          if (this.activeFormat === 'audio') {
            this.activeFormat = 'dash'
          }
          // } else {
          //   this.manifestSrc = url
          //   this.manifestMimeType = MANIFEST_TYPE_DASH
          // }

          this.legacyFormats = []

          if (this.activeFormat === 'legacy') {
            this.activeFormat = 'dash'
          }
        } else {
          this.videoLengthSeconds = result.lengthSeconds

          this.streamingDataExpiryDate = this.extractExpiryDateFromStreamingUrl(result.adaptiveFormats[0].url)

          this.legacyFormats = result.formatStreams.map(mapInvidiousLegacyFormat)

          if (!process.env.SUPPORTS_LOCAL_API || this.proxyVideos) {
            this.legacyFormats.forEach(format => {
              format.url = getProxyUrl(format.url)
            })
          }

          this.vrProjection = result.adaptiveFormats
            .find(stream => {
              return typeof stream.projectionType === 'string' &&
                  stream.projectionType !== 'RECTANGULAR'
            })
            ?.projectionType ?? null

          const manifestSrc = await this.createInvidiousDashManifest(result)
          if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
          this.manifestSrc = manifestSrc
          this.manifestMimeType = MANIFEST_TYPE_DASH
        }

        if (!this.isUpcoming) {
          if (!this.applyDownloadedPlaybackSource()) {
            this.alignActiveFormatWithAvailableSources()

            // Deliberately not awaited, so that the metadata (title, description,
            // comments, recommendations, ...) is shown while yt-dlp is still extracting.
            this.applyYtDlpPlaybackSource(loadGeneration, videoId)
          }
        }

        this.updateShortsPlayerState(result.lengthSeconds, result.adaptiveFormats)
        if (this.customShortsPlayerActive) {
          this.thumbnail = getShortThumbnailUrl(
            this.currentSubscriptionShort ?? { videoId: this.videoId },
            this.backendPreference,
            this.currentInvidiousInstanceUrl,
            this.thumbnailPreference
          ) ?? this.thumbnail
        }
        this.updateTitle()

        this.isLoading = false
      })
      .catch(async err => {
        if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

        console.error(err)
        videoApi.loadWatchMetadata(this.backendPreference, {
          failedProvider: 'invidious',
          error: err,
          localAvailable: process.env.SUPPORTS_LOCAL_API,
          fallbackEnabled: this.backendFallback,
          loadLocal: () => this.getVideoInformationLocal(loadGeneration),
          loadInvidious: () => this.getVideoInformationInvidious(loadGeneration),
          onFallback: () => {
            const errorMessage = this.t('Invidious API Error (Click to copy)')
            showApiErrorToast(errorMessage, err, this.showTabToast)
            this.showTabToast({ message: this.t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
          },
          onNoProvider: async () => {
            const restrictedPlaybackError = this.getRestrictedPlaybackErrorType(err.message || err.toString())
            if (restrictedPlaybackError !== null) {
              this.isLoading = false
              this.thumbnail ||= this.getUnavailableVideoThumbnail()
              this.setRestrictedPlaybackError(restrictedPlaybackError)
              return
            }

            const didReload = await this.runIpBlockRecoveryScriptAndReload()
            if (!this.isCurrentVideoLoad(loadGeneration, videoId) || didReload) return
            if (this.finishDownloadedPlaybackWithoutMetadata()) return
            this.isLoading = false
            if (!this.thumbnail) this.thumbnail = this.getUnavailableVideoThumbnail()
            this.errorMessage = err.message || err.toString()
          },
        })
      })
  },
}
