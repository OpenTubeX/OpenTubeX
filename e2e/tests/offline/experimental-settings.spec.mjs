import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

test('canceling experimental restart prompts restores both running settings', async ({ page }, testInfo) => {
  const settings = await goToSettingsSection(page, 'advanced')
  const labels = ['Disable Hardware Acceleration', 'Replace HTTP Cache']

  for (const label of labels) {
    const checkbox = settings.getByRole('checkbox', { name: new RegExp(label, 'i') })
    await expect(checkbox).toBeEnabled()
    await expect(checkbox).not.toBeChecked()
    await settings.locator('label.switch-label').filter({ hasText: new RegExp(label, 'i') }).click()

    const prompt = page.getByRole('dialog', { name: /The app needs to restart/ })
    await expect(prompt).toBeVisible()
    for (const name of ['Yes, restart', 'Cancel']) {
      await expect(prompt.getByRole('button', { name, exact: true }).locator('.ft-icon')).toHaveCount(1)
    }
    if (label === labels[0]) await prompt.screenshot({ path: testInfo.outputPath('restart-prompt-icons.png') })
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(prompt).toBeHidden()
    await expect(checkbox).not.toBeChecked()
  }

  expect(await page.evaluate(async () => Promise.all([
    window.ftElectron.getDisableHardwareAcceleration(),
    window.ftElectron.getReplaceHttpCache()
  ]))).toEqual([false, false])
})
