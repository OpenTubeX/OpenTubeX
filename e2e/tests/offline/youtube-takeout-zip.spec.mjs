import { strToU8, zipSync } from 'fflate'

import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'

test('imports selected data from a YouTube Takeout ZIP in one step', async ({ page }) => {
  const root = 'Takeout/YouTube and YouTube Music'
  const archive = zipSync({
    [`${root}/subscriptions/subscriptions.csv`]: strToU8('Channel Id,Channel Url,Channel Title\nUCtakeouttest,https://www.youtube.com/channel/UCtakeouttest,Takeout Channel\n'),
    [`${root}/history/watch-history.json`]: strToU8(JSON.stringify([{
      products: ['YouTube'],
      title: 'Watched Example',
      titleUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
      time: '2025-01-01T00:00:00Z',
      subtitles: [{ name: 'Channel', url: 'https://www.youtube.com/channel/UCtakeouttest' }]
    }])),
    [`${root}/history/search-history.json`]: strToU8(JSON.stringify([{
      products: ['YouTube'],
      titleUrl: 'https://www.youtube.com/results?search_query=example',
      time: '2025-01-01T00:00:00Z'
    }])),
    [`${root}/playlists/My list-videos.csv`]: strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\n -abcdefghij,2025-01-02T00:00:00+00:00\n'),
    [`${root}/playlists/My list (2)-videos.csv`]: strToU8('Video ID,Playlist video creation timestamp\nzzzzzzzzzzz,2025-01-03T00:00:00+00:00\n'),
    'Another account/playlists/My list.CSV': strToU8('Video ID,Playlist video creation timestamp\nlmnopqrstuv,2025-01-02T00:00:00+00:00\n'),
    'Another account/playlists/playlists.csv': strToU8('Playlist ID,Playlist Title (Original),Playlist Description (Original),Playlist Create Timestamp,Playlist Update Timestamp\nPLolder,My list,Older account,2024-01-01T00:00:00Z,2025-01-01T00:00:00Z\n'),
    [`${root}/videos/unrelated.mp4`]: new Uint8Array(1024),
  })

  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(bytes => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async options => {
        if (!Array.isArray(options.types[0].accept['application/zip'])) { throw new Error('Invalid ZIP picker accept option') }
        return [{ getFile: async () => new File([new Uint8Array(bytes)], 'takeout.zip', { type: 'application/zip' }) }]
      }
    })
  }, [...archive])

  await dataSection.getByRole('button', { name: 'Import YouTube Takeout ZIP' }).click()
  const selection = page.locator('.takeoutSelectionCentered')
  await expect(selection.getByRole('checkbox')).toHaveCount(4)
  await expect.poll(() => selection.evaluate(element => {
    const content = element.closest('.settingsSubpageContent').getBoundingClientRect()
    const selected = element.getBoundingClientRect()
    const offsetX = Math.abs((selected.left + selected.right - content.left - content.right) / 2)
    const offsetY = Math.abs((selected.top + selected.bottom - content.top - content.bottom) / 2)
    return Math.max(offsetX, offsetY)
  })).toBeLessThanOrEqual(1)
  await selection.getByRole('checkbox', { name: 'Search history', exact: true }).locator('+ label').click()
  await expect(selection.getByRole('checkbox', { name: /Search history/i })).not.toBeChecked()
  await selection.getByRole('button', { name: 'Import selected data' }).click()

  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return {
      subscribed: store.getters.getProfileList[0].subscriptions.some(channel => channel.id === 'UCtakeouttest'),
      watched: Boolean(store.getters.getHistoryCacheById.abcdefghijk),
      playlists: store.getters.getAllPlaylists.filter(playlist => playlist.playlistName.startsWith('My list')).map(playlist => playlist.playlistName).sort(),
      playlistVideoIds: store.getters.getAllPlaylists.find(playlist => playlist.playlistName === 'My list')?.videos.map(video => video.videoId),
      olderDescription: store.getters.getAllPlaylists.find(playlist => playlist.playlistName === 'My list (3)')?.description,
      search: store.getters.getSearchHistoryEntries.some(entry => entry.query === 'example'),
    }
  })).toEqual({ subscribed: true, watched: true, playlists: ['My list', 'My list (2)', 'My list (3)'], playlistVideoIds: ['abcdefghijk', '-abcdefghij'], olderDescription: 'Older account', search: false })
})

test('imports a Takeout playlist CSV through Import Playlists', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(() => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async options => {
        if (!Array.isArray(options.types[0].accept['text/csv'])) { throw new Error('Invalid CSV picker accept option') }
        return [{
          getFile: async () => new File(
            ['Video ID,Playlist Video Creation Timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\n  -abcdefghij,2025-01-02T00:00:00+00:00\n'],
            'Takeout favorites-videos.csv',
            { type: 'text/csv' }
          )
        }]
      }
    })
  })

  await dataSection.getByRole('button', { name: 'Import Playlists' }).click()
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getAllPlaylists.find(playlist => playlist.playlistName === 'Takeout favorites')?.videos.map(video => video.videoId)
  })).toEqual(['abcdefghijk', '-abcdefghij'])
})

