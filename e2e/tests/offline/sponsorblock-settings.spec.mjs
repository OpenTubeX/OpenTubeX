import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

async function openSettings(page) {
  await goToSettingsSection(page, 'sponsor-block')
  await expect(page.locator('.sponsorBlockCategory')).toHaveCount(10)
}

for (const uiScale of [100, 125]) {
  test.describe(`SponsorBlock settings at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale, baseTheme: uiScale === 100 ? 'dark' : 'light', currentLocale: 'en-US', useSponsorBlock: true, sponsorBlockEnableSubmission: true, sponsorBlockUserId: 'test-private-id', alwaysShowScrollbars: true } } })

    test('masks the private user ID while preserving edits', async ({ page }) => {
      await openSettings(page)
      const input = page.getByLabel('Private user ID (optional)', { exact: true })
      await expect(input).toHaveAttribute('type', 'password')
      await expect(input).toHaveValue('test-private-id')
      await input.fill('edited-private-id')
      const field = input.locator('../..')
      await field.getByRole('button', { name: 'Show password', exact: true }).click()
      await expect(input).toHaveAttribute('type', 'text')
      await expect(input).toHaveValue('edited-private-id')
      await field.getByRole('button', { name: 'Hide password', exact: true }).click()
      await expect(input).toHaveAttribute('type', 'password')
      await page.locator('.settingsMenu [data-section="general"]').click()
      await openSettings(page)
      await expect(input).toHaveValue('edited-private-id')
    })

    test('uses equal category widths and shows complete skip values across window sizes', async ({ app, page }, testInfo) => {
      await openSettings(page)
      const categories = page.locator('.sponsorBlockCategory')
      for (const locale of ['en-US', 'de-DE']) {
        await page.evaluate(locale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCurrentLocale', locale), locale)
        for (const value of ['promptToSkip', 'showInSeekBar']) {
          await categories.locator('.nativeSelect').evaluateAll((selects, value) => {
            for (const select of selects.filter(select => Array.from(select.options).some(option => option.value === value))) {
              select.value = value
              select.dispatchEvent(new Event('change', { bubbles: true }))
            }
          }, value)
          for (const width of [1600, 1100, 750, 375]) {
            await app.electronApp.evaluate(({ BrowserWindow }, width) => {
              const window = BrowserWindow.getAllWindows()[0]
              window.setBounds({ ...window.getBounds(), width, height: 900 })
            }, Math.round(width * uiScale / 100))
            await expect.poll(() => categories.evaluateAll(elements => {
              const widths = elements.map(element => element.getBoundingClientRect().width)
              return Math.max(...widths) - Math.min(...widths)
            })).toBeLessThanOrEqual(1)
            await expect.poll(() => categories.locator('.selectedValue').evaluateAll(elements => elements.every(element =>
              element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1
            ))).toBe(true)
            await expect.poll(() => categories.evaluateAll(elements => elements.every(element => {
              const bounds = element.getBoundingClientRect()
              return bounds.left >= -1 && bounds.right <= innerWidth + 1
            }))).toBe(true)
            if (value === 'promptToSkip' && [1600, 375].includes(width)) {
              await categories.first().scrollIntoViewIfNeeded()
              await page.screenshot({ path: testInfo.outputPath(`sponsorblock-${locale}-${width}.png`) })
            }
          }
        }
      }
    })

    test('widens narrow dropdowns around their select and keeps complete options inside viewport edges', async ({ app, page }, testInfo) => {
      await openSettings(page)
      const category = page.locator('.sponsorBlockCategory').first()
      const select = category.getByRole('combobox', { name: 'Skip Option' })
      await select.evaluate(button => { button.style.inlineSize = '130px' })
      await select.click()
      const menu = page.locator('.selectDropdown:not(.phonePicker)')
      await expect(menu).toBeVisible()
      await expect.poll(() => select.evaluate(button => {
        const menu = document.getElementById(button.getAttribute('aria-controls'))
        const bounds = menu.getBoundingClientRect()
        const anchor = button.getBoundingClientRect()
        return bounds.width > anchor.width && Math.abs(bounds.left + bounds.width / 2 - anchor.left - anchor.width / 2) <= 1 &&
          Array.from(menu.querySelectorAll('.optionName')).every(name => {
            const range = document.createRange()
            range.selectNodeContents(name)
            const text = range.getBoundingClientRect()
            const row = name.closest('.selectOption')
            const bounds = row.getBoundingClientRect()
            const style = getComputedStyle(row)
            return text.left >= bounds.left + parseFloat(style.paddingLeft) - 1 &&
              text.right <= bounds.right - parseFloat(style.paddingRight) + 1
          })
      })).toBe(true)
      await menu.screenshot({ path: testInfo.outputPath('widened-dropdown.png') })
      await select.press('Escape')

      // A label wider than the viewport must wrap rather than lose its ending.
      await page.evaluate(() => {
        const app = document.querySelector('#app').__vue_app__
        app._context.provides[app.__VUE_I18N_SYMBOL__].global.mergeLocaleMessage('en-US', {
          Settings: { 'SponsorBlock Settings': { 'Skip Options': { 'Show In Seek Bar': 'Show this complete option in the seek bar '.repeat(40) } } }
        })
      })
      await select.evaluate(button => {
        button.style.position = 'fixed'
        button.style.left = '8px'
        button.style.top = '250px'
      })
      await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setBounds({ ...window.getBounds(), width: Math.round(760 * scale / 100), height: Math.round(900 * scale / 100) })
      }, uiScale)
      // The artificial fixed anchor can overlap another category after resize.
      await select.focus()
      await select.press('Enter')
      await expect.poll(() => menu.evaluate(menu => {
        const bounds = menu.getBoundingClientRect()
        return bounds.left >= 7 && bounds.right <= innerWidth - 7 &&
          Array.from(menu.querySelectorAll('.optionName')).every(name => {
            const range = document.createRange()
            range.selectNodeContents(name)
            const text = range.getBoundingClientRect()
            const row = name.closest('.selectOption')
            const bounds = row.getBoundingClientRect()
            const style = getComputedStyle(row)
            return text.left >= bounds.left + parseFloat(style.paddingLeft) - 1 &&
              text.right <= bounds.right - parseFloat(style.paddingRight) + 1
          })
      })).toBe(true)
      const longOption = menu.getByRole('option', { name: /^Show this complete/ })
      await expect.poll(() => longOption.evaluate(option => option.getBoundingClientRect().height)).toBeGreaterThan(48)
      const scrollbar = menu.locator('.os-scrollbar-vertical')
      await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
      await menu.evaluate(menu => menu.scrollTo(0, menu.scrollHeight))
      await expect.poll(() => menu.evaluate(menu => Math.abs(
        menu.querySelector('.selectOption:last-of-type').getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(menu).paddingBottom) - menu.getBoundingClientRect().bottom
      ) * devicePixelRatio)).toBeLessThanOrEqual(2)
      // Widening the viewport unwraps long labels and reduces the scroll range.
      await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setBounds({ ...window.getBounds(), width: Math.round(1600 * scale / 100) })
      }, uiScale)
      await expect.poll(() => menu.evaluate(menu => {
        const bounds = menu.getBoundingClientRect()
        const contentEnd = menu.querySelector('.selectOption:last-of-type').getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(menu).paddingBottom)
        return menu.scrollTop <= Math.max(0, menu.scrollHeight - menu.clientHeight) + 1 &&
          Math.abs(contentEnd - bounds.bottom) * devicePixelRatio <= 2
      })).toBe(true)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-visible/)
      await longOption.click()
      await expect(menu).toHaveCount(0)
    })

    test('sizes dropdown options with color dots without clipping their labels', async ({ page }) => {
      await page.locator('.profileTrigger').click()
      const select = page.getByRole('dialog', { name: 'Quick settings' }).getByRole('combobox', { name: 'Main Color Theme' })
      await select.evaluate(button => { button.style.inlineSize = '80px' })
      await select.click()
      const menu = page.locator('.selectDropdown:not(.phonePicker)')
      await expect(menu.locator('.optionColorDot').first()).toBeVisible()
      await expect.poll(() => menu.locator('.optionName').evaluateAll(names => names.every(name => {
        const range = document.createRange()
        range.selectNodeContents(name)
        const text = range.getBoundingClientRect()
        const row = name.closest('.selectOption')
        return name.scrollWidth <= name.clientWidth + 1 &&
          text.right <= row.getBoundingClientRect().right - parseFloat(getComputedStyle(row).paddingRight) + 1
      }))).toBe(true)
    })
  })
}
