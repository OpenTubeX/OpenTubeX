const GENERAL_EVERYDAY_KEYS = new Set([
  'Sections',
  'Avoid translation',
  'Auto Load Comments',
  'Auto Load Next Page',
  'General Settings',
  'Check for Updates',
  'Close Window With Last Tab',
  'Comment Translation',
  'Confirm Before',
  'Confirmation Options',
  'Default Landing Page',
  'Enable Tabs',
  'Extra Thumbnail Action Button',
  'Locale Preference',
  'System Tray',
  'New Tab Position',
  'Open Deep Links In New Window',
  'Region for Trending',
  'Reply Notifications',
  'Startup Behavior',
  'Swipe to refresh',
  'Haptic Feedback',
  'Ignore System Haptics Setting',
  'Thumbnail Swipe Gestures',
  'System Default',
  'Tab Close Focus',
  'Use AI Translation Completions',
  'Watched Comments'
])

const GENERAL_APPEARANCE_KEYS = new Set([
  'Data Saver Thumbnails',
  'Grid Columns',
  'Link Underlines',
  'Mobile Layout',
  'Navigation',
  'Playlist View Type',
  'Reduced Motion',
  'Show Thumbnail Previews',
  'Show Video Menu Button',
  'Thumbnail Preference',
  'Title Lines',
  'Video View Type'
])

const GENERAL_PRIVACY_KEYS = new Set([
  'Enable Search Suggestions',
  'External Link Handling',
  'Remember Tab Navigation History'
])

const GENERAL_PROVIDER_KEYS = new Set([
  'Always Use Backup Media Server',
  'Automatically switch stream extraction methods',
  'Built-in Streams',
  'Clear Default Instance',
  'Current instance will be randomized on startup',
  'Current Invidious Instance',
  'Fallback to Non-Preferred Backend on Failure',
  'No default instance has been set',
  'Preferred API Backend',
  'Set Current Instance as Default',
  'Stream Extraction Method',
  'The currently set default instance is {instance}',
  'View all Invidious instance information',
  'Yattee Server'
])

const SCHEDULED_BACKUP_KEYS = new Set([
  'Scheduled backups', 'Scheduled backup description', 'Choose backup folder',
  'No backup folder selected', 'Enable scheduled backups', 'Backup frequency',
  'Backups to keep', 'Daily', 'Weekly', 'Every 30 days', 'Last scheduled backup',
  'No scheduled backup yet', 'Scheduled backup failed'
])

const PRIVACY_STORAGE_KEYS = new Set([
  'Cache Video Metadata',
  'Cache Video Metadata Tooltip',
  'Clear Search History and Cache',
  'Clear Video Metadata Cache',
  'Remove Watch History',
  'Remove All Subscriptions / Profiles',
  'Remove All Playlists'
])

const DATA_STORAGE_KEYS = new Set([
  'Profile Directory',
  'Open Profile Directory'
])

// Theme settings shown on the theme gallery subpage instead of the Appearance page.
const THEME_GALLERY_KEYS = new Set([
  'Base Theme',
  'Light Theme',
  'Dark Theme',
  'Main Color Theme',
  'Secondary Color Theme',
  'Material Accent Color',
  'Tally Accent Color',
  'Material Wallpaper Colors',
  'Material System Accent Color',
  'Custom Theme'
])

// Distraction Free strings for the player's interface, shown in Playback.
const PLAYER_INTERFACE_KEYS = new Set([
  'Playing Interface Hide Delay',
  'Paused Interface Hide Delay',
  'Show Player Controls',
  'Show Video Title',
  'Show Bottom Right Actions Dock'
])

const QUICK_PLAYBACK_SPEED_SUBPAGE_KEYS = new Set([
  'Quick Playback Speed Bar Manager',
  'Add Playback Speed',
  'Reset Quick Playback Speed Bar',
  'Edit Playback Speed Name',
  'Reorder Playback Speed',
  'Playback Speed'
])

const YT_DLP_STREAMING_KEYS = new Set([
  'yt-dlp Streaming',
  'Parallel Segment Loading',
  'Upcoming Videos to Preload',
  'Concurrent Preloads',
  'Ask Before Preloading Large Playlists'
])

