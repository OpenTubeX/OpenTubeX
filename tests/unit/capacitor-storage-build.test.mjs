import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'

for (const separator of ['/', '\\']) {
  test(`Capacitor replaces only NeDB storage with ${JSON.stringify(separator)} paths`, () => {
    const config = { plugins: [], entry: { web: 'app.js' } }
    let replace
    const dependencies = {
      path, 'node:child_process': { execFileSync() {} },
      'copy-webpack-plugin': class {},
      webpack: {
        NormalModuleReplacementPlugin: class { constructor(_pattern, callback) { replace = callback } },
        IgnorePlugin: class {},
      },
      './webpack.web.config': config,
      './webpack.botGuardScript.config': { output: {} },
    }
    vm.runInNewContext(readFileSync(new URL('../../_scripts/webpack.capacitor.config.js', import.meta.url), 'utf8'), {
      require: name => dependencies[name], process: { env: {}, execPath: 'node' },
      __dirname: '/project/_scripts', module: {},
    })
    const resource = { context: ['project', 'node_modules', '@seald-io', 'nedb', 'lib'].join(separator), request: './storage.js' }
    replace(resource)
    assert.equal(resource.request, '/project/src/datastores/androidStorage.js')
    const unrelated = { context: 'project/node_modules/other/lib', request: './storage.js' }
    replace(unrelated)
    assert.equal(unrelated.request, './storage.js')
  })
}
