import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import net from 'node:net'
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

test('main D-Bus bundling excludes Bun loaders and preserves Node socket connections', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dbus-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const compiler = webpack({
    ...config,
    mode: 'production',
    devtool: false,
    entry: { address: require.resolve('dbus-native/lib/address.js') },
    plugins: [],
    optimization: { minimize: false },
    output: { ...config.output, path: directory }
  })
  t.after(() => new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve())))
  const stats = await new Promise((resolve, reject) => compiler.run((error, result) => error ? reject(error) : resolve(result)))
  assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }))
  assert.equal(stats.hasWarnings(), false, stats.toString({ all: false, warnings: true }))
  const source = await readFile(path.join(directory, 'address.js'), 'utf8')
  assert.ok(!source.includes('bun:ffi'), 'Electron must not bundle the Bun-only transport')
  const { connectToAddress } = require(path.join(directory, 'address.js'))
  const server = net.createServer(socket => socket.end('connected'))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\opentubex-dbus-${path.basename(directory)}`
    : path.join(directory, 'bus')
  server.listen(socketPath)
  await once(server, 'listening')
  for (const options of [undefined, { fdTransport: true }, { fdTransport: false }]) {
    const socket = connectToAddress(`unix:path=${socketPath}`, options)
    t.after(() => socket.destroy())
    let received = ''
    for await (const chunk of socket) received += chunk.toString()
    assert.equal(received, 'connected')
  }
})
