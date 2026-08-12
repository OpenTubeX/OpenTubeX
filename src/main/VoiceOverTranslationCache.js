import asyncFs from 'fs/promises'
import path from 'path'

export const VOICE_OVER_TRANSLATION_CACHE_DURATION_MS = 24 * 60 * 60 * 1000

export class VoiceOverTranslationCache {
  constructor(directory, validateUrl, now = Date.now) {
    this.directory = directory
    this.validateUrl = validateUrl
    this.now = now
  }

  pathFor(videoId, responseLanguage) {
    return path.join(this.directory, `${videoId}_${responseLanguage}.json`)
  }

  async get(videoId, responseLanguage) {
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

  async set(videoId, responseLanguage, result) {
    await asyncFs.mkdir(this.directory, { recursive: true })
    await asyncFs.writeFile(this.pathFor(videoId, responseLanguage), JSON.stringify({
      expiresAt: this.now() + VOICE_OVER_TRANSLATION_CACHE_DURATION_MS,
      result
    }))
  }

  async pruneExpired() {
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
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(async entry => {
        const filePath = path.join(this.directory, entry.name)
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
