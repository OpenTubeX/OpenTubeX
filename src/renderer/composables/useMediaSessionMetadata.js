import { onBeforeUnmount, watch } from 'vue'

import appIcon from '../../../_icons/iconColor.png?inline'
import { useTabContext } from '../tabs/TabContext'
import { tabMediaCoordinator } from '../tabs/TabMediaCoordinator'

function createMediaMetadata({ title, artist, artworkSrc }) {
  let artwork = []
  if (artworkSrc) {
    artwork = [{ src: artworkSrc, sizes: '128x128', type: 'image/png' }]
  } else if (process.platform === 'linux') {
    // Chromium never clears the MPRIS artwork on Linux, so without a
    // replacement the previous media's thumbnail would keep showing. Media
    // session artwork rejects app:// URLs, so the icon is inlined.
    artwork = [{ src: appIcon, sizes: '512x512', type: 'image/png' }]
  }

  const metadata = { title, artist, artwork }
  return typeof MediaMetadata === 'function' ? new MediaMetadata(metadata) : metadata
}

/**
 * Publishes the current tab's media to the system media controls until the
 * component unmounts.
 *
 * @param {() => { title: string, artist: string, artworkSrc: string } | null} getMetadata
 */
export function useMediaSessionMetadata(getMetadata) {
  const { tabId } = useTabContext()
  const source = Symbol('media session metadata')

  watch(getMetadata, (current) => {
    tabMediaCoordinator.setMetadata(tabId ?? 'web', current && createMediaMetadata(current), source)
  }, { immediate: true })

  onBeforeUnmount(() => {
    tabMediaCoordinator.setMetadata(tabId ?? 'web', null, source)
  })
}
