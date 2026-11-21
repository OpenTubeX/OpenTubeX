import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

export async function prepareMacosNative(arch = process.arch, outputDirectory = 'dist') {
  const require = createRequire(import.meta.url)
  const directory = path.join(root, '_scripts/macos-native')
  const nodeDir = path.dirname(path.dirname(process.execPath))
  const args = [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild', `--arch=${arch}`]
  // Use the local Node headers when present so builds do not fail on transient
  // nodejs.org timeouts.
  if (existsSync(path.join(nodeDir, 'include/node/node_api.h'))) {
    args.push(`--nodedir=${nodeDir}`)
  }
  const result = spawnSync(process.execPath, args, {
    cwd: directory,
    stdio: 'inherit'
  })
  if (result.error || result.status !== 0) throw new Error('Could not build the macOS window integration', { cause: result.error })
  await mkdir(path.join(root, outputDirectory), { recursive: true })
  await copyFile(path.join(directory, 'build/Release/macos_native.node'), path.join(root, outputDirectory, 'macos_native.node'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.platform === 'darwin') {
  await prepareMacosNative(process.arch, process.argv[2] || 'dist')
}
