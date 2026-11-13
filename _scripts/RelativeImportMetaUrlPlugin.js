const { pathToFileURL } = require('url')

const PLUGIN_NAME = 'RelativeImportMetaUrlPlugin'

/**
 * Rspack replaces `import.meta.url` with the module's absolute file URL,
 * so bundles would depend on the checkout path. Use the path relative to
 * the project, as F-Droid rebuilds the APK in a different directory.
 * `new URL('./asset', import.meta.url)` assets are resolved while bundling,
 * before this runs.
 */
class RelativeImportMetaUrlPlugin {
  /** @param {import('@rspack/core').Compiler} compiler */
  apply(compiler) {
    const { Compilation, sources } = compiler.rspack
    const projectUrl = `${pathToFileURL(compiler.context).href.replace(/\/$/, '')}/`

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
      compilation.hooks.processAssets.tap({
        name: PLUGIN_NAME,
        stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE
      }, assets => {
        for (const [name, asset] of Object.entries(assets)) {
          if (!/\.[cm]?js$/.test(name)) continue

          const source = asset.source().toString()
          if (source.includes(projectUrl)) {
            compilation.updateAsset(name, new sources.RawSource(source.replaceAll(projectUrl, 'file:///')))
          }
        }
      })
    })
  }
}

module.exports = RelativeImportMetaUrlPlugin
