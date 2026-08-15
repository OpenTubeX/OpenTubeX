/**
 * Settings that noticeably add work when they are enabled, so that the UI can warn
 * about the cost before someone turns them on. Settings that are not listed here are
 * treated as having no impact worth mentioning, keeping the badges rare enough to
 * still mean something.
 *
 * `moderate` is for extra requests or timers that most machines will not feel,
 * `high` is for continuous work that is noticeable on weaker hardware.
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

  ['useDeArrowTitles', { level: 'moderate', resources: ['Network'] }],
  ['useSponsorBlock', { level: 'moderate', resources: ['Network'] }],
  ['useReturnYouTubeDislikes', { level: 'moderate', resources: ['Network'] }],
  ['enableSearchSuggestions', { level: 'moderate', resources: ['Network'] }],
  ['enableCaptionTranslations', { level: 'moderate', resources: ['Network'] }],
  ['fetchSubscriptionsAutomatically', { level: 'moderate', resources: ['Network'] }],
  ['showNewSubscriptionFeedIndicators', { level: 'moderate', resources: ['Network'] }],
  // keeps loading pages as you scroll, so the list in memory never stops growing
  ['generalAutoLoadMorePaginatedItemsEnabled', { level: 'moderate', resources: ['Memory', 'Network'] }],
  // re-renders every visible timestamp on a timer
  ['updateRelativeTimestamps', { level: 'moderate', resources: ['CPU'] }],
  // screenshots of the tabs are captured and cached on disk
  ['showTabPreviews', { level: 'moderate', resources: ['Memory', 'Disk'] }],
  // keeps every title, description, and thumbnail revision found for visited videos
  ['enableVideoMetadataCache', { level: 'moderate', resources: ['Disk', 'Network'] }],

  // the feeds keep being fetched in the background while the app is open
  ['subscriptionFeedAutoRefreshInterval', { level: 'moderate', resources: ['Network'] }],
  ['subscriptionShortsAutoRefreshInterval', { level: 'moderate', resources: ['Network'] }],
  ['subscriptionLiveAutoRefreshInterval', { level: 'moderate', resources: ['Network'] }],
  ['subscriptionPostsAutoRefreshInterval', { level: 'moderate', resources: ['Network'] }],
  // higher resolutions cost bandwidth and are more work to decode
  ['defaultQuality', { level: 'moderate', resources: ['Network', 'CPU'] }],
  // segments are downloaded ahead of playback and kept around until they are needed
  ['segmentPrefetchLimit', { level: 'moderate', resources: ['Network', 'Memory'] }]
])

/**
 * @param {string} settingKey
 * @returns {PerformanceImpact | null}
 */
export function getSettingPerformanceImpact(settingKey) {
  return SETTING_PERFORMANCE_IMPACTS.get(settingKey) ?? null
}
