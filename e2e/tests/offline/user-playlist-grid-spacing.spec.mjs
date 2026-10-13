import { test, expect, goTo, updateInputWithoutScrolling } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

test.use({
  seed: {
    settings: { listType: 'grid', baseTheme: 'dark' },
    playlists: Array.from({ length: 8 }, (_, index) => ({
      _id: `grid-spacing-${index}`,
      playlistName: index === 7 ? 'Playlist 8 with a longer title that wraps on a phone' : `Playlist ${index + 1}`,
      protected: false,
      description: '',
      videos: [{
        videoId: 'aaaaaaaaaaa',
        playlistItemId: `grid-video-${index}`,
        title: 'Fixture video',
        author: 'Test Channel',
        lengthSeconds: 120,
        type: 'video'
      }],
      lastUpdatedAt: 1700000000000 + index
    }))
  }
})

test('playlist overview rows fit their contents on phones and desktop', async ({ app, page }, testInfo) => {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await goTo(page, 'userplaylists')
  const cards = page.locator('.playlistList .ft-list-item')
  await expect(cards).toHaveCount(8)
  for (const scale of [1, 0.95, 1.25]) {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale)
    }, scale)
    for (const viewport of [{ width: 393, height: 852 }, { width: 461, height: 1026 }, { width: 812, height: 375 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport)
      await expect(async () => {
        const rows = await cards.evaluateAll(elements => elements.map(element => {
          const bounds = element.getBoundingClientRect()
          const contentEnd = Math.max(...[...element.querySelectorAll('.videoThumbnail, .h3Title')]
            .map(content => content.getBoundingClientRect().bottom))
          return { top: bounds.top, bottom: bounds.bottom, contentEnd }
        }))
        for (const card of rows) {
          const rowContentEnd = Math.max(...rows.filter(other => Math.abs(other.top - card.top) <= 1).map(other => other.contentEnd))
          expect(card.bottom - rowContentEnd).toBeLessThanOrEqual(8)
          const nextRow = rows.find(next => next.top > card.top + 1)
          if (nextRow) {
            expect(nextRow.top - card.bottom).toBeGreaterThanOrEqual(7)
            expect(nextRow.top - card.bottom).toBeLessThanOrEqual(9)
          }
        }
      }).toPass({ timeout: 5000 })
      if (scale === 1 && viewport.width === 393) {
        await page.screenshot({ path: testInfo.outputPath('mobile-playlist-grid.png') })
      }
    }
  }
})

test('playlist overview keeps valid scroll geometry when its content shrinks', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(0.95)
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await goTo(page, 'userplaylists')
  const originalPlaylists = await page.evaluate(() => JSON.parse(JSON.stringify(
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.playlists.playlists
  )))
  for (const trigger of ['thumbnail size', 'resize', 'search', 'remove', 'replace']) {
    await page.setViewportSize({ width: 393, height: 520 })
    await page.evaluate(async playlists => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setAllPlaylists', playlists)
      await store.dispatch('updateThumbnailSize', 110)
    }, originalPlaylists)
    await page.locator('.playlistSearch input').fill('')
    await expect.poll(() => page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
      return window.scrollY
    })).toBeGreaterThan(500)
    const previousHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    if (trigger === 'resize') await page.setViewportSize({ width: 1440, height: 520 })
    else if (trigger === 'search') await updateInputWithoutScrolling(page.locator('.playlistSearch input'), 'Playlist 1')
    else {
      await page.evaluate(async trigger => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        if (trigger === 'thumbnail size') await store.dispatch('updateThumbnailSize', 60)
        else if (trigger === 'remove') store.commit('removePlaylists', store.state.playlists.playlists.slice(1).map(playlist => playlist._id))
        else store.commit('setAllPlaylists', store.state.playlists.playlists.slice(0, 1))
      }, trigger)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(previousHeight)
    await expect(async () => {
      const geometry = await page.evaluate(() => {
        const root = document.documentElement
        const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
        const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
        const handleElement = scrollbar.querySelector('.os-scrollbar-handle')
        const handle = handleElement.getBoundingClientRect()
        const range = Math.max(0, root.scrollHeight - innerHeight)
        return {
          offset: scrollY,
          range,
          thumbError: Math.abs(handle.height - Math.max(parseFloat(getComputedStyle(handleElement).minHeight), track.height * innerHeight / root.scrollHeight)),
          thumbOverflow: handle.bottom - track.bottom,
          unusable: scrollbar.classList.contains('os-scrollbar-unusable')
        }
      })
      expect(geometry.offset, trigger).toBeGreaterThanOrEqual(0)
      expect(geometry.offset, trigger).toBeLessThanOrEqual(geometry.range + 1)
      expect(geometry.thumbError, trigger).toBeLessThanOrEqual(2)
      expect(geometry.thumbOverflow, trigger).toBeLessThanOrEqual(2)
      expect(geometry.unusable, trigger).toBe(geometry.range <= 1)
    }).toPass()
  }
})
