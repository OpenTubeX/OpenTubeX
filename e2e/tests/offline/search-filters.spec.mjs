import { test, expect, sel, abortUnmockedRequest } from '../../helpers/app.mjs'

// A closing filters prompt stays in the page while it fades out.
const filters = page => page.locator('.prompt:not([inert])')

test('right-clicking the search filter button clears active filters', async ({ page }) => {
  const searchInput = page.locator(sel.searchInput)
  const filterButton = page.locator('.navFilterButton')

  await searchInput.fill('keep this query')
  await filterButton.click()
  await filters(page).locator('.searchRadio', { hasText: 'Prioritize' }).getByText('Popularity', { exact: true }).click()
  await filters(page).locator('.searchRadio', { hasText: 'Time' }).getByText('Today', { exact: true }).click()
  await filters(page).locator('.searchRadio', { hasText: 'Type' }).getByText('Videos', { exact: true }).click()
  await filters(page).locator('.searchRadio', { hasText: 'Duration' }).getByText('3 - 20 minutes', { exact: true }).click()
  await filters(page).locator('.searchRadio', { hasText: 'Features' }).getByText('HD', { exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(filterButton).toHaveClass(/filterChanged/)

  await filterButton.evaluate(element => {
    element.addEventListener('contextmenu', event => {
      element.dataset.contextMenuDefaultPrevented = String(event.defaultPrevented)
    }, { once: true })
  })
  await filterButton.click({ button: 'right' })

  await expect(filterButton).not.toHaveClass(/filterChanged/)
  await expect(filterButton).toHaveAttribute('data-context-menu-default-prevented', 'true')
  await expect(searchInput).toHaveValue('keep this query')
  await expect(page.getByRole('heading', { name: 'Search Filters' })).toBeHidden()
  await expect(page.getByRole('menu', { name: 'Context Menu' })).toBeHidden()

  await filterButton.click()
  await expect(filters(page).locator('input[type="radio"][value="relevance"]')).toBeChecked()
  await expect(filters(page).locator('.searchRadio', { hasText: 'Time' }).locator('input[value=""]')).toBeChecked()
  await expect(filters(page).locator('input[type="radio"][value="all"]')).toBeChecked()
  await expect(filters(page).locator('.searchRadio', { hasText: 'Duration' }).locator('input[value=""]')).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'HD', exact: true })).not.toBeChecked()
})

test('right-clicking the search filter button clears only the active tab', async ({ page }) => {
  const searchInput = page.locator(sel.searchInput)
  const filterButton = page.locator('.navFilterButton')

  await searchInput.fill('first tab query')
  await filterButton.click()
  await filters(page).locator('.searchRadio', { hasText: 'Time' }).getByText('Today', { exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator(sel.newTabButton).click()
  await searchInput.fill('second tab query')
  await filterButton.click()
  await filters(page).locator('.searchRadio', { hasText: 'Prioritize' }).getByText('Popularity', { exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator(sel.tabs).first().click()
  await expect(searchInput).toHaveValue('first tab query')
  await expect(filterButton).toHaveClass(/filterChanged/)
  await filterButton.click({ button: 'right' })
  await expect(filterButton).not.toHaveClass(/filterChanged/)

  await page.locator(sel.tabs).nth(1).click()
  await expect(searchInput).toHaveValue('second tab query')
  await expect(filterButton).toHaveClass(/filterChanged/)
  await filterButton.click()
  await expect(filters(page).locator('input[type="radio"][value="popularity"]')).toBeChecked()
  await expect(filters(page).locator('input[type="radio"][value="today"]')).not.toBeChecked()
})

test('changing filters on a search page re-runs the search', async ({ page }) => {
  const requests = []
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await page.route('https://www.youtube.com/youtubei/v1/search**', async route => {
    const request = route.request().postDataJSON()
    requests.push(request)
    const videoId = `result-${requests.length}`
    await route.fulfill({
      json: {
        contents: {
          twoColumnSearchResultsRenderer: {
            primaryContents: {
              sectionListRenderer: {
                contents: [{
                  itemSectionRenderer: {
                    contents: [{
                      videoRenderer: {
                        videoId,
                        title: { simpleText: `Search result ${requests.length}` },
                        thumbnail: { thumbnails: [] },
                        navigationEndpoint: { watchEndpoint: { videoId } },
                      }
                    }]
                  }
                }]
              }
            }
          }
        }
      }
    })
  })

  const filterButton = page.locator('.navFilterButton')
  const closeFilters = () => page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator(sel.searchInput).fill('filter rerun')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('Search result 1')).toBeVisible()

  // Closing the filters without changes keeps the results
  await filterButton.click()
  await closeFilters()
  await expect(filters(page)).toHaveCount(0)
  expect(requests).toHaveLength(1)

  // Several changes search once, after the filters close
  await filterButton.click()
  await filters(page).locator('.searchRadio', { hasText: 'Prioritize' }).getByText('Popularity', { exact: true }).click()
  await filters(page).locator('.searchRadio', { hasText: 'Type' }).getByText('Videos', { exact: true }).click()
  await expect(page.getByText('Search result 1')).toBeVisible()
  expect(requests).toHaveLength(1)
  await closeFilters()

  await expect(page.getByText('Search result 2')).toBeVisible()
  await expect(page).toHaveURL(/#\/search\/filter%20rerun\?prioritize=popularity&.*type=video/)
  expect(requests).toHaveLength(2)
  expect(requests[1].query).toBe('filter rerun')
  expect(requests[1].params).not.toBe(requests[0].params)

  // Back returns to the unfiltered results
  await page.locator(sel.backButton).click()
  await expect(page.getByText('Search result 1')).toBeVisible()
  await expect(filterButton).not.toHaveClass(/filterChanged/)

  await page.locator(sel.forwardButton).click()
  await expect(page.getByText('Search result 2')).toBeVisible()
  await expect(filterButton).toHaveClass(/filterChanged/)

  // Clearing the filters from the button applies them too
  await filterButton.click({ button: 'right' })
  await expect(page.getByText('Search result 1')).toBeVisible()
  await expect(page).toHaveURL(/#\/search\/filter%20rerun\?prioritize=relevance&/)
  expect(requests).toHaveLength(2)
})
