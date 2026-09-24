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
    [`${root}/playlists/My list.csv`]: strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\n'),
    [`${root}/playlists/My list (2).csv`]: strToU8('Video ID,Playlist video creation timestamp\nzzzzzzzzzzz,2025-01-03T00:00:00+00:00\n'),
    'Another account/playlists/My list.csv': strToU8('Video ID,Playlist video creation timestamp\nlmnopqrstuv,2025-01-02T00:00:00+00:00\n'),
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
  const selection = page.locator('.takeoutSelection')
  await expect(selection.getByRole('checkbox')).toHaveCount(4)
  await selection.getByText('Search history', { exact: true }).click()
  await expect(selection.getByRole('checkbox', { name: /Search history/i })).not.toBeChecked()
  await selection.getByRole('button', { name: 'Import selected data' }).click()

  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return {
      subscribed: store.getters.getProfileList[0].subscriptions.some(channel => channel.id === 'UCtakeouttest'),
      watched: Boolean(store.getters.getHistoryCacheById.abcdefghijk),
      playlists: store.getters.getAllPlaylists.filter(playlist => playlist.playlistName.startsWith('My list')).map(playlist => playlist.playlistName).sort(),
      search: store.getters.getSearchHistoryEntries.some(entry => entry.query === 'example'),
    }
  })).toEqual({ subscribed: true, watched: true, playlists: ['My list', 'My list (2)', 'My list (3)'], search: false })
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
            ['Video ID,Playlist Video Creation Timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\n'],
            'Takeout favorites.csv',
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
  })).toEqual(['abcdefghijk'])
})
