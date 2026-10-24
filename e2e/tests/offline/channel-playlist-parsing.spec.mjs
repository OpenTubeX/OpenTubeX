import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { test, expect, sel } from '../../helpers/app.mjs'
import { fixtureKey } from '../../helpers/innertube.mjs'
import { routeIframeApi } from '../../helpers/media.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const fixtures = new URL('../../fixtures/innertube/channel/loads-the-glitch-channel-home-and-playlists-tabs/', import.meta.url)
const channelId = 'UCn_FAXem2-e3HQvmK-mOH4g'

test.use({ seed: { settings: { backendPreference: 'local', backendFallback: false } } })

test('channel playlists retain valid cards beside GridShow and incomplete cards', async ({ page }, testInfo) => {
  await routeIframeApi(page)
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.route('https://yt3.googleusercontent.com/**', route => fulfillVisualFixture(route, 'avatar'))
  await page.route('https://yt3.ggpht.com/**', route => fulfillVisualFixture(route, 'avatar'))
  await page.route('**/youtubei/v1/**', async route => {
    const key = fixtureKey(route.request().url(), route.request().postData())
    const response = JSON.parse(gunzipSync(await readFile(new URL(`${key}.0.json.gz`, fixtures))))
    if (key === 'browse-7fa98cd7310f') {
      const tabs = response.contents.twoColumnBrowseResultsRenderer.tabs
      const tab = tabs.find(tab => tab.tabRenderer?.selected).tabRenderer
      const items = tab.content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].gridRenderer.items
      const missingId = structuredClone(items[0])
      delete missingId.lockupViewModel.contentId
      const missingTitle = structuredClone(items[0])
      missingTitle.lockupViewModel.contentId = 'PLmissingTitle'
      delete missingTitle.lockupViewModel.metadata.lockupMetadataViewModel.title
      items.unshift({
        gridShowRenderer: {
          title: { simpleText: 'GridShow regression' },
          navigationEndpoint: { browseEndpoint: { browseId: 'VLPLgridShow' } },
          thumbnailRenderer: {
            showCustomThumbnailRenderer: {
              thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/grid-show.jpg', width: 1280, height: 720 }] },
            }
          },
          thumbnailOverlays: [{ thumbnailOverlayBottomPanelRenderer: { text: { simpleText: '3 seasons' } } }],
        }
      }, missingId, missingTitle)
    }
    await route.fulfill({ json: response })
  })

  await page.locator(sel.searchInput).fill(`https://www.youtube.com/channel/${channelId}`)
  await page.locator(sel.searchInput).press('Enter')
  await page.getByRole('tab', { name: 'Playlists', exact: true }).click()
  const playlists = page.locator('#playlistPanel')
  const show = playlists.locator('.ft-list-video').filter({ has: page.getByRole('heading', { name: 'GridShow regression', exact: true }) })
  await expect(show).toBeVisible()
  await expect(show.locator('.videoCountContainer')).toContainText('3 seasons')
  await expect(show.locator('a.title')).toHaveAttribute('href', /^#\/playlist\/PLgridShow\?/)
  const original = playlists.locator('a.title[href^="#/playlist/PLTqcR5ouTGRU?"]')
  await expect(original).toHaveCount(1)
  await expect(original.getByRole('heading', { name: 'Meta Runner', exact: true })).toBeVisible()
  await expect(playlists.locator('a.title[href^="#/playlist/PLmissingTitle?"]')).toHaveCount(1)
  await expectImagesLoaded(show.locator('img'))
  await testInfo.attach('channel-playlist-parsing', { body: await page.screenshot(), contentType: 'image/png' })
})
