import { isPortableBuild } from './applicationDataPaths.js'

export function supportsNativeNotifications (
  notification,
  environment = process.env,
  platform = process.platform
) {
  // Electron 43 creates a host Start Menu shortcut when Windows notifications
  // initialize. Portable builds must not write outside their data directory.
  return (platform !== 'win32' || !isPortableBuild(environment)) &&
    notification.isSupported()
}
