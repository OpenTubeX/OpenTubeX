import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { escapeNsisString, getInstallerTranslations, prepareWindowsInstallerTranslations } from '../../_scripts/windowsInstallerTranslations.mjs'

test('installer labels cannot interpolate NSIS variables or inject instructions', () => {
  assert.equal(escapeNsisString('Create "$DESKTOP"\r\nshortcut'), 'Create $\\"$$DESKTOP$\\"$\\r$\\nshortcut')
})

test('installer languages use human translations and AI completions', async () => {
  const translations = await getInstallerTranslations('static/locales')
  assert.match(translations, /\$\{LANG_ENGLISH\} "Create a desktop shortcut"/)
  assert.match(translations, /\$\{LANG_GERMAN\} "Desktop-Verknüpfung erstellen"/)
  assert.match(translations, /\$\{LANG_FRENCH\} "Créer un raccourci sur le bureau"/)
  assert.equal(translations.trim().split('\n').length, 26)
})

test('Windows packaging writes installer translations to its configured resources directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-installer-locales-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const resources = join(directory, 'custom-resources')
  await prepareWindowsInstallerTranslations({
    electronPlatformName: 'win32',
    packager: { projectDir: process.cwd(), info: { buildResourcesDir: resources } }
  })
  assert.equal(await readFile(join(resources, 'installer-translations.nsh'), 'utf8'),
    await getInstallerTranslations('static/locales'))
})

test('other platform packages do not require Windows installer resources', async () => {
  for (const electronPlatformName of ['linux', 'darwin']) {
    await prepareWindowsInstallerTranslations({ electronPlatformName })
  }
})
