const { relative, join } = require('path')

const PLUGIN_NAME = 'ProcessBoundaryPlugin'
const ROOT = join(__dirname, '..')

/**
 * Renderer code that depends on Vue, the store, the router or the DOM, and
 * packages that only work in a renderer. Plain helpers under
 * `src/renderer/helpers` and `src/renderer/constants` may be shared.
 */
const RENDERER_ONLY = [
  /[\\/]src[\\/]renderer[\\/](?:App\.vue|main\.js|components|composables|directives|router|store|tabs|views|i18n[\\/]index\.js)/,
  /\.vue$/,
  /[\\/]node_modules[\\/](?:vue|vuex|vue-router|vue-i18n|@vue|@capacitor|@capawesome|shaka-player)[\\/]/,
]

/**
 * Fails the main process and preload builds when they bundle renderer-only
 * code, which would also run its side effects, such as creating the store.
 * Reports the import chain that pulled the module in.
 */
class ProcessBoundaryPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap(PLUGIN_NAME, compilation => {
      compilation.hooks.finishModules.tap(PLUGIN_NAME, modules => {
        const isRendererOnly = module => typeof module?.resource === 'string' &&
          RENDERER_ONLY.some(pattern => pattern.test(module.resource))

        for (const module of modules) {
          if (!isRendererOnly(module)) continue

          const chain = []
          for (let current = module; current; current = compilation.moduleGraph.getIssuer(current)) {
            chain.unshift(current)
          }
          // Report only where the chain first crosses the boundary.
          if (chain.slice(0, -1).some(isRendererOnly)) continue

          compilation.errors.push(new compiler.webpack.WebpackError(
            `${PLUGIN_NAME}: the ${compiler.options.name} bundle must not include renderer-only modules:\n  ${chain.map(current => relative(ROOT, current.resource ?? current.identifier())).join('\n  -> ')}`
          ))
        }
      })
    })
  }
}

module.exports = ProcessBoundaryPlugin
