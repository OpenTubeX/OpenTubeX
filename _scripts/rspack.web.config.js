const path = require('path')
const { rspack } = require('@rspack/core')
const createRendererConfig = require('./createRendererConfig')
const getStartupSplash = require('./startupSplash')
const RelativeImportMetaUrlPlugin = require('./RelativeImportMetaUrlPlugin')
const getMinimizers = require('./minimizers')
const { SHAKA_LOCALES_TO_BE_BUNDLED } = require('./getShakaLocales')
const getStaticDataVersion = require('./staticDataVersion')

const isDevMode = process.env.NODE_ENV === 'development'
const isCapacitor = process.env.IS_CAPACITOR === 'true'
const isIos = isCapacitor && process.env.CAPACITOR_PLATFORM === 'ios'
const isSelfHosted = !isCapacitor && process.env.OPENTUBEX_SELF_HOSTED === 'true'
const outputPath = path.join(__dirname, isCapacitor ? '../dist/capacitor' : '../dist/web')

const config = createRendererConfig({
  name: 'web',
  output: {
    path: outputPath,
    // Hashed names let the browser build's service worker cache assets
    // cache-first without mixing files from different builds.
    filename: isDevMode || isCapacitor ? '[name].js' : '[name].[contenthash].js',
  },
  cssTargets: isIos ? getMinimizers.IOS_TARGETS : getMinimizers.WEB_TARGETS,
  minimizeJson: true,
  compressLocales: false,
  dbHandlers: path.resolve(__dirname, '../src/datastores/handlers/web.js'),
  define: {
    'process.platform': 'undefined',
    'process.env.IS_ELECTRON': false,
    'process.env.IS_CAPACITOR': isCapacitor,
    'process.env.IS_IOS': isIos,
    // Matches the scheme _scripts/prepareIos.mjs registers.
    'process.env.APP_URL_SCHEME': JSON.stringify(
      isIos && /-nightly-\d+$/.test(require('../package.json').version)
        ? 'opentubex-nightly'
        : 'opentubex'
    ),
    // The web app can only reach YouTube while the OpenTubeX Local API browser
    // extension (browser-extension/) rewrites the CORS headers for it.
    'process.env.SUPPORTS_LOCAL_API': isCapacitor || '(globalThis.opentubexExtension?.protocol === 1)',
    // The Docker image serves the web build, by default in front of its own
    // Invidious server. Its Caddyfile serves self-hosted.js, which says whether
    // the server runs one.
    'process.env.IS_SELF_HOSTED': isSelfHosted,
    'process.env.SELF_HOSTED_INVIDIOUS': isSelfHosted && '(globalThis.opentubexSelfHosted?.invidious !== false)',
    // The Capacitor apps bundle their files, so only browsers keep older copies
    'process.env.STATIC_DATA_VERSION': isCapacitor ? false : JSON.stringify(getStaticDataVersion())
  },
  html: {
    excludeChunks: ['processTaskWorker']
  },
  templateParameters: isCapacitor
    ? { startupSplash: getStartupSplash({ stillSplash: process.env.CAPACITOR_PLATFORM !== 'ios' }) }
    : { selfHosted: isSelfHosted },
  copyPatterns: [
    ...(isCapacitor
      ? [getStartupSplash.copyPattern]
      : [
          {
            from: path.join(__dirname, '../static/pwabuilder-sw.js'),
            to: path.join(outputPath, 'pwabuilder-sw.js'),
          },
          {
            from: path.join(__dirname, '../src/renderer/startup/register-service-worker.js'),
            to: path.join(outputPath, 'register-service-worker.js'),
          },
          {
            from: path.join(__dirname, '../_icons/icon.svg'),
            to: path.join(outputPath, 'icon.svg'),
          }
        ]),
    ...(isDevMode
      ? []
      : [
          {
            from: path.join(__dirname, '../static'),
            to: path.join(outputPath, 'static'),
            globOptions: {
              dot: true,
              ignore: ['**/.*', '**/locales/**', '**/pwabuilder-sw.js', '**/dashFiles/**', '**/storyboards/**'],
            },
          },
          {
            from: path.join(__dirname, '../node_modules/shaka-player/ui/locales', `{${SHAKA_LOCALES_TO_BE_BUNDLED.join(',')}}.json`).replaceAll('\\', '/'),
            to: path.join(outputPath, 'static/shaka-player-locales'),
            context: path.join(__dirname, '../node_modules/shaka-player/ui/locales')
          }
        ])
  ]
})

config.plugins.unshift(new RelativeImportMetaUrlPlugin())
config.plugins.push(new rspack.ProvidePlugin({
  process: 'process/browser.js'
}))

module.exports = config
