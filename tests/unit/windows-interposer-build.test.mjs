import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

import { verifyWindowsX64Dll } from '../../_scripts/windowsInterposer.mjs'

const repositoryRoot = path.resolve()

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
  const optionalHeaderSizePosition = machinePosition + 16
  const optionalHeaderPosition = machinePosition + coffHeaderSize
  const optionalHeaderSize = 240
  const characteristicsPosition = machinePosition + 18
  const windowsArm64Machine = 0xAA64
  const windowsX64Machine = 0x8664
  const imageFileDll = 0x2000
  const x64Binary = Buffer.alloc(optionalHeaderPosition + optionalHeaderSize)
  x64Binary.writeUInt16LE(dosHeaderSignature, 0)
  x64Binary.writeUInt32LE(peHeaderOffset, peHeaderOffsetPosition)
  x64Binary.writeUInt32LE(peHeaderSignature, peHeaderOffset)
  x64Binary.writeUInt16LE(windowsX64Machine, machinePosition)
  x64Binary.writeUInt16LE(imageFileDll, characteristicsPosition)
  x64Binary.writeUInt16LE(optionalHeaderSize, optionalHeaderSizePosition)
  x64Binary.writeUInt16LE(0x20B, optionalHeaderPosition)

  assert.doesNotThrow(() => verifyWindowsX64Dll(x64Binary))
  for (const invalidSize of [0, 111, optionalHeaderSize + 1]) {
    x64Binary.writeUInt16LE(invalidSize, optionalHeaderSizePosition)
    assert.throws(() => verifyWindowsX64Dll(x64Binary), /invalid PE32\+ optional header/)
  }
  x64Binary.writeUInt16LE(optionalHeaderSize, optionalHeaderSizePosition)
  assert.throws(
    () => verifyWindowsX64Dll(x64Binary.subarray(0, optionalHeaderPosition)),
    /invalid PE32\+ optional header/
  )
  x64Binary.writeUInt16LE(0x10B, optionalHeaderPosition)
  assert.throws(() => verifyWindowsX64Dll(x64Binary), /invalid PE32\+ optional header/)
  x64Binary.writeUInt16LE(0x20B, optionalHeaderPosition)
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
