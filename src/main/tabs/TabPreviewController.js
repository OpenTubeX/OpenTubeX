import { nativeImage } from 'electron'
import { getTabAvatarPath } from '../../tabAvatarRoute.js'
import { tabPreviewStorage } from './TabPreviewStorage.js'
import {
  normalizeTabPreviewFileName,
  TAB_PREVIEW_JPEG_QUALITY,
  tabPreviewBufferToDataUrl
} from './tabPreviewCache.js'
import {
  cropTabPreviewToContent,
  getTabPreviewTargetSize,
  measureTabPreviewContentBounds
} from './tabPreviewGeometry.js'
import { getVideoThumbnailUrl } from './tabRoutes.js'

const TAB_PREVIEW_REFRESH_DELAY_MS = 700
const TAB_PREVIEW_CAPTURE_STYLE_ID = 'opentubex-tab-preview-capture-style'
const TAB_PREVIEW_CAPTURE_CLASS = 'opentubex-tab-preview-capturing'
const MAX_TAB_AVATAR_DOWNLOAD_BYTES = 2 * 1024 * 1024
const TAB_AVATAR_SIZE = 64

/** @typedef {import('./TabManager.js').TabManager} TabManager */
/** @typedef {import('./TabManager.js').TabInfo} TabInfo */

/**
 * Captures and caches the switcher previews and channel avatars of one
 * window's tabs. Tab ownership, presentation, and persistence stay in
 * TabManager.
 */
export class TabPreviewController {
  /**
   * @param {TabManager} manager
   * @param {() => Iterable<TabManager>} getManagers the managers of every
   *   window, since tabs in different windows can share an avatar file
   */
  constructor(manager, getManagers) {
    this.manager = manager
    this._getManagers = getManagers
    // Serializes preview captures across every tab in this window. Captures share
    // the window's single renderer, so running two at once would screenshot each
    // other's content and toggle capture mode out from under one another.
    /** @type {Promise<void>} */
    this._captureLock = Promise.resolve()
    this._capturePaused = false
    this._captureRevision = 0
    this.previewsEnabled = true
    this._transitionId = 0
    this.avatarsEnabled = true
  }

  /**
   * @param {TabInfo} tab
   * @param {number} [delay]
   */
  scheduleRefresh(tab, delay = TAB_PREVIEW_REFRESH_DELAY_MS) {
    this.clearRefresh(tab)
    if (!this.previewsEnabled || this._capturePaused || this.manager.presentedTabId !== tab.id) {
      return
    }

    tab.previewCaptureTimeoutId = setTimeout(() => {
      tab.previewCaptureTimeoutId = null
      if (this.manager.presentedTabId !== tab.id) {
        return
      }
      if (this.manager._getTabLoadingState(tab)) {
        this.scheduleRefresh(tab, delay)
        return
      }
      this.refresh(tab).catch(error => {
        console.error('Failed to refresh tab preview:', error)
      })
    }, delay)
  }

  /**
   * @param {TabInfo} tab
   */
  clearRefresh(tab) {
    if (tab.previewCaptureTimeoutId != null) {
      clearTimeout(tab.previewCaptureTimeoutId)
      tab.previewCaptureTimeoutId = null
    }
  }

  /**
   * @param {TabInfo} tab
   * @returns {Promise<string | null>}
   */
  async _getCachedDataUrl(tab) {
    if (typeof tab.previewDataUrl === 'string' && tab.previewDataUrl.length > 0) {
      return tab.previewDataUrl
    }

    const dataUrl = await tabPreviewStorage.read(tab.previewFileName)
    if (dataUrl != null) {
      tab.previewDataUrl = dataUrl
    }
    return dataUrl
  }

  /**
   * @param {string} tabId
   * @returns {Promise<string | null>}
   */
  async capture(tabId) {
    if (!this.previewsEnabled) {
      return null
    }

    const tab = this.manager.tabs.get(tabId)
    if (!tab) {
      return null
    }

    const cachedPreview = await this._getCachedDataUrl(tab)
    if (
      tab.id !== this.manager.presentedTabId ||
      this.manager.browserWindow.webContents.isDestroyed() ||
      this.manager._getTabLoadingState(tab)
    ) {
      return cachedPreview ?? getVideoThumbnailUrl(tab.url)
    }

    return await this.refresh(tab) ?? cachedPreview ?? getVideoThumbnailUrl(tab.url)
  }

