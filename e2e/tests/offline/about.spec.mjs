import { test, expect, goTo } from '../../helpers/app.mjs'

test('about page shows the bundled runtime versions', async ({ app, page }) => {
  const expectedVersions = await app.electronApp.evaluate(() => ({
    Electron: process.versions.electron,
    Chromium: process.versions.chrome,
    'Node.js': process.versions.node,
    V8: process.versions.v8
  }))

  await goTo(page, 'about')

  const versionList = page.locator('.runtimeVersions')
  for (const [runtime, version] of Object.entries(expectedVersions)) {
    await expect(versionList).toContainText(`${runtime}${version}`)
  }
})
