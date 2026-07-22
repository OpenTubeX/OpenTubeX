<template>
  <div
    ref="videoLayout"
    class="videoLayout"
    :class="{
      ambientModeActive,
      isLoading,
      useTheatreMode: (useTheatreMode && !isLoading) || (isLoading && defaultViewingMode === 'theatre'),
      noSidebar: !theatrePossible
    }"
  >
    <div
      v-if="(isFamilyFriendly || !showFamilyFriendlyOnly)"
      class="videoArea"
    >
      <div class="videoAreaMargin">
        <div
          v-if="isLoading"
          class="videoPlayer videoPlayerPlaceholder ft-shimmer"
          data-tab-loading-indicator
        />
        <ft-shaka-video-player
          v-if="!isLoading && (!isUpcoming || playabilityStatus === 'OK') && !errorMessage"
          ref="player"
          :manifest-src="manifestSrc"
          :manifest-mime-type="manifestMimeType"
          :sabr-data="sabrData"
          :legacy-formats="legacyFormats"
          :start-time="startTimeSeconds"
          :captions="captions"
          :storyboard-src="videoStoryboardSrc"
          :annotations="videoAnnotations"
          :format="activeFormat"
          :thumbnail="thumbnail"
          :video-id="videoId"
          :playlist-id="playlistId"
          :chapters="videoChapters"
          :current-chapter-index="videoCurrentChapterIndex"
          :chapters-kind="videoChaptersKind"
          :chapters-src="chaptersSrc"
          :title="videoTitle"
          :theatre-possible="theatrePossible"
          :use-theatre-mode="useTheatreMode"
          :autoplay-possible="autoplayPossible"
          :autoplay-enabled="autoplayEnabled"
          :autoplay-countdown="autoplayCountdown"
          :auto-open-chapters="autoOpenChapters"
          :watching-playlist="watchingPlaylist"
          :vr-projection="vrProjection"
          :start-in-fullscreen="startNextVideoInFullscreen"
          :start-in-fullwindow="startNextVideoInFullwindow"
          :start-in-pip="startNextVideoInPip"
          :start-with-chapters="startNextVideoWithChapters"
          :start-with-fullscreen-metadata="startNextVideoWithFullscreenMetadata"
          :start-with-fullscreen-comments="startNextVideoWithFullscreenComments"
          :start-with-fullscreen-playlist="startNextVideoWithFullscreenPlaylist"
          :channel-id="channelId"
          :published="videoPublished"
          :is-live="isLive"
          :video-genre-is-music="videoGenreIsMusic"
          :current-playback-rate="currentPlaybackRate"
          :current-video-quality="currentVideoQuality"
          :delay-load-until-unix="adEndTimeUnixMs"
          :sponsor-block-auto-skip-disabled="sponsorBlockAutoSkipDisabled"
          :comments-available="!isLive && !hideComments"
          :resume-playback-after-sabr-reload="resumePlaybackAfterSabrReload"
          :sabr-reload-caption-index="sabrReloadCaptionIndex"
          :sabr-reload-playback-rate="sabrReloadPlaybackRate"
          class="videoPlayer"
          @error="handlePlayerError"
          @loaded="handleVideoLoaded"
          @timeupdate="handleTimeUpdate"
          @terminal-outro-started="handleTerminalOutroStarted"
          @ended="handlePlayerEnded"
          @pause="handleVideoPause"
          @toggle-theatre-mode="toggleTheatreMode"
          @toggle-autoplay="toggleAutoplay"
          @autoplay-cancel="abortAutoplayCountdown"
          @autoplay-play-now="playNextVideoNow"
          @playback-rate-updated="updatePlaybackRate"
          @playback-rate-user-set="handlePlaybackRateUserSet"
          @save-channel-playback-speed="handleChannelPlaybackSpeedManualSave"
          @video-quality-updated="updateVideoQuality"
          @video-quality-user-set="handleVideoQualityUserSet"
          @skip-to-next="handleSkipToNext"
          @skip-to-prev="handleSkipToPrev"
          @player-reload-requested="onPlayerReloadRequested"
          @resume-playback-after-sabr-reload-done="onResumePlaybackAfterSabrReloadDone"
          @fullscreen-metadata-change="handleFullscreenMetadataChange"
          @fullscreen-transcript-change="handleFullscreenTranscriptChange"
          @fullscreen-sponsorblock-change="handleFullscreenSponsorBlockChange"
          @fullscreen-comments-change="handleFullscreenCommentsChange"
          @fullscreen-playlist-change="handleFullscreenPlaylistChange"
          @add-to-playlist="addCurrentVideoToPlaylist"
          @chapters-overlay-change="handleChaptersOverlayChange"
          @chapter-thumbnails-change="handleChapterThumbnailsChange"
          @sponsorblock-info-change="handleSponsorBlockInfoChange"
        />
        <div
          v-if="!isLoading && (isUpcoming || errorMessage)"
          class="videoPlayer"
        >
          <img
            v-if="!isUpcoming || playabilityStatus !== 'OK'"
            :src="thumbnail"
            class="videoThumbnail"
            alt=""
          >
          <div
            v-if="isUpcoming"
            class="premiereDate"
            :class="{trailer: isUpcoming && playabilityStatus === 'OK'}"
          >
            <font-awesome-icon
              :icon="['fas', 'satellite-dish']"
              class="premiereIcon"
            />
            <p
              v-if="upcomingTimestamp !== null"
              class="premiereText"
            >
              <span
                class="premiereTextTimeLeft"
              >
                {{ $t("Video.Premieres") }} {{ upcomingTimeLeft }}
              </span>
              <br>
              <span
                class="premiereTextTimestamp"
              >
                {{ upcomingTimestamp }}
              </span>
            </p>
            <p
              v-else
              class="premiereText"
            >
              {{ $t("Video.Starting soon, please refresh the page to check again") }}
            </p>
          </div>
          <div
            v-else-if="errorMessage"
            class="errorContainer"
          >
            <div
              class="errorWrapper"
            >
              <font-awesome-icon
                :icon="customErrorIcon || ['fas', 'exclamation-circle']"
                aria-hidden="true"
                class="errorIcon"
              />
              <p
                class="errorMessage"
              >
                {{ errorMessage }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <ft-age-restricted
      v-if="(!isLoading && !isFamilyFriendly && showFamilyFriendlyOnly)"
      class="ageRestricted"
    />
    <div
      v-if="(isFamilyFriendly || !showFamilyFriendlyOnly)"
      class="infoArea"
    >
      <div
        v-if="isLoading"
        class="watchVideo infoSkeleton"
        aria-hidden="true"
      >
        <div class="skeletonLine skeletonTitle ft-shimmer" />
        <div class="skeletonInfoRow">
          <div class="skeletonAvatar ft-shimmer" />
          <div class="skeletonLine skeletonChannel ft-shimmer" />
        </div>
      </div>
      <Teleport
        :to="fullscreenMetadataTarget || 'body'"
        :disabled="!fullscreenMetadataOpen"
      >
        <watch-video-info
          v-if="!isLoading"
          :id="videoId"
          :title="videoTitle"
          :channel-id="channelId"
          :channel-name="channelName"
          :channel-thumbnail="channelThumbnail"
          :channel-collaborators="channelCollaborators"
          :published="videoPublished"
          :premiere-date="premiereDate"
          :subscription-count-text="channelSubscriptionCountText"
          :like-count="videoLikeCount"
          :dislike-count="videoDislikeCount"
          :category="videoCategory"
          :view-count="videoViewCount"
          :get-timestamp="getTimestamp"
          :is-live-content="isLiveContent"
          :is-live="isLive"
          :is-upcoming="isUpcoming"
          :playlist-id="playlistId"
          :get-playlist-state="getPlaylistState"
          :length-seconds="videoLengthSeconds"
          :video-thumbnail="thumbnail"
          :in-user-playlist="!!selectedUserPlaylist"
          :is-unlisted="isUnlisted"
          :has-ai-generated-content="hasAiGeneratedContent"
          :can-save-watched-progress="canSaveWatchProgress"
          :sponsor-block-panel-open="showSidebarSponsorBlock"
          :transcript-open="showTranscript"
          class="watchVideo"
          :class="{ theatreWatchVideo: useTheatreMode }"
          @change-format="handleFormatChange"
          @pause-player="pausePlayer"
          @save-watched-progress="handleWatchProgressManualSave"
          @save-channel-playback-speed="handleChannelPlaybackSpeedManualSave"
          @save-channel-video-quality="handleChannelVideoQualityManualSave"
          @toggle-sponsorblock-info="toggleSponsorBlockInfo"
          @toggle-transcript="toggleTranscript"
        />
        <watch-video-description
          v-if="!isLoading && !hideVideoDescription"
          :description="videoDescription"
          :description-html="videoDescriptionHtml"
          :license="license"
          class="watchVideo"
          :class="{ theatreWatchVideo: useTheatreMode }"
          @timestamp-event="changeTimestamp"
        />
      </Teleport>
    </div>
    <div
      v-if="(isFamilyFriendly || !showFamilyFriendlyOnly)"
      class="sidebarArea"
    >
      <div
        v-if="isLoading && watchingPlaylist"
        class="playlistSkeleton watchVideoSideBar watchVideoPlaylist"
        aria-hidden="true"
      >
        <div class="skeletonLine skeletonPlaylistTitle ft-shimmer" />
        <div class="skeletonLine skeletonPlaylistMeta ft-shimmer" />
        <div class="skeletonPlaylistProgress ft-shimmer" />
        <div class="skeletonPlaylistButtons">
          <div
            v-for="n in 3"
            :key="n"
            class="skeletonPlaylistButton ft-shimmer"
          />
        </div>
        <div class="skeletonPlaylistItems">
          <div
            v-for="n in 4"
            :key="n"
            class="skeletonPlaylistItem"
          >
            <div class="skeletonPlaylistIndex ft-shimmer" />
            <div class="skeletonPlaylistThumbnail ft-shimmer" />
            <div class="skeletonPlaylistDetails">
              <div class="skeletonPlaylistDetailLine ft-shimmer" />
              <div class="skeletonPlaylistDetailLine short ft-shimmer" />
              <div class="skeletonPlaylistDetailLine shorter ft-shimmer" />
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="isLoading && !hideRecommendedVideos"
        class="recommendationsSkeleton"
        aria-hidden="true"
      >
        <div
          v-for="n in 5"
          :key="n"
          class="skeletonRecommendation"
        >
          <div class="skeletonRecommendationThumbnail ft-shimmer" />
          <div class="skeletonRecommendationDetails">
            <div class="skeletonLine ft-shimmer" />
            <div class="skeletonLine short ft-shimmer" />
          </div>
        </div>
      </div>
      <transition name="chapters-panel">
        <div
          v-if="showSidebarChapters && !isLoading && videoChapters.length > 0"
          class="watchVideoSideBar watchVideoChaptersPanel"
        >
          <div class="chaptersPanelHeader">
            <h3 class="chaptersPanelTitle">
              {{ videoChaptersKind === 'keyMoments' ? $t('Chapters.Key Moments') : $t('Chapters.Chapters') }}
            </h3>
            <button
              type="button"
              class="chaptersPanelClose"
              :aria-label="$t('Chapters.Close Chapters')"
              :title="$t('Chapters.Close Chapters')"
              @click="closeSidebarChapters"
            >
              <font-awesome-icon :icon="['fas', 'xmark']" />
            </button>
          </div>
          <watch-video-chapters
            :chapters="videoChapters"
            :chapter-thumbnails="videoChapterThumbnails"
            :current-chapter-index="videoCurrentChapterIndex"
            :fallback-thumbnail="thumbnail"
            @copy-timestamp="copyChapterTimestamp"
            @timestamp-event="changeTimestamp"
          />
        </div>
      </transition>
      <Teleport
        :to="fullscreenSponsorBlockTarget || 'body'"
        :disabled="!fullscreenSponsorBlockOpen"
      >
        <transition name="sponsorblock-panel">
          <watch-video-sponsor-block
            v-if="showSidebarSponsorBlock && !isLoading"
            class="watchVideoSideBar watchVideoSponsorBlock"
            :loading="sponsorBlockInfoLoading"
            :pending-uuid="sponsorBlockInfoPendingUuid"
            :segments="sponsorBlockInfoSegments"
            :submission-enabled="sponsorBlockInfoSubmissionEnabled"
            :auto-skip-disabled="sponsorBlockAutoSkipTemporarilyDisabled"
            :channel-whitelisted="isSponsorBlockChannelWhitelisted"
            :can-whitelist-channel="Boolean(channelId)"
            :current-time="currentTime"
            @close="closeSidebarSponsorBlock"
            @refresh="refreshSponsorBlockInfo"
            @skip="skipSponsorBlockInfoSegment"
            @auto-skip-change="handleSponsorBlockAutoSkipToggle"
            @channel-whitelist-change="handleSponsorBlockChannelWhitelistToggle"
            @vote="voteOnSponsorBlockInfoSegment"
          />
        </transition>
      </Teleport>
      <Teleport
        :to="fullscreenTranscriptTarget || 'body'"
        :disabled="!fullscreenTranscriptOpen"
      >
        <watch-video-transcript
          v-if="showTranscript && !isLoading && !isLive && !isUpcoming"
          :captions="captions"
          :current-time="currentTime"
          :preferred-caption-index="preferredTranscriptCaptionIndex"
          :video-title="videoTitle"
          :fullscreen-overlay="fullscreenTranscriptOpen"
          class="watchVideoSideBar watchVideoTranscript"
          @close="closeTranscript"
          @timestamp-event="playTranscriptSegment"
        />
      </Teleport>
      <watch-video-live-chat
        v-if="!isLoading && !hideLiveChat && (isLive || isUpcoming)"
        :live-chat="liveChat"
        :video-id="videoId"
        :channel-id="channelId"
        class="watchVideoSideBar watchVideoPlaylist"
        :class="{ theatrePlaylist: useTheatreMode }"
      />
      <Teleport
        :to="fullscreenPlaylistTarget || 'body'"
        :disabled="!fullscreenPlaylistOpen"
      >
        <watch-video-playlist
          v-if="watchingPlaylist"
          v-show="!isLoading"
          ref="watchVideoPlaylist"
          :watch-view-loading="isLoading"
          :playlist-id="playlistId"
          :playlist-type="playlistType"
          :video-id="videoId"
          :playlist-item-id="playlistItemId"
          :fullscreen-overlay="fullscreenPlaylistOpen"
          class="watchVideoSideBar watchVideoPlaylist resizablePlaylist"
          :class="{ theatrePlaylist: useTheatreMode }"
          @close="closeFullscreenPlaylist"
          @pause-player="pausePlayer"
        />
      </Teleport>
      <watch-video-recommendations
        v-if="!isLoading && !hideRecommendedVideos"
        :data="recommendedVideos"
        class="watchVideoSideBar watchVideoRecommendations"
        :class="{
          theatreRecommendations: useTheatreMode,
          watchVideoRecommendationsLowerCard: watchingPlaylist || isLive,
          watchVideoRecommendationsNoCard: !watchingPlaylist || !isLive
        }"
        @pause-player="pausePlayer"
      />
    </div>
    <div
      v-if="(isFamilyFriendly || !showFamilyFriendlyOnly)"
      class="commentsArea"
    >
      <Teleport
        :to="fullscreenCommentsTarget || 'body'"
        :disabled="!fullscreenCommentsOpen"
      >
        <CommentSection
          v-if="!isLoading && !isLive && !hideComments"
          :id="videoId"
          class="watchVideo"
          :class="{ theatreWatchVideo: useTheatreMode }"
          :channel-thumbnail="channelThumbnail"
          :channel-name="channelName"
          :fullscreen-overlay="fullscreenCommentsOpen"
          @close-comments="closeFullscreenComments"
          @timestamp-event="changeTimestamp"
        />
      </Teleport>
    </div>
  </div>
</template>

<script src="./Watch.js" />
<style scoped src="./Watch.scss" lang="scss" />
