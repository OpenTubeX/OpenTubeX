import { test, expect } from '../../helpers/app.mjs'

test('about page shows the bundled runtime versions', async ({ app, page }) => {
  const expectedVersions = await app.electronApp.evaluate(() => ({
    Electron: process.versions.electron,
    Chromium: process.versions.chrome,
    'Node.js': process.versions.node,
    V8: process.versions.v8
  }))

  await page.locator('.profileTrigger').click()
  await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'About' }).click()

  const aboutWindow = page.getByRole('dialog', { name: 'About' })
  await expect(aboutWindow).toBeVisible()
  const versionLineBox = await aboutWindow.locator('.version').evaluate(element => {
    const style = getComputedStyle(element)
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight)
    }
  })
  expect(versionLineBox.lineHeight).toBe(versionLineBox.fontSize)

  const versionRows = aboutWindow.locator('.runtimeVersion')
  const expectedEntries = Object.entries(expectedVersions)
  await expect(versionRows).toHaveCount(expectedEntries.length)

  for (const [index, [runtime, version]] of expectedEntries.entries()) {
    const row = versionRows.nth(index)
    await expect(row.locator('dt')).toHaveText(runtime)
    await expect(row.locator('dd')).toHaveText(version)
  }
})
