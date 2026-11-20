import { readFile } from 'node:fs/promises'
import { test, expect, latestSettings, readDatastore, goTo, waitForAppReady } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test'
    }
  }
})

test.beforeEach(async ({ page }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => {
    const channelId = new URL(route.request().url()).pathname.split('/')[4]
    return route.fulfill({
      json: {
        author: 'Channel',
        authorId: channelId,
        authorThumbnails: [{ url: `https://yt3.googleusercontent.com/${channelId}=s176`, width: 48, height: 48 }],
        authorBanners: [],
        description: 'Channel description',
        subCount: 0,
        totalViews: 0,
        joined: 0,
        tabs: ['videos', 'shorts', 'streams'],
        relatedChannels: [],
        videos: [],
        latestVideos: []
      }
    })
  })
  // The saved avatar uses Electron's native decoder, which needs a raster image.
  const avatar = await readFile(new URL('../../fixtures/media/avatar.png', import.meta.url))
  await page.route('https://invidious.test/ggpht/**', route => route.fulfill({ body: avatar, contentType: 'image/png' }))
})

test('pins unsubscribed channels, persists them and unpins after navigation', async ({ app, page }, testInfo) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), id)
  const pin = page.getByRole('button', { name: 'Pin to Navigation', exact: true })
  await expect(pin).toBeVisible()
  await pin.click()
  const unpin = page.getByRole('button', { name: 'Unpin from Navigation', exact: true })
  await expect(unpin).toHaveAttribute('aria-pressed', 'true')
  const pinned = page.locator('.sideNav .pinnedChannels .navChannel')
  await expect(pinned).toHaveCount(1)
  await expect(pinned).toHaveAttribute('href', `#/channel/${id}`)
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels)
    .toEqual([{ id, name: 'Channel', thumbnail: `https://yt3.googleusercontent.com/${id}=s176` }])
  await page.reload()
  await waitForAppReady(page)
  await expect(pinned).toHaveCount(1)
  await expect(unpin).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.$store.getters.getActiveProfile.subscriptions.length)).toBe(0)
  await page.evaluate(() => window.$store.dispatch('updateHideActiveSubscriptions', true))
  await expect(pinned).toBeVisible()
  await page.evaluate(() => {
    if (!window.$store.getters.getIsSideNavOpen) window.$store.commit('toggleSideNav')
  })
  await page.screenshot({ path: testInfo.outputPath('pinned-channel.png'), animations: 'disabled' })
  await goTo(page, 'history')
  await pinned.click()
  await expect(unpin).toBeVisible()
  await unpin.click()
  await expect(pinned).toHaveCount(0)
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels).toEqual([])
})

test('shows subscribed pinned channels once when subscribing after pinning', async ({ page }) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), id)
  const subscribe = page.locator('.channelDetails:visible .subscribeButton')
  const pin = page.getByRole('button', { name: 'Pin to Navigation', exact: true })
  await pin.click()
  await subscribe.click()
  await expect(subscribe).toHaveText('Unsubscribe')
  const links = page.locator(`.sideNav .navChannel[href="#/channel/${id}"]`)
  await expect(links).toHaveCount(1)
  await expect(page.locator('.sideNav .pinnedChannels .navChannel')).toHaveCount(1)
  await page.getByRole('button', { name: 'Unpin from Navigation', exact: true }).click()
  await expect(page.locator('.sideNav .pinnedChannels .navChannel')).toHaveCount(0)
  await expect(links).toHaveCount(1)
  await expect(subscribe).toHaveText('Unsubscribe')
})

test('refreshes saved pin metadata when reopening a channel', async ({ app, page }) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  await page.evaluate(id => window.$store.dispatch('updatePinnedChannels', [
    { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Other channel', thumbnail: null },
    { id, name: 'Old channel name', thumbnail: 'https://yt3.googleusercontent.com/old=s176' }
  ]), id)
  const membership = await page.evaluate(() => window.$store.getters.getPinnedChannels)
  const pinEditTime = await page.evaluate(() => window.$store.state.settings.syncServerSettingUpdatedAt.pinnedChannels)
  await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), id)
  const expected = { [id]: { name: 'Channel', thumbnail: `https://yt3.googleusercontent.com/${id}=s176` } }
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannelMetadata).toEqual(expected)
  const pinned = page.locator('.sideNav .pinnedChannels .navChannel').last()
  await expect(pinned).toHaveAttribute('title', 'Channel')
  expect(await page.evaluate(() => window.$store.state.settings.syncServerSettingUpdatedAt.pinnedChannels)).toBe(pinEditTime)
  expect(latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels).toEqual(membership)
  await expect(pinned.locator('img')).toHaveAttribute('src', `https://invidious.test/ggpht/${id}=s35`)
  await page.reload()
  await waitForAppReady(page)
  await expect.poll(() => page.evaluate(() => window.$store.getters.getPinnedChannelMetadata)).toEqual(expected)
})

