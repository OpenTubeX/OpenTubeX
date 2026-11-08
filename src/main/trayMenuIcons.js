import { nativeImage } from 'electron'
import icons from './trayMenuIcons.json'

const cache = new Map()

/**
 * Native menus need raster images. The generated glyphs reuse the app's icon mappings.
 * @param {string} name
 * @param {string} pack
 * @returns {Electron.NativeImage}
 */
export function getTrayMenuIcon(name, pack) {
  const selectedPack = pack === 'remix' ? 'remix' : 'material'
  const key = `${selectedPack}:${name}`
  if (!cache.has(key)) {
    const image = nativeImage.createEmpty()
    for (const [index, png] of icons[selectedPack][name].entries()) {
      const source = nativeImage.createFromBuffer(Buffer.from(png, 'base64'))
      const bitmap = source.toBitmap()
      for (let offset = 0; offset < bitmap.length; offset += 4) {
        // Linux tray menus follow the desktop's theme independently of the app.
        // Mid-gray keeps contrast on both backgrounds. Bitmaps use premultiplied alpha.
        const color = process.platform === 'darwin' ? 0 : Math.round(bitmap[offset + 3] * 128 / 255)
        bitmap[offset] = bitmap[offset + 1] = bitmap[offset + 2] = color
      }
      const tinted = nativeImage.createFromBitmap(bitmap, source.getSize())
      image.addRepresentation({ scaleFactor: index + 1, buffer: tinted.toPNG() })
    }
    if (process.platform === 'darwin') image.setTemplateImage(true)
    cache.set(key, image)
  }
  return cache.get(key)
}
