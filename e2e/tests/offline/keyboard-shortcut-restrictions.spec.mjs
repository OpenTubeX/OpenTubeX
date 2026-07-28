import { test, expect } from '../../helpers/app.mjs'

test('context-dependent shortcuts are shown as non-editable', async ({ page }) => {
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setIsKeyboardShortcutPromptShown', true)
  })
  await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toHaveAttribute(
    'data-overlayscrollbars-viewport'
  )

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
})
