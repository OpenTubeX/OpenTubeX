import { test, expect } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'local',
      backendFallback: false
    }
  }
})

const hashtagResponse = {
  header: {
    pageHeaderRenderer: {
      pageTitle: '#minecraft',
      content: {
        pageHeaderViewModel: {
          title: { dynamicTextViewModel: { text: { content: '#minecraft' } } },
          metadata: {
            contentMetadataViewModel: {
              metadataRows: [{ metadataParts: [{ text: { content: '47M videos • 1 channel' } }] }]
            }
          }
        }
      }
    }
  },
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [{
        tabRenderer: {
          selected: true,
          content: {
            richGridRenderer: {
              contents: [{
                richItemRenderer: {
                  content: {
                    videoRenderer: {
                      videoId: 'hashtag0001',
                      title: { runs: [{ text: 'Hashtag video' }] },
                      lengthText: { simpleText: '1:23' },
                      viewCountText: { simpleText: '12 views' }
                    }
                  }
                }
              }]
            }
          }
        }
      }]
    }
  }
}

async function openHashtag(page, hashtag) {
  const hashtagTab = await page.evaluate(route => window.ftElectron.tabs.create({ route, makeActive: false }), `/hashtag/${hashtag}`)
  await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()
  await expect(page).toHaveURL(new RegExp(`#/hashtag/${hashtag}`))
}

test('shows the video and channel counts of a hashtag', async ({ page }) => {
  await page.route('https://www.youtube.com/youtubei/v1/browse**', route => route.fulfill({ json: hashtagResponse }))

  await openHashtag(page, 'minecraft')

  await expect(page.locator('.hashtagStats')).toHaveText(/^47M videos • 1 channel$/i)
  await expect(page.getByText('Hashtag video')).toBeVisible()
})

test('omits the counts when the Invidious API does not provide them', async ({ page }) => {
  await page.evaluate(() => window.$store.dispatch('updateBackendPreference', 'invidious'))
  await page.route('**/api/v1/hashtag/**', route => route.fulfill({ json: { results: [] } }))

  await openHashtag(page, 'no-stats')

  await expect(page.getByText('This hashtag does not currently have any videos')).toBeVisible()
  await expect(page.locator('.hashtagStats')).toHaveCount(0)
})
