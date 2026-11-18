process.env.IS_CAPACITOR = 'true'

const fs = require('node:fs')
const path = require('path')
const { execFileSync } = require('node:child_process')
const { rspack } = require('@rspack/core')
const config = require('./rspack.web.config')
const botGuardConfig = require('./rspack.botGuardScript.config')

execFileSync(process.execPath, [path.join(__dirname, 'brand/generate-app-icon-presets.mjs')])
config.plugins.push(new rspack.CopyRspackPlugin({
  patterns: [{ from: path.join(__dirname, '../build/generated/app-icons/previews'), to: 'static/app-icons' }]
}))

config.name = 'capacitor'
config.plugins.push(new rspack.NormalModuleReplacementPlugin(/^\.\/storage\.js$/, resource => {
  const context = resource.context.replaceAll('\\', '/')
  if (context.includes('@seald-io/nedb') && context.endsWith('/lib')) {
    resource.request = path.join(__dirname, '../src/datastores/androidStorage.js')
  }
}),
// VOT uses window.crypto in WebViews; its Node fallback must stay out of this bundle.
new rspack.IgnorePlugin({ resourceRegExp: /^node:crypto$/ }))
// Release and F-Droid builds bundle the WebAssembly modules built from source
// by _scripts/androidWasm.mjs instead of the npm packages' prebuilt copies.
if (process.env.ANDROID_WASM_FROM_SOURCE) {
  const wasm = path.join(__dirname, '../build/android-wasm/out')
  const modules = {
    '@jitl/quickjs-wasmfile-release-sync/emscripten-module$': path.join(wasm, 'quickjs/emscripten-module.mjs'),
    '@jsquash/jxl/codec/enc/jxl_enc.js$': path.join(wasm, 'jxl/jxl_enc.js')
  }
  for (const file of Object.values(modules)) {
    if (!fs.existsSync(file)) throw new Error(`${file} is missing. Run node _scripts/androidWasm.mjs docker first.`)
  }
  Object.assign(config.resolve.alias, modules)
}
if (process.env.CAPACITOR_PLATFORM === 'ios') {
  config.entry.web = [config.entry.web, path.join(__dirname, '../src/renderer/helpers/iosSafeArea.css')]
}
botGuardConfig.name = 'capacitorBotGuardScript'
botGuardConfig.output.path = path.join(__dirname, '../dist/capacitor')

module.exports = [config, botGuardConfig]
