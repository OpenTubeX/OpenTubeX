// Controls of the player menu. Controls with a setting key keep their own
// setting for whether the menu shows them, which also turns the feature on or
// off. Control bar buttons that are not on the control bar join the menu.
export const PLAYER_MENU_CONTROL_DEFINITIONS = Object.freeze([
  { id: 'audioTracks', labelKey: 'Video.Player.Audio Tracks', icon: ['fas', 'podcast'] },
  { id: 'captions', labelKey: 'Settings.Player Settings.Caption Appearance.Captions', icon: ['fas', 'closed-captioning'] },
  { id: 'playbackRate', labelKey: 'Settings.Player Settings.Playback Speed', icon: ['fas', 'gauge'] },
  { id: 'quality', labelKey: 'Settings.Interface Customizer.Resolution', icon: ['fas', 'sliders-h'] },
  { id: 'sleepTimer', labelKey: 'Video.Player.Sleep Timer.Sleep Timer', icon: ['fas', 'clock'] },
  { id: 'autoplay', labelKey: 'Video.Autoplay', icon: ['fas', 'autoplay'] },
  { id: 'seekHistory', labelKey: 'Video.Player.Seek History.Seek History', icon: ['fas', 'history'], settingKey: 'enableSeekHistory' },
  { id: 'chapters', labelKey: 'Chapters.Chapters', icon: ['fas', 'list'] },
  { id: 'skipSilence', labelKey: 'Settings.Player Settings.Skip Silence', icon: ['fas', 'step-forward'], settingKey: 'showSkipSilenceButton', unavailableOnIos: true },
  { id: 'voiceOverTranslation', labelKey: 'Settings.Player Settings.Voice-over Translation.Title', icon: ['fas', 'language'], unavailableOnIos: true },
  { id: 'musicVisualizer', labelKey: 'Settings.Player Settings.Music Visualizer', icon: ['fas', 'music'] },
  { id: 'musicMode', labelKey: 'Video.Player.Music Mode', icon: ['fas', 'headphones'], settingKey: 'showMusicModeToggle' },
  { id: 'ambientMode', labelKey: 'Global.Ambient Mode', icon: ['fas', 'sun'] },
  { id: 'lightsOff', labelKey: 'Settings.Player Settings.Lights Off', icon: ['fas', 'moon'], settingKey: 'showLightsOffToggle' },
  { id: 'videoZoom', labelKey: 'Video.Player.Zoom.Zoom', icon: ['fas', 'magnifying-glass'], settingKey: 'enableVideoZoom' },
  { id: 'volumeBoost', labelKey: 'Video.Player.Volume Boost.Volume Boost', icon: ['fas', 'volume-high'], settingKey: 'showVolumeBoostToggle', unavailableOnIos: true },
  { id: 'monoAudio', labelKey: 'Settings.Player Settings.Mono Audio', icon: ['fas', 'speaker'], settingKey: 'showMonoAudioToggle', unavailableOnIos: true },
  { id: 'loop', labelKey: 'Settings.Interface Customizer.Loop', icon: ['fas', 'retweet'] },
  { id: 'abRepeat', labelKey: 'Video.Player.A-B Repeat.A-B Repeat', icon: ['fas', 'exchange-alt'], settingKey: 'disableAbRepeat', inverted: true },
  { id: 'screenshot', labelKey: 'Video.Player.Take Screenshot', icon: ['fas', 'camera'], settingKey: 'enableScreenshot' },
  { id: 'pictureInPicture', labelKey: 'Settings.Player Settings.Default Viewing Mode.Picture in Picture', icon: ['fas', 'picture-in-picture'] },
  { id: 'theatreMode', labelKey: 'Video.Player.Theatre Mode', icon: ['fas', 'theatre-mode'], desktopOnly: true },
  { id: 'fullWindow', labelKey: 'Video.Player.Full Window', icon: ['fas', 'full-window'], desktopOnly: true },
])

const IS_MOBILE = !!process.env.IS_CAPACITOR
const IS_IOS = !!process.env.IS_IOS

/**
 * @param {boolean} mobile
 * @param {boolean} ios
 */
export function getPlayerMenuControlDefinitions(mobile = IS_MOBILE, ios = IS_IOS) {
  return PLAYER_MENU_CONTROL_DEFINITIONS.filter(control => (
    (!mobile || !control.desktopOnly) && (!ios || !control.unavailableOnIos)
  ))
}

/**
 * The menu order each platform had before it was customizable. The compact
 * menu of phones starts with the playback settings.
 * @param {boolean} mobile
 */
export function getDefaultPlayerMenuControls(mobile = IS_MOBILE) {
  const ids = PLAYER_MENU_CONTROL_DEFINITIONS.map(({ id }) => id)
  if (!mobile) return ids
  const first = ['quality', 'playbackRate', 'captions', 'audioTracks', 'sleepTimer', 'seekHistory', 'autoplay', 'chapters']
  return [...first, ...ids.filter(id => !first.includes(id))]
}

/**
 * Orders every control, so a control keeps its place while it is on the
 * control bar or hidden. Unknown and duplicate entries are removed, and
 * missing controls are added at their default position.
 * @param {unknown} value
 * @param {boolean} mobile
 */
export function normalizePlayerMenuControls(value, mobile = IS_MOBILE) {
  const defaults = getDefaultPlayerMenuControls(mobile)
  if (!Array.isArray(value)) return defaults
  const order = [...new Set(value.filter(id => defaults.includes(id)))]
  for (const [index, id] of defaults.entries()) {
    if (order.includes(id)) continue
    const previous = defaults.slice(0, index).findLast(other => order.includes(other))
    order.splice(previous === undefined ? 0 : order.indexOf(previous) + 1, 0, id)
  }
  return order
}

/**
 * Removes unknown and duplicate controls and the ones that have their own setting.
 * @param {unknown} value
 */
export function normalizeHiddenPlayerMenuControls(value) {
  if (!Array.isArray(value)) return []
  const ids = new Set(PLAYER_MENU_CONTROL_DEFINITIONS.filter(control => !control.settingKey).map(({ id }) => id))
  return [...new Set(value.filter(id => ids.has(id)))]
}

/**
 * Controls on the control bar show there instead, so they are never hidden.
 * @param {string[]} hiddenControls
 * @param {string[]} controlBarButtons
 */
export function withoutControlBarButtons(hiddenControls, controlBarButtons) {
  return hiddenControls.filter(id => !controlBarButtons.includes(id))
}
