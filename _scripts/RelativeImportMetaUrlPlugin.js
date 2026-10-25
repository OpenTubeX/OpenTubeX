const path = require('path')
const { pathToFileURL } = require('url')
const { dependencies: { ConstDependency } } = require('webpack')

const PLUGIN_NAME = 'RelativeImportMetaUrlPlugin'

/**
 * Webpack replaces `import.meta.url` with the module's absolute file URL,
 * so bundles would depend on the checkout path. Use the path relative to
 * the project, as F-Droid rebuilds the APK in a different directory.
 * `new URL('./asset', import.meta.url)` assets are handled before this runs.
 */
class RelativeImportMetaUrlPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation, { normalModuleFactory }) => {
      const relativeUrl = parser => {
        const relativePath = path.relative(compiler.context, parser.state.module.resource)
        return new URL(relativePath.replaceAll('\\', '/'), pathToFileURL('/')).href
      }
      const handler = parser => {
        parser.hooks.expression.for('import.meta.url').tap({ name: PLUGIN_NAME, stage: -10 }, expression => {
          const dependency = new ConstDependency(JSON.stringify(relativeUrl(parser)), expression.range)
          dependency.loc = parser.getLocation(expression)
          parser.state.module.addPresentationalDependency(dependency)
          return true
        })
      }
      for (const type of ['javascript/auto', 'javascript/esm']) {
        normalModuleFactory.hooks.parser.for(type).tap(PLUGIN_NAME, handler)
      }
    })
  }
}

module.exports = RelativeImportMetaUrlPlugin
