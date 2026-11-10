/** @typedef {'minimize' | 'maximize' | 'close'} WindowControl */

const WINDOW_CONTROLS = new Set(['minimize', 'maximize', 'close'])

/**
 * Splits a GTK button layout, such as `close,minimize,maximize:`, into the
 * window controls on each side of the title bar. Other entries, such as the
 * app menu or KWin-only buttons, have no equivalent here.
 * @param {string} layout
 * @returns {{ left: WindowControl[], right: WindowControl[] }}
 */
export function parseWindowButtonLayout(layout) {
  const seen = new Set()
  /** @param {string | undefined} side */
  const parseSide = side => (side ?? '').split(',')
    .map(name => name.trim())
    .filter(name => WINDOW_CONTROLS.has(name) && !seen.has(name) && seen.add(name))

  const [left, right] = layout.split(':')
  return {
    left: /** @type {WindowControl[]} */ (parseSide(left)),
    right: /** @type {WindowControl[]} */ (parseSide(right))
  }
}
