import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

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
