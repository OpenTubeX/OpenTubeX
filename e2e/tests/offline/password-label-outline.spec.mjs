import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'
import { hashPassword } from '../../../src/renderer/helpers/passwords.js'

const settingsPassword = await hashPassword('settings-test-password')

for (const baseTheme of ['openTubeXDark', 'openTubeXLight']) {
  test.describe(`${baseTheme} password error outline`, () => {
    test.use({ seed: { settings: { settingsPassword, baseTheme } } })

    test('leaves space above the label while focused and blurred', { tag: '@scale' }, async ({ app, page, uiScale }) => {
      await goTo(page, 'settings')
      const field = page.locator('.settingsPassword .passwordInput')
      const input = field.getByLabel('Password', { exact: true })
      await input.fill('incorrect-password')
      await input.press('Enter')
      await expect(page.getByRole('alert')).toHaveText('Incorrect password')

      for (const width of [1000, 480]) {
        await setWindowSize(app, page, {
          width: Math.round(width * uiScale / 100),
          height: Math.round((width === 1000 ? 800 : 700) * uiScale / 100)
        })
        for (const focused of [false, true]) {
          if (focused) await input.focus()
          else await input.blur()
          await expect.poll(() => field.evaluate(element => {
            const label = element.querySelector('.selectLabel').getBoundingClientRect()
            const rings = [...element.querySelectorAll('.ft-input, .inputOutline')].filter(node => {
              const style = getComputedStyle(node)
              return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
            })
            if (rings.length !== 1) return -Infinity
            const ring = rings[0]
            return label.top - (ring.getBoundingClientRect().top - parseFloat(getComputedStyle(ring).outlineOffset))
          }), { message: 'The error outline must clear the floating label by at least 2px' }).toBeGreaterThanOrEqual(2)
        }
      }
      await input.fill('settings-test-password')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(field.locator('.inputOutline')).toHaveCSS('outline-style', 'none')
      await input.press('Enter')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
    })
  })
}
