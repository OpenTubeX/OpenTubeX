import { app, systemPreferences } from 'electron'
import { getFonts } from 'font-list'
import { hostname, release } from 'node:os'

import { IpcChannels } from '../constants'
import { normalizeSystemAccentColor } from '../materialTheme.js'
import { handleTrusted, sendToAppWindows } from './ipc'
import { getLinuxDistributionInfo } from './linuxDistribution'

/** @returns {string | null} */
export function getSystemAccentColor() {
  try {
    return normalizeSystemAccentColor(systemPreferences.getAccentColor())
  } catch {
    return null
  }
}

/**
 * Answers questions about the device for sync device names, diagnostics and
 * font and accent color settings, and tells windows when the accent color changes.
 */
export function setupSystemInfoIpc() {
  handleTrusted(IpcChannels.GET_DEVICE_NAME, () => hostname())

  handleTrusted(IpcChannels.GET_DEVICE_INFO, async () => {
    const linuxDistribution = process.platform === 'linux'
      ? await getLinuxDistributionInfo()
      : null
    return {
      platform: linuxDistribution?.platform || process.platform,
      architecture: process.arch,
      release: linuxDistribution?.release || release(),
    }
  })

  handleTrusted(IpcChannels.GET_SYSTEM_FONTS, async () => {
    const fonts = await getFonts({ disableQuoting: true })
    return [...new Set(fonts
      .filter(font => typeof font === 'string')
      .map(font => font.trim())
      .filter(Boolean))]
  }, [])

  handleTrusted(IpcChannels.GET_SYSTEM_ACCENT_COLOR, getSystemAccentColor, null)

  const publishSystemAccentColor = () => {
    sendToAppWindows(IpcChannels.SYSTEM_ACCENT_COLOR_UPDATED, getSystemAccentColor())
  }
  systemPreferences.on('accent-color-changed', publishSystemAccentColor)
  if (process.platform === 'darwin') {
    const subscription = systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', publishSystemAccentColor)
    app.once('will-quit', () => systemPreferences.unsubscribeNotification(subscription))
  }
}
