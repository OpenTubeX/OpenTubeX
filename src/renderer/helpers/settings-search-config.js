export const SETTINGS_SEARCH_KEYS = {
  general: 'Settings.General Settings',
  theme: 'Settings.Theme Settings',
  player: 'Settings.Player Settings',
  channel: 'Settings.Channel Settings',
  'caption-appearance': 'Settings.Player Settings.Caption Appearance',
  'external-player': 'Settings.External Player Settings',
  download: 'Settings.Download Settings',
  'external-software': 'Settings.External Software Settings',
  subscription: 'Settings.Subscription Settings',
  distraction: 'Settings.Distraction Free Settings',
  'parental-control': 'Settings.Parental Control Settings',
  privacy: 'Settings.Privacy Settings',
  data: 'Settings.Data Settings',
  sync: 'Settings.Sync Settings',
  proxy: 'Settings.Proxy Settings',
  'sponsor-block': 'Settings.SponsorBlock Settings',
  'return-youtube-dislike': 'Settings.Return YouTube Dislike Settings',
  'context-menu-search': 'Settings.Context Menu Search Settings',
  experimental: 'Settings.Experimental Settings'
}

export const SETTINGS_SEARCH_SELECT_GROUP_LABELS = {
  general: {
    'Stream Extraction Method': ['Stream Extraction Method'],
    'New Tab Position': ['New Tab Position'],
    'Tab Close Focus': ['Tab Close Focus'],
    'Startup Behavior': ['Startup Behavior'],
    'Reduced Motion': ['Reduced Motion'],
    'Avoid translation': ['Avoid translation'],
    'Preferred API Backend': ['Preferred API Backend'],
    'Video View Type': ['Video View Type'],
    'Thumbnail Preference': ['Thumbnail Preference'],
    'Extra Thumbnail Action Button': ['Extra Thumbnail Action Button'],
    'External Link Handling': ['External Link Handling']
  },
  theme: {
    'Tab Layout': ['Tab Layout'],
    'Toast Position': ['Toast Position'],
    'Base Theme': ['Base Theme'],
    Font: ['App Font'],
    'Main Color Theme': ['Main Color Theme']
  },
  player: {
    'Caption Appearance': [],
    'Default Viewing Mode': ['Default Viewing Mode', 'Tooltip'],
    'Auto Picture in Picture': ['Auto Picture in Picture', 'Wayland Minimize Unsupported'],
    'Default Video Format': ['Default Video Format'],
    'Default Quality': ['Default Quality'],
    'Screenshot.Modes': []
  },
  data: {
    '': [
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
      'Import search history formats',
      'Manage Subscriptions'
    ]
  },
  'caption-appearance': {
    Anchor: ['Anchor'],
    'Edge Style': ['Edge Style']
  },
  'external-player': { Players: [] },
  'external-software': { Sources: [] },
  privacy: { 'Watched Progress Saving Mode.Modes': [] },
  'sponsor-block': { 'Skip Options': ['Skip Option'] }
}

export const SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS = {
  general: new Set(['System Default']),
  'caption-appearance': new Set(['Application Language'])
}
