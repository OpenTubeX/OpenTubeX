import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { DBActions, IpcChannels } from '../../../src/constants.js'
import { test, expect, goTo, goToSettingsSection, latestSettings, setWindowSize } from '../../helpers/app.mjs'
import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'

const LABEL = 'Compact Settings Categories'

test.use({ seed: { settings: { currentLocale: 'en-US' } } })

async function expectValidCategoryScrollbars(menu) {
  await expect.poll(() => menu.evaluate(element => {
    const lastCategory = element.querySelector('.titleItem:last-of-type')
    const renderedEnd = lastCategory.getBoundingClientRect().bottom - element.getBoundingClientRect().top +
      element.scrollTop + Number.parseFloat(getComputedStyle(element).paddingBottom)
    const maximum = Math.max(0, renderedEnd - element.clientHeight)
    if (element.scrollTop > maximum + 1 || Math.abs(element.scrollHeight - element.clientHeight - maximum) > 1) return false
    const scrollbar = element.querySelector('.os-scrollbar-vertical')
    if (maximum <= 1) return scrollbar.classList.contains('os-scrollbar-unusable')
    const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
    const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
    return !scrollbar.classList.contains('os-scrollbar-unusable') &&
      Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) < 0.02
  })).toBe(true)
}

async function resizeWindowWidth(app, page, width) {
  const previousWidth = await page.evaluate(() => innerWidth)
  await app.electronApp.evaluate(({ BrowserWindow }, nextWidth) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setBounds({ ...window.getBounds(), width: nextWidth })
  }, width)
  await expect.poll(() => page.evaluate(() => innerWidth)).not.toBe(previousWidth)
}

for (const initialValue of [false, true]) {
  test.describe(`compact settings categories initially ${initialValue}`, () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', hideSettingsCategoryDescriptions: initialValue } } })

    test('keeps the toggle and layout consistent after a failed save and allows retrying', async ({ app, page }) => {
      const appearance = await goToSettingsSection(page, 'appearance')
      const toggle = appearance.getByRole('checkbox', { name: LABEL })
      await expect(toggle).toBeChecked({ checked: initialValue })
      await app.electronApp.evaluate(({ ipcMain }, { channel, upsert }) => {
        const original = ipcMain._invokeHandlers.get(channel)
        globalThis.__restoreCompactCategoryHandler = () => {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, original)
          delete globalThis.__rejectCompactCategorySave
          delete globalThis.__restoreCompactCategoryHandler
        }
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (event, request) => {
          if (request.action === upsert && request.data?._id === 'hideSettingsCategoryDescriptions') {
            return new Promise((_resolve, reject) => {
              globalThis.__rejectCompactCategorySave = () => reject(new Error('Compact category save failed'))
            })
          }
          return original(event, request)
        })
      }, { channel: IpcChannels.DB_SETTINGS, upsert: DBActions.GENERAL.UPSERT })

      try {
        await appearance.locator('label.switch-label').filter({ hasText: LABEL }).click()
        await expect.poll(() => app.electronApp.evaluate(() =>
          typeof globalThis.__rejectCompactCategorySave === 'function'
        )).toBe(true)
        await expect(toggle).toBeDisabled()
        const errorLogged = page.waitForEvent('console', {
          predicate: message => message.type() === 'error' && message.text().includes('Compact category save failed')
        })
        await app.electronApp.evaluate(() => globalThis.__rejectCompactCategorySave())
        await errorLogged
        await expect(toggle).toBeEnabled()
        await expect(toggle).toBeChecked({ checked: initialValue })
        await expect(page.locator('.settingsMenu .titleDescription')).toHaveCount(initialValue ? 0 : 11)
        expect(latestSettings(await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8'))
          .hideSettingsCategoryDescriptions).toBe(initialValue)
      } finally {
        await app.electronApp.evaluate(() => globalThis.__restoreCompactCategoryHandler())
      }

      await appearance.locator('label.switch-label').filter({ hasText: LABEL }).click()
      await expect(toggle).toBeChecked({ checked: !initialValue })
      await expect(page.locator('.settingsMenu .titleDescription')).toHaveCount(initialValue ? 11 : 0)
      await expect.poll(async () => latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      ).hideSettingsCategoryDescriptions).toBe(!initialValue)
    })

    test('disables the toggle during a slow save and enables it when saving finishes', async ({ app, page }, testInfo) => {
      const appearance = await goToSettingsSection(page, 'appearance')
      const toggle = appearance.getByRole('checkbox', { name: LABEL })
      await app.electronApp.evaluate(({ ipcMain }, { channel, upsert }) => {
        const original = ipcMain._invokeHandlers.get(channel)
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async (event, request) => {
          if (request.action === upsert && request.data?._id === 'hideSettingsCategoryDescriptions') {
            await new Promise(resolve => { globalThis.__releaseCompactCategorySave = resolve })
          }
          return original(event, request)
        })
      }, { channel: IpcChannels.DB_SETTINGS, upsert: DBActions.GENERAL.UPSERT })

      await appearance.locator('label.switch-label').filter({ hasText: LABEL }).click()
      try {
        await expect.poll(() => app.electronApp.evaluate(() =>
          typeof globalThis.__releaseCompactCategorySave === 'function'
        )).toBe(true)
        await expect(toggle).toBeDisabled()
        await expect(toggle).toBeChecked({ checked: initialValue })
        await expect(page.locator('.settingsMenu .titleDescription')).toHaveCount(initialValue ? 0 : 11)
        const savingScreenshot = testInfo.outputPath('compact-categories-saving.png')
        await page.locator('[data-setting-key="hideSettingsCategoryDescriptions"]').screenshot({ path: savingScreenshot })
        await testInfo.attach('compact-categories-saving', { path: savingScreenshot, contentType: 'image/png' })
      } finally {
        await app.electronApp.evaluate(() => globalThis.__releaseCompactCategorySave?.())
      }
      await expect(toggle).toBeEnabled()
      await expect(toggle).toBeChecked({ checked: !initialValue })
      await expect(page.locator('.settingsMenu .titleDescription')).toHaveCount(initialValue ? 11 : 0)
      await expect.poll(async () => latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      ).hideSettingsCategoryDescriptions).toBe(!initialValue)
      const savedScreenshot = testInfo.outputPath('compact-categories-saved.png')
      await page.locator('[data-setting-key="hideSettingsCategoryDescriptions"]').screenshot({ path: savedScreenshot })
      await testInfo.attach('compact-categories-saved', { path: savedScreenshot, contentType: 'image/png' })
    })
  })
}

