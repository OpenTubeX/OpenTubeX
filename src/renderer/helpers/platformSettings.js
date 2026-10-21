export const DEVICE_LOCAL_SETTING_KEYS = new Set([
  'autoPictureInPictureTriggers',
  'autoUnloadTabs',
  'autoUnloadMemoryThreshold',
  'autoUnloadTabPercentage',
  'autoUpdateChannelVolumes',
  'channelVolumes',
  'continuePlaybackWhenScreenIsLocked',
  'controlBarButtons',
  'defaultVolume',
  'displayVideoPlayButton',
  'enableClosedAppSubscriptionRefresh',
  'enableMobileFullscreenSeek',
  'enableMobileFullscreenSwipe',
  'enableMobileTabs',
  'enablePullToRefresh',
  'enableUploadNotifications',
  'fullscreenRotationIgnoresSystemLock',
  'hideToTrayOnClose',
  'hideToTrayOnMinimize',
  'useTrayIcon',
  'keepPlayingOnNavigation',
  'mobileFullscreenBrightness',
  'mobileLeftSwipeAction',
  'mobileRightSwipeAction',
  'rememberTabNavigationHistory',
  'rememberVolume',
  'rememberVolumePerChannel',
  'rotateFullscreenToLandscape',
  'scrollMiniPlayerOnAllTabs',
  'showMobileSeekPreview',
  'showProgressBarToast',
  'showTabPreviews',
  'tabBarPosition',
  'tabLoadingIndicator',
  'thumbnailLeftSwipeAction',
  'thumbnailRightSwipeAction',
  'ytDlpDownloadFolderPath',
  'ytDlpPlaybackCookiesPath',
  'videoVolumeMouseScroll',
])

/**
 * Settings with platform-specific behavior must stay local to each device
 * instead of overwriting preferences on other devices during settings sync.
 *
 * @param {string} settingKey
 * @returns {boolean}
 */
export function isSettingSyncableOnPlatform(settingKey) {
  return !DEVICE_LOCAL_SETTING_KEYS.has(settingKey)
}
