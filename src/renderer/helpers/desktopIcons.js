import { APP_ICON_PRESETS } from '../../appIconPresets'
import maskUrl from '../assets/img/tray-icon-mask.svg'

export const MONOCHROME_TRAY_ICON_PRESET = 'monochrome'

const TRAY_ICON_SIZE = 64
const APP_ICON_SIZE = 512
// The mask centers the glyph in 573.5 of its 1024 units to leave room for the
// tile. The monochrome icon has no tile, so it fills all but a 2px margin.
const MONOCHROME_MASK_SCALE = (TRAY_ICON_SIZE - 4) / TRAY_ICON_SIZE * 1024 / 573.5
// macOS app icons draw their tile in 824 of 1024 units, leaving room around it.
const MAC_APP_ICON_TILE_SCALE = 824 / 1024

let maskPromise
let trayRevision = 0
let appRevision = 0

function loadMask() {
  maskPromise ??= new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      maskPromise = null
      reject(new Error('Unable to load tray icon artwork'))
    }
    image.src = maskUrl
  })
  return maskPromise
}

/**
 * @param {string} presetId
 * @returns {boolean} whether the preset uses the bundled icon instead of a drawn one
 */
function usesBundledIcon(presetId) {
  if (presetId === 'theme' || presetId === MONOCHROME_TRAY_ICON_PRESET) return false
  const preset = APP_ICON_PRESETS.find(({ id }) => id === presetId)
  return !preset || preset.id === 'default'
}

/**
 * @param {string} presetId
 * @param {number} size
 * @param {number} tileScale
 * @returns {Promise<string>} a PNG data URL
 */
async function drawIcon(presetId, size, tileScale) {
  const monochrome = presetId === MONOCHROME_TRAY_ICON_PRESET
  const preset = APP_ICON_PRESETS.find(({ id }) => id === presetId)
  const mask = await loadMask()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  // The main process turns the black monochrome glyph white for dark taskbars and panels.
  // Resolve CSS variables through computed colors, including custom and dynamic themes.
  canvas.style.color = monochrome ? '#000000' : (preset?.foreground ?? 'var(--logo-primary-color)')
  canvas.style.backgroundColor = preset?.background ?? 'var(--bg-color)'
  canvas.hidden = true
  document.body.append(canvas)
  const style = getComputedStyle(canvas)
  const foreground = style.color
  const background = style.backgroundColor
  canvas.remove()
  const tileSize = size * tileScale
  const maskSize = monochrome ? tileSize * MONOCHROME_MASK_SCALE : tileSize
  const maskOffset = (size - maskSize) / 2
  context.drawImage(mask, maskOffset, maskOffset, maskSize, maskSize)
  context.globalCompositeOperation = 'source-in'
  context.fillStyle = foreground
  context.fillRect(0, 0, size, size)
  if (!monochrome) {
    const tileOffset = (size - tileSize) / 2
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = background
    context.beginPath()
    context.roundRect(tileOffset, tileOffset, tileSize, tileSize, tileSize * 0.225)
    context.fill()
  }
  return canvas.toDataURL('image/png')
}

export async function updateTrayIcon(presetId) {
  const currentRevision = ++trayRevision
  if (usesBundledIcon(presetId)) {
    await window.ftElectron.setTrayIcon(null, false)
    return
  }
  const image = await drawIcon(presetId, TRAY_ICON_SIZE, 1)
  if (currentRevision !== trayRevision) return
  await window.ftElectron.setTrayIcon(image, presetId === MONOCHROME_TRAY_ICON_PRESET)
}

export async function updateAppIcon(presetId) {
  const currentRevision = ++appRevision
  // A monochrome glyph without a tile disappears on taskbars that match its color.
  if (usesBundledIcon(presetId) || presetId === MONOCHROME_TRAY_ICON_PRESET) {
    await window.ftElectron.setAppIcon(null)
    return
  }
  const image = await drawIcon(presetId, APP_ICON_SIZE, process.platform === 'darwin' ? MAC_APP_ICON_TILE_SCALE : 1)
  if (currentRevision !== appRevision) return
  await window.ftElectron.setAppIcon(image)
}
