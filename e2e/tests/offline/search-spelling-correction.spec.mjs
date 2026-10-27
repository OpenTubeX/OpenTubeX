import { test, expect, sel, abortUnmockedRequest } from '../../helpers/app.mjs'

const NO_SPELL_CORRECTION_BYTES = [0x42, 0x02, 0x08, 0x01]

/** @param {string} params */
function decodeParams(params) {
  return [...Buffer.from(decodeURIComponent(params), 'base64')]
}

function text(value) {
  return { runs: [{ text: value }] }
}

function searchVideo(id, title) {
  return {
    videoRenderer: {
      videoId: id,
      title: { simpleText: title },
      thumbnail: { thumbnails: [] },
      ownerText: { runs: [{ text: 'OpenTubeX', navigationEndpoint: { browseEndpoint: { browseId: 'spelling-test-author' } } }] },
      navigationEndpoint: { watchEndpoint: { videoId: id } },
      lengthText: { simpleText: '1:00' },
      viewCountText: { simpleText: '1 view' },
      publishedTimeText: { simpleText: '1 day ago' }
    }
  }
}

// Shapes recorded from YouTube's responses for "minecarft speedrn".
function searchResponse(request) {
  const spellCorrection = !decodeParams(request.params).join().endsWith(NO_SPELL_CORRECTION_BYTES.join())
  const contents = []

  if (request.query === 'minecarft speedrn' && spellCorrection) {
    contents.push({
      showingResultsForRenderer: {
        showingResultsFor: text('Showing results for'),
        correctedQuery: text('minecraft speedrun'),
        correctedQueryEndpoint: { searchEndpoint: { query: 'minecraft speedrun' } },
        searchInsteadFor: text('Search instead for'),
        originalQuery: { simpleText: 'minecarft speedrn' },
        originalQueryEndpoint: { searchEndpoint: { query: 'minecarft speedrn', params: 'QgIIAQ%3D%3D' } }
      }
    }, searchVideo('corrected', 'Corrected spelling result'))
  } else if (request.query === 'minecarft speedrn') {
    contents.push({
      didYouMeanRenderer: {
        didYouMean: text('Did you mean:'),
        correctedQuery: text('minecraft speedrun'),
        correctedQueryEndpoint: { searchEndpoint: { query: 'minecraft speedrun' } }
      }
    }, searchVideo('original', 'Original spelling result'))
  } else if (request.query === '#cooking') {
    // YouTube offers no "Search only for" link for hashtags and ignores the
    // request to turn spelling correction off.
    contents.push({
      includingResultsForRenderer: {
        includingResultsFor: text('Including results for:'),
        correctedQuery: text('cooking'),
        correctedQueryEndpoint: { searchEndpoint: { query: 'cooking' } }
      }
    }, searchVideo('hashtag', 'Hashtag result'))
  } else if (request.query === 'qwzxv plorf') {
    contents.push({
      didYouMeanRenderer: {
        didYouMean: text('Did you mean:'),
        correctedQuery: text('quiz plot'),
        correctedQueryEndpoint: { searchEndpoint: { query: 'quiz plot' } }
      }
    })
  } else {
    contents.push(searchVideo('suggested', 'Suggested spelling result'))
  }

  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents } }] } }
      }
    }
  }
}

test('searches for the original query when YouTube corrects its spelling', async ({ page, attachScreenshot }) => {
  const requests = []
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await page.route('https://www.youtube.com/youtubei/v1/search**', async route => {
    const request = route.request().postDataJSON()
    requests.push(request)
    await route.fulfill({ json: searchResponse(request) })
  })

  await page.locator('.navFilterButton').click()
  await page.locator('.searchRadio', { hasText: 'Type' }).getByText('Videos', { exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator(sel.searchInput).fill('minecarft speedrn')
  await page.locator(sel.searchInput).press('Enter')

  const correction = page.locator('.searchCorrection')
  await expect(page.getByText('Corrected spelling result')).toBeVisible()
  await expect(correction).toContainText('Showing results for minecraft speedrun')
  await expect(correction).toContainText('Search instead for minecarft speedrn')
  await attachScreenshot('automatic spelling correction')

  await correction.getByRole('link', { name: 'minecarft speedrn' }).click()
  await expect(page.getByText('Original spelling result')).toBeVisible()
  await expect(page).toHaveURL(/#\/search\/minecarft%20speedrn\?.*type=video.*spellCorrection=false/)
  await expect(correction).toHaveText('Did you mean minecraft speedrun?')
  await expect(page.locator(sel.searchInput)).toHaveValue('minecarft speedrn')
  // The filters stay encoded, followed by YouTube's flag that turns off spelling correction.
  expect(decodeParams(requests[1].params)).toEqual([...decodeParams(requests[0].params), ...NO_SPELL_CORRECTION_BYTES])
  await attachScreenshot('spelling suggestion')

  // The corrected search is cached separately and keeps its notice.
  await page.locator(sel.searchInput).fill('minecarft speedrn')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('Corrected spelling result')).toBeVisible()
  await expect(correction).toContainText('Showing results for minecraft speedrun')
  expect(requests).toHaveLength(2)

  await correction.getByRole('link', { name: 'minecarft speedrn' }).click()
  await expect(page.getByText('Original spelling result')).toBeVisible()
  expect(requests).toHaveLength(2)

  await correction.getByRole('link', { name: 'minecraft speedrun' }).click()
  await expect(page.getByText('Suggested spelling result')).toBeVisible()
  await expect(page).toHaveURL(/#\/search\/minecraft%20speedrun\?/)
  await expect(page).not.toHaveURL(/spellCorrection/)
  await expect(correction).toHaveCount(0)
  expect(requests.map(request => request.query)).toEqual(['minecarft speedrn', 'minecarft speedrn', 'minecraft speedrun'])
  expect(requests[2].params).toBe(requests[0].params)
})

test('omits the uncorrected search when YouTube offers none', async ({ page }) => {
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await page.route('https://www.youtube.com/youtubei/v1/search**', route => route.fulfill({ json: searchResponse(route.request().postDataJSON()) }))

  await page.locator(sel.searchInput).fill('#cooking')
  await page.locator(sel.searchInput).press('Enter')

  const correction = page.locator('.searchCorrection')
  await expect(page.getByText('Hashtag result')).toBeVisible()
  await expect(correction).toHaveText('Including results for cooking')
  await expect(correction.getByRole('link')).toHaveCount(0)
})

test('centers the spelling suggestion with the empty results message', { tag: '@scale' }, async ({ page, attachScreenshot }) => {
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await page.route('https://www.youtube.com/youtubei/v1/search**', route => route.fulfill({ json: searchResponse(route.request().postDataJSON()) }))

  await page.locator(sel.searchInput).fill('qwzxv plorf')
  await page.locator(sel.searchInput).press('Enter')

  const suggestion = page.locator('.searchCorrection p')
  const status = page.locator('.searchStatus')
  await expect(suggestion).toHaveText('Did you mean quiz plot?')
  await expect(status).toBeVisible()

  const centerOf = locator => locator.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const { left, right } = range.getBoundingClientRect()
    return (left + right) / 2
  })
  expect(Math.abs(await centerOf(suggestion) - await centerOf(status))).toBeLessThanOrEqual(1)
  await attachScreenshot('centered spelling suggestion')
})
