import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import path from 'path'
import asyncFs from 'fs/promises'
import { randomUUID } from 'crypto'

import { IpcChannels } from '../constants'
import {
  CUSTOM_THEMES_DIRECTORY,
  customThemeIdFromValue,
  customThemeValue,
  isCustomThemeValue,
  normalizeCustomTheme,
  normalizeCustomThemes,
} from '../customTheme'
import { resolveSystemTheme, resolveSystemThemeSettings } from '../appearanceSettings'
import * as baseHandlers from '../datastores/handlers/base'
import { isOpenTubeXUrl } from './utils'

/**
 * Stores each custom theme as its own JSON file in the profile and registers
 * the IPC handlers that edit them.
 * @param {object} options
 * @param {(settingKey: string, value: unknown, expectedValue?: unknown) => Promise<void>} options.updateSettingFromMain
 * @param {(baseTheme: string) => void} options.updateThemeSource
 */
export function setupCustomThemes({ updateSettingFromMain, updateThemeSource }) {
  const CUSTOM_THEMES_PATH = path.join(app.getPath('userData'), CUSTOM_THEMES_DIRECTORY)

  function getCustomThemePath(id) {
    if (!/^[\w-]{1,80}$/.test(id)) throw new TypeError('Invalid custom theme ID')
    return path.join(CUSTOM_THEMES_PATH, `${id}.json`)
  }

  async function writeCustomThemeFile(theme) {
    const themePath = getCustomThemePath(theme.id)
    const temporaryPath = `${themePath}.${randomUUID()}.tmp`
    await asyncFs.writeFile(temporaryPath, `${JSON.stringify(theme, null, 2)}\n`, 'utf8')
    await asyncFs.rename(temporaryPath, themePath)
  }

  async function loadCustomThemes() {
    await asyncFs.mkdir(CUSTOM_THEMES_PATH, { recursive: true })
    const entries = await asyncFs.readdir(CUSTOM_THEMES_PATH, { withFileTypes: true })
    const themes = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || path.extname(entry.name) !== '.json') continue
      try {
        themes.push(normalizeCustomTheme(
          JSON.parse(await asyncFs.readFile(path.join(CUSTOM_THEMES_PATH, entry.name), 'utf8'))
        ))
      } catch (error) {
        console.error(`Failed to load custom theme ${entry.name}:`, error)
      }
    }
    return themes.sort((left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }

  async function saveCustomTheme(theme) {
    getCustomThemePath(theme?.id)
    const normalizedTheme = normalizeCustomTheme(theme)
    await asyncFs.mkdir(CUSTOM_THEMES_PATH, { recursive: true })
    await writeCustomThemeFile(normalizedTheme)
    return await loadCustomThemes()
  }

  async function deleteCustomTheme(id) {
    await asyncFs.unlink(getCustomThemePath(id))
    return await loadCustomThemes()
  }

  async function replaceCustomThemes(themes) {
    const normalizedThemes = normalizeCustomThemes(themes)
    const themeIds = new Set()
    for (const theme of normalizedThemes) {
      if (themeIds.has(theme.id)) throw new TypeError(`Duplicate custom theme ID: ${theme.id}`)
      themeIds.add(theme.id)
    }

    await asyncFs.mkdir(CUSTOM_THEMES_PATH, { recursive: true })
    await Promise.all(normalizedThemes.map(writeCustomThemeFile))

    const entries = await asyncFs.readdir(CUSTOM_THEMES_PATH, { withFileTypes: true })
    await Promise.all(entries.map(async entry => {
      if (!entry.isFile() || path.extname(entry.name) !== '.json') return
      const id = path.basename(entry.name, '.json')
      if (!themeIds.has(id)) await asyncFs.unlink(path.join(CUSTOM_THEMES_PATH, entry.name))
    }))

    return await loadCustomThemes()
  }

  async function publishCustomThemes(themes) {
    const selectedTheme = (await baseHandlers.settings._findOne('baseTheme'))?.value
    const selectedCustomTheme = isCustomThemeValue(selectedTheme)
      ? themes.find(({ id }) => id === customThemeIdFromValue(selectedTheme)) ?? themes[0]
      : null
    if (selectedCustomTheme) {
      nativeTheme.themeSource = selectedCustomTheme.isDark ? 'dark' : 'light'
    }
    BrowserWindow.getAllWindows().forEach((window) => {
      if (isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.CUSTOM_THEME_UPDATED, themes)
      }
    })
  }

  async function getSelectedCustomTheme(value) {
    const id = customThemeIdFromValue(value)
    const themes = await loadCustomThemes()
    return id === null ? themes[0] ?? null : themes.find(theme => theme.id === id) ?? null
  }

  async function repairSystemThemeSettingsFromMain(themes) {
    const [systemLightTheme, systemDarkTheme] = await Promise.all([
      baseHandlers.settings._findOne('systemLightTheme'),
      baseHandlers.settings._findOne('systemDarkTheme')
    ])
    const currentSettings = {
      systemLightTheme: systemLightTheme?.value ?? 'light',
      systemDarkTheme: systemDarkTheme?.value ?? 'dark',
    }
    const resolvedSettings = resolveSystemThemeSettings(currentSettings, themes)

    await Promise.all(Object.entries(resolvedSettings).map(([key, value]) => (
      value === currentSettings[key] ? null : updateSettingFromMain(key, value, currentSettings[key])
    )))
  }

  ipcMain.handle(IpcChannels.CUSTOM_THEME_LOAD, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return
    return await loadCustomThemes()
  })

  ipcMain.handle(IpcChannels.CUSTOM_THEME_SAVE, async (event, theme) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return

    const themes = await saveCustomTheme(theme)
    await repairSystemThemeSettingsFromMain(themes)
    await publishCustomThemes(themes)
    return themes
  })

  ipcMain.handle(IpcChannels.CUSTOM_THEME_REPLACE, async (event, themes) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return

    const normalizedThemes = await replaceCustomThemes(themes)
    await repairSystemThemeSettingsFromMain(normalizedThemes)
    await publishCustomThemes(normalizedThemes)
    return normalizedThemes
  })

  ipcMain.handle(IpcChannels.CUSTOM_THEME_DELETE, async (event, themeId) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return

    const deletedTheme = (await loadCustomThemes()).find(({ id }) => id === themeId)
    const themes = await deleteCustomTheme(themeId)
    if (deletedTheme) {
      const deletedThemeValue = customThemeValue(themeId)
      const [baseTheme, systemLightTheme, systemDarkTheme] = await Promise.all([
        baseHandlers.settings._findOne('baseTheme'),
        baseHandlers.settings._findOne('systemLightTheme'),
        baseHandlers.settings._findOne('systemDarkTheme')
      ])
      if (systemLightTheme?.value === deletedThemeValue) {
        await updateSettingFromMain(
          'systemLightTheme',
          resolveSystemTheme(deletedTheme.basedOn, 'light'),
          deletedThemeValue
        )
      }
      if (systemDarkTheme?.value === deletedThemeValue) {
        await updateSettingFromMain(
          'systemDarkTheme',
          resolveSystemTheme(deletedTheme.basedOn, 'dark'),
          deletedThemeValue
        )
      }
      if (baseTheme?.value === deletedThemeValue) {
        await updateSettingFromMain('mainColor', deletedTheme.mainColor)
        await updateSettingFromMain('secColor', deletedTheme.secondaryColor)
        await updateSettingFromMain('baseTheme', deletedTheme.basedOn)
        updateThemeSource(deletedTheme.basedOn)
      }
    }
    await repairSystemThemeSettingsFromMain(themes)
    await publishCustomThemes(themes)
    return themes
  })

  return { loadCustomThemes, getSelectedCustomTheme }
}
