import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      unsubscriptionPopupStatus: true,
      // Boot fresh after relaunches: session restore keeps the router and
      // URL hash out of sync, which breaks post-restart navigation.
      startupBehavior: 'emptySession'
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Channel', thumbnail: '' },
          { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Beta Channel', thumbnail: '' }
        ]
      }
    ]
  }
})

test.describe('subscribed channels', () => {
  test('lists seeded subscriptions and filters them', async ({ page }) => {
    await goTo(page, 'subscribedchannels')

    await expect(page.getByText('2 channel(s) found.')).toBeVisible()
    await expect(page.locator('.channel', { hasText: 'Alpha Channel' })).toBeVisible()
    await expect(page.locator('.channel', { hasText: 'Beta Channel' })).toBeVisible()

    await page.getByPlaceholder('Search Channels').fill('Beta')
    await expect(page.locator('.channel', { hasText: 'Beta Channel' })).toBeVisible()
    await expect(page.locator('.channel', { hasText: 'Alpha Channel' })).toBeHidden()
  })

  test('unsubscribing asks for confirmation and persists', async ({ app, page }) => {
    await goTo(page, 'subscribedchannels')

    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await alpha.getByRole('button', { name: 'Unsubscribe' }).click()

    await expect(page.getByText('Are you sure you want to unsubscribe from "Alpha Channel"?')).toBeVisible()
    await page.getByRole('button', { name: 'Yes', exact: true }).click()

    await expect(alpha).toHaveCount(0)
    await expect(page.getByText('1 channel(s) found.')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      const main = records.filter((record) => record._id === 'allChannels').at(-1)
      return main.subscriptions.map((channel) => channel.name)
    }).toEqual(['Beta Channel'])

    ;({ page } = await app.relaunch())
    await goTo(page, 'subscribedchannels')
    await expect(page.getByText('1 channel(s) found.')).toBeVisible()
    await expect(page.locator('.channel', { hasText: 'Beta Channel' })).toBeVisible()
    await expect(page.locator('.channel', { hasText: 'Alpha Channel' })).toHaveCount(0)
  })
})
