const { rspack } = require('@rspack/core')
const { version: electronVersion } = require('electron/package.json')

const PLUGIN_NAME = 'JsonMinimizer'

/** Minifies emitted JSON files, such as the copied static data. */
const jsonMinimizer = {
  /** @param {import('@rspack/core').Compiler} compiler */
  apply(compiler) {
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
      compilation.hooks.processAssets.tap({
        name: PLUGIN_NAME,
        stage: rspack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE
      }, assets => {
        for (const name of Object.keys(assets).filter(name => name.endsWith('.json'))) {
          const json = JSON.stringify(JSON.parse(assets[name].source().toString()))
          compilation.updateAsset(name, new rspack.sources.RawSource(json))
        }
      })
    })
  }
}

/**
 * @param {object} options
 * @param {string|string[]} [options.cssTargets] browserslist query for the CSS minifier, which adds,
 *   removes and lowers syntax for it
 * @param {boolean} [options.json] also minify emitted JSON files
 */
function getMinimizers({ cssTargets, json = false } = {}) {
  return [
    new rspack.SwcJsMinimizerRspackPlugin({
      extractComments: true,
      minimizerOptions: { compress: { passes: 2 } }
    }),
    ...(cssTargets
      ? [new rspack.LightningCssMinimizerRspackPlugin({ minimizerOptions: { targets: cssTargets } })]
      : []),
    ...(json ? [jsonMinimizer] : [])
  ]
}

getMinimizers.ELECTRON_TARGETS = `electron >= ${electronVersion.split('.')[0]}`
// The oldest engines with :has(), container queries and color-mix(), which the styles need.
// Android uses these too, as its WebView is Chrome.
getMinimizers.WEB_TARGETS = ['chrome >= 111', 'firefox >= 121', 'safari >= 16.2', 'ios_saf >= 16.2']
// Keep in sync with IPHONEOS_DEPLOYMENT_TARGET in ios/App/App.xcodeproj.
getMinimizers.IOS_TARGETS = 'ios_saf >= 17.4'

module.exports = getMinimizers