  /**
   * @param {string[]} tabIds
   * @returns {Promise<Record<string, string | null>>}
   */
  async getCached(tabIds) {
    if (!this.previewsEnabled) {
      return Object.fromEntries(tabIds.map(tabId => [tabId, null]))
    }

    const previews = await Promise.all(tabIds.map(async tabId => {
      const tab = this.manager.tabs.get(tabId)
      const preview = tab == null
        ? null
        : await this._getCachedDataUrl(tab) ?? getVideoThumbnailUrl(tab.url)
      return [tabId, preview]
    }))
    return Object.fromEntries(previews)
  }

  /**
   * @param {boolean} paused
   */
  setCapturePaused(paused) {
    if (this._capturePaused === paused) {
      return
    }

    this._capturePaused = paused
    if (paused) {
      // Invalidate captures even if the switcher closes before their IPC
      // round-trip returns. Their screenshot may already contain the overlay.
      this._captureRevision++
      for (const tab of this.manager.tabs.values()) {
        this.clearRefresh(tab)
      }
      return
    }

    const presentedTab = this.manager.presentedTabId == null ? null : this.manager.tabs.get(this.manager.presentedTabId)
    if (presentedTab != null && !this.manager._getTabLoadingState(presentedTab)) {
      this.scheduleRefresh(presentedTab)
    }
  }

  /**
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setPreviewsEnabled(enabled) {
    if (this.previewsEnabled === enabled) return

    const transitionId = ++this._transitionId
    this.previewsEnabled = enabled
    if (enabled) {
      const presentedTab = this.manager.presentedTabId == null ? null : this.manager.tabs.get(this.manager.presentedTabId)
      if (presentedTab != null && !this.manager._getTabLoadingState(presentedTab)) {
        this.scheduleRefresh(presentedTab)
      }
      return
    }

    for (const tab of this.manager.tabs.values()) {
      this.clearRefresh(tab)
    }
    await Promise.allSettled(Array.from(this.manager.tabs.values(), tab => tab.previewCapturePromise).filter(Boolean))
    if (transitionId !== this._transitionId || this.previewsEnabled) {
      return
    }

    const fileNames = Array.from(this.manager.tabs.values(), tab => {
      tab.previewDataUrl = null
      tab.previewCapturedAt = 0
      const fileName = tab.previewFileName
      tab.previewFileName = null
      return fileName
    })
    await Promise.all(fileNames.map(fileName => tabPreviewStorage.remove(fileName)))
    if (transitionId !== this._transitionId || this.previewsEnabled) {
      return
    }
    this.manager._broadcastStateUpdate()
    this.manager._scheduleSessionSave()
  }

  /**
   * @param {TabInfo} tab
   * @returns {Promise<string | null>}
   */
  async refresh(tab) {
    if (!this.previewsEnabled) {
      return null
    }

    if (
      tab.id !== this.manager.presentedTabId ||
      this.manager.browserWindow.webContents.isDestroyed() ||
      this.manager._getTabLoadingState(tab)
    ) {
      return await this._getCachedDataUrl(tab)
    }

    if (tab.previewCapturePromise != null) {
      return tab.previewCapturePromise
    }

    tab.previewCapturePromise = this._captureSerialized(tab)

    try {
      return await tab.previewCapturePromise
    } finally {
      tab.previewCapturePromise = null
    }
  }

