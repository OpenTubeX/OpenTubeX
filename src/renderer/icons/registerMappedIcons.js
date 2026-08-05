import { addIcon } from '@iconify/vue/offline'

import lucideFilledBases from './lucideFilledBases.json'
import {
  facFluxer,
  facHorizontalTabs,
  facMatrix,
  facPlaylistAdd,
  facPlaylistCheck,
  facVerticalTabs
} from '../customIcons.js'

/**
 * Derive a filled Lucide glyph from a stroke-only base icon.
 * @param {object} base
 * @returns {object}
 */
function filledFromLucide(base) {
  return {
    ...base,
    body: base.body
      .replaceAll('fill="none"', 'fill="currentColor"')
      .replaceAll(/stroke-width="[^"]*"/g, 'stroke-width="0"')
  }
}

/**
 * Register the pre-extracted Iconify glyphs used by the icon-pack preview.
 * Custom FA glyphs stay registered as `otx:*` only as a fallback; non-FA packs
 * use native playlist/tab icons from `faIconMap.json`.
 */
const PACK_LOADERS = {
  lucide: () => import('./iconifyBundles/lucide.json'),
  material: () => import('./iconifyBundles/material.json'),
  phosphor: () => import('./iconifyBundles/phosphor.json'),
  remix: () => import('./iconifyBundles/remix.json'),
  tabler: () => import('./iconifyBundles/tabler.json')
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

  // Lucide is stroke-only — fill solid FA shapes by deriving from the outline glyph.
  if (pack === 'lucide') {
    for (const [filledName, baseName] of Object.entries(lucideFilledBases)) {
      const base = bundle[`lucide:${baseName}`]
      if (!base) {
        console.warn(`[icon-pack] missing lucide base for filled icon: ${baseName}`)
        continue
      }
      addIcon(`lucide:${filledName}`, filledFromLucide(base))
    }
  }

  registerCustomIcons()
}

/**
 * Load and register only the selected preview pack. Font Awesome requires no
 * Iconify data, so the default path does not parse a generated bundle.
 * @param {import('./iconPackState').IconPackId} pack
 * @returns {Promise<void>}
 */
export function registerMappedIcons(pack) {
  registerCustomIcons()
  if (pack === 'fontawesome') return Promise.resolve()
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
