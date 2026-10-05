import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

const ALPHA_CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const BETA_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'

test.use({
  seed: {
    settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      subscriptions: [
        { id: ALPHA_CHANNEL_ID, name: 'Alpha Channel', thumbnail: '' },
        { id: BETA_CHANNEL_ID, name: 'Beta Channel', thumbnail: '' }
      ]
    }]
  }
})

for (const uiScale of [100, 95, 125]) {
  test(`shows channel options before saving and preserves rapid edits at ${uiScale}%`, async ({ app, page }) => {
    await page.evaluate(value => window.ftElectron.setZoomFactor(value / 100), uiScale)
    await goToSettingsSection(page, 'download')
    await page.getByRole('button', { name: 'Manage Automatic Downloads (0)' }).click()
    await app.electronApp.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('db-settings')
      let firstWrite = true
      ipcMain.removeHandler('db-settings')
      ipcMain.handle('db-settings', async (event, request) => {
        if (request.action === 2 && request.data._id === 'ytDlpAutomaticDownloadRules' && firstWrite) {
          firstWrite = false
          await new Promise(resolve => { globalThis.releaseAutomaticDownloadWrite = resolve })
        }
        return original(event, request)
      })
    })

    const alpha = page.locator('.channelRule', { has: page.getByRole('checkbox', { name: 'Alpha Channel', exact: true }) })
    const beta = page.locator('.channelRule', { has: page.getByRole('checkbox', { name: 'Beta Channel', exact: true }) })
    await alpha.getByText('Alpha Channel', { exact: true }).click()
    try {
      await expect.poll(() => app.electronApp.evaluate(() => typeof globalThis.releaseAutomaticDownloadWrite)).toBe('function')
      await expect(alpha.getByRole('checkbox', { name: 'Alpha Channel', exact: true })).toBeChecked()
      await expect(alpha.locator('.channelRuleOptions')).toBeVisible({ timeout: 1000 })
      await beta.getByText('Beta Channel', { exact: true }).click()
      await expect(beta.locator('.channelRuleOptions')).toBeVisible({ timeout: 1000 })
      await alpha.getByText('Shorts', { exact: true }).click()
      await alpha.getByRole('textbox', { name: 'Title includes', exact: true }).fill('Keep this edit')
      await beta.getByText('Beta Channel', { exact: true }).click()
      await expect(beta.locator('.channelRuleOptions')).toHaveCount(0)
      await beta.getByText('Beta Channel', { exact: true }).click()
      await expect(beta.locator('.channelRuleOptions')).toBeVisible({ timeout: 1000 })
    } finally {
      await app.electronApp.evaluate(() => globalThis.releaseAutomaticDownloadWrite?.())
      await expect(alpha.locator('.channelRuleOptions')).toBeVisible()
    }

    await expect.poll(() => page.evaluate(async () => {
      const settings = await window.ftElectron.dbSettings(1)
      return JSON.parse(settings.find(setting => setting._id === 'ytDlpAutomaticDownloadRules').value)
    })).toEqual({
      [ALPHA_CHANNEL_ID]: expect.objectContaining({ includeShorts: true, titleIncludes: 'Keep this edit' }),
      [BETA_CHANNEL_ID]: expect.objectContaining({ includeVideos: true })
    })
    await expect(alpha.getByRole('checkbox', { name: 'Shorts', exact: true })).toBeChecked()
    await expect(alpha.getByRole('textbox', { name: 'Title includes', exact: true })).toHaveValue('Keep this edit')
  })
}

test('restores the last saved channel rules when a later edit fails', async ({ app, page }) => {
  await goToSettingsSection(page, 'download')
  await page.getByRole('button', { name: 'Manage Automatic Downloads (0)' }).click()
  await app.electronApp.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('db-settings')
    let writes = 0
    ipcMain.removeHandler('db-settings')
    ipcMain.handle('db-settings', async (event, request) => {
      if (request.action === 2 && request.data._id === 'ytDlpAutomaticDownloadRules') {
        if (++writes === 2) throw new Error('Fixture disk failure')
        await new Promise(resolve => { globalThis.releaseAutomaticDownloadWrite = resolve })
      }
      return original(event, request)
    })
  })
  const alpha = page.locator('.channelRule').filter({ hasText: 'Alpha Channel' })
  const beta = page.locator('.channelRule').filter({ hasText: 'Beta Channel' })
  await alpha.getByText('Alpha Channel', { exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(() => typeof globalThis.releaseAutomaticDownloadWrite)).toBe('function')
  await expect(alpha.locator('.channelRuleOptions')).toBeVisible({ timeout: 1000 })
  await beta.getByText('Beta Channel', { exact: true }).click()
  await expect(beta.locator('.channelRuleOptions')).toBeVisible({ timeout: 1000 })
  await app.electronApp.evaluate(() => globalThis.releaseAutomaticDownloadWrite())
  await expect(beta.getByRole('checkbox', { name: 'Beta Channel', exact: true })).not.toBeChecked()
  await expect(beta.locator('.channelRuleOptions')).toHaveCount(0)
  await expect(alpha.getByRole('checkbox', { name: 'Alpha Channel', exact: true })).toBeChecked()
  await expect(alpha.locator('.channelRuleOptions')).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const settings = await window.ftElectron.dbSettings(1)
    return Object.keys(JSON.parse(settings.find(setting => setting._id === 'ytDlpAutomaticDownloadRules').value))
  })).toEqual([ALPHA_CHANNEL_ID])
})
