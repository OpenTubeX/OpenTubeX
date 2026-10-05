import { test, expect, goTo, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

test.use({
  seed: {
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Channel', thumbnail: '' }]
    }]
  }
})

test.beforeEach(async ({ app, page }) => {
  await setWindowSize(app, page, { width: 390, height: 850 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => document.querySelector('.app').classList.add('capacitorTabs'))
})

test('large switches keep the same thumb diameter when off and on', async ({ page }) => {
  const appearance = await goToSettingsSection(page, 'appearance')
  const label = appearance.locator('.switch-ctn[data-setting-key="moveSettingsToAppHeader"] .switch-label')
  const diameter = () => label.evaluate(element => getComputedStyle(element, '::after').width)
  const off = await diameter()
  await label.click()
  await page.mouse.move(0, 0)
  expect(await diameter()).toBe(off)
  await label.click()
  await page.mouse.move(0, 0)
  expect(await diameter()).toBe(off)
})

test('phone picker marks selection with its radio without a row background', async ({ page }) => {
  await goToSettingsSection(page, 'theme')
  await page.getByRole('combobox', { name: 'Icon Pack' }).click()
  const selected = page.locator('.phonePicker .selectOption.selected')
  await page.mouse.move(0, 0)
  await expect(selected).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  expect(await selected.locator('.optionRadio').evaluate(element => getComputedStyle(element, '::after').content)).not.toBe('none')
  await page.getByRole('option', { name: 'Remix Icon' }).click()
  await page.getByRole('combobox', { name: 'Icon Pack' }).click()
  await expect(selected).toContainText('Remix Icon')
  await expect(selected).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('mobile select labels are readable and centered with both icon packs', async ({ page }) => {
  await goToSettingsSection(page, 'theme')
  for (const iconPack of ['material', 'remix']) {
    await page.evaluate(iconPack => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setIconPack', iconPack), iconPack)
    const label = page.locator('.select-label').filter({ hasText: 'Base Theme' }).first()
    const geometry = await label.evaluate(element => {
      const icon = element.querySelector('.select-icon').getBoundingClientRect()
      const text = element.querySelector('.select-placeholder').getBoundingClientRect()
      return {
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        centerDifference: Math.abs(icon.y + icon.height / 2 - text.y - text.height / 2)
      }
    })
    expect(geometry.fontSize).toBeGreaterThanOrEqual(14)
    expect(geometry.centerDifference).toBeLessThanOrEqual(1)
  }
})

test('subscription videos per day picker preserves its parent popup', async ({ page }) => {
  await goTo(page, 'subscribedchannels')
  await page.evaluate(() => document.body.style.setProperty('--card-bg-blur', 'blur(8px)'))
  await page.locator('.channel').getByRole('button', { name: 'Subscription settings' }).click()
  const popup = page.locator('body > .profileDropdown')
  const select = popup.getByRole('combobox', { name: 'Videos per day' })
  await select.click()
  const picker = page.getByRole('dialog', { name: 'Videos per day' })
  await expect(picker).toBeVisible()
  expect(await picker.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      fitsViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      centered: Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 1,
      expectedWidth: Math.abs(rect.width - Math.min(innerWidth - 40, 400)) < 1
    }
  })).toEqual({ fitsViewport: true, centered: true, expectedWidth: true })
  expect(await picker.getByRole('option', { name: '2', exact: true }).evaluate(element => {
    const rect = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  })).toBe(true)
  await picker.getByRole('option', { name: '2', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(popup).toBeVisible()
  await expect(select).toHaveText('2')
  await select.click()
  await picker.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(popup).toBeVisible()
  await expect(select).toBeFocused()
  await select.click()
  await picker.press('Escape')
  await expect(popup).toBeVisible()
  await expect(select).toBeFocused()
  await select.press('Escape')
  await expect(popup).toBeHidden()
})
