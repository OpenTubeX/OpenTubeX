import { APP_ICON_PRESETS } from '../../appIconPresets'
import maskUrl from '../assets/img/tray-icon-mask.svg'

export const MONOCHROME_TRAY_ICON_PRESET = 'monochrome'

const SIZE = 64
// The mask centers the glyph in 573.5 of its 1024 units to leave room for the
// tile. The monochrome icon has no tile, so it fills all but a 2px margin.
const MONOCHROME_MASK_SCALE = (SIZE - 4) / SIZE * 1024 / 573.5

let maskPromise
let revision = 0

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

export async function updateTrayIcon(presetId) {
  const currentRevision = ++revision
  const monochrome = presetId === MONOCHROME_TRAY_ICON_PRESET
  const preset = APP_ICON_PRESETS.find(({ id }) => id === presetId)
  if (presetId !== 'theme' && !monochrome && (!preset || preset.id === 'default')) {
    await window.ftElectron.setTrayIcon(null, false)
    return
  }
  const mask = await loadMask()
  if (currentRevision !== revision) return
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
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
  const maskSize = monochrome ? SIZE * MONOCHROME_MASK_SCALE : SIZE
  const maskOffset = (SIZE - maskSize) / 2
  context.drawImage(mask, maskOffset, maskOffset, maskSize, maskSize)
  context.globalCompositeOperation = 'source-in'
  context.fillStyle = foreground
  context.fillRect(0, 0, SIZE, SIZE)
  if (!monochrome) {
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = background
    context.beginPath()
    context.roundRect(0, 0, SIZE, SIZE, 14.4)
    context.fill()
  }
  await window.ftElectron.setTrayIcon(canvas.toDataURL('image/png'), monochrome)
}
