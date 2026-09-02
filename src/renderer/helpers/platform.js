import { readonly, ref } from 'vue'

const linuxWayland = ref(false)
const autoPictureInPictureMinimizeSupported = ref(true)
let platformInfoPromise = null

export const isLinuxWayland = readonly(linuxWayland)
export const supportsAutoPictureInPictureMinimize = readonly(autoPictureInPictureMinimizeSupported)

/** Resolve renderer platform details once and share them across every settings view. */
export function initializePlatformInfo() {
  if (platformInfoPromise !== null) return platformInfoPromise

  if (!process.env.IS_ELECTRON || process.platform !== 'linux') {
    platformInfoPromise = Promise.resolve()
    return platformInfoPromise
  }

  platformInfoPromise = Promise.all([
    window.ftElectron.isWaylandPlatform(),
    window.ftElectron.supportsAutoPictureInPictureMinimize(),
  ])
    .then(([wayland, minimizeSupported]) => {
      linuxWayland.value = wayland
      autoPictureInPictureMinimizeSupported.value = minimizeSupported
    })
    .catch(error => {
      console.error('Failed to determine whether Electron is using Wayland', error)
    })
  return platformInfoPromise
}