  /**
   * Runs a single preview capture, serialized against every other capture in
   * this window via {@link _captureLock}. Only the lock owner toggles
   * capture mode, and presentation is revalidated across every async hop so a
   * screenshot of a different tab is never persisted as this tab's preview.
   * @param {TabInfo} tab
   * @returns {Promise<string | null>}
   */
  async _captureSerialized(tab) {
    const captureRevision = this._captureRevision
    const previousCapture = this._captureLock
    /** @type {() => void} */
    let releaseLock = () => {}
    this._captureLock = new Promise(resolve => {
      releaseLock = resolve
    })
    await Promise.all([
      previousCapture.catch(() => {}),
      tabPreviewStorage.maintenance,
    ])

    try {
      // Presentation and window state may have changed while waiting for the lock.
      if (
        !this.previewsEnabled ||
        this._capturePaused ||
        captureRevision !== this._captureRevision ||
        tab.id !== this.manager.presentedTabId ||
        this.manager.browserWindow.webContents.isDestroyed() ||
        this.manager._getTabLoadingState(tab)
      ) {
        return await this._getCachedDataUrl(tab)
      }

      try {
        const captureStarted = await this._setCaptureMode(true)
        if (!captureStarted) {
          if (captureStarted === false) this.scheduleRefresh(tab)
          return await this._getCachedDataUrl(tab)
        }
        // Entering capture mode awaits an IPC round-trip, during which the main
        // process stays unblocked and another tab may have been activated. If so,
        // the renderer is now painting a different tab, so capturing here would
        // save the wrong content as this tab's preview. Bail out with the cache.
        if (!this.previewsEnabled || tab.id !== this.manager.presentedTabId || captureRevision !== this._captureRevision) {
          return await this._getCachedDataUrl(tab)
        }
        const image = await this.manager.browserWindow.webContents.capturePage()
        // capturePage awaits another round-trip; the presented tab may have
        // changed again. Never persist a screenshot captured for a stale tab.
        if (!this.previewsEnabled || tab.id !== this.manager.presentedTabId || captureRevision !== this._captureRevision) {
          return await this._getCachedDataUrl(tab)
        }
        if (image.isEmpty()) {
          return await this._getCachedDataUrl(tab)
        }

        const contentBounds = await this._getContentBounds()
        if (!this.previewsEnabled || tab.id !== this.manager.presentedTabId || captureRevision !== this._captureRevision) {
          return await this._getCachedDataUrl(tab)
        }
        const contentImage = contentBounds == null ? image : cropTabPreviewToContent(image, contentBounds)
        if (contentImage == null || contentImage.isEmpty()) {
          return await this._getCachedDataUrl(tab)
        }

        const targetSize = getTabPreviewTargetSize(contentImage.getSize(), contentBounds)
        const preview = targetSize == null
          ? contentImage
          : contentImage.resize({ ...targetSize, quality: 'best' })
        const previewBuffer = preview.toJPEG(TAB_PREVIEW_JPEG_QUALITY)
        if (previewBuffer.length === 0) {
          return await this._getCachedDataUrl(tab)
        }

        if (!this.previewsEnabled) {
          return null
        }

        const dataUrl = tabPreviewBufferToDataUrl(previewBuffer)
        tab.previewDataUrl = dataUrl
        tab.previewCapturedAt = Date.now()
        tab.previewFileName = await tabPreviewStorage.writePreview(previewBuffer, tab.previewFileName)
        this.manager._scheduleSessionSave()
        return dataUrl
      } catch (error) {
        console.error('Failed to capture tab preview:', error)
        return await this._getCachedDataUrl(tab)
      } finally {
        await this._setCaptureMode(false)
      }
    } finally {
      releaseLock()
    }
  }

  /**
   * @returns {Promise<import('./tabPreviewGeometry.js').TabPreviewContentBounds | null>}
   */
  async _getContentBounds() {
    try {
      return await this.manager.browserWindow.webContents.executeJavaScript(
        `(${measureTabPreviewContentBounds.toString()})(window, document)`,
        true
      )
    } catch {
      return null
    }
  }

  /**
   * @param {boolean} enabled
   */
  async _setCaptureMode(enabled) {
    if (this.manager.browserWindow.webContents.isDestroyed()) {
      return
    }

    const script = enabled
      ? `
        (() => {
          // Interactive preview UI takes priority over background captures.
          // Reuse the cache while a tooltip or keyboard switcher is visible.
          if (document.querySelector('[data-tab-preview-preserve-visibility]')) {
            return false
          }
          let style = document.getElementById(${JSON.stringify(TAB_PREVIEW_CAPTURE_STYLE_ID)})
          if (!style) {
            style = document.createElement('style')
            style.id = ${JSON.stringify(TAB_PREVIEW_CAPTURE_STYLE_ID)}
            style.textContent = 'html.${TAB_PREVIEW_CAPTURE_CLASS} [data-tab-preview-overlay]:not([data-tab-preview-preserve-visibility]) { visibility: hidden !important; }'
            document.head.appendChild(style)
          }
          document.documentElement.classList.add(${JSON.stringify(TAB_PREVIEW_CAPTURE_CLASS)})
          // Two frames: the first callback runs before the frame that applies
          // the class is painted, so resolving there can still capture a
          // visible overlay and put one tab's preview inside another's.
          return new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
          })
        })()
      `
      : `document.documentElement.classList.remove(${JSON.stringify(TAB_PREVIEW_CAPTURE_CLASS)})`

    try {
      return await this.manager.browserWindow.webContents.executeJavaScript(script, true)
    } catch {
      // The shared renderer may be navigating or shutting down.
    }
  }

