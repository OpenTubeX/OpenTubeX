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
  // The field has no outline of its own; keyboard focus rings the whole bar.
  const findbar = page.locator('.findbar')
  const [primaryColor, contrastColor] = await findbarInput.evaluate(input => ['--primary-color', '--focus-ring-contrast-color'].map((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    input.after(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }))
  const contrastRing = `${contrastColor} 0px 0px 0px`
  await expect(findbar).toHaveCSS('outline-style', 'solid')
  await expect(findbar).toHaveCSS('outline-color', primaryColor)
  // A contrast line keeps light accents visible, as on the global focus ring.
  expect(await findbar.evaluate(element => getComputedStyle(element).boxShadow)).toContain(contrastRing)
  await expect(findbarInput).toHaveCSS('outline-style', 'none')
  // The focus ring belongs to the bar; it must not leak onto the document root.
  await expect(page.locator('html')).toHaveCSS('box-shadow', 'none')
  await findbarInput.click()
  await expect(page.locator('.app')).toHaveClass(/hideOutlines/)
  await expect(findbar).toHaveCSS('outline-style', 'none')
  expect(await findbar.evaluate(element => getComputedStyle(element).boxShadow)).not.toContain(contrastRing)
  await findbarInput.fill('findbar regression marker')
  await expect(findbarStatus).toHaveText('1/2')

  await findbarInput.press('Enter')
  await expect(findbarStatus).toHaveText('2/2')

  await findbarInput.press('Shift+Enter')
  await expect(findbarStatus).toHaveText('1/2')
})

for (const position of ['top', 'bottom']) {
  test(`find bar clears an overflowing ${position} tab bar`, { tag: '@scale' }, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1400, height: 700 })
    await page.evaluate(async (position) => {
      const store = window.$store
      store.commit('setTabBarPosition', position)
      store.commit('setScrollbarThumbWidth', 20)
      for (let index = 0; index < 18; index++) {
        await window.ftElectron.tabs.create({ route: '/history', makeActive: false, lazyLoad: true })
      }
    }, position)
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

test('find bar keeps its buttons inside the narrowest window', { tag: '@scale' }, async ({ app, page }) => {
  await setWindowSize(app, page, { width: 340, height: 640 })
  await page.keyboard.press('Control+f')
  await page.locator('.findbarInput').fill('zzz no such text zzz')
  await expect(page.locator('.findbarStatus')).toHaveText('No matches')
  // Stand in for a long translation, such as Japanese, of "No matches".
  await page.locator('.findbarStatus').evaluate((status) => { status.textContent = '一致する項目はありません' })
  const layout = await page.locator('.findbar').evaluate((findbar) => {
    const bar = findbar.getBoundingClientRect()
    const close = findbar.querySelector('.findbarButton:last-child').getBoundingClientRect()
    const input = findbar.querySelector('.findbarInput').getBoundingClientRect()
    return { bar: bar.right - innerWidth, close: close.right - bar.right, input: input.width }
  })
  expect(layout.bar).toBeLessThanOrEqual(0)
  expect(layout.close).toBeLessThanOrEqual(0)
  expect(layout.input).toBeGreaterThanOrEqual(48)
})
