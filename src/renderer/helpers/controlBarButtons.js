// Buttons at the end of the player's control bar. Mobile players always use
// the compact layout, which never shows the desktop-only buttons.
export const CONTROL_BAR_BUTTON_DEFINITIONS = Object.freeze([
  { id: 'autoplay', labelKey: 'Video.Autoplay', icon: ['fas', 'autoplay'], desktopOnly: true },
  { id: 'captions', labelKey: 'Settings.Player Settings.Caption Appearance.Captions', icon: ['fas', 'closed-captioning'] },
  { id: 'menu', labelKey: 'Settings.Interface Customizer.Player Menu', icon: ['fas', 'gear'], required: true },
  { id: 'pictureInPicture', labelKey: 'Settings.Player Settings.Default Viewing Mode.Picture in Picture', icon: ['fas', 'picture-in-picture'] },
  { id: 'theatreMode', labelKey: 'Video.Player.Theatre Mode', icon: ['fas', 'theatre-mode'], desktopOnly: true },
  { id: 'fullWindow', labelKey: 'Video.Player.Full Window', icon: ['fas', 'full-window'], desktopOnly: true },
  { id: 'fullscreen', labelKey: 'Settings.Interface Customizer.Fullscreen', icon: ['fas', 'fullscreen'] },
])

const IS_MOBILE = !!process.env.IS_CAPACITOR

/** @param {boolean} mobile */
export function getControlBarButtonDefinitions(mobile = IS_MOBILE) {
  return CONTROL_BAR_BUTTON_DEFINITIONS.filter(button => !mobile || !button.desktopOnly)
}

/**
 * Matches the layout each platform had before the buttons were customizable.
 * @param {boolean} mobile
 */
export function getDefaultControlBarButtons(mobile = IS_MOBILE) {
  return mobile
    ? ['captions', 'pictureInPicture', 'menu', 'fullscreen']
    : ['autoplay', 'captions', 'menu', 'pictureInPicture', 'theatreMode', 'fullWindow', 'fullscreen']
}

export const DEFAULT_CONTROL_BAR_BUTTONS = Object.freeze(getDefaultControlBarButtons())

/**
 * Removes unknown and duplicate buttons while preserving the selected order.
 * The player menu holds every other control, so it is always kept.
 * @param {unknown} value
 * @param {boolean} mobile
 */
export function normalizeControlBarButtons(value, mobile = IS_MOBILE) {
  if (!Array.isArray(value)) return getDefaultControlBarButtons(mobile)
  const ids = new Set(getControlBarButtonDefinitions(mobile).map(({ id }) => id))
  const buttons = [...new Set(value.filter(id => ids.has(id)))]
  return buttons.includes('menu') ? buttons : [...buttons, 'menu']
}