test('does not copy the previous channel into a pin after a local load failure', async ({ app, page }) => {
  const id = 'UCbbbbbbbbbbbbbbbbbbbbbb'
  const saved = [{ id, name: 'Saved channel', thumbnail: 'https://yt3.googleusercontent.com/saved=s176' }]
  await page.evaluate(() => window.ftElectron.tabs.create({ route: '/channel/UCaaaaaaaaaaaaaaaaaaaaaa', makeActive: true }))
  await expect(page.locator('.channelDetails:visible .name')).toHaveText('Channel')
  await page.evaluate(async saved => {
    await window.$store.dispatch('updatePinnedChannels', saved)
    await window.$store.dispatch('updateBackendPreference', 'local')
  }, saved)
  await page.route('**/youtubei/v1/browse**', route => route.fulfill({ status: 403, body: 'Forced channel load failure' }))
  await page.locator('.sideNav .pinnedChannels .navChannel').click()
  await expect(page).toHaveURL(new RegExp(`/channel/${id}`))
  await expect(page.getByText(/^Local API Error \(Click to copy\)/)).toBeVisible()
  await expect(page.locator('.channelDetails:visible')).toBeVisible()
  await expect(page.locator('.sideNav .pinnedChannels .navChannel')).toHaveAttribute('title', 'Saved channel')
  expect(latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels).toEqual(saved)
  await page.getByRole('button', { name: 'Unpin from Navigation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pin to Navigation', exact: true })).toHaveCount(0)
})

test('removing a pin discards cached details before sync adds it again', async ({ app, page }) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  await page.evaluate(async id => {
    await window.$store.dispatch('updatePinnedChannels', [{ id, name: 'Original', thumbnail: null }])
    await window.$store.dispatch('refreshPinnedChannelMetadata', { id, name: 'Local cached name', thumbnail: null })
  }, id)
  await expect(page.locator('.sideNav .pinnedChannels .navChannel')).toHaveAttribute('title', 'Local cached name')
  await page.evaluate(() => window.$store.dispatch('updatePinnedChannels', []))
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannelMetadata).toEqual({})
  await page.reload()
  await waitForAppReady(page)
  // Settings sync applies membership through the setting mutation.
  await page.evaluate(id => window.$store.commit('setPinnedChannels', [{ id, name: 'New synced name', thumbnail: null }]), id)
  await expect(page.locator('.sideNav .pinnedChannels .navChannel')).toHaveAttribute('title', 'New synced name')
})

