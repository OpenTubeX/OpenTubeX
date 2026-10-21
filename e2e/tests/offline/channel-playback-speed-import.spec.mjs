import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'

const SUBSCRIBED_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const SAVED_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const IMPORTED_ID = 'UCcccccccccccccccccccccc'

test.use({
  seed: {
    settings: {
      channelPlaybackSpeeds: JSON.stringify({ [SUBSCRIBED_ID]: 1, [SAVED_ID]: 1.25 }),
      rememberPlaybackSpeedPerChannel: false
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{ id: SUBSCRIBED_ID, name: 'Alpha Channel', thumbnail: '' }]
    }]
  }
})

/**
 * @param {import('@playwright/test').Page} page
 * @param {unknown} values
 */
async function mockImportFile(page, values) {
  await page.evaluate((content) => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{
        getFile: async () => new File([content], 'youtube-speed-by-channel.json', { type: 'application/json' })
      }]
    })
  }, JSON.stringify(values))
}

/**
 * The import sits in the Advanced section at the bottom of the data settings.
 * @param {import('@playwright/test').Page} page
 */
async function importButton(page) {
  const advancedSection = (await goToSettingsSection(page, 'data')).locator('.settingsSection').last()
  await expect(advancedSection.locator('.sectionTitle')).toHaveText('Advanced')
  await expect(advancedSection.getByRole('link', { name: 'Youtube Speed By Channel', exact: true }))
    .toHaveAttribute('href', 'https://greasyfork.org/scripts/397614-youtube-speed-by-channel')
  return advancedSection.getByRole('button', { name: 'Import channel playback speeds', exact: true })
}

function readChannelSpeedSettings(page) {
  return page.evaluate(() => ({
    speeds: JSON.parse(window.$store.getters.getChannelPlaybackSpeeds),
    remember: window.$store.getters.getRememberPlaybackSpeedPerChannel
  }))
}

test('imports the channel playback speeds of the Youtube Speed By Channel userscript', async ({ page }) => {
  const button = await importButton(page)
  // Tampermonkey's storage export, with names saved by older versions of the userscript
  await mockImportFile(page, {
    ts: 1,
    data: {
      '_YSC-DEFAULT_SPEED': 1.5,
      'Alpha Channel': 2,
      [IMPORTED_ID]: 1.75,
      'Unknown Channel': 3
    }
  })

  await button.click()

  await expect(page.locator('.toast', { hasText: 'Imported the playback speeds of 2 channels' })).toBeVisible()
  await expect(page.locator('.toast', { hasText: '1 channel could not be found' })).toBeVisible()
  await expect.poll(() => readChannelSpeedSettings(page)).toEqual({
    speeds: { [SUBSCRIBED_ID]: 2, [SAVED_ID]: 1.25, [IMPORTED_ID]: 1.75 },
    remember: true
  })
})

test('reports files without channel playback speeds', async ({ page }) => {
  const button = await importButton(page)
  await mockImportFile(page, { '_YSC-DEFAULT_SPEED': 1.5 })

  await button.click()

  await expect(page.locator('.toast', { hasText: 'No channel playback speeds were found in this file' })).toBeVisible()
  expect(await readChannelSpeedSettings(page)).toEqual({
    speeds: { [SUBSCRIBED_ID]: 1, [SAVED_ID]: 1.25 },
    remember: false
  })
})
