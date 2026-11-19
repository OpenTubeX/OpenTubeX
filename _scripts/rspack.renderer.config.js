const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const createRendererConfig = require('./createRendererConfig')
const getMinimizers = require('./minimizers')
const getStartupSplash = require('./startupSplash')
const { SHAKA_LOCALES_TO_BE_BUNDLED } = require('./getShakaLocales')

const isDevMode = process.env.NODE_ENV === 'development'
const rendererPlatform = process.platform

for (const [name, requestedPlatform] of [
  ['OTX_PLATFORM', process.env.OTX_PLATFORM],
  ['npm_config_platform', process.env.npm_config_platform]
]) {
  if (requestedPlatform && requestedPlatform !== rendererPlatform) {
    throw new Error(`${name}=${requestedPlatform} does not match the packager platform ${rendererPlatform}`)
  }
}

const config = createRendererConfig({
  name: 'renderer',
  output: {
    scriptType: 'text/javascript',
    path: path.join(__dirname, '../dist'),
    filename: '[name].js',
  },
  cssTargets: getMinimizers.ELECTRON_TARGETS,
  minimizeJson: false,
  compressLocales: !isDevMode,
  dbHandlers: path.resolve(__dirname, '../src/datastores/handlers/electron.js'),
  define: {
    // build.mjs packages for the host OS, so reject mismatched target hints
    // above instead of compiling renderer behavior for a different platform.
    'process.platform': JSON.stringify(rendererPlatform),
    'process.env.IS_ELECTRON': true,
    'process.env.IS_CAPACITOR': false,
    'process.env.IS_IOS': false,
    'process.env.APP_URL_SCHEME': JSON.stringify('opentubex'),
    'process.env.SUPPORTS_LOCAL_API': true,
    'process.env.IS_SELF_HOSTED': false,
    'process.env.SELF_HOSTED_INVIDIOUS': false
  },
  templateParameters: {
    startupSplash: getStartupSplash()
  },
  copyPatterns: [
    getStartupSplash.copyPattern,
    // Don't need to copy them in dev mode,
    // as we configure the dev server to serve them
    ...(isDevMode
      ? []
      : [
          {
            from: path.join(__dirname, '../node_modules/shaka-player/ui/locales', `{${SHAKA_LOCALES_TO_BE_BUNDLED.join(',')}}.json`).replaceAll('\\', '/'),
            to: 'static/shaka-player-locales',
            context: path.join(__dirname, '../node_modules/shaka-player/ui/locales'),
            transform: {
              transformer: (input) => {
                return JSON.stringify(JSON.parse(input.toString('utf-8')))
              }
            }
          }
        ])
  ]
})

config.infrastructureLogging = {
  // Only warnings and errors
  // level: 'none' disable logging
  // Please read https://webpack.js.org/configuration/other-options/#infrastructurelogginglevel
  level: isDevMode ? 'info' : 'none'
}
// The renderer is loaded from the local Electron package, so Rspack's
// 250 kB web-delivery budget is not representative. Keep a realistic limit
// so unexpected bundle growth still produces a warning.
config.performance = {
  maxAssetSize: 4 * 1024 * 1024,
  maxEntrypointSize: 4 * 1024 * 1024
}
Object.assign(config.resolve.alias, {
  'youtubei.js$': 'youtubei.js/web',
  // Fix dompurify not being tree-shaking friendly
  dompurify$: path.resolve(__dirname, '_undefinedDefaultExport.mjs')
})

if (!isDevMode) {
  // The main build emits this UMD artifact once; keep renderer and utility
  // imports on that same implementation without sharing runtime state.
  config.externals = { 'youtubei.js': 'window OpenTubeXYouTube' }
  config.plugins.push({
    apply(compiler) {
      compiler.hooks.compilation.tap('SharedYouTubeLibrary', compilation => {
        HtmlWebpackPlugin.getHooks(compilation).alterAssetTags.tap('SharedYouTubeLibrary', data => {
          data.assetTags.scripts.unshift({
            tagName: 'script',
            voidTag: false,
            attributes: { defer: true, src: 'youtubei.js' },
            meta: { plugin: 'SharedYouTubeLibrary' }
          })
          return data
        })
      })
    }
  })
}

module.exports = config
