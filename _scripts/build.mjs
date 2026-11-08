import { Arch, build, Platform } from 'electron-builder'
import config from './ebuilder.config.mjs'
import { prepareWindowsShare } from './windowsShare.mjs'
import { prepareMacosNative } from './macosNative.mjs'
import { prepareWindowsInterposer } from './windowsInterposer.mjs'
import { withWindowsPortable } from './windowsPortable.mjs'
import { prepareCastSender } from './castSender.mjs'

const args = process.argv
const targetArch = args[2] ?? process.arch
if (targetArch !== 'x64' && targetArch !== 'arm64') {
  throw new Error(`Unsupported build architecture: ${targetArch}`)
}
const arch = Arch[targetArch]

let buildRequests
const platform = process.platform
await prepareCastSender('dist', platform, targetArch)

if (platform === 'darwin') {
  await prepareMacosNative(targetArch)
  buildRequests = [{
    targets: Platform.MAC.createTarget(['DMG', 'zip', '7z'], arch),
    config
  }]
} else if (platform === 'win32') {
  await prepareWindowsShare(targetArch)
  if (targetArch === 'x64') {
    await prepareWindowsInterposer()
  }
  buildRequests = [
    {
      targets: Platform.WINDOWS.createTarget(['nsis'], arch),
      config
    },
    {
      targets: Platform.WINDOWS.createTarget(['zip', '7z'], arch),
      config: withWindowsPortable(config, targetArch)
    }
  ]
} else if (platform === 'linux') {
  buildRequests = [{
    targets: Platform.LINUX.createTarget(['deb', 'zip', '7z', 'rpm', 'AppImage', 'pacman'], arch),
    config
  }]
}

const outputs = []
for (const request of buildRequests) {
  outputs.push(...await build({ ...request, publish: 'never' }))
}
console.log(outputs)
