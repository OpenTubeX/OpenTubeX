import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const UNKNOWN_VALUES = new Set(['', 'n/a', 'unknown'])

function cleanValue(value) {
  if (typeof value !== 'string') return ''
  let cleaned = value.trim()
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1)
  }
  return cleaned
    .replaceAll(/\\(["'\\$`])/g, '$1')
    .replaceAll(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .trim()
}

function distribution(name, version) {
  const platform = cleanValue(name)
  let release = cleanValue(version)
  if (UNKNOWN_VALUES.has(platform.toLowerCase())) return null
  if (UNKNOWN_VALUES.has(release.toLowerCase()) ||
      platform.toLowerCase().includes(release.toLowerCase())) {
    release = ''
  }
  return { platform, release }
}

export function parseLsbRelease(output) {
  const values = new Map()
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    values.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1))
  }
  return distribution(
    values.get('description') || values.get('distributor id'),
    values.get('release')
  )
}

export function parseReleaseFile(contents) {
  const values = new Map()
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (match) values.set(match[1], cleanValue(match[2]))
  }
  if (values.size === 0) return distribution(contents.split(/\r?\n/, 1)[0], '')
  return distribution(
    values.get('PRETTY_NAME') || values.get('DISTRIB_DESCRIPTION') ||
      values.get('NAME') || values.get('DISTRIB_ID'),
    values.get('VERSION_ID') || values.get('DISTRIB_RELEASE') ||
      values.get('VERSION') || values.get('BUILD_ID')
  )
}

async function runLsbRelease() {
  const { stdout } = await execFileAsync('lsb_release', ['-a'], {
    encoding: 'utf8',
    timeout: 1000,
    windowsHide: true,
    maxBuffer: 16 * 1024,
  })
  return stdout
}

async function releaseFilePaths(listEtcFiles) {
  const names = await listEtcFiles('/etc')
  return names
    .filter(name => name.endsWith('-release') && name !== 'os-release')
    .sort()
    .map(name => `/etc/${name}`)
}

export async function getLinuxDistributionInfo({
  isFlatpak = process.env.FLATPAK_ID !== undefined,
  getLsbRelease = runLsbRelease,
  readReleaseFile = (filePath) => readFile(filePath, 'utf8'),
  listEtcFiles = readdir,
} = {}) {
  const filePaths = [
    ...(isFlatpak ? ['/run/host/os-release'] : []),
    '/etc/os-release',
    '/usr/lib/os-release',
  ]

  if (!isFlatpak) {
    try {
      const info = parseLsbRelease(await getLsbRelease())
      if (info) return info
    } catch {}
  }

  try {
    filePaths.push(...await releaseFilePaths(listEtcFiles))
  } catch {}

  for (const filePath of [...new Set(filePaths)]) {
    try {
      const info = parseReleaseFile(await readReleaseFile(filePath))
      if (info) return info
    } catch {}
  }

  if (isFlatpak) {
    try {
      return parseLsbRelease(await getLsbRelease())
    } catch {}
  }
  return null
}
