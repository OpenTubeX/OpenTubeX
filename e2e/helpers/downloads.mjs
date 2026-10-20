export async function openDownloadMenu(page, row) {
  await row.getByRole('button', { name: 'More options', exact: true }).click()
  return page.getByRole('menu')
}

export async function chooseDownloadAction(page, row, name) {
  const menu = await openDownloadMenu(page, row)
  await menu.getByRole('menuitem', { name, exact: true }).click()
}
