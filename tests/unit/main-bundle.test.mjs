import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import webpack from 'webpack'
import config from '../../_scripts/webpack.main.config.js'

const require = createRequire(import.meta.url)

test('main bundling includes font-list dependencies and preserves the runtime Windows addon loader', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-main-bundle-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const compiler = webpack({
    ...config,
    mode: 'production',
    devtool: false,
    entry: {
      fonts: path.join(path.dirname(require.resolve('font-list')), 'index.mjs'),
      share: path.resolve(import.meta.dirname, '../../src/main/desktopShare.js')
    },
    plugins: [],
    optimization: { minimize: false },
    output: { ...config.output, path: directory }
  })
  t.after(() => new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve())))
  const stats = await new Promise((resolve, reject) => compiler.run((error, result) => error ? reject(error) : resolve(result)))
  assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }))
  assert.equal(stats.hasWarnings(), false, stats.toString({ all: false, warnings: true }))
  const fonts = await readFile(path.join(directory, 'fonts.js'), 'utf8')
  assert.ok(!fonts.includes('file://'), 'font loading must not retain a build-time module URL')
  assert.equal(typeof require(path.join(directory, 'fonts.js')).getFonts, 'function')
  const { loadWindowsShare } = require(path.join(directory, 'share.js'))
  assert.throws(() => loadWindowsShare(directory, false), error =>
    error.code === 'MODULE_NOT_FOUND' && error.message.includes(path.join(directory, 'windows_share.node')))
})
