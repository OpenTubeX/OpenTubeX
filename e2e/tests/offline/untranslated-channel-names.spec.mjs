import { test, expect, sel, abortUnmockedRequest } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const translatedName = 'Übersetzter Kanalname'
const originalName = 'Original Channel'
const rss = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <title>${originalName}</title><author><name>${originalName}</name></author>
</feed>`

async function mockSearch(page, respondToFeed) {
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await page.route('https://yt3.ggpht.com/**', route => fulfillVisualFixture(route, 'avatar'))
  await page.route('https://www.youtube.com/feeds/videos.xml**', respondToFeed)
  await page.route('https://www.youtube.com/youtubei/v1/search**', route => route.fulfill({
    json: {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [{
                itemSectionRenderer: {
                  contents: [{
                    channelRenderer: {
                      channelId,
                      title: { simpleText: translatedName },
                      thumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/channel-avatar', width: 160, height: 160 }] },
                      navigationEndpoint: { browseEndpoint: { browseId: channelId } },
                      subscriberCountText: { simpleText: '@examplechannel' },
                      videoCountText: { simpleText: '1.2K subscribers' },
                      descriptionSnippet: { simpleText: '' }
                    }
                  }]
                }
              }]
            }
          }
        }
      }
    }
  }))
}

async function search(page, query = 'example channel') {
  await page.locator(sel.searchInput).fill(query)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator('.ft-list-channel')).toBeVisible()
}

async function setPreference(page, value) {
  await page.evaluate(value => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.dispatch('updateAvoidTranslation', value)
  }, value)
}

for (const avoidTranslation of ['entire_app', 'disabled', 'watch_only']) {
  test.describe(`channel names with untranslated text ${avoidTranslation}`, () => {
    test.use({
      seed: {
        settings: {
          avoidTranslation,
          listType: 'grid',
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue'
        }
      }
    })

    test('uses the original channel name only for Entire App', async ({ page }, testInfo) => {
      let feedRequests = 0
      await mockSearch(page, route => {
        feedRequests++
        expect(new URL(route.request().url()).searchParams.get('channel_id')).toBe(channelId)
        return route.fulfill({ contentType: 'application/atom+xml', body: rss })
      })
      await search(page)
      const card = page.locator('.ft-list-channel')
      const expectedName = avoidTranslation === 'entire_app' ? originalName : translatedName
      await expect(card.locator('.h3Title')).toHaveText(expectedName)
      expect(feedRequests).toBe(avoidTranslation === 'entire_app' ? 1 : 0)

      if (avoidTranslation === 'entire_app') {
        await expectImagesLoaded(card.locator('img'))
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
          await card.screenshot({ path: testInfo.outputPath(`original-channel-${theme}.png`), animations: 'disabled' })
        }
        await card.getByRole('button', { name: 'Subscribe', exact: true }).click()
        await expect.poll(() => page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          return store.getters.getProfileList.find(profile => profile._id === 'allChannels')?.subscriptions
        })).toContainEqual(expect.objectContaining({ id: channelId, name: originalName }))
      }

      // Another search recreates the card and reuses the resolved name.
      await search(page, 'another channel search')
      await expect(page.locator('.ft-list-channel .h3Title')).toHaveText(expectedName)
      expect(feedRequests).toBe(avoidTranslation === 'entire_app' ? 1 : 0)
    })
  })
}

test.describe('channel name request lifecycle', () => {
  test.use({ seed: { settings: { avoidTranslation: 'entire_app' } } })

  test('preserves the search name when the RSS feed is unavailable', async ({ page }) => {
    let requested = false
    await mockSearch(page, route => {
      requested = true
      return route.fulfill({ status: 404, body: 'Not found' })
    })
    await search(page)
    await expect.poll(() => requested).toBe(true)
    await expect(page.locator('.ft-list-channel .h3Title')).toHaveText(translatedName)
  })

  test('ignores a late original name after disabling the preference', async ({ page }) => {
    let releaseFeed
    await mockSearch(page, async route => {
      await new Promise(resolve => { releaseFeed = resolve })
      await route.fulfill({ contentType: 'application/atom+xml', body: rss })
    })
    await search(page)
    await expect.poll(() => typeof releaseFeed).toBe('function')
    await setPreference(page, 'disabled')
    const feedFinished = page.waitForEvent('requestfinished', request => request.url().includes('/feeds/videos.xml'))
    releaseFeed()
    await feedFinished
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(page.locator('.ft-list-channel .h3Title')).toHaveText(translatedName)
    // The completed response is cached and applied when the setting is enabled again.
    await setPreference(page, 'entire_app')
    await expect(page.locator('.ft-list-channel .h3Title')).toHaveText(originalName)
    await setPreference(page, 'watch_only')
    await expect(page.locator('.ft-list-channel .h3Title')).toHaveText(translatedName)
  })
})
