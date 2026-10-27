import { test, expect, sel } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'local',
      backendFallback: false,
      generalAutoLoadMorePaginatedItemsEnabled: false
    }
  }
})

const SHORTS_PARAMS = '6gULCgVsb2ZpchAAGAM%3D'

function tab(title, url, params, selected, content) {
  return {
    tabRenderer: {
      title,
      selected,
      endpoint: {
        commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_BROWSE', apiUrl: '/youtubei/v1/browse' } },
        browseEndpoint: { browseId: 'FEhashtag', params }
      },
      ...(content ? { content } : {})
    }
  }
}

function hashtagPage(selectedTab, items) {
  return {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          tab('All', '/hashtag/lofi', '6gULCgVsb2ZpchAAGAE%3D', selectedTab === 'all', selectedTab === 'all' && { richGridRenderer: { contents: items } }),
          tab('Shorts', '/hashtag/lofi/shorts', SHORTS_PARAMS, selectedTab === 'shorts', selectedTab === 'shorts' && { richGridRenderer: { contents: items } })
        ]
      }
    }
  }
}

function video(index) {
  return {
    richItemRenderer: {
      content: {
        videoRenderer: {
          videoId: `hashtagvid${index}`,
          title: { runs: [{ text: `Hashtag video ${index}` }] },
          lengthText: { simpleText: '1:23' },
          viewCountText: { simpleText: '12 views' }
        }
      }
    }
  }
}

function short(index) {
  return {
    richItemRenderer: {
      content: {
        shortsLockupViewModel: {
          // Hashtag pages use slim lockups, which carry the title only in the accessibility text.
          entityId: `shorts-shelf-item-hashtagsht${index}`,
          accessibilityText: `Hashtag short ${index}, 1.2 thousand views - play Short`,
          style: 'SHORTS_LOCKUP_STYLE_SLIM',
          onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: `hashtagsht${index}` } } },
          overlayMetadata: { secondaryText: { content: '1.2K views' } },
          thumbnailViewModel: { thumbnailViewModel: { image: { sources: [] } } }
        }
      }
    }
  }
}

const shortsContinuation = {
  continuationItemRenderer: {
    trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
    continuationEndpoint: { continuationCommand: { token: 'hashtag-shorts-page-2', request: 'CONTINUATION_REQUEST_TYPE_BROWSE' } }
  }
}

test('pages through the Shorts of a hashtag whose main tab ends early', async ({ page }) => {
  const requests = []
  await page.route('https://www.youtube.com/youtubei/v1/browse**', route => {
    const request = route.request().postDataJSON()
    requests.push(request)
    if (request.continuation === 'hashtag-shorts-page-2') {
      return route.fulfill({
        json: { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [short(3)] } }] }
      })
    }
    return route.fulfill({
      json: decodeURIComponent(request.params ?? '') === decodeURIComponent(SHORTS_PARAMS)
        ? hashtagPage('shorts', [short(1), short(2), shortsContinuation])
        : hashtagPage('all', [video(1), video(2)])
    })
  })

  const hashtagTab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/hashtag/lofi', makeActive: false }))
  await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()

  const tabs = page.getByRole('tablist', { name: 'lofi' })
  const videosTab = tabs.getByRole('tab', { name: 'Videos' })
  const shortsTab = tabs.getByRole('tab', { name: 'Shorts' })
  await expect(videosTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.ft-list-video')).toHaveCount(2)
  await expect(page.locator('.ft-list-video.youtubeShort')).toHaveCount(0)
  await expect(page.getByText('There are no more results for this search')).toBeVisible()

  await shortsTab.click()
  await expect(shortsTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Hashtag short 2')).toBeVisible()
  await expect(page.getByText('Hashtag video 1')).toHaveCount(0)
  await expect(page.locator('.ft-list-video.youtubeShort')).toHaveCount(2)
  await expect(page.getByRole('tabpanel', { name: 'Shorts' })).toBeVisible()

  await page.getByRole('button', { name: 'Fetch more results' }).click()
  await expect(page.getByText('Hashtag short 3')).toBeVisible()
  await expect(page.getByText('There are no more results for this search')).toBeVisible()

  // Both tabs keep their results.
  await videosTab.click()
  await expect(page.getByText('Hashtag video 2')).toBeVisible()
  await shortsTab.click()
  await expect(page.locator('.ft-list-video')).toHaveCount(3)
  expect(requests).toHaveLength(3)
})

