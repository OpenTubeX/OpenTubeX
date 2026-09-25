import { fileURLToPath } from 'node:url'
import { getWindowsPortableExtraFiles } from './windowsInterposer.mjs'

export function withWindowsPortable (config, architecture = 'x64') {
  return {
    ...config,
    files: [...(config.files ?? [])],
    extraFiles: [
      ...(config.extraFiles ?? []),
      ...(architecture === 'arm64'
        ? [{ from: fileURLToPath(new URL('./windows-portable.marker', import.meta.url)), to: 'portable.marker' }]
        : getWindowsPortableExtraFiles('win32', architecture))
    ]
  }
}
