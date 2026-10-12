import { test, expect, setWindowSize } from '../../helpers/app.mjs'

test('Enter and Shift+Enter navigate one find bar match at a time', async ({ page }) => {
  await page.locator('.tabContent[aria-hidden="false"]').evaluate((tabContent) => {
    const fixture = document.createElement('div')
    fixture.textContent = 'findbar regression marker findbar regression marker'
    tabContent.prepend(fixture)
  })

  await page.keyboard.press('Control+f')
  const findbarInput = page.locator('.findbarInput')
  const findbarStatus = page.locator('.findbarStatus')
  await expect(findbarInput).toBeFocused()
  await expect(page.locator('.app')).not.toHaveClass(/hideOutlines/)
  await expect(findbarInput).not.toHaveCSS('box-shadow', 'none')
  await findbarInput.click()
  await expect(page.locator('.app')).toHaveClass(/hideOutlines/)
  await expect(findbarInput).toHaveCSS('box-shadow', 'none')
  await findbarInput.fill('findbar regression marker')
  await expect(findbarStatus).toHaveText('1/2')

  await findbarInput.press('Enter')
  await expect(findbarStatus).toHaveText('2/2')

  await findbarInput.press('Shift+Enter')
  await expect(findbarStatus).toHaveText('1/2')
})

for (const position of ['top', 'bottom']) {
  for (const scale of [0.95, 1.25]) {
    test(`find bar clears an overflowing ${position} tab bar at ${scale} scale`, async ({ app, page }) => {
      await setWindowSize(app, page, { width: 1400, height: 700 })
      await page.evaluate(async ({ position, scale }) => {
        window.ftElectron.setZoomFactor(scale)
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setTabBarPosition', position)
        store.commit('setScrollbarThumbWidth', 20)
        for (let index = 0; index < 18; index++) {
          await window.ftElectron.tabs.create({ route: '/history', makeActive: false, lazyLoad: true })
        }
      }, { position, scale })
      await expect(page.locator('.tabsContainer > .os-scrollbar-horizontal')).toHaveClass(/os-scrollbar-visible/)
      await page.keyboard.press('Control+f')
      const findbar = page.locator('.findbar')
      await expect(findbar).toBeVisible()
      await expect.poll(() => findbar.evaluate(element => {
        const gap = element.getBoundingClientRect().top - document.querySelector('.topNav').getBoundingClientRect().bottom
        return Math.abs(gap - 10) * devicePixelRatio
      })).toBeLessThanOrEqual(1)
    })
  }
}
