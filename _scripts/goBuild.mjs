import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const androidTargets = {
  'arm64-v8a': ['arm64', 'aarch64-linux-android'],
  'armeabi-v7a': ['arm', 'armv7a-linux-androideabi'],
  x86_64: ['amd64', 'x86_64-linux-android'],
  x86: ['386', 'i686-linux-android']
}

export async function buildAndroidGo(module, executable, output, ndk, abis = Object.keys(androidTargets).join(',')) {
  const host = { linux: 'linux-x86_64', darwin: 'darwin-x86_64', win32: 'windows-x86_64' }[process.platform]
  await rm(join(output, 'jniLibs'), { recursive: true, force: true })
  await rm(join(output, 'licenses'), { recursive: true, force: true })
  let options
  for (const abi of abis.split(',')) {
    const target = androidTargets[abi]
    if (!target) throw new Error(`Unsupported Android Go ABI: ${abi}`)
    const [arch, triple] = target
    const directory = join(output, 'jniLibs', abi)
    await mkdir(directory, { recursive: true })
    options = {
      cwd: module,
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
    await execFileAsync('go', ['build', '-mod=readonly', '-trimpath', '-buildmode=pie', '-ldflags=-s -w',
      '-o', join(directory, executable), '.'], options)
  }
  return options
}

export async function readGoDependencyLicenses(options) {
  // Include the licenses of modules actually linked into this target.
  const { stdout } = await execFileAsync('go', ['list', '-mod=readonly', '-deps', '-f',
    '{{if and .Module (not .Module.Main)}}{{.Module.Path}}|{{.Module.Dir}}{{end}}', '.'], options)
  const licenses = []
  for (const module of [...new Set(stdout.trim().split('\n').filter(Boolean))].sort()) {
    const [name, directory] = module.split('|')
    const files = (await readdir(directory)).filter(file => /^(license|copying|notice)(\.|$)/i.test(file)).sort()
    if (!files.length) throw new Error(`Missing Go dependency license: ${name}`)
    for (const file of files) licenses.push(`${name} (${file})\n${await readFile(join(directory, file), 'utf8')}`)
  }
  licenses.push(`Go standard library\n${await readFile(new URL('cast-sender/Go.LICENSE', import.meta.url), 'utf8')}`)
  return licenses
}
