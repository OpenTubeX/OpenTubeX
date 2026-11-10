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