export const SETTINGS_SEARCH_SOURCES = {
  general: [{
    type: 'general',
    key: 'Settings.General Settings',
    include: GENERAL_EVERYDAY_KEYS
  }, {
    type: 'context-menu-search',
    key: 'Settings.Context Menu Search Settings'
  }],
  appearance: [{
    type: 'theme',
    key: 'Settings.Theme Settings',
    exclude: new Set(['Sections', ...THEME_GALLERY_KEYS])
  }, {
    type: 'theme',
    key: 'Settings.Theme Settings',
    include: THEME_GALLERY_KEYS,
    subpage: 'theme'
  }, {
    type: 'general',
    key: 'Settings.General Settings',
    include: GENERAL_APPEARANCE_KEYS,
    exclude: new Set(['Navigation'])
  }, {
    type: 'interface-customizer',
    key: 'Settings.Interface Customizer',
    include: new Set(['Customize Interface'])
  }, {
    type: 'control-bar',
    key: 'Settings.Control Bar',
    include: new Set(['Title', 'Customize']),
    subpage: 'customize-interface',
    subpageTab: 'controlBar'
  }, {
    type: 'fullscreen-actions',
    key: 'Settings.Fullscreen Actions',
    include: new Set(['Title', 'Customize', 'Add Action', 'Quick Bookmark']),
    subpage: 'customize-interface',
    subpageTab: 'fullscreenActions'
  }, {
    type: 'subscription-tabs',
    key: 'Settings.Subscription Tabs',
    include: new Set(['Title']),
    subpage: 'customize-interface',
    subpageTab: 'subscriptionTabs'
  }, {
    type: 'navigation',
    key: 'Settings.General Settings.Navigation',
    include: new Set(['Navigation', 'Customize Navigation', 'Show Active Subscriptions', 'Add Item', 'Always Show Navigation Bar', 'Navigation Bar Labels']),
    subpage: 'customize-interface',
    subpageTab: 'navigation'
  }, {
    type: 'quick-settings',
    key: 'Settings.Quick Settings',
    include: new Set(['Quick Settings', 'Customize Quick Settings', 'Add Setting']),
    subpage: 'customize-interface',
    subpageTab: 'quickSettings'
  }],
  playback: [{
    type: 'player',
    key: 'Settings.Player Settings',
    exclude: new Set([
      'Proxy Videos Through Invidious',
      'Sections',
      // Short labels, descriptions, and group titles that read well only in
      // their group. Search lists the full labels below instead, which
      // contain the short ones, except for the Center Play Button.
      'Player Controls',
      'Display Play Button In Video Player',
      'Voice-over Translation',
      'Buffering',
      ...QUICK_PLAYBACK_SPEED_SUBPAGE_KEYS,
      ...YT_DLP_STREAMING_KEYS
    ])
  }, {
    type: 'player-controls',
    key: 'Settings.Player Settings.Player Controls',
    include: new Set(['Center Play Button'])
  }, {
    type: 'player',
    key: 'Settings.Player Settings',
    include: QUICK_PLAYBACK_SPEED_SUBPAGE_KEYS,
    subpage: 'quick-playback-speed'
  }, {
    type: 'distraction',
    key: 'Settings.Distraction Free Settings',
    include: PLAYER_INTERFACE_KEYS
  }, {
    type: 'caption-appearance',
    key: 'Settings.Player Settings.Caption Appearance'
  }, {
    type: 'channel',
    key: 'Settings.Channel Settings'
  }],
  subscriptions: [{
    type: 'subscription',
    key: 'Settings.Subscription Settings'
  }],
  download: [{
    type: 'download',
    key: 'Settings.Download Settings'
  }],
  focus: [{
    type: 'distraction',
    key: 'Settings.Distraction Free Settings',
    exclude: new Set([
      'Hide Active Subscriptions',
      'Digital Wellbeing',
      // The chips' short names; search lists their switches' full labels.
      'Chips',
      ...PLAYER_INTERFACE_KEYS
    ]),
    tab: 'distraction'
  }, {
    type: 'digital-wellbeing',
    key: 'Settings.Distraction Free Settings.Digital Wellbeing',
    tab: 'wellbeing'
  }, {
    type: 'digital-wellbeing-heading',
    key: 'Settings.Distraction Free Settings.Sections',
    include: new Set(['Digital Wellbeing']),
    tab: 'wellbeing'
  }, {
    type: 'parental-control',
    key: 'Settings.Parental Control Settings',
    tab: 'parental'
  }],
  'add-ons': [{
    type: 'sponsor-block',
    key: 'Settings.SponsorBlock Settings'
  }, {
    type: 'return-youtube-dislike',
    key: 'Settings.Return YouTube Dislike Settings'
  }, {
    type: 'ai-slop-list',
    key: 'Settings.AiSList Settings'
  }, {
    type: 'player',
    key: 'Settings.Player Settings',
    include: new Set(['Voice-over Translation']),
    electronOnly: true,
    capacitorSupported: true
  }],
  privacy: [{
    type: 'privacy',
    key: 'Settings.Privacy Settings',
    exclude: PRIVACY_STORAGE_KEYS
  }, {
    type: 'general',
    key: 'Settings.General Settings',
    include: GENERAL_PRIVACY_KEYS
  }],
  data: [{
    type: 'data',
    key: 'Settings.Data Settings',
    exclude: new Set([...DATA_STORAGE_KEYS, ...SCHEDULED_BACKUP_KEYS]),
    tab: 'data'
  }, {
    type: 'data',
    key: 'Settings.Data Settings',
    include: SCHEDULED_BACKUP_KEYS,
    electronOnly: true,
    tab: 'data'
  }, {
    type: 'storage',
    key: 'Settings.Storage Settings',
    tab: 'storage'
  }, {
    type: 'privacy',
    key: 'Settings.Privacy Settings',
    include: PRIVACY_STORAGE_KEYS,
    tab: 'storage'
  }, {
    type: 'data',
    key: 'Settings.Data Settings',
    include: DATA_STORAGE_KEYS,
    electronOnly: true,
    tab: 'storage'
  }],
  sync: [{
    type: 'sync',
    key: 'Settings.Sync Settings',
    tab: 'sync'
  }, {
    type: 'youtube-account',
    key: 'Settings.YouTube Account Settings',
    include: new Set(['YouTube Account Settings', 'Sign In', 'Sign Out', 'Sync Subscriptions', 'Sync Playlists', 'YouTube Watch History', 'Add to YouTube Watch History', 'Import Watch History', 'Rate Videos', 'Watch Posted Comments']),
    electronOnly: true,
    capacitorSupported: true,
    tab: 'youtube-account'
  }],
  advanced: [{
    type: 'tab-unloading',
    key: 'Settings.Tab Unloading',
    include: new Set(['Automatically unload tabs', 'Memory threshold', 'Tabs to unload']),
    electronOnly: true,
    capacitorSupported: true
  }, {
    type: 'general',
    key: 'Settings.General Settings',
    include: GENERAL_PROVIDER_KEYS
  }, {
    type: 'player',
    key: 'Settings.Player Settings',
    include: new Set(['Proxy Videos Through Invidious', 'Buffering'])
  }, {
    type: 'external-player',
    key: 'Settings.External Player Settings',
    electronOnly: true
  }, {
    type: 'external-software',
    key: 'Settings.External Software Settings',
    exclude: new Set(['Managed Tool Errors']),
    electronOnly: true
  }, {
    type: 'yt-dlp-streaming',
    key: 'Settings.Player Settings',
    include: YT_DLP_STREAMING_KEYS,
    electronOnly: true
  }, {
    type: 'proxy',
    key: 'Settings.Proxy Settings',
    capacitorSupported: true,
    electronOnly: true
  }, {
    type: 'experimental',
    key: 'Settings.Experimental Settings',
    electronOnly: true
  }, {
    type: 'diagnostics',
    key: 'Settings.Diagnostics',
    include: new Set(['Diagnostics', 'Enable Logging', 'Copy Report', 'Save Report', 'Clear Log'])
  }]
}

