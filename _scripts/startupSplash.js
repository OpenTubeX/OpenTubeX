const path = require('path')
const { readFileSync } = require('fs')

// Android routes every native bridge call through the main thread, which an
// endless splash animation keeps busy redrawing. First-run startup makes many
// sequential calls, so animating there made it about three times slower. The
// boot script marks a launch without a cached appearance as the first one.
const STATIC_PROGRESS = '\n.startupSplash[data-first-launch] *, .startupSplash[data-first-launch] *::before { animation: none; }\n'

// Reuse the app's 9-sided cookie for the logo's container and, as a mask
// image, for the hole the reveal grows through the splash.
function cookieShape() {
  const themes = readFileSync(path.join(__dirname, '../src/renderer/themes.css'), 'utf8')
  const polygon = themes.match(/--shape-cookie-9: (polygon\([^;]+\));/)[1]
  const points = polygon.slice('polygon('.length, -1).split(',')
    .map(point => point.trim().split(/\s+/).map(value => parseFloat(value)).join(' '))
    .join(' ')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><polygon points='${points}'/></svg>`
  return `\n.startupSplash { --splash-cookie: ${polygon}; --splash-cookie-mask: url("data:image/svg+xml,${encodeURIComponent(svg)}"); }\n`
}

module.exports = ({ staticProgress = false } = {}) => ({
  styles: readFileSync(path.join(__dirname, '../src/renderer/startup/splash.css'), 'utf8') + cookieShape() + (staticProgress ? STATIC_PROGRESS : ''),
  script: readFileSync(path.join(__dirname, '../src/renderer/startup/boot.js'), 'utf8'),
  logo: readFileSync(path.join(__dirname, '../_icons/iconColorSmall.svg'), 'utf8').replaceAll('#212121', 'currentColor')
})
