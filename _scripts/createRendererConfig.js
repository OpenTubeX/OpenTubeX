const path = require('path')
const { readFileSync, readdirSync } = require('fs')
const { rspack } = require('@rspack/core')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const { VueLoaderPlugin } = require('rspack-vue-loader')
const ProcessLocalesPlugin = require('./ProcessLocalesPlugin')
const getMinimizers = require('./minimizers')
const getPersistentCache = require('./persistentCache')
const postcssFontScale = require('./postcssFontScale')
const getBuildCommit = require('./buildCommit')
const {
  SHAKA_LOCALE_MAPPINGS,
  SHAKA_LOCALES_PREBUNDLED
} = require('./getShakaLocales')

const isDevMode = process.env.NODE_ENV === 'development'

const postcssLoader = {
  loader: 'postcss-loader',
  options: {
    postcssOptions: {
      // The CSS minimizer adds the vendor prefixes the targets need
      plugins: [postcssFontScale]
    }
  }
}

const { version: swiperVersion } = JSON.parse(readFileSync(path.join(__dirname, '../node_modules/swiper/package.json')))

/**
 * The renderer configuration shared by the Electron renderer and the web build,
 * which the Capacitor apps use too.
 * @param {object} options
 * @param {string} options.name compiler and entry name
 * @param {import('@rspack/core').Configuration['output']} options.output
 * @param {string|string[]} options.cssTargets browserslist query for the CSS minifier
 * @param {boolean} options.minimizeJson also minify emitted JSON files
 * @param {boolean} options.compressLocales Brotli-compress the locale files
 * @param {string} options.dbHandlers file for the `DB_HANDLERS_ELECTRON_RENDERER_OR_WEB` import
 * @param {Record<string, any>} options.define build-specific DefinePlugin values
 * @param {Record<string, any>} options.templateParameters for `src/index.ejs`
 * @param {object} [options.html] additional HtmlWebpackPlugin options
 * @param {any[]} [options.copyPatterns] additional CopyRspackPlugin patterns
 * @returns {import('@rspack/core').Configuration}
 */
