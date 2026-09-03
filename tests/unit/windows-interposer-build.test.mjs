import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

import {
  getWindowsPortableExtraFiles,
  verifyWindowsX64Dll,
  WINDOWS_INTERPOSER_COMMIT,
  WINDOWS_INTERPOSER_PATCH_SHA256,
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
  const patch = (await readFile(path.join(
    repositoryRoot,
    '_scripts',
    'windows-interposer',
    'native-registry.patch'
  ), 'utf8')).replaceAll('\r\n', '\n')

  assert.match(license, new RegExp(`Interposer ${WINDOWS_INTERPOSER_VERSION}`))
  assert.equal(WINDOWS_INTERPOSER_COMMIT.length, 40)
  assert.equal(
    createHash('sha256').update(patch).digest('hex'),
    WINDOWS_INTERPOSER_PATCH_SHA256
  )
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

test('rejects invalid, non-DLL, and non-x64 Interposer binaries', () => {
  const dosHeaderSignature = 0x5A4D
  const peHeaderOffset = 0x40
  const peHeaderOffsetPosition = 0x3C
  const peHeaderSignature = 0x00004550
  const machinePosition = peHeaderOffset + 4
  const coffHeaderSize = 20
  const characteristicsPosition = machinePosition + 18
  const windowsArm64Machine = 0xAA64
  const windowsX64Machine = 0x8664
  const imageFileDll = 0x2000
  const x64Binary = Buffer.alloc(0x80)
  x64Binary.writeUInt16LE(dosHeaderSignature, 0)
  x64Binary.writeUInt32LE(peHeaderOffset, peHeaderOffsetPosition)
  x64Binary.writeUInt32LE(peHeaderSignature, peHeaderOffset)
  x64Binary.writeUInt16LE(windowsX64Machine, machinePosition)
  x64Binary.writeUInt16LE(imageFileDll, characteristicsPosition)

  assert.doesNotThrow(() => verifyWindowsX64Dll(x64Binary))
  const truncatedHeader = x64Binary.subarray(
    0,
    peHeaderOffset + 4 + coffHeaderSize - 1
  )
  assert.throws(
    () => verifyWindowsX64Dll(truncatedHeader),
    /invalid PE header/
  )
  x64Binary.writeUInt16LE(0, characteristicsPosition)
  assert.throws(() => verifyWindowsX64Dll(x64Binary), /not a DLL/)
  x64Binary.writeUInt16LE(imageFileDll, characteristicsPosition)
  x64Binary.writeUInt16LE(windowsArm64Machine, machinePosition)
  assert.throws(() => verifyWindowsX64Dll(x64Binary), /not an x64 DLL/)
})

test('extends Interposer to keep native registry writes local', async () => {
  const patch = await readFile(path.join(
    repositoryRoot,
    '_scripts',
    'windows-interposer',
    'native-registry.patch'
  ), 'utf8')

  for (const api of [
    'NtCreateKey',
    'NtSetValueKey',
    'NtDeleteValueKey',
    'NtDeleteKey',
    'NtSetInformationKey',
    'NtFlushKey',
    'NtSetSecurityObject'
  ]) {
    assert.match(patch, new RegExp(`MH_CreateHookApi\\(L"ntdll", "${api}"`))
  }
  assert.match(
    patch,
    /erase\(NativeValueName\(valueName\)\) > 0;[\s\S]+if \(!removed\) return static_cast<NTSTATUS>\(0xC0000034UL\)/
  )
  assert.match(patch, /struct VirtKey \{ std::wstring path; bool deleted; \};/)
  assert.match(
    patch,
    /if \(!isDescendant\)[\s\S]+break;[\s\S]+0xC0000121UL/
  )
  assert.match(patch, /MarkVirtHandlesDeleted\(path\);/)
  assert.match(
    patch,
    /IsDeletedVirtHandle[\s\S]+return static_cast<NTSTATUS>\(0xC000017CUL\)/
  )
  assert.doesNotMatch(patch, /^\+.*Interposer\.log/m)
})
