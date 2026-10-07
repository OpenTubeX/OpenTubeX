import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { writeCastSenderLicenses } from './castSender.mjs'

const targets = {
  'arm64-v8a': ['arm64', 'aarch64-linux-android'],
  'armeabi-v7a': ['arm', 'armv7a-linux-androideabi'],
  x86_64: ['amd64', 'x86_64-linux-android'],
  x86: ['386', 'i686-linux-android']
}
const [output, ndk, abis = Object.keys(targets).join(',')] = process.argv.slice(2)
if (!output || !ndk) throw new Error('Usage: androidCastSender.mjs OUTPUT NDK [ABIS]')
const host = { linux: 'linux-x86_64', darwin: 'darwin-x86_64', win32: 'windows-x86_64' }[process.platform]
await rm(join(output, 'jniLibs'), { recursive: true, force: true })
await rm(join(output, 'licenses'), { recursive: true, force: true })
let options
for (const abi of abis.split(',')) {
  const target = targets[abi]
  if (!target) throw new Error(`Unsupported Cast ABI: ${abi}`)
  const [arch, triple] = target
  const directory = join(output, 'jniLibs', abi)
  await mkdir(directory, { recursive: true })
  options = {
    cwd: new URL('cast-sender/', import.meta.url),
    env: {
      ...process.env,
      GOOS: 'android',
      GOARCH: arch,
      GOARM: '7',
      CGO_ENABLED: '1',
      CC: join(ndk, 'toolchains/llvm/prebuilt', host, 'bin', `${triple}26-clang${process.platform === 'win32' ? '.cmd' : ''}`)
    },
    timeout: 180_000
  }
  await promisify(execFile)('go', ['build', '-mod=readonly', '-trimpath', '-buildmode=pie', '-ldflags=-s -w',
    '-o', join(directory, 'libopentubex_cast.so'), '.'], options)
}
// Use the same linked-module license bundle as the desktop sender.
await writeCastSenderLicenses(join(output, 'licenses'), options)
