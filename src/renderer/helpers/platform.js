import { readonly, ref } from 'vue'

const linuxWayland = ref(false)
let platformInfoPromise = null

export const isLinuxWayland = readonly(linuxWayland)

/** Resolve renderer platform details once and share them across every settings view. */
export function initializePlatformInfo() {
  if (platformInfoPromise !== null) return platformInfoPromise

  if (!process.env.IS_ELECTRON || process.platform !== 'linux') {
    platformInfoPromise = Promise.resolve()
    return platformInfoPromise
  }

  platformInfoPromise = window.ftElectron.isWaylandPlatform()
    .then(value => {
      linuxWayland.value = value
    })
    .catch(error => {
      console.error('Failed to determine whether Electron is using Wayland', error)
    })
  return platformInfoPromise
}
