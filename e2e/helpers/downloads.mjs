/**
 * Opens the actions menu for a download row.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} row
 * @returns {Promise<import('@playwright/test').Locator>}
 */
export async function openDownloadMenu(page, row) {
  await row.getByRole('button', { name: 'More options', exact: true }).click()
  return page.getByRole('menu')
}

/**
 * Selects a download action by its exact accessible name.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} row
 * @param {string} name
 */
export async function chooseDownloadAction(page, row, name) {
  const menu = await openDownloadMenu(page, row)
  await menu.getByRole('menuitem', { name, exact: true }).click()
}
