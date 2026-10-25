import { markRaw } from 'vue'
import { usesInvidiousApi } from '../../../../apiBackends'
import { getLocalShortLinkedVideo, getLocalVideoInfo } from '../../../helpers/api/local'
import { invidiousGetVideoInformation } from '../../../helpers/api/invidious'
import { applyAnimationSpeed } from '../../../helpers/animationSpeed'
import { isHistoryEntryWatched } from '../../../helpers/history'
import { getConnectionState, initializeNetworkRecovery } from '../../../helpers/networkRecovery'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../../helpers/overlayScrollbars'
import {
  buildSubscriptionShortsFeed,
  getChannelShortsNavigationContext,
  getShortsPlaybackWindow,
  getVideoAspectRatio,
  isYouTubeShort
} from '../../../helpers/player/shorts'
import { isReducedMotionEnabled } from '../../../helpers/reducedMotion'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../../helpers/restricted-playback'
import { isVideoHiddenByPreferences } from '../../../helpers/subscriptions'
import { getShortThumbnailUrl, isUnloadedBackgroundTabClick, openInternalPath } from '../../../helpers/utils'
import { supportsYtDlp } from '../../../helpers/ytDlpCapabilities'

/**
 * OpenTubeX Shorts player state: the subscription or channel feed around the
 * current Short, its player size, and which Shorts panels are open.
 * Spread into the Watch view's `computed`.
 */
