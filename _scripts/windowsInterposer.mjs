import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const WINDOWS_INTERPOSER_VERSION = '1.1.0'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const sourceDirectory = path.join(
  repositoryRoot,
  '_scripts',
  'windows-interposer'
)
const cacheDirectory = path.join(
  repositoryRoot,
  '.cache',
  'windows-interposer',
  WINDOWS_INTERPOSER_VERSION
)
const preparedProxyPath = path.join(cacheDirectory, 'version.dll')
const archivePath = path.join(cacheDirectory, 'interposer.zip')
const archiveUrl = `https://github.com/LANCommander/LANCommander.Interposer/releases/download/v${WINDOWS_INTERPOSER_VERSION}/LANCommander.Interposer.v${WINDOWS_INTERPOSER_VERSION}.zip`
const archiveSha256 = '0f89a4caf97344c7cae7cde15ecada5701f6d002149e596e4779447bf31078c2'
const proxySha256 = 'c0dc211e358d79c3116c7e6ef431641af7aab89fad925ea49a42527fbfdae712'
const preparedProxySha256 = '8014ad2b7f92c413a7cbdd4a902609681ec23e0b4009c74db90e2c2b64f54601'
const interposerTempLogName = Buffer.from('Interposer.log\0', 'utf16le')
const dosHeaderSignature = 0x5A4D
const peHeaderOffsetPosition = 0x3C
const peHeaderSignature = 0x00004550
const windowsX64Machine = 0x8664

function sha256 (contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function assertSha256 (contents, expected, name) {
  const actual = sha256(contents)
  if (actual !== expected) {
    throw new Error(`${name} has SHA-256 ${actual}; expected ${expected}`)
  }
}

export function verifyWindowsX64Dll (contents) {
  if (contents.length < 0x40 || contents.readUInt16LE(0) !== dosHeaderSignature) {
    throw new Error('LANCommander Interposer is not a Windows PE file')
  }

  const peHeaderOffset = contents.readUInt32LE(peHeaderOffsetPosition)
  if (peHeaderOffset + 6 > contents.length ||
      contents.readUInt32LE(peHeaderOffset) !== peHeaderSignature) {
    throw new Error('LANCommander Interposer has an invalid PE header')
  }
  if (contents.readUInt16LE(peHeaderOffset + 4) !== windowsX64Machine) {
    throw new Error('LANCommander Interposer is not an x64 DLL')
  }
}

export function disableInterposerTempLog (contents) {
  const output = Buffer.from(contents)
  const firstMatch = output.indexOf(interposerTempLogName)
  const secondMatch = firstMatch === -1
    ? -1
    : output.indexOf(interposerTempLogName, firstMatch + interposerTempLogName.length)

  if (firstMatch === -1 || secondMatch !== -1) {
    throw new Error('LANCommander Interposer has an unexpected diagnostic log marker')
  }

  // Upstream writes Interposer.log to %TEMP% before its file hooks exist. An
  // empty filename makes that diagnostic CreateFile call fail without touching
  // the host. Electron Builder signs the prepared DLL with the application.
  output.writeUInt16LE(0, firstMatch)
  return output
}

async function downloadArchive () {
  if (existsSync(archivePath)) {
    const cachedArchive = await readFile(archivePath)
    if (sha256(cachedArchive) === archiveSha256) return cachedArchive
  }

  const response = await fetch(archiveUrl)
  if (!response.ok) {
    throw new Error(`Could not download LANCommander Interposer: ${response.status} ${response.statusText}`)
  }

  const archive = Buffer.from(await response.arrayBuffer())
  assertSha256(archive, archiveSha256, 'LANCommander Interposer archive')
  const temporaryArchivePath = `${archivePath}.tmp`
  await writeFile(temporaryArchivePath, archive)
  await rm(archivePath, { force: true })
  await rename(temporaryArchivePath, archivePath)
  return archive
}

export async function prepareWindowsInterposer (platform = process.platform) {
  if (platform !== 'win32') return

  await mkdir(cacheDirectory, { recursive: true })
  if (existsSync(preparedProxyPath)) {
    const preparedProxy = await readFile(preparedProxyPath)
    if (sha256(preparedProxy) === preparedProxySha256) return
  }

  await downloadArchive()
  const extractionDirectory = path.join(cacheDirectory, 'extracted')
  await rm(extractionDirectory, { recursive: true, force: true })
  await mkdir(extractionDirectory, { recursive: true })
  const tarExecutable = process.platform === 'win32'
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'bsdtar'
  const extraction = spawnSync(tarExecutable, [
    '-xf',
    archivePath,
    '-C',
    extractionDirectory,
    'x64/version.dll'
  ], { stdio: 'inherit' })
  if (extraction.status !== 0) {
    const reason = extraction.error?.message ?? `exit code ${extraction.status}`
    throw new Error(`Could not extract LANCommander Interposer with ${tarExecutable}: ${reason}`)
  }

  const proxy = await readFile(path.join(extractionDirectory, 'x64', 'version.dll'))
  assertSha256(proxy, proxySha256, 'LANCommander Interposer x64 proxy')
  verifyWindowsX64Dll(proxy)
  const preparedProxy = disableInterposerTempLog(proxy)
  assertSha256(preparedProxy, preparedProxySha256, 'Prepared LANCommander Interposer x64 proxy')
  const temporaryProxyPath = `${preparedProxyPath}.tmp`
  await writeFile(temporaryProxyPath, preparedProxy)
  await rm(preparedProxyPath, { force: true })
  await rename(temporaryProxyPath, preparedProxyPath)
  await rm(extractionDirectory, { recursive: true, force: true })
}

export function getWindowsPortableExtraFiles (
  platform = process.platform,
  architecture = 'x64'
) {
  if (platform !== 'win32') return []
  if (architecture !== 'x64') {
    throw new Error(`LANCommander Interposer does not support Windows ${architecture}`)
  }

  return [
    { from: preparedProxyPath, to: 'version.dll' },
    { from: path.join(sourceDirectory, 'Config.yml'), to: '.interposer/Config.yml' },
    { from: path.join(sourceDirectory, 'Registry.reg'), to: '.interposer/Registry.reg' },
    { from: path.join(sourceDirectory, 'LICENSE.txt'), to: 'LANCommander.Interposer.LICENSE.txt' },
    { from: path.join(sourceDirectory, 'portable.marker'), to: 'portable.marker' }
  ]
}

export function withWindowsInterposer (config, architecture = 'x64') {
  return {
    ...config,
    files: [...(config.files ?? [])],
    extraFiles: [
      ...(config.extraFiles ?? []),
      ...getWindowsPortableExtraFiles('win32', architecture)
    ]
  }
}
