const path = require('path')
const { readFileSync } = require('fs')

// Android routes every native bridge call through the main thread, which an
// endless splash animation keeps busy redrawing. First-run startup makes many
// sequential calls, so animating there made it about three times slower. The
// boot script marks a launch without a cached appearance as the first one, and
// the whole splash holds still on it.
const STILL_SPLASH = '\n:root[data-first-launch] .startupSplash *, :root[data-first-launch] .startupSplash *::before { animation: none; }\n'

// Reuse the app's 9-sided cookie for the logo's container and for the hole
// the reveal grows through the splash.
function cookieShape() {
  const themes = readFileSync(path.join(__dirname, '../src/renderer/themes.css'), 'utf8')
  const polygon = themes.match(/--shape-cookie-9: (polygon\([^;]+\));/)[1]
  return `\n.startupSplash { --splash-cookie: ${polygon}; }\n`
}

// index.ejs loads it as boot.js; the page's Content-Security-Policy blocks inline scripts.
const STARTUP_SCRIPT = path.join(__dirname, '../src/renderer/startup/boot.js')

module.exports = ({ stillSplash = false } = {}) => ({
  styles: readFileSync(path.join(__dirname, '../src/renderer/startup/splash.css'), 'utf8') + cookieShape() + (stillSplash ? STILL_SPLASH : ''),
  logo: readFileSync(path.join(__dirname, '../_icons/iconColorSmall.svg'), 'utf8').replaceAll('#212121', 'currentColor')
})

module.exports.copyPattern = { from: STARTUP_SCRIPT, to: 'boot.js' }