export const watchShortsComputed = {
  shortsPhonePanelsEnabled() {
    return this.phoneLayout && this.portraitLayout && this.customShortsPlayerActive
  },
  customShortsPlayerActive: function () {
    return this.useCustomShortsPlayerForCurrentVideo &&
      this.isShort &&
      this.activeFormat !== 'audio'
  },
  isStandaloneShort: function () {
    return this.isShort && !this.watchingPlaylist
  },
  shortsPlayerWidth: function () {
    const playerHeight = Math.max(0, this.shortsViewportHeight - 156)
    return Math.min(600, playerHeight * (this.videoAspectRatio ?? 9 / 16))
  },
  shortsPlayerHeight: function () {
    return this.shortsPlayerWidth / (this.videoAspectRatio ?? 9 / 16)
  },
  subscriptionShortsFeedActive: function () {
    return this.customShortsPlayerActive
  },
  subscriptionShortsFeed: function () {
    if (!this.subscriptionShortsFeedActive) {
      return []
    }

    let feed
    if (
      this.tabRoute.query.shortSource === 'channel' &&
      this.tabRoute.query.shortChannelId
    ) {
      feed = getChannelShortsNavigationContext(
        this.tabRoute.query.shortChannelId
      )
    } else {
      const maxPerChannel = this.$store.getters.getOnlyShowLatestFromChannel
        ? this.$store.getters.getOnlyShowLatestFromChannelNumber
        : null

      feed = buildSubscriptionShortsFeed({
        cache: this.$store.getters.getShortsCache,
        subscriptions: this.$store.getters.getActiveProfile.subscriptions,
        isHidden: video => isVideoHiddenByPreferences(video, {
          hideLiveStreams: this.$store.getters.getHideLiveStreams,
          hideUpcomingPremieres: this.$store.getters.getHideUpcomingPremieres,
          forbiddenTitles: this.forbiddenTitles,
        }),
        isWatched: video => isHistoryEntryWatched(
          this.$store.getters.getHistoryCacheById[video.videoId]
        ),
        hideWatched: this.$store.getters.getHideWatchedSubs,
        restrictedPlaybackConfigured: hasConfiguredRestrictedPlaybackAuthentication(this.$store.getters),
        maxPerChannel,
        currentVideoId: this.videoId,
      })
    }

    if (
      this.videoId &&
      !feed.some(video => video.videoId === this.videoId)
    ) {
      feed.unshift({
        videoId: this.videoId,
        title: this.videoTitle,
        author: this.channelName,
        authorId: this.channelId,
        published: this.videoPublished,
        isShort: true,
      })
    }

    return feed
  },
  subscriptionShortsFeedIndex: function () {
    return this.subscriptionShortsFeed.findIndex(video => video.videoId === this.videoId)
  },
  shortsPlaybackWindow: function () {
    return getShortsPlaybackWindow(this.subscriptionShortsFeed, this.videoId)
  },
  shortsPreloadKey: function () {
    return JSON.stringify([
      this.customShortsPlayerActive,
      this.videoId,
      this.shortsPlaybackWindow,
      this.backendPreference,
      this.apiServerUrl,
      this.videoPlaybackEngine,
      this.playbackEngineFallbackTarget,
      this.ytDlpPlaybackCacheKey,
      this.alwaysUseYtDlpPlaybackCookies,
    ])
  },
  hasPreviousSubscriptionShort: function () {
    return this.subscriptionShortsFeedIndex > 0
  },
  hasNextSubscriptionShort: function () {
    return this.subscriptionShortsFeedIndex >= 0 &&
      this.subscriptionShortsFeedIndex < this.subscriptionShortsFeed.length - 1
  },
  nextSubscriptionShort: function () {
    return this.hasNextSubscriptionShort
      ? this.subscriptionShortsFeed[this.subscriptionShortsFeedIndex + 1]
      : null
  },
  currentSubscriptionShort: function () {
    return this.subscriptionShortsFeedIndex >= 0
      ? this.subscriptionShortsFeed[this.subscriptionShortsFeedIndex]
      : null
  },
  nextSubscriptionShortThumbnail: function () {
    if (!this.nextSubscriptionShort) {
      return ''
    }

    return getShortThumbnailUrl(
      this.nextSubscriptionShort,
      this.backendPreference,
      this.currentInvidiousInstanceUrl,
      this.thumbnailPreference,
      this.$store.getters.getThumbnailDataSaver
    ) ?? ''
  },
  shortsCommentsPanelOpen: function () {
    return this.shortsCommentsOpen && !this.fullscreenCommentsOpen && !this.shortsPhonePanelsEnabled
  },
  shortsCommentsText: function () {
    return this.shortsCommentsOpen
      ? this.$t('Comments.Hide Comments')
      : this.$t('Comments.Show Comments')
  },
  shortsAuxPanelOpen: function () {
    return this.customShortsPlayerActive && !this.shortsPhonePanelsEnabled && (
      this.shortsMetadataOpen ||
      this.showTranscript ||
      this.showSidebarSponsorBlock
    )
  },
  shortsNavigationPanelOpen: function () {
    return this.customShortsPlayerActive && (
      this.shortsCommentsOpen ||
      this.shortsAuxPanelOpen ||
      this.fullscreenMetadataOpen ||
      this.fullscreenTranscriptOpen ||
      this.fullscreenSponsorBlockOpen ||
      this.fullscreenCommentsOpen ||
      this.fullscreenLiveChatOpen ||
      this.fullscreenPlaylistOpen || this.fullscreenQueueOpen || this.fullscreenRecommendationsOpen
    )
  },
  shortsActionSkeletonCount: function () {
    return [
      !this.hideComments,
      true,
      this.useSponsorBlock,
      !this.hideSharingActions,
      this.showPlaylists,
      this.isQuickBookmarkEnabled,
    ].filter(Boolean).length
  },
}

/**
 * OpenTubeX Shorts player: feed navigation by swipe, wheel, scroll and
 * keyboard, preloading of nearby Shorts, and the Shorts side and phone panels.
 * Spread into the Watch view's `methods`.
 */
