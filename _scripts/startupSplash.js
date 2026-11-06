const path = require('path')
const { readFileSync } = require('fs')

// Android routes every native bridge call through the main thread, which an
// endless splash animation keeps busy redrawing. First-run startup makes many
// sequential calls, so animating there made it about three times slower. The
// boot script marks a launch without a cached appearance as the first one.
const STATIC_PROGRESS = '\n.startupSplash[data-first-launch] .startupProgress { animation: none; transform: translateX(-35%); }\n'

module.exports = ({ staticProgress = false } = {}) => ({
  styles: readFileSync(path.join(__dirname, '../src/renderer/startup/splash.css'), 'utf8') + (staticProgress ? STATIC_PROGRESS : ''),
  script: readFileSync(path.join(__dirname, '../src/renderer/startup/boot.js'), 'utf8'),
  logo: readFileSync(path.join(__dirname, '../_icons/iconColorSmall.svg'), 'utf8').replaceAll('#212121', 'currentColor')
})