test('imports original titles, descriptions, timestamps and empty playlists from Takeout metadata', async ({ page }) => {
  const root = 'Takeout/YouTube and YouTube Music/playlists'
  const header = 'Playlist ID,Playlist Title (Original),Playlist Description (Original),Playlist Create Timestamp,Playlist Update Timestamp,Playlist Visibility'
  const createdAt = Date.parse('2023-03-29T08:20:30Z')
  const lastUpdatedAt = Date.parse('2025-10-01T19:20:15Z')
  const archive = zipSync({
    [`${root}/Sets (Techno_Trance)-videos-videos.csv`]: strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\n'),
    [`${root}/Favorites-videos.csv`]: strToU8('Video ID,Playlist video creation timestamp\n -abcdefghij,2025-01-02T00:00:00Z\n'),
    [`${root}/It_s music-videos.csv`]: strToU8('Video ID,Playlist video creation timestamp\nlmnopqrstuv,2025-01-02T00:00:00Z\n'),
    [`${root}/Case list.CSV`]: strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\n'),
    [`${root}/Case list-videos.CSV`]: strToU8('Video ID,Playlist video creation timestamp\nlmnopqrstuv,2025-01-02T00:00:00Z\n'),
    // Keep metadata after videos to catch dependence on ZIP entry order.
    [`${root}/playlists.csv`]: strToU8(`${header}\nPLsets,Sets (Techno/Trance)-videos,"Sets, with ""quotes""\nand a second line",2023-03-29T08:20:30Z,2025-10-01T19:20:15Z,Public\nPLempty,Empty,No videos,2023-03-29T08:20:30Z,2025-10-01T19:20:15Z,Private\nFLfavorites,Favorites,Imported favorites,2023-03-29T08:20:30Z,2025-10-01T19:20:15Z,Private\nPLquote,It's music,Original title,2023-03-29T08:20:30Z,2025-10-01T19:20:15Z,Private\nPLcase,Case list,First overlapping title,2023-03-29T08:20:30Z,2025-10-01T19:20:15Z,Private\nPLsuffix,Case list-videos,Second overlapping title,2023-03-29T08:20:30Z,2025-10-01T19:20:15Z,Private\n`),
  })
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(bytes => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{ getFile: async () => new File([new Uint8Array(bytes)], 'metadata-takeout.zip', { type: 'application/zip' }) }]
    })
  }, [...archive])

  for (let attempt = 0; attempt < 2; attempt++) {
    await dataSection.getByRole('button', { name: 'Import YouTube Takeout ZIP' }).click()
    const selection = page.locator('.takeoutSelectionCentered')
    await expect(selection.getByRole('checkbox')).toHaveCount(1)
    await selection.getByRole('button', { name: 'Import selected data' }).click()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return ['Sets (Techno/Trance)-videos', 'Empty', 'Favorites', "It's music", 'Case list', 'Case list-videos'].map(name => {
        const playlist = store.getters.getAllPlaylists.find(item => item.playlistName === name)
        return playlist && {
          playlistName: playlist.playlistName,
          description: playlist.description,
          createdAt: playlist.createdAt,
          lastUpdatedAt: playlist.lastUpdatedAt,
          videoIds: playlist.videos.map(video => video.videoId),
        }
      })
    })).toEqual([
      { playlistName: 'Sets (Techno/Trance)-videos', description: 'Sets, with "quotes"\nand a second line', createdAt, lastUpdatedAt, videoIds: ['abcdefghijk'] },
      { playlistName: 'Empty', description: 'No videos', createdAt, lastUpdatedAt, videoIds: [] },
      { playlistName: 'Favorites', description: 'Imported favorites', createdAt, lastUpdatedAt, videoIds: ['-abcdefghij'] },
      { playlistName: "It's music", description: 'Original title', createdAt, lastUpdatedAt, videoIds: ['lmnopqrstuv'] },
      { playlistName: 'Case list', description: 'First overlapping title', createdAt, lastUpdatedAt, videoIds: ['abcdefghijk'] },
      { playlistName: 'Case list-videos', description: 'Second overlapping title', createdAt, lastUpdatedAt, videoIds: ['lmnopqrstuv'] },
    ])
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getAllPlaylists.length)).toBe(7)
  }
})