test('hides settings category descriptions immediately and persists across restarts', async ({ app }, testInfo) => {
  let page = app.page
  const appearance = await goToSettingsSection(page, 'appearance')
  const toggle = appearance.getByRole('checkbox', { name: LABEL })
  await expect(toggle).not.toBeChecked()
  await expect(page.locator('.settingsMenu .titleDescription')).toHaveCount(11)

  await appearance.locator('label.switch-label').filter({ hasText: LABEL }).click()
  await expect(toggle).toBeChecked()
  await expect(page.locator('.settingsMenu .titleDescription')).toHaveCount(0)
  await expect(page.locator('.settingsMenu .titleText')).toHaveCount(11)
  await expect.poll(async () => latestSettings(
    await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
  ).hideSettingsCategoryDescriptions).toBe(true)
  ;({ page } = await app.relaunch())
  await goToSettingsSection(page, 'appearance')
  await expect(page.getByRole('checkbox', { name: LABEL })).toBeChecked()
  await expect(page.locator('.settingsMenu .titleDescription')).toHaveCount(0)
  const tooltipButton = page.locator('[data-setting-key="hideSettingsCategoryDescriptions"] .tooltip .button')
  await expect(tooltipButton.locator('[data-icon="circle-question"]')).toBeVisible()
  await tooltipButton.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Hides descriptions and reduces the height of settings categories.')
  await captureAppFramebuffer(app, testInfo, 'settings-category-descriptions-hidden')

  const search = page.getByRole('searchbox', { name: 'Search settings' })
  await search.fill(LABEL)
  await page.getByRole('button', { name: LABEL, exact: true }).click()
  await expect(page.locator('.settingsSearchTarget')).toContainText(LABEL)
  await page.locator('label.switch-label').filter({ hasText: LABEL }).click()
  await expect(page.locator('.settingsMenu .titleDescription')).toHaveCount(11)
})

for (const uiScale of [100, 125]) {
  for (const reveal of ['back', 'resize']) {
    test.describe(`hidden settings menu at ${uiScale}% revealed by ${reveal}`, () => {
      test.use({ seed: { settings: { currentLocale: 'en-US', uiScale } } })

      test('clamps the shortened category menu when it becomes visible', async ({ app, page }) => {
        await setWindowSize(app, page, { width: 1500, height: 550 })
        const appearance = await goToSettingsSection(page, 'appearance')
        const menu = page.locator('.settingsMenu')
        await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
        await resizeWindowWidth(app, page, 480)
        await expect(menu).toBeHidden()
        await appearance.locator('label.switch-label').filter({ hasText: LABEL }).click()
        await expect(appearance.getByRole('checkbox', { name: LABEL })).toBeChecked()
        await expect(menu.locator('.titleDescription')).toHaveCount(0)
        if (reveal === 'back') {
          await page.locator('.settingsBackButton').click()
        } else {
          await resizeWindowWidth(app, page, 1500)
        }
        await expect(menu).toBeVisible()
        await expectValidCategoryScrollbars(menu)
      })
    })
  }

  for (const width of [480, 1500]) {
    test.describe(`settings category descriptions at ${width}px and ${uiScale}%`, () => {
      test.use({ seed: { settings: { currentLocale: 'en-US', uiScale } } })

      test('preserves category navigation and valid scrollbars after hiding descriptions at the bottom', async ({ app, page }) => {
        await setWindowSize(app, page, { width, height: 650 })
        await goTo(page, 'settings')
        const menu = page.locator('.settingsMenu')
        await expect(menu).toBeVisible()
        await expect(menu.locator('.titleDescription')).toHaveCount(11)
        const category = menu.locator('.titleItem').first()
        const expandedHeight = (await category.boundingBox()).height
        await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

        // The control lives on another view in compact layouts. Change the same
        // preference directly to exercise shortening the currently visible menu.
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
          .dispatch('updateHideSettingsCategoryDescriptions', true))
        await expect(menu.locator('.titleDescription')).toHaveCount(0)
        await expect(category).toHaveCSS('min-block-size', width === 480 ? '48px' : '36px')
        expect((await category.boundingBox()).height).toBeLessThan(expandedHeight - 10)
        await expectValidCategoryScrollbars(menu)

        await goToSettingsSection(page, 'appearance')
        await expect(page.getByRole('checkbox', { name: LABEL })).toBeChecked()
        await page.locator('label.switch-label').filter({ hasText: LABEL }).click()
        if (width === 480) await page.locator('.settingsBackButton').click()
        await expect(menu).toBeVisible()
        await expect(menu.locator('.titleDescription')).toHaveCount(11)
        await expect.poll(async () => (await category.boundingBox()).height).toBeCloseTo(expandedHeight, 0)
      })
    })
  }
}
