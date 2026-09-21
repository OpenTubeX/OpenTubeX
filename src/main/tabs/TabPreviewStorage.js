import { app } from 'electron'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  createTabAvatarFileName,
  createTabPreviewFileName,
  createTabPreviewTempFileName,
  isReusableTabPreviewFileName,
  normalizeTabPreviewFileName,
  selectOrphanedTabPreviews,
  tabPreviewBufferToDataUrl
} from './tabPreviewCache.js'

/** Disk storage shared by all windows. Tab ownership stays in TabManager. */
export class TabPreviewStorage {
  constructor(directory = () => join(app.getPath('userData'), 'tab-previews')) {
    this.directory = directory
    this.maintenance = Promise.resolve()
  }

  /** Hold new writes until the startup orphan scan finishes. */
  startPrune(referencedFileNames) {
    const prune = this.prune(referencedFileNames).catch(error => {
      console.error('Failed to prune the tab preview cache:', error)
      return 0
    })
    this.maintenance = prune.then(() => undefined)
    return prune
  }

  async prune(referencedFileNames) {
    let fileNames
    try {
      fileNames = await readdir(this.directory())
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('Failed to read the tab preview cache:', error)
      return 0
    }
    const orphans = selectOrphanedTabPreviews(fileNames, referencedFileNames)
    const results = await Promise.all(orphans.map(async fileName => {
      try {
        await unlink(join(this.directory(), fileName))
        return true
      } catch (error) {
        if (error?.code !== 'ENOENT') console.error('Failed to delete an orphaned tab preview:', error)
        return false
      }
    }))
    return results.filter(Boolean).length
  }

  filePath(fileName) {
    const normalized = normalizeTabPreviewFileName(fileName)
    return normalized == null ? null : join(this.directory(), normalized)
  }

  async read(fileName) {
    const path = this.filePath(fileName)
    if (path == null) return null
    try {
      const buffer = await readFile(path)
      return buffer.length > 0 ? tabPreviewBufferToDataUrl(buffer) : null
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('Failed to load tab preview:', error)
      return null
    }
  }

  async remove(fileName) {
    const path = this.filePath(fileName)
    if (path == null) return
    try {
      await unlink(path)
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('Failed to delete tab preview:', error)
    }
  }

  async writePreview(buffer, previousFileName) {
    const previous = normalizeTabPreviewFileName(previousFileName)
    if (buffer == null || buffer.length === 0) return previous
    // Old PNG entries must get a new name when their bytes become JPEG.
    const fileName = isReusableTabPreviewFileName(previous) ? previous : createTabPreviewFileName()
    await this.write(fileName, buffer)
    if (previous != null && previous !== fileName) await this.remove(previous)
    return fileName
  }

  async writeAvatar(buffer) {
    // Content-addressed names let tabs of the same channel share one file.
    const fileName = createTabAvatarFileName(buffer)
    await this.write(fileName, buffer)
    return fileName
  }

  async write(fileName, buffer) {
    await this.maintenance
    const directory = this.directory()
    await mkdir(directory, { recursive: true })
    // A failed write must not truncate an existing cached image.
    const temporary = join(directory, createTabPreviewTempFileName())
    try {
      await writeFile(temporary, buffer)
      await rename(temporary, join(directory, fileName))
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
  }
}

export const tabPreviewStorage = new TabPreviewStorage()
