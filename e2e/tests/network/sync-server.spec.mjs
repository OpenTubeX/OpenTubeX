import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo } from '../../helpers/app.mjs'

const syncServerUrl = process.env.OPENTUBEX_SYNC_SERVER_URL
const channelId = 'UCuAXFkgsw1L7xaCfnd5JJOw'
const secondChannelId = 'UC-lHJZR3Gqxm24_Vd_AJ5Yw'
const remoteChannelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw'

function latestSettings(contents) {
  return Object.fromEntries(contents.trim().split('\n')
    .map(line => JSON.parse(line))
    .filter(record => record._id && !record.$$deleted)
    .map(record => [record._id, record.value]))
}

test.describe('OpenTubeX sync server', () => {
  test.skip(!syncServerUrl, 'Set OPENTUBEX_SYNC_SERVER_URL to run the local sync-server test')

  test.use({
    seed: {
      settings: {
        channelPlaybackSpeeds: JSON.stringify({ [channelId]: 1.5 })
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: channelId,
          name: 'Rick Astley',
          thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
        }, {
          id: secondChannelId,
          name: 'PewDiePie',
          thumbnail: 'https://yt3.googleusercontent.com/ytc/default'
        }]
      }],
      playlists: [{
        _id: 'sync-playlist',
        playlistName: 'Synced playlist',
        description: 'Created in OpenTubeX',
        protected: false,
        videos: [],
        createdAt: Date.now(),
        lastUpdatedAt: Date.now()
      }],
      history: [{
        _id: 'dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
        title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
        author: 'Rick Astley',
        authorId: channelId,
        published: Date.now() - 60_000,
        description: '',
        lengthSeconds: 213,
        watchProgress: 45,
        isWatched: false,
        timeWatched: Date.now(),
        isLive: false,
        type: 'video'
      }]
    }
  })

  test('pushes local data and pulls remote changes', async ({ app, page }) => {
    const username = `opentubex-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const bulkRequests = []
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname
      if (pathname.endsWith('/bulk')) bulkRequests.push(pathname)
    })

    await goTo(page, 'settings')
    const syncSection = page.locator('[data-section="sync"]')
    const serverUrlInput = syncSection.getByLabel('Server URL')
    await serverUrlInput.fill(syncServerUrl)
    await syncSection.getByLabel('Username').fill(username)
    await syncSection.getByLabel('Password').fill('local-test-password')
    await syncSection.getByRole('button', { name: 'Register' }).click()
    await expect(syncSection.getByText(`Connected as ${username}`)).toBeVisible()
    await expect(syncSection.getByText(/Last synced:/)).toBeVisible()
    expect(bulkRequests).toEqual(expect.arrayContaining([
      '/v1/subscriptions/bulk',
      '/v1/watch_history/bulk'
    ]))
    await expect(serverUrlInput).toHaveValue(syncServerUrl.replace(/\/$/, ''))

    const settingsPath = path.join(app.userDataDir, 'settings.db')
    await expect.poll(async () => {
      const settings = latestSettings(await readFile(settingsPath, 'utf8'))
      return settings.syncServerToken
    }).not.toBe('')

    const settings = latestSettings(await readFile(settingsPath, 'utf8'))
    expect(settings.syncServerUrl).toBe(syncServerUrl.replace(/\/$/, ''))
    const headers = {
      Authorization: settings.syncServerToken,
      'Content-Type': 'application/json'
    }
    const versionedSubscriptionsResponse = await fetch(`${syncServerUrl}/v1/subscriptions/`, { headers })
    const apiPrefix = versionedSubscriptionsResponse.status === 404 ? '' : '/v1'
    const subscriptionsResponse = apiPrefix
      ? versionedSubscriptionsResponse
      : await fetch(`${syncServerUrl}/subscriptions/`, { headers })
    expect(await subscriptionsResponse.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: channelId }),
      expect.objectContaining({ id: secondChannelId })
    ]))

    const playlistsResponse = await fetch(`${syncServerUrl}${apiPrefix}/playlists/`, { headers })
    expect(await playlistsResponse.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Synced playlist' })
    ]))

    const historyResponse = await fetch(`${syncServerUrl}${apiPrefix}/watch_history/?page=1`, { headers })
    expect(historyResponse.ok).toBe(true)
    expect(await historyResponse.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        video: expect.objectContaining({
          id: 'dQw4w9WgXcQ',
          uploader: expect.objectContaining({
            avatar: 'https://yt3.googleusercontent.com/ytc/default'
          })
        })
      })
    ]))

    const playbackSpeedsResponse = await fetch(
      `${syncServerUrl}${apiPrefix}/channel_playback_speeds/`,
      { headers }
    )
    expect(playbackSpeedsResponse.ok).toBe(true)
    expect(await playbackSpeedsResponse.json()).toEqual(expect.arrayContaining([
      { channel_id: channelId, playback_speed: 1.5 }
    ]))

    const putPlaybackSpeedResponse = await fetch(
      `${syncServerUrl}${apiPrefix}/channel_playback_speeds/`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ channel_id: remoteChannelId, playback_speed: 2 })
      }
    )
    expect(putPlaybackSpeedResponse.ok).toBe(true)

    const addRemoteResponse = await fetch(`${syncServerUrl}${apiPrefix}/subscriptions/`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        id: remoteChannelId,
        name: 'Google for Developers',
        avatar: 'https://i.ytimg.com/vi/7V-fIGMDsmE/hqdefault.jpg',
        verified: false
      })
    })
    expect(addRemoteResponse.ok).toBe(true)

    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
      return records
        .filter(record => record._id === 'allChannels' && !record.$$deleted)
        .at(-1)
        ?.subscriptions
        .find(channel => channel.id === remoteChannelId)
    }).toEqual(expect.objectContaining({
      id: remoteChannelId,
      thumbnail: null
    }))
    await expect.poll(async () => {
      const syncedSettings = latestSettings(await readFile(settingsPath, 'utf8'))
      return JSON.parse(syncedSettings.channelPlaybackSpeeds || '{}')
    }).toEqual({
      [channelId]: 1.5,
      [remoteChannelId]: 2
    })

    await syncSection.getByRole('button', { name: 'Delete sync account' }).click()
    const deleteAccountPrompt = page.getByRole('dialog', { name: 'Delete sync account?' })
    const deleteAccountPassword = deleteAccountPrompt.getByLabel('Password')
    await deleteAccountPassword.fill('wrong-password')
    await deleteAccountPrompt.getByRole('button', { name: 'Delete account' }).click()
    await expect(deleteAccountPrompt.getByRole('alert')).toBeVisible()
    await expect(syncSection.getByText(`Connected as ${username}`)).toBeVisible()

    await deleteAccountPassword.fill('local-test-password')
    await deleteAccountPrompt.getByRole('button', { name: 'Delete account' }).click()
    await expect(deleteAccountPrompt).toBeHidden()
    await expect(syncSection.getByRole('button', { name: 'Log in' })).toBeVisible()

    const deletedAccountLoginResponse = await fetch(`${syncServerUrl}${apiPrefix}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: username, password: 'local-test-password' })
    })
    expect(deletedAccountLoginResponse.ok).toBe(false)

    expect(await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')).toContain(channelId)
    expect(await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')).toContain('sync-playlist')
    expect(await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')).toContain('dQw4w9WgXcQ')
  })
})
