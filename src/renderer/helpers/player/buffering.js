/**
 * Seconds of video shaka-player keeps around the playhead, as configured by the user.
 * @typedef {object} BufferSettings
 * @property {number} bufferAhead how much is loaded ahead of the playhead
 * @property {number} bufferBehind how much already watched video stays loaded for rewinding
 * @property {number} bufferBeforePlaying how much has to be loaded before playback starts or continues after a stall
 */

/** @type {Record<keyof BufferSettings, { min: number, max: number, step: number }>} */
export const BUFFER_SETTING_RANGES = {
  bufferAhead: { min: 10, max: 600, step: 5 },
  bufferBehind: { min: 10, max: 600, step: 5 },
  // Shaka requires the buffering goal to be at least the rebuffering goal,
  // so this can't go above the lowest buffer ahead
  bufferBeforePlaying: { min: 0, max: 10, step: 1 },
}

/** @type {Record<'dataSaver' | 'default' | 'smooth', BufferSettings>} */
export const BUFFER_PRESETS = {
  dataSaver: { bufferAhead: 15, bufferBehind: 300, bufferBeforePlaying: 0 },
  // YouTube uses these values and they seem to work well in FreeTube too
  default: { bufferAhead: 180, bufferBehind: 300, bufferBeforePlaying: 0 },
  smooth: { bufferAhead: 600, bufferBehind: 300, bufferBeforePlaying: 3 },
}

export const BUFFER_SETTING_KEYS = /** @type {(keyof BufferSettings)[]} */ (Object.keys(BUFFER_SETTING_RANGES))

/**
 * A rebuffering goal of 0 turns off shaka-player's own buffering detection,
 * so playback that should resume right away still needs a tiny one.
 */
const MIN_REBUFFERING_GOAL = 0.02

/**
 * @param {BufferSettings} settings
 * @returns {keyof BUFFER_PRESETS | 'custom'}
 */
export function findBufferPreset(settings) {
  const preset = Object.entries(BUFFER_PRESETS).find(([, values]) => (
    BUFFER_SETTING_KEYS.every(key => values[key] === settings[key])
  ))

  return /** @type {keyof BUFFER_PRESETS | undefined} */ (preset?.[0]) ?? 'custom'
}

/**
 * @param {keyof BufferSettings} key
 * @param {number} value
 */
function resolveBufferSetting(key, value) {
  if (!Number.isFinite(value)) {
    return BUFFER_PRESETS.default[key]
  }

  const { min, max } = BUFFER_SETTING_RANGES[key]
  return Math.min(Math.max(value, min), max)
}

/**
 * @param {BufferSettings} settings
 * @param {boolean} [progressive] whether the browser loads a single file itself (src=) instead of shaka-player streaming segments
 * @returns {Pick<shaka.extern.StreamingConfiguration, 'bufferingGoal' | 'bufferBehind' | 'rebufferingGoal'>}
 */
export function getBufferingConfig(settings, progressive = false) {
  return {
    bufferingGoal: resolveBufferSetting('bufferAhead', settings.bufferAhead),
    bufferBehind: resolveBufferSetting('bufferBehind', settings.bufferBehind),
    // The browser decides how far ahead it loads a progressive file, which can be less than the
    // rebuffering goal (about 2 seconds for long downloads). shaka-player then holds playback forever.
    rebufferingGoal: progressive
      ? MIN_REBUFFERING_GOAL
      : Math.max(resolveBufferSetting('bufferBeforePlaying', settings.bufferBeforePlaying), MIN_REBUFFERING_GOAL),
  }
}
