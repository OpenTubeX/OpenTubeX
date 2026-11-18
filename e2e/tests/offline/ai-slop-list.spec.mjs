import { test, expect, goToSettingsSection, sel } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const LIST_URL = 'https://raw.githubusercontent.com/Override92/AiSList/main/AiSList/'

test.use({
  seed: {
    settings: {
      generalAutoLoadMorePaginatedItemsEnabled: false
    }
  }
})

function videoRenderer(videoId, title, channelName, handle, index) {
  const channelId = `UC${String(index).padStart(22, '0')}`

  return {
    videoRenderer: {
      videoId,
      title: { runs: [{ text: title }] },
      ownerText: {
        runs: [{
          text: channelName,
          navigationEndpoint: { browseEndpoint: { browseId: channelId, canonicalBaseUrl: `/${handle}` } }
        }]
      },
      lengthText: { simpleText: '4:20' },
      viewCountText: { simpleText: '12,345 views' },
      publishedTimeText: { simpleText: '2 days ago' }
    }
  }
}

function collaborationVideoRenderer(videoId, title, channels) {
  return {
    videoRenderer: {
      videoId,
      title: { runs: [{ text: title }] },
      ownerText: {
        runs: [{
          text: channels.map(({ name }) => name).join(' and '),
          navigationEndpoint: {
            showDialogCommand: {
              panelLoadingStrategy: {
                inlineContent: {
                  dialogViewModel: {
                    customContent: {
                      listViewModel: {
                        listItems: channels.map(({ name, handle, index }) => ({
                          listItemViewModel: {
                            title: { content: name },
                            subtitle: { content: `\u200e\u2068${handle}\u2069 • \u20681.2K subscribers\u2069` },
                            rendererContext: {
                              commandContext: {
                                onTap: {
                                  innertubeCommand: {
                                    commandMetadata: { webCommandMetadata: { url: `/${handle}`, webPageType: 'WEB_PAGE_TYPE_CHANNEL' } },
                                    browseEndpoint: { browseId: `UC${String(index).padStart(22, '0')}` }
                                  }
                                }
                              }
                            }
                          }
                        }))
                      }
                    }
                  }
                }
              }
            }
          }
        }]
      },
      lengthText: { simpleText: '4:20' },
      viewCountText: { simpleText: '12,345 views' },
      publishedTimeText: { simpleText: '2 days ago' }
    }
  }
}

function channelRenderer(channelName, handle, index) {
  const channelId = `UC${String(index).padStart(22, '0')}`

  return {
    channelRenderer: {
      channelId,
      title: { simpleText: channelName },
      thumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/channel-avatar', width: 160, height: 160 }] },
      navigationEndpoint: { browseEndpoint: { browseId: channelId } },
      subscriberCountText: { simpleText: handle },
      videoCountText: { simpleText: '1.2K subscribers' },
      descriptionSnippet: { simpleText: '' }
    }
  }
}

const searchResponse = {
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [{
            itemSectionRenderer: {
              contents: [
                videoRenderer('aaaaaaaaaaa', 'Handmade pottery tutorial', 'Real Potter', '@RealPotter', 1),
                videoRenderer('bbbbbbbbbbb', 'Cat saves the world', 'Slop Factory', '@SlopFactory', 2),
                videoRenderer('ccccccccccc', 'Ancient history explained', 'Maybe Narrated', '@Maybe%C3%91arrated', 3),
                collaborationVideoRenderer('ddddddddddd', 'Pottery meets slop', [
                  { name: 'Real Potter', handle: '@RealPotter', index: 1 },
                  { name: 'Slop Factory', handle: '@SlopFactory', index: 2 }
                ]),
                collaborationVideoRenderer('eeeeeeeeeee', 'Pottery through the ages', [
                  { name: 'Real Potter', handle: '@RealPotter', index: 1 },
                  { name: 'Maybe Narrated', handle: '@MaybeÑarrated', index: 3 }
                ]),
                channelRenderer('Maybe Narrated', '@MaybeÑarrated', 3),
                channelRenderer('Slop Factory', '@SlopFactory', 2)
              ]
            }
          }]
        }
      }
    }
  }
}

test('hides blocklisted channels and labels warnlisted channels in search results', async ({ page, attachScreenshot }) => {
  const listRequests = []
  await page.route(`${LIST_URL}*`, route => {
    const url = route.request().url()
    listRequests.push(url)
    const body = url.endsWith('aislist_blocklist.txt')
      ? '! Title: AISList - Blocklist\n@slopfactory\n'
      : '! Title: AISList - Warnlist\n@MAYBEÑARRATED\n'
    return route.fulfill({ body, contentType: 'text/plain' })
  })
  await page.route('https://www.youtube.com/youtubei/v1/search**', route => route.fulfill({ json: searchResponse }))
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.route('https://yt3.ggpht.com/**', route => fulfillVisualFixture(route, 'avatar'))

  const addOns = await goToSettingsSection(page, 'add-ons')
  await addOns.locator('label.switch-label').filter({ hasText: 'Hide AI slop channels' }).click()
  await expect(addOns.getByText('Blocked channels: 1 · Flagged channels: 1')).toBeVisible()
  expect(listRequests).toHaveLength(2)
  await attachScreenshot('AiSList settings')
  await page.keyboard.press('Escape')

  await page.locator(sel.searchInput).fill('ai slop')
  await page.locator(sel.searchInput).press('Enter')

  const results = page.locator('.ft-list-video')
  await expect(results.filter({ hasText: 'Handmade pottery tutorial' })).toBeVisible()
  const warned = results.filter({ hasText: 'Ancient history explained' })
  await expect(warned.locator('.aiSlopTag')).toHaveText('Possibly AI-generated')
  await expect(results.filter({ hasText: 'Cat saves the world' })).toHaveCount(0)
  await expect(results.filter({ hasText: 'Pottery through the ages' }).locator('.aiSlopTag')).toHaveText('Possibly AI-generated')
  await expect(results.filter({ hasText: 'Pottery meets slop' })).toHaveCount(0)
  await expect(results.filter({ hasText: 'Handmade pottery tutorial' }).locator('.aiSlopTag')).toHaveCount(0)
  const channels = page.locator('.ft-list-channel')
  await expect(channels.filter({ hasText: 'Maybe Narrated' }).locator('.aiSlopTag')).toHaveText('Possibly AI-generated')
  await expect(channels.filter({ hasText: 'Slop Factory' })).toHaveCount(0)
  await attachScreenshot('AiSList search results')

  await page.evaluate(() => window.$store.dispatch('updateUseAiSlopList', false))
  await expect(results.filter({ hasText: 'Cat saves the world' })).toBeVisible()
  await expect(results.filter({ hasText: 'Pottery meets slop' })).toBeVisible()
  await expect(page.locator('.aiSlopTag')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('aiSlopList'))).toBeNull()
})
