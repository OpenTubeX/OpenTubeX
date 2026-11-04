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
  const diameter = () => label.locator('.switch-thumb').evaluate(element => getComputedStyle(element).width)
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
    await page.evaluate(iconPack => window.$store.commit('setIconPack', iconPack), iconPack)
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

test('subscription videos per day stepper keeps its parent sheet open', async ({ page }) => {
  await goTo(page, 'subscribedchannels')
  await page.locator('.channel').getByRole('button', { name: 'Subscription settings' }).click()
  const popup = page.locator('.profileDropdown')
  const limit = () => page.evaluate(() => window.$store.getters.getActiveProfile.subscriptions[0].dailyVideoLimit)
  const fewer = popup.getByRole('button', { name: 'Fewer videos per day', exact: true })
  const count = popup.locator('.dailyVideoLimitCount')
  await expect(fewer).toHaveAttribute('aria-disabled', 'true')
  await popup.getByRole('button', { name: 'More videos per day', exact: true }).click()
  await expect.poll(limit).toBe(2)
  await expect(count).toHaveAttribute('aria-pressed', 'true')
  await popup.getByRole('button', { name: 'Unlimited', exact: true }).click()
  await expect.poll(limit).toBe(null)
  // The stepper keeps its count for when a limit is chosen again.
  await expect(count).toHaveText('2')
  await expect(count).toHaveAttribute('aria-pressed', 'false')
  await popup.getByRole('button', { name: 'Use global setting', exact: true }).click()
  await expect.poll(limit).toBe(undefined)
  await count.click()
  await expect.poll(limit).toBe(2)
  await expect(popup).toBeVisible()
  await count.press('Escape')
  await expect(popup).toBeHidden()
})
