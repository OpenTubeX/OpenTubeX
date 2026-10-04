import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'
import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

for (const width of [1600, 480]) {
  for (const uiScale of [100, 95]) {
    test.describe(`password visibility at ${width}px and ${uiScale}% scale`, () => {
      test.use({
        seed: {
          settings: {
            currentLocale: 'en-US',
            baseTheme: 'dark',
            uiScale,
            bounds: { x: 0, y: 0, width, height: 900, maximized: false }
          }
        }
      })

      test('reveals and masks passwords with pointer and keyboard without changing the value', async ({ app, page }, testInfo) => {
        const section = await goToSettingsSection(page, 'privacy')
        const input = section.getByLabel('Password', { exact: true })
        const field = input.locator('../..')
        const toggle = field.locator('.passwordVisibilityToggle')
        await expect(input).toHaveAttribute('type', 'password')
        await expect(toggle).toHaveAccessibleName('Show password')
        await expect(toggle).toHaveAttribute('aria-controls', await input.getAttribute('id'))
        await expect(page.locator('.topNav .passwordVisibilityToggle')).toHaveCount(0)
        await input.fill('example-password')
        await toggle.hover()
        await expect(toggle).toHaveCSS('background-clip', 'content-box')
        expect(await toggle.evaluate(element => parseFloat(getComputedStyle(element).paddingTop))).toBeGreaterThanOrEqual(4)
        await captureAppFramebuffer(app, testInfo, 'password-eye-hover')

        for (const pack of ['material', 'remix']) {
          await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', value), pack)
          for (const direction of ['ltr', 'rtl']) {
            await page.evaluate(value => { document.body.dir = value }, direction)
            await input.focus()
            await input.evaluate(element => element.setSelectionRange(2, 7, 'backward'))
            await toggle.click()
            await expect(input).toHaveAttribute('type', 'text')
            await expect(input).toHaveValue('example-password')
            await expect(input).toBeFocused()
            await expect(toggle).toHaveAccessibleName('Hide password')
            await expect(toggle.locator('[data-icon="eye-slash"]')).toBeVisible()
            expect(await input.evaluate(element => [element.selectionStart, element.selectionEnd, element.selectionDirection])).toEqual([2, 7, 'backward'])
            const geometry = await input.evaluate(element => {
              const style = getComputedStyle(element)
              const field = element.getBoundingClientRect()
              const button = element.parentElement.querySelector('.passwordVisibilityToggle').getBoundingClientRect()
              return {
                padding: parseFloat(style.paddingInlineEnd),
                reserved: style.direction === 'rtl' ? button.right - field.left : field.right - button.left,
                buttonInside: button.left >= field.left && button.right <= field.right && button.top >= field.top && button.bottom <= field.bottom
              }
            })
            expect(geometry.padding).toBeGreaterThanOrEqual(geometry.reserved)
            expect(geometry.buttonInside).toBe(true)
            await toggle.click()
            await expect(input).toHaveAttribute('type', 'password')
            await expect(toggle.locator('[data-icon="eye"]')).toBeVisible()
          }
          await page.evaluate(() => { document.body.dir = 'ltr' })
          await toggle.click()
          await input.evaluate(element => element.setSelectionRange(element.value.length, element.value.length))
          await page.locator('.settingsContent').evaluate(element => { element.scrollTop = element.scrollHeight })
          await captureAppFramebuffer(app, testInfo, `password-visibility-${pack}`)
          await toggle.click()
        }

        await input.focus()
        await input.press('Tab')
        await expect(toggle).toBeFocused()
        await toggle.press('Space')
        await expect(input).toHaveAttribute('type', 'text')
        await expect(toggle).toBeFocused()
        await toggle.press('Enter')
        await expect(input).toHaveAttribute('type', 'password')
        await expect(toggle).toBeFocused()
        await expect(input).toHaveValue('example-password')
        expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getSettingsPassword)).toBe('')
      })
    })
  }
}
