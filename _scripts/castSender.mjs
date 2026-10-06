import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))

export async function prepareCastSender(output = 'dist', platform = process.platform, arch = process.arch) {
  const goPlatform = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform]
  const goArch = { x64: 'amd64', arm64: 'arm64', arm: 'arm', armv7l: 'arm' }[arch]
  if (!goPlatform || !goArch) throw new Error(`Unsupported Cast sender platform: ${platform}/${arch}`)
  const directory = resolve(root, output)
  const options = {
    cwd: resolve(root, '_scripts/cast-sender'),
    env: { ...process.env, CGO_ENABLED: '0', GOOS: goPlatform, GOARCH: goArch, GOARM: '7' },
    timeout: 180_000
  }
  await mkdir(directory, { recursive: true })
  await execFileAsync('go', ['build', '-mod=readonly', '-trimpath', '-ldflags=-s -w',
    '-o', resolve(directory, platform === 'win32' ? 'opentubex-cast.exe' : 'opentubex-cast'), '.'], options)
  // Include the licenses of modules actually linked into this target.
  const { stdout } = await execFileAsync('go', ['list', '-mod=readonly', '-deps', '-f',
    '{{if and .Module (not .Module.Main)}}{{.Module.Path}}|{{.Module.Dir}}{{end}}', '.'], options)
  const licenses = []
  for (const module of [...new Set(stdout.trim().split('\n').filter(Boolean))].sort()) {
    const [name, moduleDirectory] = module.split('|')
    const files = (await readdir(moduleDirectory)).filter(file => /^(license|copying|notice)(\.|$)/i.test(file)).sort()
    if (!files.length) throw new Error(`Missing Cast dependency license: ${name}`)
    for (const file of files) licenses.push(`${name} (${file})\n${await readFile(join(moduleDirectory, file), 'utf8')}`)
  }
  licenses.push(`Go standard library\n${await readFile(resolve(root, '_scripts/cast-sender/Go.LICENSE'), 'utf8')}`)
  licenses.push(`Chromium Cast protocol definitions\n${await readFile(resolve(root, '_scripts/cast-sender/CastProtocol.LICENSE'), 'utf8')}`)
  licenses.push(`OpenScreen Cast trust roots\n${await readFile(resolve(root, '_scripts/cast-sender/OpenScreen.LICENSE'), 'utf8')}`)
  await writeFile(join(directory, 'cast-sender-licenses.txt'), licenses.join('\n\n'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await prepareCastSender(process.argv[2])
}
