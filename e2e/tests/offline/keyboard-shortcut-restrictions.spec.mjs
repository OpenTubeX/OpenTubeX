import { test, expect } from '../../helpers/app.mjs'

test('context-dependent shortcuts are shown as non-editable', async ({ page }) => {
  await page.locator('.navSettingsButton').click()
  await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()

  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(page.locator('.settingsBreadcrumb')).toContainText('Keyboard Shortcuts')
  await expect(page.locator('.shortcutColumns')).toHaveAttribute(
    'data-overlayscrollbars-viewport'
  )
  await expect(page.locator('.keyboardShortcutPromptEmbedded')).toBeVisible()

  const [backBounds, settingsIconBounds, settingsBreadcrumbBounds, settingsTextBounds] = await Promise.all([
    page.locator('.settingsBackButton').boundingBox(),
    page.locator('.settingsBreadcrumbRoot .settingsWindowIcon').boundingBox(),
    page.locator('.settingsBreadcrumbRoot').boundingBox(),
    page.locator('.settingsBreadcrumbRoot .settingsBreadcrumbText').boundingBox()
  ])
  expect(backBounds.x + backBounds.width).toBeLessThan(settingsBreadcrumbBounds.x)
  expect(settingsIconBounds.x + settingsIconBounds.width).toBeLessThan(settingsTextBounds.x)
  expect(settingsIconBounds.y + settingsIconBounds.height / 2)
    .toBeCloseTo(settingsTextBounds.y + settingsTextBounds.height / 2, 0)

  const resetButton = page.getByRole('button', { name: 'Reset to Defaults' })
  await expect(resetButton).toBeDisabled()
  const [resetBounds, firstSectionBounds] = await Promise.all([
    resetButton.boundingBox(),
    page.locator('.shortcutSection').first().boundingBox()
  ])
  expect(resetBounds.y).toBeLessThan(firstSectionBounds.y)

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.dispatch('updateKeyboardShortcuts', JSON.stringify({
      APP: { GENERAL: { FOCUS_SEARCH: 'Ctrl+Shift+K' } }
    }))
  })
  await expect(resetButton).toBeEnabled()
  await resetButton.click()
  await expect(resetButton).toBeDisabled()

  const toolbar = page.locator('.shortcutToolbar')
  const scrollContainer = page.locator('.shortcutColumns')
  const initialToolbarTop = (await toolbar.boundingBox()).y
  await scrollContainer.evaluate(element => {
    element.scrollTop = 500
  })
  await expect.poll(async () => (await toolbar.boundingBox()).y).toBeCloseTo(initialToolbarTop, 0)

  const reservedPaths = [
    'APP.GENERAL.FOCUS_SEARCH_ALT_SLASH',
    'APP.GENERAL.SEARCH_IN_NEW_WINDOW',
    'APP.GENERAL.FIND_NEXT_ALT_ENTER',
    'APP.GENERAL.FIND_PREVIOUS_ALT_ENTER',
    'APP.GENERAL.NEXT_TAB',
    'APP.GENERAL.PREV_TAB',
  ]

  for (const path of reservedPaths) {
    await expect(page.locator(`[data-shortcut-path="${path}"]`)).toHaveCount(0)
  }

  await expect(page.locator('[data-shortcut-path="APP.GENERAL.FOCUS_SEARCH"]')).toHaveCount(1)

  await page.locator('.settingsBackButton').click()
  await expect(page.locator('.keyboardShortcutPromptEmbedded')).toHaveCount(0)
  await expect(page.locator('.settingsMenu')).toBeVisible()
})
