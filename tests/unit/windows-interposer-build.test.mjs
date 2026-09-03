import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

import {
  disableInterposerTempLog,
  getWindowsPortableExtraFiles,
  verifyWindowsX64Dll,
  WINDOWS_INTERPOSER_VERSION,
  withWindowsInterposer
} from '../../_scripts/windowsInterposer.mjs'

const repositoryRoot = path.resolve()

test('adds Interposer only to a copied Windows x64 portable configuration', () => {
  const installedConfig = {
    appId: 'io.opentubex.opentubex',
    files: ['dist/**/*']
  }
  const portableConfig = withWindowsInterposer(installedConfig)

  assert.equal(installedConfig.extraFiles, undefined)
  assert.notEqual(portableConfig.files, installedConfig.files)
  assert.deepEqual(portableConfig.files, installedConfig.files)
  assert.deepEqual(portableConfig.extraFiles.map(file => file.to), [
    'version.dll',
    '.interposer/Config.yml',
    '.interposer/Registry.reg',
    'LANCommander.Interposer.LICENSE.txt',
    'portable.marker'
  ])
  assert.deepEqual(getWindowsPortableExtraFiles('linux'), [])
  assert.throws(
    () => getWindowsPortableExtraFiles('win32', 'arm64'),
    /does not support Windows arm64/
  )
})

test('pins Interposer and virtualizes every standard registry hive', async () => {
  const registry = await readFile(path.join(
    repositoryRoot,
    '_scripts',
    'windows-interposer',
    'Registry.reg'
  ), 'utf8')
  const license = await readFile(path.join(
    repositoryRoot,
    '_scripts',
    'windows-interposer',
    'LICENSE.txt'
  ), 'utf8')

  assert.match(license, new RegExp(`Interposer ${WINDOWS_INTERPOSER_VERSION}`))
  for (const root of [
    'HKEY_CLASSES_ROOT',
    'HKEY_CURRENT_USER',
    'HKEY_LOCAL_MACHINE',
    'HKEY_USERS',
    'HKEY_CURRENT_CONFIG'
  ]) {
    assert.equal(registry.includes(`[${root}]`), true)
  }
})

test('redirects fallback application paths into the portable data directory', async () => {
  const config = parse(await readFile(path.join(
    repositoryRoot,
    '_scripts',
    'windows-interposer',
    'Config.yml'
  ), 'utf8'))
  const paths = [
    'C:\\Users\\Nico\\AppData\\Roaming\\OpenTubeX\\Cache\\index',
    'C:\\Users\\Nico\\AppData\\Local\\OpenTubeX\\Crashpad\\metadata',
    'C:\\Users\\Nico\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\OpenTubeX.lnk'
  ]

  for (const [index, source] of paths.entries()) {
    assert.match(source, new RegExp(config.FileRedirects[index].Pattern, 'i'))
    assert.match(
      config.FileRedirects[index].Replacement,
      /^%PORTABLE_EXECUTABLE_DIR%\\OpenTubeX-data\\/
    )
  }
})

test('rejects non-x64 Interposer binaries', () => {
  const dosHeaderSignature = 0x5A4D
  const peHeaderOffset = 0x40
  const peHeaderOffsetPosition = 0x3C
  const peHeaderSignature = 0x00004550
  const machinePosition = peHeaderOffset + 4
  const windowsArm64Machine = 0xAA64
  const windowsX64Machine = 0x8664
  const x64Binary = Buffer.alloc(0x80)
  x64Binary.writeUInt16LE(dosHeaderSignature, 0)
  x64Binary.writeUInt32LE(peHeaderOffset, peHeaderOffsetPosition)
  x64Binary.writeUInt32LE(peHeaderSignature, peHeaderOffset)
  x64Binary.writeUInt16LE(windowsX64Machine, machinePosition)

  assert.doesNotThrow(() => verifyWindowsX64Dll(x64Binary))
  x64Binary.writeUInt16LE(windowsArm64Machine, machinePosition)
  assert.throws(() => verifyWindowsX64Dll(x64Binary), /not an x64 DLL/)
})

test('disables only the upstream global diagnostic log marker', () => {
  const prefix = Buffer.from('prefix')
  const marker = Buffer.from('Interposer.log\0', 'utf16le')
  const binary = Buffer.concat([prefix, marker, Buffer.from('suffix')])
  const prepared = disableInterposerTempLog(binary)

  assert.equal(binary.indexOf(marker), prefix.length)
  assert.equal(prepared.indexOf(marker), -1)
  assert.equal(prepared.readUInt16LE(prefix.length), 0)
  assert.throws(
    () => disableInterposerTempLog(Buffer.from('missing')),
    /unexpected diagnostic log marker/
  )
  assert.throws(
    () => disableInterposerTempLog(Buffer.concat([marker, marker])),
    /unexpected diagnostic log marker/
  )
})
