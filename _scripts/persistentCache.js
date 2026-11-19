const path = require('path')
const { readdirSync } = require('fs')

const root = path.join(__dirname, '..')

/**
 * Development and E2E builds keep their results in `node_modules/.cache/rspack`
 * and rebuild only what changed. Release builds always start from scratch,
 * so their output never depends on an earlier build.
 * `rspackProduction.mjs --persistent-cache` enables it for production builds.
 * @param {boolean} isDevMode
 * @returns {Pick<import('@rspack/core').Configuration, 'cache'>}
 */
module.exports = function getPersistentCache(isDevMode) {
  if (!isDevMode && process.env.OTX_PERSISTENT_CACHE !== 'true') {
    return {}
  }

  return {
    cache: {
      type: 'persistent',
      // Rspack only hashes these files, not what they require, so list every build script.
      buildDependencies: [
        ...readdirSync(__dirname)
          .filter(file => /\.(?:js|mjs)$/.test(file))
          .map(file => path.join(__dirname, file)),
        path.join(root, 'package.json'),
        path.join(root, 'pnpm-lock.yaml')
      ]
    }
  }
}
