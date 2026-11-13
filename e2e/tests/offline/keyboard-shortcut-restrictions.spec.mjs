import { test, expect, goTo } from '../../helpers/app.mjs'

test('opens Downloads without navigating or reloading the active tab', async ({ page }) => {
  const activeView = page.locator('.tabContent[aria-hidden="false"] > .routerView')
  await activeView.evaluate(element => { element.dataset.downloadShortcutSentinel = 'mounted' })

  await page.keyboard.press('Control+j')

  await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
  expect(await activeView.getAttribute('data-download-shortcut-sentinel')).toBe('mounted')
})

test('assigns and runs a shortcut for the tab organizer', async ({ page }) => {
  await goTo(page, 'settings')
  await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()

  const shortcut = page.locator('[data-shortcut-path="APP.GENERAL.OPEN_TAB_ORGANIZER"]')
  await expect(shortcut).toHaveText('Unassigned')
  await shortcut.click()
  await shortcut.press('Control+Shift+o')
  await expect(shortcut).toHaveText('Ctrl+Shift+o')
  await expect(page.locator('.tabOrganizerButton')).toHaveAttribute(
    'title',
    'Tab Organizer (Ctrl+Shift+o)'
  )

  await page.locator('.settingsCloseButton').click()
  await expect(page.locator('.settingsWindow')).toBeHidden()
  await page.keyboard.press('Control+Shift+o')

  await expect(page.getByRole('dialog', { name: 'Tab Organizer' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search tabs' })).toBeFocused()
  await page.keyboard.press('Control+Shift+o')
  await expect(page.getByRole('dialog', { name: 'Tab Organizer' })).toBeHidden()
})

test('closing cached shortcuts dismisses conflicts and releases the page scroll lock', async ({ page }) => {
  await page.keyboard.press('Shift+?')
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(page.locator('.keyboardShortcutPromptEmbedded')).toBeVisible()
  const originalOverflow = await page.evaluate(() => document.documentElement.style.overflow)
  const shortcut = page.locator('[data-shortcut-path="APP.GENERAL.FOCUS_SEARCH"]')
  const originalBinding = await shortcut.textContent()
  await shortcut.click()
  await shortcut.press('Control+j')
  await expect(page.locator('.prompt')).toBeVisible()
  await page.keyboard.press('Shift+?')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.prompt')).toHaveCount(0)
  expect(await page.evaluate(() => window.$store.getters.isAnyPromptOpen)).toBe(false)
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe(originalOverflow)
  await page.keyboard.press('Shift+?')
  await expect(page.locator('.keyboardShortcutPromptEmbedded')).toBeVisible()
  await expect(page.locator('.prompt')).toHaveCount(0)
  await expect(shortcut).toHaveText(originalBinding)
  await expect(shortcut).not.toHaveClass(/recording/)
})
