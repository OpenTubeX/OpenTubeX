import { addIcon } from '@iconify/vue/offline'

import {
  facFluxer,
  facHorizontalTabs,
  facMatrix,
  facPlaylistAdd,
  facPlaylistCheck,
  facVerticalTabs
} from '../customIcons.js'

/**
 * Register the pre-extracted Iconify glyphs used by the selected icon pack.
 * Project-specific glyphs stay registered as `otx:*` fallbacks; both packs use
 * native playlist/tab icons where mappings are available.
 */
const PACK_LOADERS = {
  material: () => import('./iconifyBundles/material.json'),
  remix: () => import('./iconifyBundles/remix.json')
}

const packPromises = new Map()
let customIconsRegistered = false

function registerCustomIcons() {
  if (customIconsRegistered) return
  customIconsRegistered = true

  for (const custom of [
    facVerticalTabs,
    facHorizontalTabs,
    facPlaylistAdd,
    facPlaylistCheck,
    facFluxer,
    facMatrix
  ]) {
    const [width, height, , , path] = custom.icon
    addIcon(`otx:${custom.iconName}`, {
      body: `<path fill="currentColor" d="${path}" />`,
      width,
      height
    })
  }
}

async function loadAndRegisterPack(pack) {
  const module = await PACK_LOADERS[pack]()
  const bundle = module.default
  for (const [id, data] of Object.entries(bundle)) addIcon(id, data)

  registerCustomIcons()
}

/**
 * Load and register only the selected pack.
 * @param {import('./iconPackState').IconPackId} pack
 * @returns {Promise<void>}
 */
export function registerMappedIcons(pack) {
  registerCustomIcons()
  if (!PACK_LOADERS[pack]) return Promise.reject(new Error(`Unknown icon pack: ${pack}`))

  if (!packPromises.has(pack)) {
    const promise = loadAndRegisterPack(pack).catch(error => {
      packPromises.delete(pack)
      throw error
    })
    packPromises.set(pack, promise)
  }
  return packPromises.get(pack)
}
