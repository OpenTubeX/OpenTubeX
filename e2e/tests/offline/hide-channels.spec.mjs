import { test, expect, latestSettings, readDatastore, goToSettingsSection } from '../../helpers/app.mjs'

const unnamed = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const added = { name: 'UCbbbbbbbbbbbbbbbbbbbbbb', preferredName: 'Added channel' }

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test',
      channelsHidden: JSON.stringify([{ name: unnamed, preferredName: '', icon: '' }]),
    }
  }
})

test('a channel hidden while Distraction settings looks up names stays hidden', async ({ app, page }) => {
  let respond
  const lookup = new Promise(resolve => { respond = resolve })
  const requested = page.waitForRequest(`https://invidious.test/api/v1/channels/${unnamed}**`)
  await page.route(`https://invidious.test/api/v1/channels/${unnamed}**`, async route => {
    await lookup
    await route.fulfill({ json: { author: 'Looked up channel', authorId: unnamed, authorThumbnails: [], tabs: [] } })
  })

  await goToSettingsSection(page, 'distraction')
  await requested
  // Another window, or a sync, hides a channel during the lookup.
  await page.evaluate(async channel => {
    const list = window.$store.getters.getChannelsHiddenParsed
    await window.$store.dispatch('updateChannelsHidden', JSON.stringify([...list, channel]))
  }, added)
  respond()

  await expect.poll(() => {
    const saved = JSON.parse(latestSettings(readDatastore(app.userDataDir, 'settings')).channelsHidden)
    return saved.map(channel => [channel.name, channel.preferredName])
  }).toEqual([[unnamed, 'Looked up channel'], [added.name, added.preferredName]])
})
