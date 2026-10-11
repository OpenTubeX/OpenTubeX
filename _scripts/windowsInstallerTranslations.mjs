import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'

// electron-builder's bundled NSIS languages, mapped to the application's locales.
const installerLocales = {
  ENGLISH: 'en-US',
  GERMAN: 'de-DE',
  FRENCH: 'fr-FR',
  SPANISHINTERNATIONAL: 'es',
  SIMPCHINESE: 'zh-CN',
  TRADCHINESE: 'zh-TW',
  JAPANESE: 'ja',
  KOREAN: 'ko',
  ITALIAN: 'it',
  DUTCH: 'nl',
  DANISH: 'da',
  SWEDISH: 'sv',
  NORWEGIAN: 'nb-NO',
  FINNISH: 'fi',
  RUSSIAN: 'ru',
  PORTUGUESE: 'pt-PT',
  PORTUGUESEBR: 'pt-BR',
  POLISH: 'pl',
  UKRAINIAN: 'uk',
  CZECH: 'cs',
  SLOVAK: 'sk',
  HUNGARIAN: 'hu',
  ARABIC: 'ar',
  TURKISH: 'tr',
  THAI: 'en-US',
  VIETNAMESE: 'vi'
}

export function escapeNsisString(value) {
  return value.replaceAll('$', () => '$$').replaceAll('"', '$\\"').replaceAll('\r', '').replaceAll('\n', '$\\r$\\n')
}

export async function getInstallerTranslations(localesDirectory) {
  const lines = await Promise.all(Object.entries(installerLocales).map(async ([language, locale]) => {
    const human = load(await readFile(join(localesDirectory, `${locale}.yaml`), 'utf8'))
    let label = human?.Installer?.['Create Desktop Shortcut']
    if (!label) {
      const ai = load(await readFile(join(localesDirectory, 'ai', `${locale}.yaml`), 'utf8'))
      label = ai?.Installer?.['Create Desktop Shortcut']
    }
    if (!label) throw new Error(`Missing desktop shortcut installer translation for ${locale}`)
    return `LangString opentubexCreateDesktopShortcut \${LANG_${language}} "${escapeNsisString(label)}"`
  }))
  return '# -*- coding: utf-8 -*-\n' + lines.join('\n') + '\n'
}

/** @param {import('electron-builder').AfterPackContext} context */
export async function prepareWindowsInstallerTranslations(context) {
  if (context.electronPlatformName !== 'win32') return
  const translations = await getInstallerTranslations(join(context.packager.projectDir, 'static/locales'))
  const directory = context.packager.info.buildResourcesDir
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'installer-translations.nsh'), translations)
}
