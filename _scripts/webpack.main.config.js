const path = require('path')
const webpack = require('webpack')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const JsonMinimizerPlugin = require('json-minimizer-webpack-plugin')

const isDevMode = process.env.NODE_ENV === 'development'

/** @type {import('webpack').Configuration} */
const config = {
  name: 'main',
  mode: process.env.NODE_ENV,
  devtool: isDevMode ? 'eval-cheap-module-source-map' : false,
  entry: {
    main: path.join(__dirname, '../src/main/index.js'),
    subscriptionBackgroundWorker: path.join(__dirname, '../src/main/subscriptionBackgroundWorker.js'),
  },
  module: {
    rules: [
      {
        // The Windows addon path is resolved at runtime. Dependencies such as
        // font-list still need webpack to follow their static createRequire calls.
        include: path.join(__dirname, '../src/main/desktopShare.js'),
        parser: { createRequire: false },
      },
    ],
    generator: {
      json: {
        JSONParse: false
      }
    }
  },
  resolve: {
    alias: {
      // electron-context-menu only needs mime-db for its "save as" feature.
      // As we only activate the save image and save as image features,
      // we can remove all other mimetypes, as they will never get used.
      // Which results in quite a significant reduction in file size.
      //
      // Only the extensions field is needed, see: https://github.com/kevva/ext-list/blob/v2.2.2/index.js
      'mime-db$': path.join(__dirname, 'image-extensions-only-mime-db.json')
    }
  },
  // webpack defaults to only optimising the production builds, so having this here is fine
  optimization: {
    minimizer: [
      '...', // extend webpack's list instead of overwriting it
      new JsonMinimizerPlugin({
        exclude: /\/locales\/.*\.json/
      })
    ]
  },
  node: {
    __dirname: isDevMode,
    __filename: isDevMode
  },
  plugins: [
    new webpack.DefinePlugin({
      // Do not bake process.platform here. Cross-compiling (e.g. macOS
      // builds on Linux) would otherwise hardcode the build host OS and
      // download the wrong managed yt-dlp/ffmpeg binaries at runtime.
      'process.env.IS_ELECTRON_MAIN': true,
      'process.env.SUPPORTS_LOCAL_API': true
    })
  ],
  output: {
    filename: '[name].js',
    libraryTarget: 'commonjs2',
    path: path.join(__dirname, '../dist'),
  },
  target: 'electron-main',
}

if (!isDevMode) {
  // Ship one youtubei module for the renderer and the headless feed process.
  // Its web adapter uses standard fetch/crypto globals, available in both.
  config.entry.youtubei = {
    import: 'youtubei.js/web',
    library: { name: 'OpenTubeXYouTube', type: 'umd' }
  }
  config.output.globalObject = 'globalThis'
  // youtubei's dependencies must also use browser exports: fflate's Node
  // adapter eagerly requires worker_threads, which a renderer cannot load.
  config.module.rules.push({
    test: /node_modules[\\/]youtubei\.js[\\/]/,
    resolve: { conditionNames: ['browser', 'import', 'default'] }
  })
  config.externals = [({ request }, callback) => {
    callback(null, request === 'youtubei.js' ? 'commonjs ./youtubei.js' : undefined)
  }]
  config.plugins.push(
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.join(__dirname, '../static'),
          to: 'static',
          globOptions: {
            dot: true,
            ignore: ['**/.*', '**/locales/**', '**/pwabuilder-sw.js', '**/manifest.json', '**/dashFiles/**', '**/storyboards/**'],
          },
        },
        {
          from: path.join(path.dirname(require.resolve('font-list')), 'libs/darwin/fontlist'),
          to: 'fontlist',
          toType: 'file'
        },
      ]
    })
  )
}

module.exports = config
