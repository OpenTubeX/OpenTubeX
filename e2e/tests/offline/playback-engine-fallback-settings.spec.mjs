import { readPersistedDatastore } from '../../helpers/datastore.mjs'
import path from 'node:path'

import { test, expect, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'

const label = 'Automatically switch stream extraction methods'

test.use({ seed: { settings: { currentLocale: 'en-US', backendFallback: true } } })

test('playback-engine fallback defaults on and persists independently of API fallback', async ({ app }) => {
  await goToSettingsSection(app.page, 'general')
  await app.page.getByRole('searchbox', { name: 'Search settings' }).fill(label)
  await app.page.getByRole('button', { name: label, exact: true }).click()
  let section = app.page.locator('.settingsContent > [data-section="advanced"]')
  await expect(section).toBeVisible()
  await expect(section.locator('.switch-ctn.settingsSearchTarget')).toContainText(label)
  let toggle = section.getByRole('checkbox', { name: /^Automatically switch stream extraction methods/ })
  const apiFallback = section.getByRole('checkbox', { name: /non-preferred backend/i })
  await expect(toggle).toBeChecked()
  await expect(apiFallback).toBeChecked()
  await section.locator('label.switch-label').filter({ hasText: label }).click()
  await expect(toggle).not.toBeChecked()
  await expect(apiFallback).toBeChecked()
  await expect.poll(async () => latestSettings(
    await readPersistedDatastore(path.join(app.userDataDir, 'settings.db'), 'utf8')
  ).playbackEngineFallback).toBe(false)

  const relaunched = await app.relaunch()
  section = await goToSettingsSection(relaunched.page, 'advanced')
  toggle = section.getByRole('checkbox', { name: /^Automatically switch stream extraction methods/ })
  await expect(toggle).not.toBeChecked()
  await toggle.focus()
  await toggle.press('Space')
  await expect(toggle).toBeChecked()
  await expect.poll(async () => latestSettings(
    await readPersistedDatastore(path.join(app.userDataDir, 'settings.db'), 'utf8')
  ).playbackEngineFallback).toBe(true)
})
