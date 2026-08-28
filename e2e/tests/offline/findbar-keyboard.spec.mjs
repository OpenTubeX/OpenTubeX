import { test, expect } from '../../helpers/app.mjs'

test('Enter and Shift+Enter navigate one find bar match at a time', async ({ page }) => {
  await page.locator('.tabContent[aria-hidden="false"]').evaluate((tabContent) => {
    const fixture = document.createElement('div')
    fixture.textContent = 'findbar regression marker findbar regression marker'
    tabContent.prepend(fixture)
  })

  await page.keyboard.press('Control+f')
  const findbarInput = page.locator('.findbarInput')
  const findbarStatus = page.locator('.findbarStatus')
  await expect(findbarInput).toBeFocused()
  await expect(page.locator('.app')).not.toHaveClass(/hideOutlines/)
  await expect(findbarInput).not.toHaveCSS('box-shadow', 'none')
  await findbarInput.click()
  await expect(page.locator('.app')).toHaveClass(/hideOutlines/)
  await expect(findbarInput).toHaveCSS('box-shadow', 'none')
  await findbarInput.fill('findbar regression marker')
  await expect(findbarStatus).toHaveText('1/2')

  await findbarInput.press('Enter')
  await expect(findbarStatus).toHaveText('2/2')

  await findbarInput.press('Shift+Enter')
  await expect(findbarStatus).toHaveText('1/2')
})