test('lists pinned playlists and channels in the mobile More sheet', { tag: '@scale' }, async ({ page }, testInfo) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  await page.setViewportSize({ width: 375, height: 812 })
  const nav = page.locator('.sideNav')
  const more = nav.getByRole('button', { name: 'More', exact: true })
  const primaryLinks = () => nav.locator('.inner > .navOption:visible').evaluateAll(links => links.map(link => link.getAttribute('href')))
  const items = ['home', 'subscriptions', 'userplaylists', 'history', 'subscribedchannels']
  await page.evaluate(items => window.$store.commit('setNavigationItems', items), items)
  await expect.poll(primaryLinks).toEqual(items.map(item => `#/${item}`))
  await expect(more).toHaveCount(0)

  await page.route('https://invidious.test/vi/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.evaluate(async id => {
    const store = window.$store
    await store.dispatch('addPlaylist', {
      _id: 'pinned-mobile',
      playlistName: 'Pinned playlist',
      description: '',
      videos: [{ videoId: 'aaaaaaaaaaa', playlistItemId: 'pinned-mobile-video', title: 'Video', author: 'Channel', lengthSeconds: 120, type: 'video' }]
    })
    await store.dispatch('updatePinnedPlaylistIds', ['pinned-mobile'])
    await store.dispatch('updatePinnedChannels', [{ id, name: 'Channel', thumbnail: `https://yt3.googleusercontent.com/${id}=s176` }])
  }, id)
  // More takes the fifth slot so the pins have somewhere to go.
  await expect.poll(primaryLinks).toEqual(items.slice(0, 4).map(item => `#/${item}`))
  await expect(nav.locator('.pinnedPlaylists, .pinnedChannels')).toHaveCount(2)
  await expect(nav.locator('.pinnedPlaylists, .pinnedChannels').first()).toBeHidden()
  await more.click()
  const sheet = page.locator('.moreOptionContainer')
  const sheetLinks = () => sheet.locator('.navOption').evaluateAll(links => links.map(link => link.getAttribute('href')))
  await expect.poll(sheetLinks).toEqual(['#/subscribedchannels', '#/playlist/pinned-mobile?playlistType=user', `#/channel/${id}`])
  await expect(sheet.locator('.moreOptionDivider')).toBeVisible()
  const avatar = sheet.locator(`a[href="#/channel/${id}"] img`)
  await expect(avatar).toHaveAttribute('src', `https://invidious.test/ggpht/${id}=s35`)
  const playlistThumbnail = sheet.locator('a[href^="#/playlist/"] img')
  await expect(playlistThumbnail).toHaveAttribute('src', 'https://invidious.test/vi/aaaaaaaaaaa/maxresdefault.jpg')
  for (const image of [avatar, playlistThumbnail]) {
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
  }
  // Thumbnails keep labels and rows aligned with the destinations above them.
  const rows = await sheet.locator('.navOption').evaluateAll(links => links.map(link => ({
    height: link.getBoundingClientRect().height,
    labelStart: link.querySelector('.navLabel').getBoundingClientRect().left
  })))
  for (const row of rows) {
    expect(Math.abs(row.height - rows[0].height)).toBeLessThanOrEqual(1)
    expect(Math.abs(row.labelStart - rows[0].labelStart)).toBeLessThanOrEqual(1)
  }
  await page.mouse.move(0, 0)
  await page.screenshot({ path: testInfo.outputPath('mobile-pins.png'), animations: 'disabled' })

  await sheet.getByRole('link', { name: 'Pinned playlist', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL(/#\/playlist\/pinned-mobile\?playlistType=user$/)
  await expect(more).toHaveClass(/router-link-active/)
  await more.click()
  await sheet.getByRole('link', { name: 'Channel', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`#/channel/${id}`))
  await expect(more).toHaveClass(/router-link-active/)

  await page.evaluate(() => window.$store.dispatch('updateDisableChannelLinks', true))
  await expect(more).not.toHaveClass(/router-link-active/)
  await more.click()
  const disabledChannel = sheet.locator('.navOption').last()
  await expect(disabledChannel).toHaveText('Channel')
  await expect(disabledChannel).not.toHaveAttribute('href')
  await expect(disabledChannel).toHaveCSS('pointer-events', 'none')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  await page.evaluate(async () => {
    await window.$store.dispatch('updatePinnedPlaylistIds', [])
    await window.$store.dispatch('updatePinnedChannels', [])
  })
  await expect(more).toHaveCount(0)
  await expect.poll(primaryLinks).toEqual(items.map(item => `#/${item}`))
})

async function dragVertically(page, fromLocator, toLocator) {
  await fromLocator.scrollIntoViewIfNeeded()
  const from = await fromLocator.boundingBox()
  const to = await toLocator.boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2, { steps: 10 })
  await page.mouse.up()
}