  /**
   * @param {TabInfo} tab
   * @param {unknown} avatarBytes
   * @param {string} routePath
   * @returns {Promise<boolean>}
   */
  async applyAvatar(tab, avatarBytes, routePath) {
    const matchesRoute = () => getTabAvatarPath(tab.route.path) === getTabAvatarPath(routePath) || tab.route.fullPath === routePath
    if (!this.avatarsEnabled || !matchesRoute()) {
      return false
    }

    try {
      const sourceBuffer = avatarBytes instanceof ArrayBuffer
        ? Buffer.from(avatarBytes)
        : ArrayBuffer.isView(avatarBytes)
          ? Buffer.from(avatarBytes.buffer, avatarBytes.byteOffset, avatarBytes.byteLength)
          : null
      if (sourceBuffer == null) return false
      if (sourceBuffer.length === 0 || sourceBuffer.length > MAX_TAB_AVATAR_DOWNLOAD_BYTES) {
        return false
      }

      let image = nativeImage.createFromBuffer(sourceBuffer)
      if (image.isEmpty()) {
        console.warn('Failed to decode tab avatar image data')
        return false
      }

      const size = image.getSize()
      if (size.width > TAB_AVATAR_SIZE || size.height > TAB_AVATAR_SIZE) {
        const scale = TAB_AVATAR_SIZE / Math.max(size.width, size.height)
        image = image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'best'
        })
      }

      const buffer = image.toJPEG(TAB_PREVIEW_JPEG_QUALITY)
      if (
        !this.avatarsEnabled ||
        !this.manager.tabs.has(tab.id) ||
        !matchesRoute() ||
        buffer.length === 0
      ) {
        return false
      }

      const previousFileName = tab.avatarFileName
      tab.avatarFileName = await tabPreviewStorage.writeAvatar(buffer)
      if (previousFileName !== tab.avatarFileName) {
        await this.releaseAvatarFile(previousFileName)
      }
      if (
        !this.avatarsEnabled ||
        !this.manager.tabs.has(tab.id) ||
        !matchesRoute()
      ) {
        const fileName = tab.avatarFileName
        tab.avatarFileName = null
        await this.releaseAvatarFile(fileName)
        return false
      }
      tab.avatarDataUrl = tabPreviewBufferToDataUrl(buffer)
      this.manager._broadcastStateUpdate()
      this.manager._scheduleSessionSave()
      return true
    } catch (error) {
      console.error('Failed to cache tab avatar:', error)
      return false
    }
  }

  /**
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setAvatarsEnabled(enabled) {
    if (this.avatarsEnabled === enabled) return

    this.avatarsEnabled = enabled
    if (enabled) return

    // Every tab has to let go of its avatar before the first file is released,
    // or a name shared by two tabs would still look referenced and survive.
    const fileNames = Array.from(this.manager.tabs.values(), tab => {
      tab.avatarDataUrl = null
      const fileName = tab.avatarFileName
      tab.avatarFileName = null
      return fileName
    })
    await Promise.all(fileNames.map(fileName => this.releaseAvatarFile(fileName)))
    this.manager._broadcastStateUpdate()
    this.manager._scheduleSessionSave()
  }

  /**
   * Whether any tab, in this window or another one, still shows this avatar.
   * @param {string} fileName
   * @param {Set<TabInfo>} [ignoredTabs] tabs that are dropping it right now
   * @returns {boolean}
   */
  _isAvatarFileReferenced(fileName, ignoredTabs) {
    for (const manager of this._getManagers()) {
      for (const tab of manager.tabs.values()) {
        if (ignoredTabs?.has(tab)) continue
        if (normalizeTabPreviewFileName(tab.avatarFileName) === fileName) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Deletes a cached avatar once the last tab using it lets go. Avatars are
   * shared between tabs of the same channel, so unlinking on the first close
   * would take the file out from under the tabs that are still open.
   * @param {string | null | undefined} fileName
   * @param {Set<TabInfo>} [ignoredTabs]
   * @returns {Promise<void>}
   */
  async releaseAvatarFile(fileName, ignoredTabs) {
    const normalizedFileName = normalizeTabPreviewFileName(fileName)
    if (
      normalizedFileName == null ||
      this._isAvatarFileReferenced(normalizedFileName, ignoredTabs)
    ) {
      return
    }
    await tabPreviewStorage.remove(normalizedFileName)
  }
}
