/**
 * Settings that noticeably add work when they are enabled, so that the UI can warn
 * about the cost before someone turns them on. Settings that are not listed here are
 * treated as having no impact worth mentioning, keeping the badges rare enough to
 * still mean something.
 *
 * `moderate` is for extra requests or timers that most machines will not feel,
 * `high` is for continuous work that is noticeable on weaker hardware.
 *
 * Entries are keyed by setting key. Switches that are not backed by a setting pass
 * their own key as `performance-impact-key` instead.
 *
 * @typedef {'moderate' | 'high'} PerformanceImpactLevel
 * @typedef {'CPU' | 'GPU' | 'Memory' | 'Network' | 'Disk'} PerformanceImpactResource
 * @typedef {{ level: PerformanceImpactLevel, resources: PerformanceImpactResource[] }} PerformanceImpact
 */

/** @type {Map<string, PerformanceImpact>} */
const SETTING_PERFORMANCE_IMPACTS = new Map([
  // draws and blurs the video's own frames behind the player, every frame
  ['ambientMode', { level: 'high', resources: ['GPU', 'CPU'] }],
  // every thumbnail is fetched from the DeArrow generator instead of coming with the video's metadata
  ['useDeArrowThumbnails', { level: 'high', resources: ['Network'] }],
  // everything is rendered and video is decoded on the CPU
  ['disableHardwareAcceleration', { level: 'high', resources: ['CPU'] }],

  ['useDeArrowTitles', { level: 'moderate', resources: ['Network'] }],
  ['useSponsorBlock', { level: 'moderate', resources: ['Network'] }],
  ['useReturnYouTubeDislikes', { level: 'moderate', resources: ['Network'] }],
  ['enableSearchSuggestions', { level: 'moderate', resources: ['Network'] }],
  ['fetchSubscriptionsAutomatically', { level: 'moderate', resources: ['Network'] }],
  // keeps loading pages as you scroll, so the list in memory never stops growing
  ['generalAutoLoadMorePaginatedItemsEnabled', { level: 'moderate', resources: ['Memory', 'Network'] }],
  // keeps loading comment pages as you scroll
  ['autoLoadComments', { level: 'moderate', resources: ['Memory', 'Network'] }],
  // screenshots of the tabs are captured, scaled, encoded, and cached on disk
  ['showTabPreviews', { level: 'moderate', resources: ['CPU', 'Memory', 'Disk'] }],
  // keeps every title, description, and thumbnail revision found for visited videos
  ['enableVideoMetadataCache', { level: 'moderate', resources: ['Disk', 'Network'] }],
  // keeps a process running after the last window closes, or schedules background work on mobile, to fetch the feeds
  ['enableClosedAppSubscriptionRefresh', { level: 'moderate', resources: ['Network', 'Memory'] }],
  // syncs on a timer and keeps a long-polling request open for changes from other devices
  ['syncServerAutoSync', { level: 'moderate', resources: ['Network'] }],
  // keeps responses that are not images out of any cache, and images in memory
  ['replaceHttpCache', { level: 'moderate', resources: ['Memory', 'Network'] }],

  // the feeds keep being fetched in the background while the app is open
  ['subscriptionFeedAutoRefreshInterval', { level: 'moderate', resources: ['Network'] }],
  ['subscriptionShortsAutoRefreshInterval', { level: 'moderate', resources: ['Network'] }],
  ['subscriptionLiveAutoRefreshInterval', { level: 'moderate', resources: ['Network'] }],
  ['subscriptionPostsAutoRefreshInterval', { level: 'moderate', resources: ['Network'] }],
  ['rssFeedsAutoRefreshInterval', { level: 'moderate', resources: ['Network'] }],
  ['platformFeedAutoRefreshInterval', { level: 'moderate', resources: ['Network'] }],
  ['twitchLiveNotifications', { level: 'moderate', resources: ['Network'] }],

  // higher resolutions cost bandwidth and are more work to decode
  ['defaultQuality', { level: 'moderate', resources: ['Network', 'CPU'] }],
  // AV1 is decoded in software on hardware that lacks an AV1 decoder
  ['preferredVideoCodec', { level: 'moderate', resources: ['CPU'] }],
  // yt-dlp starts an extraction process for every video
  ['videoPlaybackEngine', { level: 'moderate', resources: ['CPU'] }],
  // runs a yt-dlp extraction for each upcoming video
  ['ytDlpPreloadEnabled', { level: 'moderate', resources: ['CPU', 'Network'] }],
  // segments are downloaded ahead of playback and kept around until they are needed
  ['segmentPrefetchLimit', { level: 'moderate', resources: ['Network', 'Memory'] }],
  ['bufferAhead', { level: 'moderate', resources: ['Network', 'Memory'] }],
  // plays a second copy of the audio ahead of playback and analyzes it every frame
  ['enableSkipSilenceByDefault', { level: 'moderate', resources: ['CPU', 'Memory'] }],
  // analyzes the audio and redraws a canvas while audio-only playback runs
  ['musicVisualizer', { level: 'moderate', resources: ['CPU'] }],
  // blurs the moving video behind the player controls every frame while they are visible
  ['useFrostedGlassPlayerUi', { level: 'moderate', resources: ['GPU'] }],
  // requests and polls for a translation of every video that loads, then preloads its audio
  ['voiceOverTranslationPrepareInBackground', { level: 'moderate', resources: ['Network'] }]
])

/**
 * @param {string} settingKey
 * @returns {PerformanceImpact | null}
 */
export function getSettingPerformanceImpact(settingKey) {
  return SETTING_PERFORMANCE_IMPACTS.get(settingKey) ?? null
}