for (const [name, metadata] of [
  ['malformed', 'wrong header\n'],
  ['ambiguous', 'Playlist ID,Playlist Title (Original)\nPLone,A/B\nPLtwo,A_B\n'],
  ['localized', '播放清單 ID,標題\nPLlocalized,本地清單\n'],
]) {
  test(`imports video CSVs and other selected types when playlist metadata is ${name}`, async ({ page }) => {
    const root = 'Takeout/YouTube and YouTube Music'
    const archive = zipSync({
      [`${root}/playlists/playlists.csv`]: strToU8(metadata),
      [`${root}/playlists/本地清單-videos.csv`]: strToU8('影片 ID,播放清單影片的建立時間戳記\nabcdefghijk,2025-01-01T00:00:00Z\n'),
      'Good account/playlists/Good_List-videos.csv': strToU8('Video ID,Playlist video creation timestamp\nlmnopqrstuv,2025-01-01T00:00:00Z\n'),
      'Good account/playlists/playlists.csv': strToU8('Playlist ID,Playlist Title (Original),Playlist Description (Original),Playlist Create Timestamp,Playlist Update Timestamp\nPLgood,Good/List,Good account,2024-01-01T00:00:00Z,2025-01-01T00:00:00Z\nPLempty,Good empty,,,\n'),
      [`${root}/subscriptions/subscriptions.csv`]: strToU8('Channel Id,Channel Url,Channel Title\nUCmetadatafailure,https://www.youtube.com/channel/UCmetadatafailure,Metadata failure channel\n'),
      [`${root}/history/watch-history.json`]: strToU8(JSON.stringify([{
        products: ['YouTube'], title: 'Watched Example', titleUrl: 'https://www.youtube.com/watch?v=abcdefghijk', time: '2025-01-01T00:00:00Z'
      }])),
      [`${root}/history/search-history.json`]: strToU8(JSON.stringify([{
        products: ['YouTube'], titleUrl: 'https://www.youtube.com/results?search_query=metadata+failure', time: '2025-01-01T00:00:00Z'
      }])),
    })
    const dataSection = await goToSettingsSection(page, 'data')
    await page.evaluate(bytes => {
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => [{ getFile: async () => new File([new Uint8Array(bytes)], 'bad-metadata.zip', { type: 'application/zip' }) }]
      })
    }, [...archive])
    await dataSection.getByRole('button', { name: 'Import YouTube Takeout ZIP' }).click()
    await page.locator('.takeoutSelectionCentered').getByRole('button', { name: 'Import selected data' }).click()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const goodPlaylist = store.getters.getAllPlaylists.find(playlist => playlist.playlistName === 'Good/List')
      return {
        subscribed: store.getters.getProfileList[0].subscriptions.some(channel => channel.id === 'UCmetadatafailure'),
        watched: Boolean(store.getters.getHistoryCacheById.abcdefghijk),
        searched: store.getters.getSearchHistoryEntries.some(entry => entry.query === 'metadata failure'),
        playlistCount: store.getters.getAllPlaylists.length,
        videoIds: store.getters.getAllPlaylists.find(playlist => playlist.playlistName === '本地清單')?.videos.map(video => video.videoId),
        goodPlaylist: goodPlaylist && {
          description: goodPlaylist.description,
          createdAt: goodPlaylist.createdAt,
          lastUpdatedAt: goodPlaylist.lastUpdatedAt,
          videoIds: goodPlaylist.videos.map(video => video.videoId),
        },
        empty: store.getters.getAllPlaylists.find(playlist => playlist.playlistName === 'Good empty')?.videos,
      }
    })).toEqual({
      subscribed: true,
      watched: true,
      searched: true,
      playlistCount: 5,
      videoIds: ['abcdefghijk'],
      goodPlaylist: { description: 'Good account', createdAt: Date.parse('2024-01-01T00:00:00Z'), lastUpdatedAt: Date.parse('2025-01-01T00:00:00Z'), videoIds: ['lmnopqrstuv'] },
      empty: [],
    })
    await expect(page.locator('.takeoutSelectionCentered')).toBeHidden()
    await expect(page.locator('.toast', { hasText: 'Unable to read file' })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'All playlists has been successfully imported' })).toHaveCount(0)
  })
}

for (const [kind, action, failedName] of [
  ['existing', 'importPlaylist', 'Favorites'],
  ['new', 'addPlaylist', 'Failed empty list'],
]) {
  test(`reports a failed ${kind} playlist save and continues without claiming complete success`, async ({ page }) => {
    const archive = zipSync({
      'Takeout/YouTube/playlists/playlists.csv': strToU8(`Playlist ID,Playlist Title (Original)\nPLfailed,${failedName}\nPLempty,Another empty list\n`),
    })
    const dataSection = await goToSettingsSection(page, 'data')
    await page.evaluate(({ bytes, action, failedName }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const dispatch = store.dispatch.bind(store)
      store.dispatch = (type, payload, options) => {
        if (type === action && payload.playlistName === failedName) {
          return action === 'addPlaylist' ? Promise.resolve(false) : Promise.reject(new Error('Simulated playlist write failure'))
        }
        return dispatch(type, payload, options)
      }
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => [{ getFile: async () => new File([new Uint8Array(bytes)], 'empty-playlists.zip', { type: 'application/zip' }) }]
      })
    }, { bytes: [...archive], action, failedName })
    await dataSection.getByRole('button', { name: 'Import YouTube Takeout ZIP' }).click()
    await page.locator('.takeoutSelectionCentered').getByRole('button', { name: 'Import selected data' }).click()
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getAllPlaylists.some(playlist => playlist.playlistName === 'Another empty list'))).toBe(true)
    await expect(page.locator('.takeoutSelectionCentered')).toBeHidden()
    await expect(page.locator('.toast', { hasText: `Unable to read file: Takeout/YouTube/playlists/${failedName}-videos.csv` })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'All playlists has been successfully imported' })).toHaveCount(0)
  })
}
