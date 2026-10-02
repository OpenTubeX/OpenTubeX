import store from '../store/index'
import { getSyncServerDeviceIcon } from './sync-server-sessions'
import { formatTabTitle } from '../tabs/tabTitle'
import { showToast } from './utils'

export function getTabDeviceMenuItem(tabs, t) {
  if (!store.getters.getSyncServerEnabled || !store.getters.getSyncServerLiveSupported || tabs.length === 0) return null
  const videos = tabs.map(tab => ({
    videoId: tab.route?.fullPath?.match(/^\/watch\/([A-Za-z0-9_-]{11})(?:[?#]|$)/)?.[1],
    title: formatTabTitle(tab.contentTitle || tab.title || tab.route?.fullPath || ''),
  }))
  if (videos.some(video => !video.videoId)) return null

  const devices = store.getters.getSyncServerDevices
  return {
    label: t('Settings.Sync Settings.Open On Device'),
    icon: ['fas', 'devices'],
    enabled: devices.length > 0,
    submenu: devices.map(device => ({
      label: device.name,
      icon: getSyncServerDeviceIcon(device.platform),
      enabled: true,
      async run() {
        const sentTitles = []
        for (const video of videos) {
          try {
            await store.dispatch('sendSyncServerVideo', { recipient: device.id, ...video })
            sentTitles.push(video.title)
          } catch (error) {
            showToast({
              message: videos.length > 1 ? `${video.title}: ${error.message}` : error.message,
              icon: ['fas', 'circle-exclamation'],
            })
          }
        }
        if (sentTitles.length > 0) {
          const message = t('Settings.Sync Settings.Video Sent')
          showToast({
            message: videos.length > 1 ? `${message} (${sentTitles.length}/${videos.length}): ${sentTitles.join(', ')}` : message,
            icon: ['fas', 'devices'],
          })
        }
      },
    })),
  }
}
