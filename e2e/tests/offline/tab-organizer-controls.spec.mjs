import { test, expect, expectScrollAtRenderedEnd } from '../../helpers/app.mjs'

for (const uiScale of [100, 95, 125]) {
  test.describe(`organizer controls at ${uiScale}%`, () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', baseTheme: 'dark', uiScale, fetchSubscriptionsAutomatically: false } } })

    test('shares one desktop row, wraps without overflow, and creates groups in a focused dialog', async ({ app, page }, testInfo) => {
      await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1920, height: 1080 }))
      await page.evaluate(async () => {
        for (let index = 0; index < 30; index++) {
          await window.ftElectron.tabs.create({ route: { path: '/subscriptions' }, title: `Organizer tab ${index}`, activate: false, lazyLoad: true })
        }
      })
      await page.locator('.tabOrganizerButton').click()
      const organizer = page.getByRole('dialog', { name: 'Tab Organizer', exact: true })
      const controls = organizer.locator('.tabOrganizerControls')
      await expect.poll(() => controls.evaluate(element => {
        const controls = [...element.querySelectorAll(':scope > button, :scope > span, :scope > .select .select-text, :scope > .tabOrganizerSearch input')]
        const bottoms = controls.map(control => control.getBoundingClientRect().bottom)
        return Math.max(...bottoms) - Math.min(...bottoms)
      })).toBeLessThanOrEqual(1)
      await organizer.screenshot({ path: testInfo.outputPath('organizer-desktop.png') })
      const scroller = organizer.locator('.tabOrganizerScroll')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expectScrollAtRenderedEnd(scroller)
      const scrollTop = await scroller.evaluate(element => element.scrollTop)
      const create = organizer.getByRole('button', { name: 'Create Group', exact: true })
      await create.click()
      const prompt = page.getByRole('dialog', { name: 'Create Group', exact: true })
      const name = prompt.getByRole('textbox', { name: 'Group name', exact: true })
      await expect(name).toBeFocused()
      await expect(prompt.getByRole('button', { name: 'Create Group', exact: true })).toBeDisabled()
      await name.fill('   ')
      await name.press('Enter')
      await expect(prompt).toBeVisible()
      await name.press('Shift+Tab')
      await expect(prompt.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(name).toBeFocused()
      await name.press('Escape')
      await expect(prompt).toHaveCount(0)
      await expect(organizer).toBeVisible()
      await expect(create).toBeFocused()
      expect(await scroller.evaluate(element => element.scrollTop)).toBeCloseTo(scrollTop, 0)

      await organizer.getByRole('button', { name: 'Select All', exact: true }).click()
      await create.click()
      await expect(name).toHaveValue('')
      await name.fill('  Research  ')
      await prompt.screenshot({ path: testInfo.outputPath('create-group.png') })
      await name.press('Enter')
      await expect(prompt).toHaveCount(0)
      await expect(organizer.locator('.tabGroup').filter({ has: page.getByRole('button', { name: 'Rename Research', exact: true }) }).locator('.tabOrganizerRow')).toHaveCount(31)
      await expect(create).toBeFocused()

      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 375, height: 800 }))
      await expect.poll(async () => Math.abs(await page.evaluate(() => innerWidth) - 375 * 100 / uiScale)).toBeLessThanOrEqual(1)
      await expect.poll(() => organizer.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expectScrollAtRenderedEnd(scroller)
      await organizer.screenshot({ path: testInfo.outputPath('organizer-narrow.png') })
      await create.click()
      await expect(name).toBeFocused()
      await expect.poll(() => prompt.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await prompt.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(create).toBeFocused()

      const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
      for (const height of [800, 1080]) {
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        const previousRange = await scroller.evaluate(element => element.scrollHeight - element.clientHeight)
        await app.electronApp.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1920, height }), height)
        await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThan(previousRange)
        await expectScrollAtRenderedEnd(scroller)
        await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
      }
    })
  })
}
