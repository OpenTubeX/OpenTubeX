import { test, expect } from '../../helpers/app.mjs'

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const types = [
  { title: 'Playlist', icon: 'list' },
  { title: 'Album', icon: 'music', flag: 'isAlbum', tab: 'releases' },
  { title: 'Podcast', icon: 'podcast', flag: 'isPodcast', tab: 'podcasts' },
  { title: 'Course', icon: 'graduation-cap', flag: 'isCourse', tab: 'courses' }
]

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: 'https://invidious.test',
      baseTheme: 'dark',
      listType: 'grid'
    }
  }
})

test('playlist types render in both icon packs and Invidious channel tabs', async ({ page, attachScreenshot }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => {
    const tab = new URL(route.request().url()).pathname.split('/').at(-1)
    const selected = types.filter(type => tab === 'playlists' || type.tab === tab)
    return route.fulfill({
      json: {
        author: 'Playlist types',
        authorId: channelId,
        authorThumbnails: [],
        authorBanners: [],
        description: '',
        subCount: 0,
        totalViews: 0,
        joined: 0,
        tabs: ['videos', 'playlists', 'releases', 'podcasts', 'courses'],
        relatedChannels: [],
        videos: [],
        latestVideos: [],
        playlists: selected.map(type => ({
          type: 'playlist',
          title: type.title,
          playlistId: `PL-${type.title}`,
          playlistThumbnail: '',
          author: 'Playlist types',
          authorId: channelId,
          videoCount: 12,
          ...(tab === 'playlists' && type.flag ? { [type.flag]: true } : {})
        }))
      }
    })
  })
  const tab = await page.evaluate(id => window.ftElectron.tabs.create({
    route: `/channel/${id}`, makeActive: false
  }), channelId)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  await page.locator('#playlistsTab').click()

  for (const pack of ['material', 'remix']) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__
      .config.globalProperties.$store.dispatch('updateIconPack', value), pack)
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 })
      for (const type of types) {
        const card = page.locator('.ft-list-item', { has: page.getByRole('heading', { name: type.title, exact: true }) })
        const icon = card.locator('.videoCountContainer .ft-icon')
        await expect(icon).toHaveAttribute('data-icon', type.icon)
        await expect(icon).toHaveAttribute('data-icon-pack', pack)
        await expect(icon.locator('svg')).toBeVisible()
        await expect(card.locator('.videoCountContainer')).toHaveText('12')
      }
      if (width === 1440) await attachScreenshot(`playlist types ${pack}`)
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  for (const type of types.filter(type => type.tab)) {
    await page.locator(`#${type.tab}Tab`).click()
    await expect(page.locator('.ft-list-item .videoCountContainer .ft-icon'))
      .toHaveAttribute('data-icon', type.icon)
  }
})