test('reorders pinned channels in the side navigation by drag and keyboard', { tag: '@scale' }, async ({ app, page }) => {
  const channels = [
    { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Channel', thumbnail: 'https://yt3.googleusercontent.com/UCaaaaaaaaaaaaaaaaaaaaaa=s176' },
    { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Beta Channel', thumbnail: 'https://yt3.googleusercontent.com/UCbbbbbbbbbbbbbbbbbbbbbb=s176' },
    { id: 'UCcccccccccccccccccccccc', name: 'Gamma Channel', thumbnail: 'https://yt3.googleusercontent.com/UCcccccccccccccccccccccc=s176' },
  ]
  await goTo(page, 'history')
  await page.evaluate(channels => window.$store.dispatch('updatePinnedChannels', channels), channels)

  const pinned = page.locator('.sideNav .pinnedChannels .navChannel')
  const pinnedIds = () => pinned.evaluateAll(links => links.map(link => link.getAttribute('data-pinned-channel-id')))
  await expect.poll(pinnedIds).toEqual(channels.map(channel => channel.id))

  // Collapsed rail: drag the third channel to the first slot without navigating.
  await dragVertically(page, pinned.nth(2), pinned.nth(0))
  await expect.poll(pinnedIds).toEqual([channels[2].id, channels[0].id, channels[1].id])
  await expect(page).toHaveURL(/#\/history$/)
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels.map(channel => channel.id))
    .toEqual([channels[2].id, channels[0].id, channels[1].id])

  // Escape cancels an in-progress drag without changing order.
  const firstBox = await pinned.nth(0).boundingBox()
  const lastBox = await pinned.nth(2).boundingBox()
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(firstBox.x + firstBox.width / 2, lastBox.y + lastBox.height / 2, { steps: 8 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect.poll(pinnedIds).toEqual([channels[2].id, channels[0].id, channels[1].id])

  // Expanded sidebar: drag the first channel to the middle slot.
  await page.evaluate(() => {
    if (!window.$store.getters.getIsSideNavOpen) window.$store.commit('toggleSideNav')
  })
  const expandedNav = page.locator('.sideNav.expanded')
  await expect(expandedNav).toBeVisible()
  await expandedNav.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  await dragVertically(page, pinned.nth(0), pinned.nth(1))
  await expect.poll(pinnedIds).toEqual([channels[0].id, channels[2].id, channels[1].id])
  await expect(page).toHaveURL(/#\/history$/)

  // Keyboard reordering with Alt+ArrowUp keeps focus on the moved link.
  await pinned.nth(2).focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(pinnedIds).toEqual([channels[0].id, channels[1].id, channels[2].id])
  await expect(pinned.nth(1)).toBeFocused()

  // Order persists across reload, and normal clicks still navigate.
  await page.reload()
  await waitForAppReady(page)
  await expect.poll(pinnedIds).toEqual([channels[0].id, channels[1].id, channels[2].id])
  await pinned.nth(1).click()
  await expect(page).toHaveURL(new RegExp(`#/channel/${channels[1].id}`))
})

test('reorders pinned playlists and channels in the mobile More sheet', { tag: '@scale' }, async ({ app, page }, testInfo) => {
  const channels = [
    { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Channel', thumbnail: 'https://yt3.googleusercontent.com/UCaaaaaaaaaaaaaaaaaaaaaa=s176' },
    { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Beta Channel', thumbnail: 'https://yt3.googleusercontent.com/UCbbbbbbbbbbbbbbbbbbbbbb=s176' },
    { id: 'UCcccccccccccccccccccccc', name: 'Gamma Channel', thumbnail: 'https://yt3.googleusercontent.com/UCcccccccccccccccccccccc=s176' },
  ]
  const playlists = [
    { _id: 'pinned-mobile-a', playlistName: 'Playlist A', description: '', videos: [] },
    { _id: 'pinned-mobile-b', playlistName: 'Playlist B', description: '', videos: [] },
  ]
  await page.setViewportSize({ width: 375, height: 812 })
  await goTo(page, 'history')
  await page.evaluate(async ({ channels, playlists }) => {
    const store = window.$store
    for (const playlist of playlists) await store.dispatch('addPlaylist', playlist)
    await store.dispatch('updatePinnedPlaylistIds', playlists.map(playlist => playlist._id))
    await store.dispatch('updatePinnedChannels', channels)
  }, { channels, playlists })

  await page.locator('.sideNav').getByRole('button', { name: 'More', exact: true }).click()
  const sheet = page.locator('.moreOptionContainer')
  await expect(sheet).toBeVisible()
  await sheet.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))

  const pinnedPlaylistRows = sheet.locator('.pinnedPlaylistOption')
  const pinnedPlaylistIds = () => pinnedPlaylistRows.evaluateAll(links => links.map(link => link.getAttribute('data-pinned-playlist-id')))
  const pinnedChannelRows = sheet.locator('.pinnedChannelOption')
  const pinnedChannelIds = () => pinnedChannelRows.evaluateAll(links => links.map(link => link.getAttribute('data-pinned-channel-id')))
  await expect.poll(pinnedPlaylistIds).toEqual(['pinned-mobile-a', 'pinned-mobile-b'])
  await expect.poll(pinnedChannelIds).toEqual(channels.map(channel => channel.id))
  await page.screenshot({ path: testInfo.outputPath('mobile-pinned-reorder.png'), animations: 'disabled' })

  // Drag handle reorders pinned playlists without dismissing the sheet or navigating.
  await dragVertically(
    page,
    pinnedPlaylistRows.nth(1).locator('.pinnedDragHandle'),
    pinnedPlaylistRows.nth(0)
  )
  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/#\/history$/)
  await expect.poll(pinnedPlaylistIds).toEqual(['pinned-mobile-b', 'pinned-mobile-a'])
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedPlaylistIds)
    .toEqual(['pinned-mobile-b', 'pinned-mobile-a'])

  // Drag handle reorders pinned channels independently without dismissing the sheet or navigating.
  await dragVertically(
    page,
    pinnedChannelRows.nth(2).locator('.pinnedDragHandle'),
    pinnedChannelRows.nth(0)
  )
  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/#\/history$/)
  await expect.poll(pinnedChannelIds).toEqual([channels[2].id, channels[0].id, channels[1].id])
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels.map(channel => channel.id))
    .toEqual([channels[2].id, channels[0].id, channels[1].id])
})
