import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  customThemeIdFromValue,
  normalizeCustomTheme,
  normalizeCustomThemes,
} from '../customTheme.js'

/** @param {string} directory */
export function createCustomThemeStore(directory) {
  function getThemePath(id) {
    if (!/^[\w-]{1,80}$/.test(id)) throw new TypeError('Invalid custom theme ID')
    return path.join(directory, `${id}.json`)
  }

  async function writeThemeFile(theme) {
    const themePath = getThemePath(theme.id)
    const temporaryPath = `${themePath}.${randomUUID()}.tmp`
    await fs.writeFile(temporaryPath, `${JSON.stringify(theme, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, themePath)
  }

  async function load() {
    await fs.mkdir(directory, { recursive: true })
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const themes = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || path.extname(entry.name) !== '.json') continue
      try {
        themes.push(normalizeCustomTheme(
          JSON.parse(await fs.readFile(path.join(directory, entry.name), 'utf8'))
        ))
      } catch (error) {
        console.error(`Failed to load custom theme ${entry.name}:`, error)
      }
    }
    return themes.sort((left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }

  async function save(theme) {
    getThemePath(theme?.id)
    const normalizedTheme = normalizeCustomTheme(theme)
    await fs.mkdir(directory, { recursive: true })
    await writeThemeFile(normalizedTheme)
    return await load()
  }

  async function remove(id) {
    await fs.unlink(getThemePath(id))
    return await load()
  }

  async function replace(themes) {
    const normalizedThemes = normalizeCustomThemes(themes)
    const themeIds = new Set()
    for (const theme of normalizedThemes) {
      if (themeIds.has(theme.id)) throw new TypeError(`Duplicate custom theme ID: ${theme.id}`)
      themeIds.add(theme.id)
    }

    await fs.mkdir(directory, { recursive: true })
    await Promise.all(normalizedThemes.map(writeThemeFile))

    const entries = await fs.readdir(directory, { withFileTypes: true })
    await Promise.all(entries.map(async entry => {
      if (!entry.isFile() || path.extname(entry.name) !== '.json') return
      const id = path.basename(entry.name, '.json')
      if (!themeIds.has(id)) await fs.unlink(path.join(directory, entry.name))
    }))

    return await load()
  }

  async function getSelected(value) {
    const id = customThemeIdFromValue(value)
    const themes = await load()
    return id === null ? themes[0] ?? null : themes.find(theme => theme.id === id) ?? null
  }

  return { load, save, remove, replace, getSelected }
}
