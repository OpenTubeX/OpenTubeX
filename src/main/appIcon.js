// @ts-check
import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { createHash } from 'node:crypto'
import { watch } from 'node:fs'
import asyncFs from 'node:fs/promises'
import path from 'node:path'
import { createSerialQueue } from './serialQueue.js'
import { writeFileAtomic } from './writeFileAtomic.js'

export const APP_ICON_SIZE = 512
const ICO_SIZES = [16, 24, 32, 48, 64, 256]
const ICO_PREFIX = 'app-icon-'
const ICO_NAME = /^app-icon-[\da-f]{16}\.ico$/

/**
 * Packs PNG images into an ICO file, which Windows reads since Vista.
 * @param {Electron.NativeImage} image
 * @returns {Buffer}
 */
export function encodeIco(image) {
  const images = ICO_SIZES.map(size => image.resize({ width: size, height: size, quality: 'best' }).toPNG())
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((png, index) => {
    const entry = 6 + 16 * index
    // A size of 0 stands for 256 pixels.
    header.writeUInt8(ICO_SIZES[index] % 256, entry)
    header.writeUInt8(ICO_SIZES[index] % 256, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images])
}

/**
 * @param {string} file
 * @returns {string}
 */
function normalizeWindowsPath(file) {
  const expanded = file.replaceAll(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
  return path.win32.resolve(expanded).toLowerCase()
}

/**
 * Applies the selected app icon to windows, the macOS Dock, and, on Windows,
 * the shortcuts that start this executable, so pinned taskbar buttons follow it.
 * @param {{ userDataPath: string, defaultIconPath: string, executablePath: string }} options
 */
export function createAppIconManager({ userDataPath, defaultIconPath, executablePath }) {
  const cachePath = path.join(userDataPath, 'app-icon.png')
  let image = nativeImage.createFromPath(cachePath)
  /** @type {Buffer | null} */
  let png = image.isEmpty() ? null : image.toPNG()
  const enqueue = createSerialQueue(error => console.error('Unable to save the app icon', error))

  /** @returns {Electron.NativeImage | string} */
  function getWindowIcon() {
    return image.isEmpty() ? defaultIconPath : image
  }

  /** @param {Buffer} data */
  function getIcoPath(data) {
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 16)
    return path.join(userDataPath, `${ICO_PREFIX}${hash}.ico`)
  }

  /** @param {string} file */
  function isOwnIco(file) {
    return path.win32.dirname(file) === normalizeWindowsPath(userDataPath) && ICO_NAME.test(path.win32.basename(file))
  }

  function getShortcutDirectories() {
    const appData = process.env.APPDATA ?? app.getPath('appData')
    return [
      path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
      path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      app.getPath('desktop'),
    ]
  }

  /**
   * Points this executable's shortcuts at the icon, or back at the executable.
   * Shortcuts with an icon the user picked keep it.
   * @param {string | null} icoPath
   * @returns {Promise<boolean>} whether every shortcut was updated
   */
  async function updateShortcuts(icoPath) {
    let updated = true
    const target = normalizeWindowsPath(executablePath)
    const desiredIcon = icoPath ?? executablePath
    for (const directory of getShortcutDirectories()) {
      const names = await asyncFs.readdir(directory).catch(error => {
        // An unreadable folder may hold shortcuts that use the old icon.
        if (error.code !== 'ENOENT') updated = false
        return []
      })
      for (const name of names) {
        if (!name.toLowerCase().endsWith('.lnk')) continue
        const file = path.join(directory, name)
        try {
          const details = shell.readShortcutLink(file)
          if (!details.target || normalizeWindowsPath(details.target) !== target) continue
          const icon = details.icon ? normalizeWindowsPath(details.icon) : ''
          if (icon === normalizeWindowsPath(desiredIcon) && (details.iconIndex ?? 0) === 0) continue
          const replaceable = isOwnIco(icon) || (icoPath !== null && (icon === '' || icon === target))
          if (!replaceable) continue
          if (!shell.writeShortcutLink(file, 'update', { target: details.target, icon: desiredIcon, iconIndex: 0 })) {
            throw new Error('Windows rejected the change')
          }
        } catch (error) {
          updated = false
          console.error(`Unable to update the icon of ${file}`, error)
        }
      }
    }
    return updated
  }

  /** @param {string | null} keep */
  async function removeOldIcos(keep) {
    const names = await asyncFs.readdir(userDataPath).catch(() => [])
    await Promise.all(names
      .filter(name => ICO_NAME.test(name))
      .map(name => path.join(userDataPath, name))
      .filter(file => file !== keep)
      .map(file => asyncFs.rm(file, { force: true })))
  }

  /** @param {Buffer | null} data */
  async function applyToShortcuts(data) {
    if (process.platform !== 'win32') return
    if (data === null) {
      // Without generated icons, no shortcut can need its icon restored.
      const names = await asyncFs.readdir(userDataPath).catch(() => [])
      if (!names.some(name => ICO_NAME.test(name))) return
    }
    const icoPath = data === null ? null : getIcoPath(data)
    if (data !== null && icoPath !== null) {
      // A new name for each icon makes Explorer load it instead of its cached copy.
      const exists = await asyncFs.access(icoPath).then(() => true, () => false)
      if (!exists) await writeFileAtomic(icoPath, encodeIco(nativeImage.createFromBuffer(data)))
    }
    // A shortcut that kept its old icon still needs the old file.
    if (await updateShortcuts(icoPath)) await removeOldIcos(icoPath)
  }

  function applyToDock() {
    if (process.platform === 'darwin') {
      // An empty image restores the bundle's icon.
      app.dock?.setIcon(image)
    }
  }

  /**
   * Pinning a running window creates a shortcut with the executable's icon.
   */
  function watchPinnedShortcuts() {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer
    try {
      const watcher = watch(getShortcutDirectories()[0], () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          const data = png
          // The queue logs failures.
          if (data !== null) enqueue(() => applyToShortcuts(data)).catch(() => {})
        }, 1000)
      })
      watcher.on('error', () => watcher.close())
      watcher.unref()
    } catch {
      // Nothing was pinned yet, so the folder doesn't exist.
    }
  }

  /**
   * Applies the saved icon after startup, since installers and updates
   * recreate shortcuts with the executable's icon.
   */
  function restore() {
    if (png !== null) applyToDock()
    const data = png
    enqueue(() => applyToShortcuts(data)).catch(() => {})
    if (process.platform === 'win32') watchPinnedShortcuts()
  }

  /**
   * @param {unknown} dataUrl a square PNG data URL, or null for the bundled icon
   * @returns {Promise<void>}
   */
  async function set(dataUrl) {
    if (dataUrl !== null && (typeof dataUrl !== 'string' || dataUrl.length > 2 * 1024 * 1024 || !dataUrl.startsWith('data:image/png;base64,'))) return
    const nextImage = dataUrl === null ? nativeImage.createEmpty() : nativeImage.createFromDataURL(dataUrl)
    if (dataUrl !== null) {
      const { width, height } = nextImage.getSize()
      if (width !== APP_ICON_SIZE || height !== APP_ICON_SIZE) return
    }
    const nextPng = nextImage.isEmpty() ? null : nextImage.toPNG()
    if (nextPng === null ? png === null : png?.equals(nextPng)) return
    image = nextImage
    png = nextPng
    const windowIcon = getWindowIcon()
    if (process.platform !== 'darwin') {
      for (const window of BrowserWindow.getAllWindows()) window.setIcon(windowIcon)
    }
    applyToDock()
    await enqueue(async () => {
      await (nextPng === null ? asyncFs.rm(cachePath, { force: true }) : writeFileAtomic(cachePath, nextPng))
      await applyToShortcuts(nextPng)
    })
  }

  return { getWindowIcon, restore, set, flush: () => enqueue(() => {}) }
}