test('omits the tabs when YouTube offers no Shorts tab', async ({ page }) => {
  await page.route('https://www.youtube.com/youtubei/v1/browse**', route => {
    const response = hashtagPage('all', [video(1)])
    response.contents.twoColumnBrowseResultsRenderer.tabs.pop()
    return route.fulfill({ json: response })
  })

  const hashtagTab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/hashtag/lofi', makeActive: false }))
  await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()

  await expect(page.getByText('Hashtag video 1')).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'lofi' })).toHaveCount(0)
})

test('keeps showing the videos while the Shorts are still loading', async ({ page }) => {
  let releaseShorts
  const shortsReleased = new Promise(resolve => { releaseShorts = resolve })
  await page.route('https://www.youtube.com/youtubei/v1/browse**', async route => {
    if (decodeURIComponent(route.request().postDataJSON().params ?? '') === decodeURIComponent(SHORTS_PARAMS)) {
      await shortsReleased
      return route.fulfill({ json: hashtagPage('shorts', [short(1)]) })
    }
    return route.fulfill({ json: hashtagPage('all', [video(1)]) })
  })

  const hashtagTab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/hashtag/lofi', makeActive: false }))
  await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()

  const tabs = page.getByRole('tablist', { name: 'lofi' })
  await tabs.getByRole('tab', { name: 'Shorts' }).click()
  await tabs.getByRole('tab', { name: 'Videos' }).click()
  await expect(page.getByText('Hashtag video 1')).toBeVisible()

  releaseShorts()
  await tabs.getByRole('tab', { name: 'Shorts' }).click()
  await expect(page.getByText('Hashtag short 1')).toBeVisible()
})

test('drops a Shorts page that arrives after opening another hashtag', async ({ page }) => {
  let releaseContinuation
  const continuationReleased = new Promise(resolve => { releaseContinuation = resolve })
  await page.route('https://www.youtube.com/youtubei/v1/browse**', async route => {
    const request = route.request().postDataJSON()
    if (request.continuation === 'hashtag-shorts-page-2') {
      await continuationReleased
      return route.fulfill({
        json: { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [short(3)] } }] }
      })
    }
    return route.fulfill({
      json: decodeURIComponent(request.params ?? '') === decodeURIComponent(SHORTS_PARAMS)
        ? hashtagPage('shorts', [short(1), short(2), shortsContinuation])
        : hashtagPage('all', [video(1)])
    })
  })

  const hashtagTab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/hashtag/lofi', makeActive: false }))
  await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()
  await page.getByRole('tablist', { name: 'lofi' }).getByRole('tab', { name: 'Shorts' }).click()
  await expect(page.getByText('Hashtag short 2')).toBeVisible()
  const continuationRequest = page.waitForRequest(request => request.postDataJSON()?.continuation === 'hashtag-shorts-page-2')
  await page.getByRole('button', { name: 'Fetch more results' }).click()
  await continuationRequest

  await page.locator(sel.searchInput).fill('https://www.youtube.com/hashtag/jazz')
  await page.locator(sel.searchInput).press('Enter')
  const jazzTabs = page.getByRole('tablist', { name: 'jazz' })
  await expect(jazzTabs).toBeVisible()
  await jazzTabs.getByRole('tab', { name: 'Shorts' }).click()
  await expect(page.getByText('Hashtag short 2')).toBeVisible()

  const staleResponse = page.waitForResponse(response => response.request().postDataJSON()?.continuation === 'hashtag-shorts-page-2')
  releaseContinuation()
  await staleResponse
  await expect(page.getByRole('button', { name: 'Fetch more results' })).toBeVisible()
  await expect(page.locator('.ft-list-video')).toHaveCount(2)
})
