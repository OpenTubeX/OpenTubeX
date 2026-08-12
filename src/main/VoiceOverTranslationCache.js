import asyncFs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

export const VOICE_OVER_TRANSLATION_CACHE_DURATION_MS = 24 * 60 * 60 * 1000

export class VoiceOverTranslationCache {
  constructor(directory, validateUrl, now = Date.now) {
    this.directory = directory
    this.validateUrl = validateUrl
    this.now = now
    this.pendingOperation = Promise.resolve()
  }

  pathFor(videoId, responseLanguage) {
    return path.join(this.directory, `${videoId}_${responseLanguage}.json`)
  }

  runExclusive(operation) {
    const result = this.pendingOperation.then(operation, operation)
    this.pendingOperation = result.catch(() => {})
    return result
  }

  get(videoId, responseLanguage) {
    return this.runExclusive(() => this.getEntry(videoId, responseLanguage))
  }

  async getEntry(videoId, responseLanguage) {
    const filePath = this.pathFor(videoId, responseLanguage)

    try {
      const cached = JSON.parse(await asyncFs.readFile(filePath, 'utf8'))
      if (!Number.isFinite(cached.expiresAt) || cached.expiresAt <= this.now() ||
          typeof cached.result?.url !== 'string') {
        await asyncFs.rm(filePath, { force: true })
        return undefined
      }

      const translationUrl = await this.validateUrl(cached.result.url)
      return { ...cached.result, url: translationUrl.href }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        await asyncFs.rm(filePath, { force: true }).catch(() => {})
      }
      return undefined
    }
  }

  set(videoId, responseLanguage, result) {
    return this.runExclusive(async () => {
      await asyncFs.mkdir(this.directory, { recursive: true })

      const filePath = this.pathFor(videoId, responseLanguage)
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`
      try {
        await asyncFs.writeFile(temporaryPath, JSON.stringify({
          expiresAt: this.now() + VOICE_OVER_TRANSLATION_CACHE_DURATION_MS,
          result
        }))
        await asyncFs.rename(temporaryPath, filePath)
      } finally {
        await asyncFs.rm(temporaryPath, { force: true })
      }
    })
  }

  pruneExpired() {
    return this.runExclusive(() => this.pruneExpiredEntries())
  }

  async pruneExpiredEntries() {
    let entries

    try {
      entries = await asyncFs.readdir(this.directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') {
        return
      }
      throw error
    }

    await Promise.all(entries
      .filter(entry => entry.isFile() &&
        (entry.name.endsWith('.json') || entry.name.endsWith('.tmp')))
      .map(async entry => {
        const filePath = path.join(this.directory, entry.name)
        if (entry.name.endsWith('.tmp')) {
          await asyncFs.rm(filePath, { force: true })
          return
        }

        try {
          const cached = JSON.parse(await asyncFs.readFile(filePath, 'utf8'))
          if (!Number.isFinite(cached.expiresAt) || cached.expiresAt <= this.now()) {
            await asyncFs.rm(filePath, { force: true })
          }
        } catch {
          await asyncFs.rm(filePath, { force: true })
        }
      }))
  }
}