// Search labels, by source type, whose control shows a shorter label, mapped to the control's
// setting key so a result can still highlight it.
export const SETTINGS_SEARCH_SETTING_KEYS = {
  subscription: {
    'Settings.Subscription Settings.Platforms.Auto Refresh Interval': 'platformFeedAutoRefreshInterval',
    'Settings.Subscription Settings.RSS Feeds Auto Refresh Interval': 'rssFeedsAutoRefreshInterval',
    'Settings.Subscription Settings.Videos Auto Refresh Interval': 'subscriptionFeedAutoRefreshInterval',
    'Settings.Subscription Settings.Shorts Auto Refresh Interval': 'subscriptionShortsAutoRefreshInterval',
    'Settings.Subscription Settings.Live Auto Refresh Interval': 'subscriptionLiveAutoRefreshInterval',
    'Settings.Subscription Settings.Posts Auto Refresh Interval': 'subscriptionPostsAutoRefreshInterval'
  },
  // The Player Controls switches show short labels, so their full labels
  // find them by setting.
  player: {
    'Settings.Player Settings.Show Volume Boost Toggle': 'showVolumeBoostToggle',
    'Settings.Player Settings.Show Mono Audio Toggle': 'showMonoAudioToggle',
    'Settings.Player Settings.Show Music Mode Toggle': 'showMusicModeToggle',
    'Settings.Player Settings.Show Skip Silence Toggle': 'showSkipSilenceButton',
    'Settings.Player Settings.Enable Skip Silence by Default': 'enableSkipSilenceByDefault',
    'Settings.Player Settings.Enable Google Cast': 'castProtocols',
    'Settings.Player Settings.Enable FCast': 'castProtocols',
    'Settings.Player Settings.Enable DLNA Casting': 'castProtocols',
    'Settings.Player Settings.Show Lights Off Toggle': 'showLightsOffToggle',
    'Settings.Player Settings.Show Mirror Video Toggle': 'showMirrorVideoToggle',
    'Settings.Player Settings.Show Rotate Video Menu': 'showRotateVideoMenu',
    'Settings.Player Settings.Show Seek Bar Filmstrip': 'showSeekBarFilmstrip'
  },
  'player-controls': {
    'Settings.Player Settings.Player Controls.Center Play Button': 'displayVideoPlayButton'
  },
  // The System Tray options only show in its menu.
  general: {
    'Settings.General Settings.System Tray': 'useTrayIcon'
  },
  // Chips whose visible text their full label doesn't contain add it to their name.
  distraction: {
    'Settings.Distraction Free Settings.Hide Recommended Videos': 'hideRecommendedVideos',
    'Settings.Distraction Free Settings.Hide Videos on Watch': 'hideWatchedSubs'
  },
  channel: {
    'Settings.Channel Settings.Auto Save Playback Speed': 'autoUpdateChannelPlaybackSpeeds',
    'Settings.Channel Settings.Auto Save Video Quality': 'autoUpdateChannelVideoQualities',
    'Settings.Channel Settings.Auto Save Subtitles State': 'autoUpdateChannelSubtitlesStates',
    'Settings.Channel Settings.Auto Save Volume': 'autoUpdateChannelVolumes'
  }
}

