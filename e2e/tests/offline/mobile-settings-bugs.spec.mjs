import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

test('help icons open a dialog on touch screens instead of a stuck tooltip', async ({ page }) => {
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await page.setViewportSize({ width: 375, height: 812 })
  const section = await goToSettingsSection(page, 'playback')
  const toggle = section.locator('.switch-ctn.containsTooltip').first()
  const help = toggle.locator('.tooltip .button')
  await help.scrollIntoViewIfNeeded()
  const helpText = (await page.locator(`[id="${await help.getAttribute('aria-labelledby')}"]`).textContent()).trim()
  const checked = await toggle.locator('input').isChecked()
  const tap = async (locator) => {
    const bounds = await locator.boundingBox()
    const touchPoint = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 0 }
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await tap(help)

  const dialog = page.locator('.prompt [role="dialog"]')
  await expect(dialog).toContainText(helpText)
  await expect(page.locator('[role="tooltip"]:visible')).toHaveCount(0)
  await expect(toggle.locator('input')).toBeChecked({ checked })

  await tap(dialog.getByRole('button', { name: 'Close' }))
  await expect(dialog).toHaveCount(0)
  await expect(help).toBeFocused()
  await expect(page.locator('[role="tooltip"]:visible')).toHaveCount(0)
})
