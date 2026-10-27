import { IpcChannels } from '../constants'
import { onTrusted, sendToAppWindows } from './ipc'

/**
 * @param {unknown} icon
 * @returns {icon is [string, string] | null | undefined}
 */
function isValidIcon(icon) {
  return icon == null || (Array.isArray(icon) && icon.length === 2 && icon.every(part => typeof part === 'string'))
}

/** Shows a toast from one window in every OpenTubeX window. */
export function setupToastIpc() {
  onTrusted(IpcChannels.SHOW_TOAST, (_event, message, time, icon, buttonAction) => {
    if (
      typeof message !== 'string' ||
      (time !== null && typeof time !== 'number') ||
      !isValidIcon(icon) ||
      (buttonAction != null && buttonAction !== 'open-sync-settings')
    ) {
      return
    }

    sendToAppWindows(IpcChannels.SHOW_TOAST, message, time, icon ?? null, buttonAction ?? null)
  })
}
