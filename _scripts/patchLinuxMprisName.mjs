import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const chromiumMprisServiceName =
  'org.mpris.MediaPlayer2.chromium.instance%i'
// "instance" is shortened because "opentubex" is one byte longer than
// "chromium" and the replacement must preserve the executable's byte layout.
export const opentubexMprisServiceName =
  'org.mpris.MediaPlayer2.opentubex.instanc%i'

if (Buffer.byteLength(chromiumMprisServiceName) !==
  Buffer.byteLength(opentubexMprisServiceName)) {
  throw new Error('MPRIS service names must have equal byte lengths')
}

/**
 * Give Electron's Linux MPRIS service an application-specific D-Bus prefix.
 *
 * Chromium hardcodes its generic service name in the executable. Replacing it
 * with an equal-length string preserves the ELF layout while allowing Linux
 * sandbox policies to grant only OpenTubeX's MPRIS namespace.
 *
 * @param {import('electron-builder').AfterPackContext} context
 */
export async function patchLinuxMprisName (context) {
  if (context.electronPlatformName !== 'linux') {
    return
  }

  const executablePath = join(
    context.appOutDir,
    context.packager.executableName
  )
  const executable = await readFile(executablePath)
  const chromiumName = Buffer.from(chromiumMprisServiceName)
  const opentubexName = Buffer.from(opentubexMprisServiceName)
  let offset = 0
  let replacements = 0

  while ((offset = executable.indexOf(chromiumName, offset)) !== -1) {
    opentubexName.copy(executable, offset)
    offset += opentubexName.length
    replacements += 1
  }

  if (replacements === 0) {
    throw new Error(`Could not find Chromium's MPRIS service name in ${executablePath}`)
  }

  await writeFile(executablePath, executable)
}