export const SETTINGS_SEARCH_SELECT_GROUP_LABELS = {
  // Leaves out select options such as Off and Always.
  'digital-wellbeing': {
    '': [
      'Grayscale',
      'Apply Grayscale To',
      'Daily Watch Time Limit',
      'Count Watch Time From',
      'Daily Shorts Limit',
      'When a Limit Is Reached',
      'Take a Break Reminder',
      'Break Reminder Action',
      'Bedtime Reminder',
      'Bedtime Start',
      'Bedtime End',
      'Wait Until the Video Ends',
      'Silence Upload Notifications at Bedtime',
      'Stop Autoplay at Bedtime and After the Daily Limit'
    ]
  },
  sync: {
    '': [
      'Sync Settings', 'Enable Sync', 'Server URL', 'Username', 'Privacy Passphrase',
      'Log In', 'Register', 'Privacy Policy', 'Pair Another Device', 'Pair With Existing Device',
      'Device Name', 'Pairing Code', 'Create Pairing Code', 'Use Text Pairing Code',
      'Show QR Code', 'Enter Pairing Code', 'Check Pairing Code', 'Scan QR Code',
      'Use Pairing Invite', 'Show Pairing Invite',
      'Pairing Codes Match', 'Approve Pairing', 'Try Again', 'Scan Again',
      'Confirm Data Loss',
      'Sync Automatically', 'Watch stats', 'Profiles', 'Open Tabs', 'Use Shared Tabs',
      'Open All Tabs', 'Open On Device', 'Sync Now', 'Disconnect', 'Delete Account', 'Confirm Delete Account',
      'Devices', 'Activity', 'Show More', 'Refresh Devices', 'Revoke Session',
      'Confirm Revoke Session', 'Rename Device', 'Save Device Name',
      'Change Password', 'Current Password', 'New Password', 'Confirm New Password',
      'Save New Password', 'Enable Automatic Sync'
    ]
  },
  general: {
    'Stream Extraction Method': ['Stream Extraction Method'],
    'Built-in Streams': ['Built-in Streams'],
    'Mobile Layout': ['Mobile Layout'],
    'New Tab Position': ['New Tab Position'],
    'Tab Close Focus': ['Tab Close Focus'],
    'Startup Behavior': ['Startup Behavior'],
    'Reduced Motion': ['Reduced Motion'],
    'Avoid translation': ['Avoid translation'],
    'Comment Translation': ['Translation', 'Offer Translations For', 'Never Translate'],
    'Preferred API Backend': ['Preferred API Backend'],
    'Yattee Server': ['Server URL', 'Username', 'Password', 'Proxy Videos', 'Test Connection'],
    'Playlist View Type': ['Playlist View Type'],
    'Video View Type': ['Video View Type'],
    'Grid Columns': ['Grid Columns', 'Playlist Grid Columns'],
    'Thumbnail Preference': ['Thumbnail Preference'],
    'Link Underlines': ['Link Underlines'],
    'Extra Thumbnail Action Button': ['Extra Thumbnail Action Button'],
    'External Link Handling': ['External Link Handling']
  },
  theme: {
    'Tab Layout': ['Tab Layout'],
    'Tab Loading Indicator': ['Tab Loading Indicator'],
    'Toast Position': ['Toast Position'],
    'Modal Backdrop': ['Modal Backdrop'],
    'Base Theme': ['Base Theme'],
    'Icon Pack': ['Icon Pack'],
    Font: ['App Font'],
    'Main Color Theme': ['Main Color Theme'],
    'Custom Theme': ['Create Custom Theme', 'Edit Custom Theme']
  },
  player: {
    'Caption Appearance': [],
    'Default Viewing Mode': ['Default Viewing Mode', 'Tooltip'],
    'Auto Picture in Picture': ['Auto Picture in Picture'],
    'Swipe Gestures': ['Left', 'Right', 'Fullscreen Brightness'],
    'Default Media Format': ['Default Media Format'],
    'Default Quality': ['Default Quality'],
    'Quality Limit on Metered Networks': ['Quality Limit on Metered Networks'],
    'Screenshot.Modes': [],
    'Buffering.Presets': []
  },
  channel: {
    '': [
      'Channel Settings',
      'Enable Channel Playback Settings',
      'Auto Save Changes',
      'Auto Save Playback Speed',
      'Auto Save Video Quality',
      'Auto Save Subtitles State',
      'Auto Save Volume'
    ]
  },
  download: {
    '': [
      'Download Settings',
      'Enable Downloads',
      'Download Folder',
      'Concurrent Downloads',
      'Bandwidth Limit',
      'Global Additional yt-dlp Arguments'
    ]
  },
  data: {
    '': [
      ...SCHEDULED_BACKUP_KEYS,
      'Data Settings',
      'Import Subscriptions',
      'Export Subscriptions',
      'Import History',
      'Export History',
      'Import Playlists',
      'Export Playlists',
      'Search history',
      'Import search history',
      'Export search history',
      'Import Settings',
      'Export Settings',
      'Import subscriptions formats',
      'Import history formats',
      'Import playlists formats',
      'Import search history formats'
    ]
  },
  'caption-appearance': {
    Anchor: ['Anchor'],
    Colors: [],
    'Edge Style': ['Edge Style'],
    'Font Family': ['Font Family']
  },
  'external-player': { Players: [] },
  'external-software': {
    Sources: [],
    'Update Modes': [],
    'Cookie Sources': [],
    'Cookie Uses': ['Use Cookies For']
  },
  distraction: { 'Blocked Items': ['Blocked Items'] },
  privacy: { 'Watched Progress Saving Mode.Modes': [] },
  'sponsor-block': { 'Skip Options': ['Skip Option'] }
}

export const SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS = {
  distraction: new Set(['Sections.Digital Wellbeing', 'Sections.Visible While Paused']),
  general: new Set(['System Default']),
  'context-menu-search': new Set(['Engine Name', 'Search URL']),
  player: new Set(['Lights Off', 'Skip Silence', 'Playback Speed Name', 'Use Automatic Playback Speed Name']),
  'sponsor-block': new Set(['Generated SponsorBlock User ID Copy Button']),
  subscription: new Set(['Auto Refresh Interval']),
  'caption-appearance': new Set(['Application Language', 'Default']),
  'external-software': new Set([
    'Download yt-dlp',
    'Update yt-dlp',
    'Downloading yt-dlp',
    'Download FFmpeg',
    'Update FFmpeg',
    'Downloading FFmpeg',
    'Download FFmpeg and FFprobe',
    'Update FFmpeg and FFprobe',
    'Downloading FFmpeg and FFprobe',
    'Select Browser'
  ])
}
