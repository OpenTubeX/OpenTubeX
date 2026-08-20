import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'

function lineDelimitedFixture(firstRecord, lastRecord) {
  return [
    JSON.stringify(firstRecord),
    ' \t ',
    '',
    '{"broken":',
    JSON.stringify(lastRecord)
  ].join('\r\n')
}

async function mockImportFile(page, filename, content) {
  await page.evaluate(({ filename, content }) => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{
        getFile: async () => new File(
          [content],
          filename,
          { type: 'application/x-freetube-db' }
        )
      }]
    })
  }, { filename, content })
}

async function expectRowError(page) {
  await expect(page.locator('.toast', {
    hasText: 'Invalid JSON at row 4, skipping item'
  })).toHaveCount(1)
}

function subscriptionProfile(_id, channelId) {
  return {
    _id,
    name: _id,
    bgColor: '#000000',
    textColor: '#FFFFFF',
    subscriptions: [{ id: channelId, name: channelId, thumbnail: null }]
  }
}

function watchRecord(videoId, timeWatched) {
  return {
    _id: videoId,
    author: 'Issue 866',
    authorId: 'UCissue866',
    isLive: false,
    lengthSeconds: 60,
    published: 0,
    timeWatched,
    title: videoId,
    type: 'video',
    videoId,
    watchProgress: 0
  }
}

function playlistRecord(_id) {
  return {
    _id,
    playlistName: _id,
    videos: []
  }
}

function searchRecord(_id, lastUpdatedAt) {
  return { _id, lastUpdatedAt }
}

test('line-delimited subscriptions keep valid rows around a malformed row', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const dataSection = await goToSettingsSection(page, 'data')

  await mockImportFile(page, 'issue-866-subscriptions.db', lineDelimitedFixture(
    subscriptionProfile('issue866-profile-a', 'UCissue866-a'),
    subscriptionProfile('issue866-profile-b', 'UCissue866-b')
  ))
  await dataSection.getByRole('button', { name: 'Import subscriptions', exact: true }).click()

  await expectRowError(page)
  await expect(page.locator('.toast', {
    hasText: 'All subscriptions and profiles have been successfully imported'
  })).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const primaryProfile = store.getters.getProfileList[0]
    return primaryProfile.subscriptions
      .map(({ id }) => id)
      .filter(id => id.startsWith('UCissue866-'))
      .sort()
  })).toEqual(['UCissue866-a', 'UCissue866-b'])
  expect(pageErrors).toEqual([])
})

test('line-delimited watch history keeps valid rows around a malformed row', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const dataSection = await goToSettingsSection(page, 'data')

  await mockImportFile(page, 'issue-866-watch-history.db', lineDelimitedFixture(
    watchRecord('issue866a01', 1),
    watchRecord('issue866b02', 2)
  ))
  await dataSection.getByRole('button', { name: 'Import history', exact: true }).click()

  await expectRowError(page)
  await expect(page.locator('.toast', {
    hasText: 'All watched history has been successfully imported'
  })).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return Object.keys(store.getters.getHistoryCacheById)
      .filter(videoId => videoId.startsWith('issue866'))
      .sort()
  })).toEqual(['issue866a01', 'issue866b02'])
  expect(pageErrors).toEqual([])
})

test('line-delimited playlists keep valid rows around a malformed row', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const dataSection = await goToSettingsSection(page, 'data')

  await mockImportFile(page, 'issue-866-playlists.db', lineDelimitedFixture(
    playlistRecord('issue866-playlist-a'),
    playlistRecord('issue866-playlist-b')
  ))
  await dataSection.getByRole('button', { name: 'Import playlists', exact: true }).click()

  await expectRowError(page)
  await expect(page.locator('.toast', {
    hasText: 'All playlists has been successfully imported'
  })).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getAllPlaylists
      .map(({ _id }) => _id)
      .filter(id => id.startsWith('issue866-playlist-'))
      .sort()
  })).toEqual(['issue866-playlist-a', 'issue866-playlist-b'])
  expect(pageErrors).toEqual([])
})

test('line-delimited search history keeps valid rows around a malformed row', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const dataSection = await goToSettingsSection(page, 'data')

  await mockImportFile(page, 'issue-866-search-history.db', lineDelimitedFixture(
    searchRecord('issue866-search-a', 1),
    searchRecord('issue866-search-b', 2)
  ))
  await dataSection.getByRole('button', { name: 'Import search history', exact: true }).click()

  await expectRowError(page)
  await expect(page.locator('.toast', {
    hasText: 'All search history has been successfully imported'
  })).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getSearchHistoryEntries
      .map(({ _id }) => _id)
      .filter(id => id.startsWith('issue866-search-'))
      .sort()
  })).toEqual(['issue866-search-a', 'issue866-search-b'])
  expect(pageErrors).toEqual([])
})

test('malformed-only line-delimited imports do not report success', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const dataSection = await goToSettingsSection(page, 'data')
  let expectedErrorCount = 0
  const imports = [
    {
      filename: 'issue-866-subscriptions.db',
      button: 'Import subscriptions',
      success: 'All subscriptions and profiles have been successfully imported'
    },
    {
      filename: 'issue-866-watch-history.db',
      button: 'Import history',
      success: 'All watched history has been successfully imported'
    },
    {
      filename: 'issue-866-playlists.db',
      button: 'Import playlists',
      success: 'All playlists has been successfully imported'
    },
    {
      filename: 'issue-866-search-history.db',
      button: 'Import search history',
      success: 'All search history has been successfully imported'
    }
  ]

  for (const { filename, button, success } of imports) {
    await mockImportFile(page, filename, ' \t \r\n{"broken":')
    await dataSection.getByRole('button', { name: button, exact: true }).click()

    expectedErrorCount++
    await expect(page.locator('.toast', {
      hasText: 'Invalid JSON at row 2, skipping item'
    })).toHaveCount(expectedErrorCount)
    await expect(page.locator('.toast', { hasText: success })).toHaveCount(0)
  }

  expect(pageErrors).toEqual([])
})
