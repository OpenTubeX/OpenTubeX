const path = require('path')

const SOURCE_DIRECTORY = path.join(__dirname, '../src') + path.sep
const ABSOLUTE_LENGTH = /\d(?:px|rem)\b/i

/** @param {import('postcss').Declaration} declaration */
function scale(declaration) {
  const file = declaration.source?.input.file ?? ''
  if (!file.startsWith(SOURCE_DIRECTORY) || !ABSOLUTE_LENGTH.test(declaration.value) || declaration.value.includes('var(')) {
    return
  }

  declaration.value = `calc(${declaration.value} * var(--font-scale, 1))`
}

/**
 * Multiplies every px and rem `font-size`, `line-height`, and tab label size in the app's own
 * stylesheets by the Font Size setting (`--font-scale`). em, percentage, and
 * unitless values follow the font size already. Keywords, values that read a
 * variable (such as caption sizes), and third-party styles stay as they are.
 * Icons reset `--font-scale`, so sizes set on an icon itself stay fixed.
 * @type {import('postcss').PluginCreator<void>}
 */
const fontScale = () => ({
  postcssPlugin: 'opentubex-font-scale',
  Declaration: {
    'font-size': scale,
    'line-height': scale,
    // FtTabs reads its label size from this property.
    '--material-tab-font-size': scale
  }
})
fontScale.postcss = true

module.exports = fontScale
