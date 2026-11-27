const { createHash } = require('crypto')
const { readFileSync, readdirSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')

// The files the renderer fetches by fixed names, see `createStaticDataURL`
const sources = [
  ['static/locales', /\.yaml$/],
  ['static/locales/ai', /\.yaml$/],
  ['static/geolocations', /\.json$/],
  ['node_modules/shaka-player/ui/locales', /\.json$/],
  ['static', /^(invidious-instances|external-player-map)\.json$/],
]

/**
 * A hash of the static data files the browser build fetches. Their names stay
 * the same between builds, so the service worker and the HTTP cache would
 * otherwise serve the previous build's copies, such as locales without the
 * strings this build added.
 * @returns {string}
 */
module.exports = function getStaticDataVersion() {
  const hash = createHash('sha256')

  for (const [directory, pattern] of sources) {
    const filenames = readdirSync(join(root, directory)).filter(filename => pattern.test(filename)).sort()
    for (const filename of filenames) {
      hash.update(`${directory}/${filename}\0`)
      hash.update(readFileSync(join(root, directory, filename)))
    }
  }

  return hash.digest('hex').slice(0, 16)
}
