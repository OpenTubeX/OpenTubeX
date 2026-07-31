import { addIcon } from '@iconify/vue/offline'

import iconifyBundle from './iconifyBundle.json'
import lucideFilledBases from './lucideFilledBases.json'
import {
  facHorizontalTabs,
  facPlaylistAdd,
  facPlaylistCheck,
  facVerticalTabs
} from '../customIcons'

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
export function registerMappedIcons() {
  for (const [id, data] of Object.entries(iconifyBundle)) {
    addIcon(id, data)
  }

  // Lucide is stroke-only — fill solid FA shapes by deriving from the outline glyph.
  for (const [filledName, baseName] of Object.entries(lucideFilledBases)) {
    const base = iconifyBundle[`lucide:${baseName}`]
    if (!base) {
      console.warn(`[icon-pack] missing lucide base for filled icon: ${baseName}`)
      continue
    }
    addIcon(`lucide:${filledName}`, filledFromLucide(base))
  }

  for (const custom of [
    facVerticalTabs,
    facHorizontalTabs,
    facPlaylistAdd,
    facPlaylistCheck
  ]) {
    const [, , , , path] = custom.icon
    addIcon(`otx:${custom.iconName}`, {
      body: `<path fill="currentColor" d="${path}" />`,
      width: 512,
      height: 512
    })
  }
}
