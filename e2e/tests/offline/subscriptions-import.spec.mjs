import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'

const channelA = `UC${'a'.repeat(22)}`
const channelB = `UC${'b'.repeat(22)}`

test('imports subscriptions from an OPML file, including one that is not well-formed XML', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(([a, b]) => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      // Unclosed outlines and a bare ampersand make this invalid XML
      value: async () => [{
        getFile: async () => new File([
          `<opml version="1.1"><body><outline text="YouTube Subscriptions">
            <outline title="Rock &amp; Roll" type="rss" xmlUrl="https://www.youtube.com/feeds/videos.xml?channel_id=${a}">
            <outline title="Fish & Chips" xmlUrl="https://yewtu.be/feed/channel/${b}">
          </body></opml>`,
        ], 'subscriptions.opml', { type: 'application/xml' }),
      }],
    })
  }, [channelA, channelB])

  await dataSection.getByRole('button', { name: 'Import Subscriptions' }).click()
  await expect.poll(() => page.evaluate(([a, b]) => {
    const subscriptions = window.$store.getters.getProfileList[0].subscriptions
    return [a, b].map(id => subscriptions.find(channel => channel.id === id)?.name)
  }, [channelA, channelB])).toEqual(['Rock & Roll', 'Fish & Chips'])
})

test.describe('importing subscription groups', () => {
  test.use({ seed: { settings: { subscriptionGroups: [{ id: 'music', name: 'Music', channelIds: [channelB], icon: 'headphones' }] } } })

  test('adds CSV channels to the groups named after their title', async ({ page }) => {
    const dataSection = await goToSettingsSection(page, 'data')
    await page.evaluate(([a, b]) => {
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => [{
          getFile: async () => new File([
            'Channel Id,Channel Url,Channel Title,Groups\r\n' +
            `${a},https://www.youtube.com/channel/${a},"Rock, Roll","music; Live "\r\n` +
            `${b},https://www.youtube.com/channel/${b},Fish,\r\n`,
          ], 'subscriptions.csv', { type: 'text/csv' }),
        }],
      })
    }, [channelA, channelB])

    await dataSection.getByRole('button', { name: 'Import Subscriptions' }).click()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscriptionGroupList
      .map(({ name, channelIds, icon }) => ({ name, channelIds, icon }))))
      .toEqual([
        { name: 'Live', channelIds: [channelA], icon: undefined },
        { name: 'Music', channelIds: [channelB, channelA], icon: 'headphones' },
      ])
    expect(await page.evaluate(() => window.$store.getters.getProfileList[0].subscriptions.map(channel => channel.name)))
      .toEqual(expect.arrayContaining(['Rock, Roll', 'Fish']))
  })
})
