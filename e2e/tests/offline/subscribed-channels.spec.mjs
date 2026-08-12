import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      unsubscriptionPopupStatus: true
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
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        _id: `profile-${index}`,
        name: `Profile ${index}`,
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: []
      }))
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

  test('profile dropdown uses an overlay scrollbar', async ({ page }) => {
    await goTo(page, 'subscribedchannels')

    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await alpha.locator('.profileDropdownToggle').click()

    const dropdown = alpha.locator('.profileDropdown')
    await expect(dropdown).toHaveAttribute('data-overlayscrollbars-viewport')
    expect(await dropdown.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  })

  test('unsubscribing asks for confirmation and persists', async ({ app, page }) => {
    await goTo(page, 'subscribedchannels')

    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await alpha.getByRole('button', { name: 'Unsubscribe' }).click()

    await expect(page.getByRole('dialog', { name: /unsubscribe from.*Alpha Channel/i })).toBeVisible()
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

test.describe('large subscribed channel lists', () => {
  test.use({
    seed: {
      settings: {
        generalAutoLoadMorePaginatedItemsEnabled: false
      },
      profiles: [
        {
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: Array.from({ length: 900 }, (_, index) => ({
            id: `UC${index.toString().padStart(22, '0')}`,
            name: `Channel ${index.toString().padStart(3, '0')}`,
            thumbnail: ''
          }))
        }
      ]
    }
  })

  test('renders large lists incrementally while keeping every channel searchable', async ({ page }) => {
    await goTo(page, 'subscribedchannels')

    await expect(page.getByText('900 channel(s) found.')).toBeVisible()
    await expect(page.locator('.channel')).toHaveCount(50)
    await expect(page.locator('.navChannel')).toHaveCount(50)

    await page.locator('.sideNav .inner').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(page.locator('.navChannel')).toHaveCount(100)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('removeChannelFromProfiles', {
        channelId: 'UC0000000000000000000000',
        profileIds: ['allChannels']
      })
    })
    await expect(page.locator('.navChannel')).toHaveCount(50)

    await page.getByPlaceholder('Search Channels').fill('Channel 899')
    expect(await page.locator('.count').textContent()).toContain('1 channel(s) found.')
    await expect(page.locator('.channel', { hasText: 'Channel 899' })).toBeVisible()

    await page.getByPlaceholder('Search Channels').fill('')
    await page.getByRole('button', { name: 'Load more channels' }).click()
    await expect(page.locator('.channel')).toHaveCount(100)
  })

  test('uses the first repeated channel search query value', async ({ page }) => {
    const channelTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/subscribedchannels?searchQueryText=Channel%20899&searchQueryText=Channel%20898',
      makeActive: false
    }))
    await page.locator(`.tab[data-tab-id="${channelTab.id}"]`).click()

    await expect(page.getByPlaceholder('Search Channels')).toHaveValue('Channel 899')
    await expect(page.locator('.count')).toContainText('1 channel(s) found.')
    await expect(page.locator('.channel', { hasText: 'Channel 899' })).toBeVisible()
  })
})