export const watchShortsMethods = {
  openShortsPhonePanel(panel) {
    if (!this.shortsPhonePanelsEnabled) return
    this.shortsMetadataOpen = false
    this.shortsCommentsOpen = false
    if (panel !== 'transcript') this.showTranscript = false
    if (panel !== 'sponsorBlock' && this.showSidebarSponsorBlock) this.closeSidebarSponsorBlock()
    if (panel === 'sponsorBlock' && !this.showSidebarSponsorBlock) this.$refs.player?.toggleSponsorBlockInfo()
    this.openPhonePanel(panel)
    if (panel === 'comments') this.shortsCommentsOpen = true
    if (panel === 'metadata') this.shortsMetadataOpen = true
  },
  closeShortsPhonePanel() {
    if (this.mobilePanel === 'sponsorBlock') this.closeSidebarSponsorBlock()
    if (this.mobilePanel === 'transcript') this.closeTranscript()
    this.shortsMetadataOpen = false
    this.shortsCommentsOpen = false
    this.mobilePanel = null
  },
  getShortsExtractionKey(videoId, backend = this.backendPreference) {
    return JSON.stringify([
      backend,
      usesInvidiousApi(backend) ? this.apiServerUrl : '',
      // Proxying decides whether the stream URLs point at the server or at YouTube
      backend === 'yattee' && this.$store.getters.getYatteeProxyVideos,
      backend === 'local' && process.env.IS_CAPACITOR && this.isYtDlpPlaybackRequested(),
      videoId,
    ])
  },
  getShortsVideoInformation(videoId, backend = this.backendPreference, reloadPlaybackContext = undefined) {
    const useYtDlp = this.isYtDlpPlaybackRequested()
    const key = this.getShortsExtractionKey(videoId, backend)
    if (reloadPlaybackContext) this.shortsPlaybackCache.delete(key)
    return this.shortsPlaybackCache.get(key, () => {
      if (usesInvidiousApi(backend)) {
        return invidiousGetVideoInformation(videoId).then(result => {
          if (result.error) throw new Error(result.error)
          return result
        })
      }
      return getLocalVideoInfo(videoId, {
        reloadPlaybackContext,
        shouldGeneratePoToken: () => !process.env.IS_CAPACITOR || !useYtDlp
      }).then(result => {
        if (result.watchPageIpBlocked || result.info?.playability_status?.status !== 'OK') {
          // Recovery and opening a preloaded failure require fresh metadata.
          this.shortsPlaybackCache.delete(key)
        }
        return result
      })
    })
  },
  async preloadShortsPlaybackWindow() {
    const generation = ++this.shortsPreloadGeneration
    const { previous, next } = this.shortsPlaybackWindow
    const visitedPrevious = previous.filter(id => this.shortsPlaybackCache.hasPosition(id))
    const nearby = [...new Set([...next, ...visitedPrevious.reverse()])]
    const videoIds = [...new Set([...previous, this.videoId, ...next])]
    this.shortsPlaybackCache.retain(
      this.customShortsPlayerActive ? videoIds.map(id => this.getShortsExtractionKey(id)) : [],
      this.customShortsPlayerActive ? videoIds : []
    )
    if (!this.customShortsPlayerActive || nearby.length === 0) return

    await initializeNetworkRecovery().ready
    if (generation !== this.shortsPreloadGeneration || getConnectionState() === 'offline') return

    // Metadata extraction is needed for both playback engines. Two workers
    // keep the next Short close without flooding the local or Invidious API.
    let nextIndex = 0
    const worker = async () => {
      while (nextIndex < nearby.length && generation === this.shortsPreloadGeneration) {
        const videoId = nearby[nextIndex++]
        try {
          await this.getShortsVideoInformation(videoId)
        } catch (error) {
          console.warn(`Could not preload Short ${videoId}`, error)
        }
      }
    }
    const metadataPreload = Promise.all([worker(), worker()])

    if (supportsYtDlp && this.videoPlaybackEngine === 'yt-dlp') {
      this.preloadUpcomingYtDlpPlaybackSources(nearby)
    }
    await metadataPreload
  },
  updateShortsViewportHeight() {
    this.resetShortsSwipe()
    this.shortsViewportHeight = window.innerHeight
    requestAnimationFrame(() => this.clampShortsErrorScroll())
    if (this.shortsAuxPanelOpen) {
      this.clampShortsAuxPanelScroll()
    }
  },
  clampShortsErrorScroll() {
    const container = this.$refs.errorContainer
    if (!container) return
    const content = container.querySelector('.errorWrapper')
    // Chromium can already reset the offset when an error becomes shorter,
    // while OverlayScrollbars still retains the previous overflow range.
    clampOverlayScrollTop(container, content)
  },
  closeShortsComments() {
    this.shortsCommentsOpen = false
  },
  toggleShortsMetadata() {
    if (this.shortsPhonePanelsEnabled) {
      if (this.mobilePanel === 'metadata') this.closeShortsPhonePanel()
      else this.openShortsPhonePanel('metadata')
      return
    }
    const shouldOpen = !this.shortsMetadataOpen
    if (shouldOpen) {
      this.resetShortsAuxPanelScroll()
    }
    this.shortsMetadataOpen = shouldOpen

    if (!shouldOpen) {
      this.clampShortsAuxPanelScroll()
    }

    if (shouldOpen) {
      if (this.showTranscript) {
        this.closeTranscript()
      }
      if (this.showSidebarSponsorBlock) {
        this.closeSidebarSponsorBlock()
      }
      this.closeShortsComments()
    }
  },
  resetShortsAuxPanelScroll() {
    const target = this.$refs.shortsAuxPanelTarget
    if (target != null) {
      restoreOverlayScrollTop(target, 0)
      this.$nextTick(() => {
        requestAnimationFrame(() => restoreOverlayScrollTop(target, 0))
      })
    }
  },
  clampShortsAuxPanelScroll() {
    this.$nextTick(() => {
      requestAnimationFrame(() => {
        const target = this.$refs.shortsAuxPanelTarget
        const content = this.$refs.shortsAuxPanelContentEnd
        if (target != null && content != null) {
          clampOverlayScrollTop(target, content)
        }
      })
    })
  },

  updateShortsPlayerState: function (duration, formats) {
    const shortQuery = this.tabRoute.query.short
    const explicit = shortQuery === 'true'
      ? true
      : shortQuery === 'false'
        ? false
        : null
    const sourceAspectRatio = getVideoAspectRatio(formats)
    this.isShort = isYouTubeShort({ explicit, duration, formats })

    this.videoAspectRatio = this.isShort
      ? sourceAspectRatio !== null && sourceAspectRatio <= 1
        ? sourceAspectRatio
        : 9 / 16
      : sourceAspectRatio
  },

  loadLocalShortLinkedVideo: async function (videoId) {
    try {
      const linkedVideo = await getLocalShortLinkedVideo(videoId)

      if (this.videoId === videoId && this.isShort) {
        this.shortsLinkedVideo = linkedVideo
      }
    } catch (error) {
      console.warn('Failed to load linked Shorts video metadata', error)
    }
  },

  updateShortThumbnail: function () {
    if (!this.customShortsPlayerActive) { return }

    this.thumbnail = getShortThumbnailUrl(
      this.currentSubscriptionShort ?? { videoId: this.videoId },
      this.backendPreference,
      this.currentInvidiousInstanceUrl,
      this.thumbnailPreference,
      this.$store.getters.getThumbnailDataSaver
    ) ?? this.thumbnail
  },

  navigateSubscriptionShort: function (offset) {
    if (
      !this.subscriptionShortsFeedActive ||
      this.shortsSwipeSettling ||
      Date.now() < this.shortsNavigationLockedUntil
    ) {
      return
    }

    const target = this.subscriptionShortsFeed[this.subscriptionShortsFeedIndex + offset]
    if (!target) {
      return
    }

    this.saveShortsPlaybackPosition()

    this.shortsTransitionDirection = Math.sign(offset)
    this.shortsTransitionPreview = getShortThumbnailUrl(
      target,
      this.backendPreference,
      this.currentInvidiousInstanceUrl,
      this.thumbnailPreference,
      this.$store.getters.getThumbnailDataSaver
    ) ?? ''
    this.shortsNavigationLockedUntil = Date.now() + 300
    const shortSource = this.tabRoute.query.shortSource === 'channel'
      ? 'channel'
      : 'subscriptions'
    this.tabRouter.push({
      path: `/watch/${target.videoId}`,
      query: {
        short: 'true',
        shortSource,
        ...(shortSource === 'channel'
          ? { shortChannelId: this.tabRoute.query.shortChannelId }
          : {}),
        ...(this.musicMode
          ? {}
          : { oneTimeTimestamp: String(this.shortsPlaybackCache.getPosition(target.videoId)) }),
      }
    })
  },

  saveShortsPlaybackPosition() {
    if (!this.customShortsPlayerActive) return
    const player = this.$refs.player
    if (player?.hasPlaybackPosition) {
      this.shortsPlaybackCache.savePosition(this.videoId, player.getCurrentTime())
    }
  },

  handleShortsWindowScroll: function () {
    const scrollY = window.scrollY

    const logicalTabSelected = !process.env.IS_ELECTRON ||
      this.tabId == null ||
      this.$store.getters.getActiveTabId === this.tabId

    if (
      !this.subscriptionShortsFeedActive ||
      !this.isCurrentlyPresented() ||
      !logicalTabSelected
    ) {
      this.shortsLastWindowScrollY = scrollY
      return
    }

    if (this.shortsScrollResetPending) {
      this.shortsScrollResetPending = false
      this.shortsLastWindowScrollY = scrollY
      return
    }

    if (Math.abs(scrollY - this.shortsLastWindowScrollY) < 4) {
      this.shortsLastWindowScrollY = scrollY
      return
    }

    const movedDown = scrollY > this.shortsLastWindowScrollY
    this.shortsLastWindowScrollY = scrollY

    // The document starts at its upper boundary, so native document
    // scrolling can only intentionally advance the feed. A decrease is our
    // own reset or tab scroll restoration; wheel, touch, and keyboard input
    // handle navigation to the previous Short directly.
    if (!movedDown) {
      return
    }

    this.navigateSubscriptionShort(1)

    // The short preview deliberately gives the document a small scroll range
    // so the page scrollbar and middle-button autoscroll can navigate. Reset
    // it after interpreting the movement; otherwise the next movement at the
    // end of the range cannot emit another scroll event.
    if (window.scrollY !== 0) {
      this.shortsScrollResetPending = true
      window.scrollTo({ top: 0 })
    }
  },

  isShortsPanelEvent: function (event) {
    return Boolean(event.target?.closest?.(
      '.shortsCommentsPanel, .shortsAuxPanel, .shaka-no-propagation'
    ))
  },

  handleShortsWheel: function (event) {
    if (
      !this.subscriptionShortsFeedActive ||
      this.isShortsPanelEvent(event) ||
      Math.abs(event.deltaY) < 20
    ) {
      return
    }

    event.preventDefault()
    this.navigateSubscriptionShort(event.deltaY > 0 ? 1 : -1)
  },

  handleShortsPointerDown: function (event) {
    this.shortsSwipeSuppressClick = false
    if (
      this.subscriptionShortsFeedActive &&
      !this.shortsSwipeSettling &&
      Date.now() >= this.shortsNavigationLockedUntil &&
      !this.shortsNavigationPanelOpen &&
      !this.isShortsPanelEvent(event) &&
      !event.target?.closest?.('button, a, input, [role="slider"]') &&
      event.pointerType === 'touch' &&
      event.isPrimary
    ) {
      const presentationTarget = event.target?.closest?.('.ftVideoPlayer:is(.fullWindow, :fullscreen)')
      this.shortsSwipePresentationTarget = presentationTarget ? markRaw(presentationTarget) : null
      this.shortsSwipeHeight = (presentationTarget ?? this.$refs.shortsSwipeViewport).getBoundingClientRect().height
      this.shortsSwipePointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false }
    }
  },

  handleShortsPointerMove: function (event) {
    const pointer = this.shortsSwipePointer
    if (!pointer || pointer.id !== event.pointerId) return

    const distance = event.clientY - pointer.y
    if (!pointer.dragging) {
      if (Math.max(Math.abs(distance), Math.abs(event.clientX - pointer.x)) < 8) return
      if (Math.abs(event.clientX - pointer.x) > Math.abs(distance)) {
        this.resetShortsSwipe()
        return
      }
      pointer.dragging = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    event.preventDefault()
    this.shortsSwipeSuppressClick = true
    const direction = distance < 0 ? 1 : -1
    const target = this.subscriptionShortsFeed[this.subscriptionShortsFeedIndex + direction]
    if (direction !== this.shortsSwipeDirection) {
      this.shortsSwipeDirection = direction
      this.shortsSwipePreview = target
        ? getShortThumbnailUrl(
          target,
          this.backendPreference,
          this.currentInvidiousInstanceUrl,
          this.thumbnailPreference,
          this.$store.getters.getThumbnailDataSaver
        ) ?? ''
        : ''
    }
    this.shortsSwipeOffset = target
      ? Math.max(-this.shortsSwipeHeight, Math.min(this.shortsSwipeHeight, distance))
      : distance / (1 + Math.abs(distance) / 60)
  },

  handleShortsPointerUp: function (event) {
    const pointer = this.shortsSwipePointer
    if (!pointer || pointer.id !== event.pointerId) return
    if (!pointer.dragging) {
      this.resetShortsSwipe()
      return
    }
    this.handleShortsPointerMove(event)
    this.shortsSwipePointer = null
    event.preventDefault()
    event.stopPropagation()
    const target = this.subscriptionShortsFeed[this.subscriptionShortsFeedIndex + this.shortsSwipeDirection]
    this.settleShortsSwipe(Boolean(target) && Math.abs(event.clientY - pointer.y) >= 50)
  },

  handleShortsPointerCancel: function (event) {
    // Claiming a touch releases its implicit capture on the player surface.
    if (event.type === 'lostpointercapture' && event.target !== event.currentTarget) return
    if (this.shortsSwipePointer?.id !== event.pointerId) return
    this.shortsSwipePointer = null
    this.settleShortsSwipe(false)
  },

  handleShortsClick: function (event) {
    if (this.shortsSwipeSuppressClick && event.detail > 0) {
      event.preventDefault()
      event.stopPropagation()
      this.shortsSwipeSuppressClick = false
    }
  },

  async settleShortsSwipe(navigate) {
    const viewport = this.shortsSwipePresentationTarget ?? this.$refs.shortsSwipeViewport
    const direction = this.shortsSwipeDirection
    const from = this.shortsSwipeOffset
    const to = navigate ? -direction * this.shortsSwipeHeight : 0
    const reducedMotion = isReducedMotionEnabled()
    this.shortsSwipeSettling = true
    this.shortsSwipeOffset = to
    const animations = markRaw([])
    this.shortsSwipeAnimations = animations
    await this.$nextTick()
    if (this.shortsSwipeAnimations !== animations) return
    const surfaces = this.shortsSwipePresentationTarget
      ? [...viewport.children]
      : [...viewport.querySelectorAll(':scope > .videoPlayer, :scope > .shortsSwipePreview')]
    animations.push(...surfaces.map(element => {
      const previewOffset = element.classList.contains('shortsSwipePreview') ? direction * this.shortsSwipeHeight : 0
      // Keep the expanded container stationary, including the browser's fullscreen top layer.
      const translateContents = this.shortsSwipePresentationTarget && !previewOffset
      return applyAnimationSpeed(element.animate([
        translateContents ? { translate: `0 ${from}px` } : { transform: `translateY(${from + previewOffset}px)` },
        translateContents ? { translate: `0 ${to}px` } : { transform: `translateY(${to + previewOffset}px)` }
      ], { duration: reducedMotion ? 0 : 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }))
    }))
    try {
      await Promise.all(animations.map(animation => animation.finished))
    } catch {
      return // Resize, tab changes, and navigation cancel the old gesture.
    }
    if (this.shortsSwipeAnimations !== animations) return
    this.resetShortsSwipe()
    if (navigate) {
      this.navigateSubscriptionShort(direction)
      this.shortsTransitionDirection = 0
    }
  },

  resetShortsSwipe() {
    this.shortsSwipeAnimations.forEach(animation => animation.cancel())
    this.shortsSwipeAnimations = markRaw([])
    this.shortsSwipePresentationTarget = null
    this.shortsSwipePointer = null
    this.shortsSwipeOffset = 0
    this.shortsSwipeDirection = 0
    this.shortsSwipePreview = ''
    this.shortsSwipeSettling = false
  },

  handleShortsNavigationKeydown: function (event) {
    if (
      !this.subscriptionShortsFeedActive ||
      !this.isCurrentlyPresented() ||
      this.shortsNavigationPanelOpen ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName) ||
      event.target?.isContentEditable ||
      event.target?.closest?.('[role="dialog"], [role="menu"]')
    ) {
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault()
      this.navigateSubscriptionShort(1)
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault()
      this.navigateSubscriptionShort(-1)
    }
  },

  openShortsChannel: function (event) {
    if (!this.channelId || this.disableChannelLinks) {
      event?.preventDefault()
      return
    }

    this.openShortsInternalPath(event, {
      path: `/channel/${this.channelId}`,
      title: this.channelName
    })
  },

  openShortsLinkedVideo: function (event) {
    if (!this.shortsLinkedVideo?.videoId) {
      return
    }

    this.openShortsInternalPath(event, {
      path: `/watch/${this.shortsLinkedVideo.videoId}`,
      title: this.shortsLinkedVideo.title
    })
  },

  /**
   * Plain left clicks stay on the router-link. Electron needs this for
   * middle-click / Ctrl–Cmd / Shift so those open a tab or window.
   * @param {MouseEvent} event
   * @param {{ path: string, title: string }} destination
   */
  openShortsInternalPath: function (event, { path, title }) {
    if (!process.env.IS_ELECTRON) {
      return
    }

    const isMiddleClick = event?.type === 'auxclick' && event.button === 1
    const isModifiedClick = event?.type === 'click' &&
      (event.ctrlKey || event.metaKey || event.shiftKey)
    if (!isMiddleClick && !isModifiedClick) {
      return
    }

    event.preventDefault()
    openInternalPath({
      path,
      title,
      doCreateNewWindow: event.shiftKey,
      doCreateNewTab: !event.shiftKey,
      makeActive: !isMiddleClick,
      lazyLoad: isUnloadedBackgroundTabClick(event)
    })
  },

  toggleShortsComments: function () {
    if (this.shortsPhonePanelsEnabled) {
      if (this.mobilePanel === 'comments') this.closeShortsPhonePanel()
      else this.openShortsPhonePanel('comments')
      return
    }
    if (this.shortsCommentsPanelOpen) {
      this.shortsCommentsOpen = false
      return
    }

    if (this.$refs.shortsCommentsTarget) {
      this.shortsMetadataOpen = false
      if (this.showTranscript) {
        this.closeTranscript()
      }
      if (this.showSidebarSponsorBlock) {
        this.closeSidebarSponsorBlock()
      }
      this.shortsCommentsOpen = true
    }
  },
}
