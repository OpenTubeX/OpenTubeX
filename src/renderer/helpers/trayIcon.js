import { APP_ICON_PRESETS } from '../../appIconPresets'
import maskUrl from '../assets/img/tray-icon-mask.svg'

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
  const preset = APP_ICON_PRESETS.find(({ id }) => id === presetId)
  if (presetId !== 'theme' && (!preset || preset.id === 'default')) {
    await window.ftElectron.setTrayIcon(null)
    return
  }
  const mask = await loadMask()
  if (currentRevision !== revision) return
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')
  // Resolve CSS variables through computed colors, including custom and dynamic themes.
  canvas.style.color = preset?.foreground ?? 'var(--logo-primary-color)'
  canvas.style.backgroundColor = preset?.background ?? 'var(--bg-color)'
  canvas.hidden = true
  document.body.append(canvas)
  const style = getComputedStyle(canvas)
  const foreground = style.color
  const background = style.backgroundColor
  canvas.remove()
  context.drawImage(mask, 0, 0, 64, 64)
  context.globalCompositeOperation = 'source-in'
  context.fillStyle = foreground
  context.fillRect(0, 0, 64, 64)
  context.globalCompositeOperation = 'destination-over'
  context.fillStyle = background
  context.beginPath()
  context.roundRect(0, 0, 64, 64, 14.4)
  context.fill()
  await window.ftElectron.setTrayIcon(canvas.toDataURL('image/png'))
}
