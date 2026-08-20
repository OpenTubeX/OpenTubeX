import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'

test('shows icons on data actions and vertically centers export choices', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  const actionButtons = dataSection.locator('.ft-flex-box.box > .btn')

  await expect(actionButtons).toHaveCount(12)
  await expect.poll(() => actionButtons.locator(':scope > .ft-icon').count()).toBe(12)

  await dataSection.getByRole('button', { name: /Export Subscriptions/i }).click()
  const exportChoices = page.locator('.settingsSubpageContent .exportTypeButtons')
  await expect(exportChoices).toHaveCSS('align-content', 'center')
  await expect(exportChoices).toHaveCSS('align-items', 'center')
  await expect(exportChoices).toHaveCSS('justify-content', 'space-evenly')
  await expect.poll(() => exportChoices.evaluate(container => {
    const subpage = container.closest('.settingsSubpageContent')
    const buttons = [...container.querySelectorAll('button')]
    if (!subpage || buttons.length === 0) return Number.POSITIVE_INFINITY

    const subpageRect = subpage.getBoundingClientRect()
    const buttonRects = buttons.map(button => button.getBoundingClientRect())
    const buttonsTop = Math.min(...buttonRects.map(rect => rect.top))
    const buttonsBottom = Math.max(...buttonRects.map(rect => rect.bottom))
    const subpageCenter = (subpageRect.top + subpageRect.bottom) / 2
    const buttonsCenter = (buttonsTop + buttonsBottom) / 2
    return Math.abs(subpageCenter - buttonsCenter)
  })).toBeLessThanOrEqual(1)
  await expect.poll(() => exportChoices.getByRole('button').evaluateAll(buttons => (
    buttons.length > 0 && buttons.every(button => button.querySelector('.ft-icon'))
  ))).toBe(true)
})

test('opens the profile directory in the file manager', async ({ app }) => {
  const { electronApp, page, userDataDir } = app
  await electronApp.evaluate(({ shell }) => {
    globalThis.openedProfileDirectory = null
    shell.openPath = async (directory) => {
      globalThis.openedProfileDirectory = directory
      return ''
    }
  })

  const dataSection = await goToSettingsSection(page, 'data')
  await expect(dataSection.locator('.groupTitle').last()).toHaveText(/Profile directory/i)
  await dataSection.getByRole('button', { name: /Open Profile Directory/i }).click()

  await expect.poll(() => electronApp.evaluate(() => globalThis.openedProfileDirectory))
    .toBe(userDataDir)
})

test('does not show a delayed IPC error after opening the profile directory', async ({ app }) => {
  const { electronApp, page, userDataDir } = app
  await electronApp.evaluate(({ shell }) => {
    globalThis.openedProfileDirectory = null
    globalThis.profileDirectoryOpenSettled = false
    shell.openPath = async (directory) => {
      globalThis.openedProfileDirectory = directory
      await new Promise(resolve => setTimeout(resolve, 50))
      globalThis.profileDirectoryOpenSettled = true
      throw new Error('reply was never sent')
    }
  })

  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(() => {
    globalThis.profileDirectoryErrorToastShown = false
    const observer = new MutationObserver(() => {
      if (document.body.textContent.includes('Unable to open profile directory')) {
        globalThis.profileDirectoryErrorToastShown = true
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
  await dataSection.getByRole('button', { name: /Open Profile Directory/i }).click()

  await expect.poll(() => electronApp.evaluate(() => globalThis.openedProfileDirectory))
    .toBe(userDataDir)
  await expect.poll(() => electronApp.evaluate(() => globalThis.profileDirectoryOpenSettled))
    .toBe(true)
  await page.waitForTimeout(2500)
  expect(await page.evaluate(() => globalThis.profileDirectoryErrorToastShown)).toBe(false)
})
