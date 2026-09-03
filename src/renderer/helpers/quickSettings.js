const CORE_QUICK_SETTINGS = [
  ['baseTheme', 'appearance', 'Settings.Theme Settings.Base Theme.Base Theme', { control: 'select', icon: ['fas', 'palette'] }],
  ['mainColor', 'appearance', 'Settings.Theme Settings.Main Color Theme.Main Color Theme', { control: 'select', icon: ['fas', 'palette'] }],
  ['uiScale', 'appearance', 'Settings.Theme Settings.UI Scale', { control: 'slider', electronOnly: true, icon: ['fas', 'sliders-h'] }],
  ['thumbnailSize', 'appearance', 'Settings.Theme Settings.Thumbnail Size', { control: 'slider', icon: ['fas', 'photo-film'] }],
  ['defaultQuality', 'playback', 'Settings.Player Settings.Default Quality.Default Quality', { control: 'select', icon: ['fas', 'photo-film'] }],
  ['playNextVideo', 'playback', 'Settings.Player Settings.Play Next Video', { control: 'toggle', icon: ['fas', 'step-forward'] }],
  ['enableSubtitlesByDefault', 'playback', 'Settings.Player Settings.Turn on Subtitles by Default', { control: 'toggle', icon: ['fas', 'closed-captioning'] }],
  ['listType', 'content', 'Settings.General Settings.Video View Type.Video View Type', { control: 'select', icon: ['fas', 'grip'] }],
  ['playlistViewType', 'content', 'Settings.General Settings.Playlist View Type.Playlist View Type', { control: 'select', icon: ['fas', 'list'] }],
  ['hideRecommendedVideos', 'content', 'Settings.Distraction Free Settings.Hide Recommended Videos', { control: 'toggle', icon: ['fas', 'eye-slash'] }],
  ['hideComments', 'content', 'Settings.Distraction Free Settings.Hide Comments', { control: 'toggle', icon: ['fas', 'comment'] }],
  ['currentLocale', 'language', 'Settings.General Settings.Locale Preference', { control: 'select', icon: ['fas', 'language'] }],
  ['region', 'language', 'Settings.General Settings.Region for Trending', { control: 'select', icon: ['fas', 'globe'] }],
  ['useProxy', 'advanced', 'Settings.Proxy Settings.Enable Tor / Proxy', { control: 'toggle', electronOnly: true, icon: ['fas', 'globe'] }],
]

export const BASIC_QUICK_SETTING_DEFINITIONS = Object.freeze([
  {
    id: 'iconPack',
    section: 'appearance',
    labelKey: 'Settings.Theme Settings.Icon Pack.Icon Pack',
    control: 'select',
    values: ['material', 'remix'],
    optionLabelKeys: [
      'Settings.Theme Settings.Icon Pack.Material Symbols',
      'Settings.Theme Settings.Icon Pack.Remix Icon',
    ],
    icon: ['fas', 'icons'],
  },
  {
    id: 'uiRoundness',
    section: 'appearance',
    labelKey: 'Settings.Theme Settings.UI Roundness',
    control: 'slider',
    min: 0,
    max: 200,
    step: 5,
    extension: '%',
    icon: ['fas', 'palette'],
  },
  {
    id: 'animationSpeed',
    section: 'appearance',
    labelKey: 'Settings.Theme Settings.Animation Speed',
    control: 'slider',
    min: 25,
    max: 200,
    step: 5,
    extension: '%',
    icon: ['fas', 'gauge-high'],
  },
  ['barColor', 'Settings.Theme Settings.Match Top Bar with Main Color', 'appearance', ['fas', 'palette']],
  ['hideSideBarOnWatchPages', 'Settings.Theme Settings.Hide Side Bar on Watch Pages', 'appearance', ['fas', 'eye-slash']],
  ['alwaysShowScrollbars', 'Settings.Theme Settings.Always Show Scrollbars', 'appearance', ['fas', 'sliders-h']],
  ['showToastTimeoutIndicator', 'Settings.Theme Settings.Show Toast Timeout Indicator', 'appearance', ['fas', 'message']],
  ['useSponsorBlock', 'Settings.SponsorBlock Settings.Enable SponsorBlock', 'add-ons', ['fas', 'forward']],
  ['useReturnYouTubeDislikes', 'Settings.Return YouTube Dislike Settings.Enable Return YouTube Dislike', 'add-ons', ['fas', 'thumbs-down']],
].map(definition => Object.freeze(Array.isArray(definition)
  ? {
      id: definition[0],
      labelKey: definition[1],
      section: definition[2] ?? 'appearance',
      icon: definition[3],
      control: 'toggle',
    }
  : definition)))

export const QUICK_SETTING_DEFINITIONS = Object.freeze([
  ...CORE_QUICK_SETTINGS.map(([id, section, labelKey, options = {}]) => Object.freeze({
    id,
    section,
    labelKey,
    ...options,
  })),
  ...BASIC_QUICK_SETTING_DEFINITIONS,
])

const SECTION_LABEL_KEYS = Object.freeze({
  appearance: 'Settings.Quick Settings.Appearance',
  playback: 'Settings.Quick Settings.Playback',
  content: 'Settings.Quick Settings.Content',
  language: 'Settings.Quick Settings.Language and Region',
  'add-ons': 'Settings.Categories.Add-ons',
  advanced: 'Settings.Categories.Advanced',
})

export function createQuickSettingCatalog(t, usingElectron) {
  return QUICK_SETTING_DEFINITIONS
    .filter(definition => !definition.electronOnly || usingElectron)
    .map(definition => ({
      ...definition,
      // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
      label: t(definition.labelKey),
    }))
}

export function createQuickSettingSections(t, usingElectron) {
  const sections = new Map()

  for (const definition of createQuickSettingCatalog(t, usingElectron)) {
    if (!sections.has(definition.section)) {
      sections.set(definition.section, {
        id: definition.section,
        // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
        label: t(SECTION_LABEL_KEYS[definition.section]),
        settings: [],
      })
    }
    sections.get(definition.section).settings.push({
      ...definition,
    })
  }

  return [...sections.values()]
}

/**
 * Pairs consecutive selects two at a time. An odd select at the end of a run
 * stays full-width instead of leaving an empty second column.
 *
 * @param {Array<{ control?: string }>} settings
 * @param {number} settingIndex
 */
export function isQuickSettingPaired(settings, settingIndex) {
  if (settings[settingIndex]?.control !== 'select') return false

  let runStart = settingIndex
  while (settings[runStart - 1]?.control === 'select') runStart--

  const positionInRun = settingIndex - runStart
  return positionInRun % 2 === 1 || settings[settingIndex + 1]?.control === 'select'
}

export const DEFAULT_QUICK_SETTINGS = Object.freeze([
  'baseTheme',
  'mainColor',
  'uiScale',
  'thumbnailSize',
  'defaultQuality',
  'playNextVideo',
  'enableSubtitlesByDefault',
  'listType',
  'playlistViewType',
  'hideRecommendedVideos',
  'hideComments',
  'currentLocale',
  'region',
])

const QUICK_SETTING_IDS = new Set(QUICK_SETTING_DEFINITIONS.map(({ id }) => id))

/**
 * Removes unknown and duplicate entries while preserving the user's order.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeQuickSettings(value) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_QUICK_SETTINGS]
  }

  return [...new Set(value.filter(id => QUICK_SETTING_IDS.has(id)))]
}
