import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { materialColorScheme, materialSeedPalette } from '../../../src/materialTheme.js'

test.use({ seed: { settings: { currentLocale: 'en-US', baseTheme: 'materialLight', materialSeedColor: '#ffff00' } } })

test('dragging the Material accent picker limits app-wide theme updates and commits the final color', async ({ page }) => {
  const section = await goToSettingsSection(page, 'theme')
  await section.locator('.materialCustomSwatch .colorFieldTrigger').click()
  const picker = page.getByRole('dialog', { name: 'Material accent color' })
  const area = picker.getByRole('slider', { name: 'Saturation and brightness' })
  const bounds = await area.boundingBox()
  await page.evaluate(() => {
    window.materialSeedUpdates = 0
    window.stopCountingMaterialSeedUpdates = window.$store.subscribe(({ type }) => {
      if (type === 'setMaterialSeedColor') window.materialSeedUpdates++
    })
  })

  const moves = 40
  await page.mouse.move(bounds.x + 4, bounds.y + 4)
  await page.mouse.down()
  const started = await page.evaluate(() => performance.now())
  for (let i = 1; i <= moves; i++) {
    await page.mouse.move(bounds.x + 4 + i * (bounds.width - 8) / moves, bounds.y + 4 + i * (bounds.height - 8) / (2 * moves))
  }
  const { elapsed, updates } = await page.evaluate(start => ({
    elapsed: performance.now() - start,
    updates: window.materialSeedUpdates,
  }), started)
  // Each update restyles the whole document, so it must not run once per pointer frame.
  expect(updates).toBeLessThanOrEqual(Math.ceil(elapsed / 100) + 1)

  await page.mouse.up()
  const color = await picker.getByRole('textbox', { name: /^Hex color/ }).inputValue()
  await expect.poll(() => page.evaluate(() => window.$store.getters.getMaterialSeedColor)).toBe(color)
  await expect(page.locator('body')).toHaveCSS('--primary-color', materialColorScheme(materialSeedPalette(color), false).primary)
  await page.evaluate(() => window.stopCountingMaterialSeedUpdates())
})
