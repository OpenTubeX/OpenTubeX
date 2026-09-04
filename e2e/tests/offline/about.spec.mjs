import { test, expect } from '../../helpers/app.mjs'

test('about header keeps its spacing without desktop runtime details', async ({ page }) => {
  await page.locator('.profileTrigger').click()
  await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'About' }).click()
  const aboutWindow = page.getByRole('dialog', { name: 'About' })
  await expect(aboutWindow).toBeVisible()

  for (const build of ['desktop', 'mobile release', 'mobile nightly']) {
    if (build === 'mobile release') {
      // Capacitor omits this Electron-only block from the shared About template.
      await aboutWindow.locator('.runtimeVersions').evaluate(element => element.remove())
      await aboutWindow.locator('.commit').evaluateAll(elements => elements.forEach(element => element.remove()))
    } else if (build === 'mobile nightly') {
      await aboutWindow.locator('.version').evaluate(element => {
        element.textContent = 'v0.33.0-nightly-1201 Beta'
        const commit = element.cloneNode(false)
        commit.className = 'commit'
        commit.textContent = 'Commit: e89ae75'
        element.after(commit)
      })
    }

    for (const scale of [1, 1.25]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }]) {
        await page.setViewportSize(viewport)
        await expect.poll(() => aboutWindow.evaluate(element => {
          const brand = element.querySelector('.brand')
          const details = brand.lastElementChild.getBoundingClientRect()
          const cards = element.querySelector('.about-chunks').getBoundingClientRect()
          const expectedGap = Number.parseFloat(getComputedStyle(brand).fontSize) * 2
          return Math.abs(cards.top - details.bottom - expectedGap)
        }), { message: `${build}, ${viewport.width}px, ${scale * 100}% scale` }).toBeLessThanOrEqual(1)
      }
    }
  }
})

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
