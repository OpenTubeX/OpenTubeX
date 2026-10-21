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

test('pinned channels respect disabled channel links', async ({ page }) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  await page.evaluate(id => window.$store.dispatch('updatePinnedChannels', [{ id, name: 'Channel', thumbnail: null }]), id)
  const pinned = page.locator('.sideNav .pinnedChannels .navChannel')
  await expect(pinned).toHaveAttribute('href', `#/channel/${id}`)
  await page.evaluate(() => window.$store.dispatch('updateDisableChannelLinks', true))
  await expect(pinned).not.toHaveAttribute('href')
  await expect(pinned).toHaveClass(/disabledIcon/)
  const url = page.url()
  await pinned.click({ force: true })
  await expect(page).toHaveURL(url)
  await page.evaluate(() => window.$store.dispatch('updateDisableChannelLinks', false))
  await expect(pinned).toHaveAttribute('href', `#/channel/${id}`)
})

test('pinned avatars follow the active backend and Invidious instance', async ({ page }) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const avatar = await readFile(new URL('../../fixtures/media/avatar.png', import.meta.url))
  await page.route('https://other.invidious.test/ggpht/**', route => route.fulfill({ body: avatar, contentType: 'image/png' }))
  await page.route('https://yt3.googleusercontent.com/**', route => route.fulfill({ body: avatar, contentType: 'image/png' }))
  await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), id)
  await page.getByRole('button', { name: 'Pin to Navigation', exact: true }).click()
  const image = page.locator('.sideNav .pinnedChannels img')
  await expect(image).toHaveAttribute('src', `https://invidious.test/ggpht/${id}=s35`)
  await page.evaluate(() => window.$store.dispatch('updateDefaultInvidiousInstance', 'https://other.invidious.test'))
  await expect(image).toHaveAttribute('src', `https://other.invidious.test/ggpht/${id}=s35`)
  await page.evaluate(() => window.$store.dispatch('updateBackendPreference', 'local'))
  await expect(image).toHaveAttribute('src', `https://yt3.googleusercontent.com/${id}=s35`)
  await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
})

for (const subscribeFirst of [true, false]) {
  test(`shows subscribed pinned channels once when subscribing ${subscribeFirst ? 'before' : 'after'} pinning`, async ({ page }) => {
    const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
    await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), id)
    const subscribe = page.locator('.channelDetails:visible .subscribeButton')
    const pin = page.getByRole('button', { name: 'Pin to Navigation', exact: true })
    if (subscribeFirst) {
      await subscribe.click()
      await expect(subscribe).toHaveText('Unsubscribe')
    }
    await pin.click()
    if (!subscribeFirst) {
      await subscribe.click()
      await expect(subscribe).toHaveText('Unsubscribe')
    }
    const links = page.locator(`.sideNav .navChannel[href="#/channel/${id}"]`)
    await expect(links).toHaveCount(1)
    await expect(page.locator('.sideNav .pinnedChannels .navChannel')).toHaveCount(1)
    await page.getByRole('button', { name: 'Unpin from Navigation', exact: true }).click()
    await expect(page.locator('.sideNav .pinnedChannels .navChannel')).toHaveCount(0)
    await expect(links).toHaveCount(1)
    await expect(subscribe).toHaveText('Unsubscribe')
  })
}

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

test('keeps saved pin metadata when the channel cannot load', async ({ app, page }) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const saved = [{ id, name: 'Saved channel', thumbnail: 'https://yt3.googleusercontent.com/saved=s176' }]
  await page.evaluate(saved => window.$store.dispatch('updatePinnedChannels', saved), saved)
  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({ status: 404, json: { error: 'Channel unavailable' } }))
  await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), id)
  await expect(page.getByRole('button', { name: 'Unpin from Navigation', exact: true })).toBeVisible()
  await expect(page.locator('.sideNav .pinnedChannels .navChannel')).toHaveAttribute('title', 'Saved channel')
  expect(latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels).toEqual(saved)
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

for (const saved of [true, false]) {
  test(`refreshes pin metadata only after a successful save (${saved})`, async ({ page }) => {
    const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
    await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), id)
    const pin = page.getByRole('button', { name: 'Pin to Navigation', exact: true })
    await expect(pin).toBeVisible()
    await page.evaluate(() => {
      const store = window.$store
      window.pinMetadataRefreshes = 0
      store._actions.updatePinnedChannels = [value => {
        store.commit('setPinnedChannels', value)
        return new Promise(resolve => { window.finishPinSave = resolve })
      }]
      store._actions.refreshPinnedChannelMetadata = [() => { window.pinMetadataRefreshes++ }]
    })
    await pin.click()
    await expect(page.getByRole('button', { name: 'Unpin from Navigation', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.pinMetadataRefreshes)).toBe(0)
    await page.evaluate(saved => {
      if (!saved) window.$store.commit('setPinnedChannels', [])
      window.finishPinSave(saved)
    }, saved)
    await expect.poll(() => page.evaluate(() => window.pinMetadataRefreshes)).toBe(saved ? 1 : 0)
    if (!saved) await expect(pin).toBeVisible()
  })
}

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