module.exports = function createRendererConfig({
  name,
  output,
  cssTargets,
  minimizeJson,
  compressLocales,
  dbHandlers,
  define,
  templateParameters,
  html = {},
  copyPatterns = []
}) {
  const processLocalesPlugin = new ProcessLocalesPlugin({
    compress: compressLocales,
    hotReload: isDevMode,
    inputDir: path.join(__dirname, '../static/locales'),
    outputDir: 'static/locales',
  })

  const processAILocalesPlugin = new ProcessLocalesPlugin({
    activeLocales: processLocalesPlugin.activeLocales,
    allowMissing: true,
    collectMetadata: false,
    compress: compressLocales,
    hotReload: isDevMode,
    inputDir: path.join(__dirname, '../static/locales/ai'),
    localeSource: 'ai',
    outputDir: 'static/locales/ai',
  })

  return {
    name,
    mode: process.env.NODE_ENV,
    devtool: isDevMode ? 'eval-cheap-module-source-map' : false,
    ...getPersistentCache(isDevMode),
    entry: {
      [name]: path.join(__dirname, '../src/renderer/main.js'),
    },
    output,
    module: {
      rules: [
        {
          // Only the OPFS pool VFS is used. Do not bundle the library's
          // optional worker API, which it starts with `new Worker()`.
          test: /node_modules[\\/]@sqlite\.org[\\/]sqlite-wasm[\\/]/,
          parser: { worker: false },
        },
        {
          test: /\.vue$/,
          loader: 'rspack-vue-loader',
          options: {
            compilerOptions: {
              isCustomElement: (tag) => tag === 'swiper-container' || tag === 'swiper-slide'
            }
          }
        },
        {
          test: /\.scss$/,
          use: [
            {
              loader: rspack.CssExtractRspackPlugin.loader,
            },
            {
              loader: 'css-loader',
              options: {
                esModule: false
              }
            },
            postcssLoader,
            {
              loader: 'sass-loader',
              options: {
                implementation: require('sass')
              }
            },
          ],
        },
        {
          test: /\.css$/,
          use: [
            {
              loader: rspack.CssExtractRspackPlugin.loader
            },
            {
              loader: 'css-loader',
              options: {
                esModule: false
              }
            },
            postcssLoader
          ],
          rules: [
            {
              resource: require.resolve('shaka-player/dist/controls.css'),
              use: path.join(__dirname, 'patch-shaka-player-loader.js')
            }
          ],
        },
        {
          test: /\.(png|jpe?g|gif|tif?f|bmp|webp|svg)(\?.*)?$/,
          oneOf: [
            {
              resourceQuery: /inline/,
              type: 'asset/inline'
            },
            {
              type: 'asset/resource',
              generator: {
                filename: 'imgs/[name][ext]'
              }
            }
          ]
        },
        {
          test: /\.(woff2?|eot|ttf|otf)(\?.*)?$/,
          type: 'asset/resource',
          generator: {
            filename: 'fonts/[name][ext]'
          }
        },
      ],
      generator: {
        json: {
          JSONParse: false
        }
      }
    },
    // Rspack only minimizes production builds, so having this here is fine
    optimization: {
      minimizer: getMinimizers({ cssTargets, json: minimizeJson })
    },
    node: {
      __dirname: false,
      __filename: false
    },
    plugins: [
      processLocalesPlugin,
      processAILocalesPlugin,
      new rspack.DefinePlugin({
        ...define,
        'process.env.IS_ELECTRON_MAIN': false,
        'process.env.BUILD_COMMIT': JSON.stringify(getBuildCommit()),
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        __VUE_I18N_LEGACY_API__: 'false',
        __VUE_I18N_FULL_INSTALL__: 'false',
        __INTLIFY_PROD_DEVTOOLS__: 'false',
        'process.env.LOCALE_NAMES': JSON.stringify(processLocalesPlugin.localeNames),
        'process.env.LOCALE_TRANSLATION_PERCENTAGES': JSON.stringify(processLocalesPlugin.localeTranslationPercentages),
        'process.env.AI_LOCALES': JSON.stringify([...processAILocalesPlugin.locales.keys()]),
        'process.env.GEOLOCATION_NAMES': JSON.stringify(readdirSync(path.join(__dirname, '..', 'static', 'geolocations')).map(filename => filename.replace('.json', ''))),
        'process.env.SWIPER_VERSION': `'${swiperVersion}'`,
        'process.env.SHAKA_LOCALE_MAPPINGS': JSON.stringify(SHAKA_LOCALE_MAPPINGS),
        'process.env.SHAKA_LOCALES_PREBUNDLED': JSON.stringify(SHAKA_LOCALES_PREBUNDLED)
      }),
      new HtmlWebpackPlugin({
        ...html,
        filename: 'index.html',
        template: path.resolve(__dirname, '../src/index.ejs'),
        templateParameters
      }),
      new VueLoaderPlugin(),
      new rspack.CssExtractRspackPlugin({
        filename: isDevMode ? '[name].css' : '[name].[contenthash].css',
        chunkFilename: isDevMode ? '[id].css' : '[id].[contenthash].css',
        // Route-level chunks can discover scoped Vue styles in different orders.
        // Their selectors cannot affect one another, so no global order is needed.
        ignoreOrder: true,
      }),
      new rspack.CopyRspackPlugin({
        patterns: [
          {
            from: '*/LICENSE',
            context: path.join(__dirname, '../node_modules/@fontsource-variable'),
            to: 'fonts/licenses/[path][name][ext]'
          },
          {
            from: path.join(__dirname, '../src/renderer/assets/font/libron/LICENSE'),
            to: 'fonts/licenses/libron'
          },
          {
            from: path.join(__dirname, '../node_modules/swiper/modules/a11y-element.css').replaceAll('\\', '/'),
            to: `swiper-${swiperVersion}.css`,
            context: path.join(__dirname, '../node_modules/swiper/modules')
          },
          ...copyPatterns
        ]
      })
    ],
    resolve: {
      fallback: {
        // Feed parsing uses sax.parser, not its optional Node stream wrapper.
        stream: false,
        // @hpke/core prefers Web Crypto in supported browsers. Its old-Node
        // fallback is unreachable in the renderer and must not be bundled.
        crypto: false
      },
      alias: {
        '@root': path.resolve(__dirname, '..'),
        DB_HANDLERS_ELECTRON_RENDERER_OR_WEB$: dbHandlers,

        // change to "shaka-player.ui-es2021.debug.js" to get debug logs (update jsconfig to get updated types)
        'shaka-player$': 'shaka-player/dist/shaka-player.ui-es2021.js',

        '@opentubex/icons$': path.resolve(__dirname, '../src/renderer/icons/iconComponents.js')
      },
      extensions: ['.js', '.vue']
    },
    target: 'web',
  }
}
