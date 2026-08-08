import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, waitForAppReady } from '../../helpers/app.mjs'
import { DBActions, PlaylistVideoAddResult } from '../../../src/constants.js'

function historyEntry(videoId, title) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    published: Date.now() - 86_400_000,
    description: '',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 10,
    isWatched: false,
    timeWatched: Date.now() - 1000,
    isLive: false,
    type: 'video'
  }
}

const SEED = {
  settings: { quickBookmarkTargetPlaylistId: 'favorites' },
  playlists: [
    {
      _id: 'favorites',
      playlistName: 'Favorites',
      protected: true,
      description: '',
      quickBookmarkIcon: 'clock',
      videos: [],
      createdAt: Date.now() - 86_400_000,
      lastUpdatedAt: Date.now() - 86_400_000
    },
    {
      _id: 'saved-videos',
      playlistName: 'Saved videos',
      protected: false,
      description: '',
      videos: [historyEntry('eeeeeeeeeee', 'Bookmarkable video')],
      createdAt: Date.now() - 86_400_000,
      lastUpdatedAt: Date.now() - 86_400_000
    }
  ],
  history: [historyEntry('eeeeeeeeeee', 'Bookmarkable video')]
}

test.use({ seed: SEED })

async function readPlaylist(app, id) {
  const contents = await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')
  const records = contents.trim().split('\n').map((line) => JSON.parse(line))
  return records.filter((record) => record._id === id).at(-1)
}

test.describe('rounded action popovers', () => {
  test.use({
    seed: {
      ...SEED,
      settings: { ...SEED.settings, uiRoundness: 0 }
    }
  })

  test('applies UI roundness to icon-button dropdowns', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    await expect(video.locator('.addToPlaylistIcon .iconDropdown')).toHaveCSS('border-radius', '0px')
  })
})

test.describe('video downloads', () => {
  test.use({
    seed: {
      ...SEED,
      settings: {
        ...SEED.settings,
        ytDlpSource: 'system',
        ytDlpPath: '/bin/false',
        ytDlpFfmpegSource: 'system',
        ytDlpFfmpegPath: '/bin/false'
      }
    }
  })

  test('sends plain download options over IPC', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()
    await page.getByRole('button', { name: 'Download', exact: true }).click()

    await expect(page.getByText('Download failed', { exact: true })).toBeVisible()
    await expect(page.locator('.downloadProgressBarTrack')).toHaveCount(0)
  })
})

test('asks for confirmation before removing a downloaded file', async ({ page }) => {
  await goTo(page, 'downloads')
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('upsertYtDlpDownload', {
      id: 42,
      title: 'Finished download',
      status: 'completed',
      percent: 100,
      thumbnail: 'https://i.ytimg.com/vi/eeeeeeeeeee/mqdefault.jpg',
      destination: '/tmp/finished-download.mp4'
    })
  })

  const downloadRow = page.locator('.downloadRow').filter({ hasText: 'Finished download' })
  await expect(downloadRow.locator('.downloadThumbnail')).toHaveAttribute(
    'src',
    'https://i.ytimg.com/vi/eeeeeeeeeee/mqdefault.jpg'
  )
  const rowLayout = await downloadRow.evaluate((row) => ({
    thumbnailRight: row.querySelector('.downloadThumbnail').getBoundingClientRect().right,
    detailsLeft: row.querySelector('.downloadDetails').getBoundingClientRect().left
  }))
  expect(rowLayout.thumbnailRight).toBeLessThanOrEqual(rowLayout.detailsLeft)

  await page.getByTitle('Remove File').click()
  await expect(page.getByRole('dialog')).toContainText('Remove downloaded file?')
  await expect(page.getByRole('dialog')).toContainText('Finished download')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Finished download')).toBeVisible()
})

test.describe('list video actions', () => {
  test('does not overflow horizontally in a narrow download modal', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 940 })
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()

    for (const locator of [page.locator('.downloadPromptCard'), page.locator('.downloadOptions')]) {
      await expect.poll(() => locator.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
    }

    const templateSection = page.locator('.fixedTemplateSection')
    await page.waitForTimeout(200)
    const templateTop = await templateSection.evaluate(element => element.getBoundingClientRect().top)
    await page.locator('.downloadOptions').evaluate(element => element.scrollTop = element.scrollHeight)
    await expect.poll(() => page.locator('.downloadOptions').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect.poll(() => templateSection.evaluate(element => element.getBoundingClientRect().top)).toBe(templateTop)
  })

  test('disabled download inputs do not fade their tooltips', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Download Video' }).click()

    const metadataSection = page.locator('.optionSection').filter({
      has: page.getByRole('heading', { name: 'Subtitles and Metadata' })
    })
    await expect(metadataSection.locator('.switch-label-text')).toHaveText([
      'Embed thumbnail as cover art',
      'Embed title, author, description, and chapters',
      'Include subtitles',
      'Embed subtitles in the media file'
    ])

    const subtitleLanguages = page.locator('.subtitleLanguages')
    const tooltip = subtitleLanguages.locator('[role="tooltip"]')
    await expect(subtitleLanguages.locator('input')).toBeDisabled()
    await subtitleLanguages.locator('.selectTooltip button').hover()
    await expect(tooltip).toBeVisible()

    const opacity = await subtitleLanguages.evaluate((field) => ({
      label: getComputedStyle(field.querySelector('.selectLabel')).opacity,
      labelText: getComputedStyle(field.querySelector('.selectLabelText')).opacity,
      tooltip: getComputedStyle(field.querySelector('[role="tooltip"]')).opacity
    }))
    expect(opacity).toEqual({ label: '1', labelText: '0.4', tooltip: '1' })
  })

  test('the options dropdown shows readable single-column actions with icons', async ({ page }) => {
    await goTo(page, 'history')
    await page.setViewportSize({ width: 1200, height: 360 })

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()

    const actions = page.getByRole('option')
    const dropdown = video.locator('.optionsButton .iconDropdown')
    await expect(actions).not.toHaveCount(0)
    await expect(actions.locator('.optionIconColumn svg')).toHaveCount(await actions.count())
    await expect(dropdown).toHaveCSS('font-size', '14px')
    await expect(dropdown).not.toHaveCSS('box-shadow', 'none')
    await expect(actions.first()).toHaveCSS('text-align', 'start')
    await expect(actions.first()).toHaveCSS('justify-content', 'flex-start')
    expect(await actions.locator('span').evaluateAll((labels) => {
      return labels.every((label) => label.scrollWidth <= label.clientWidth)
    })).toBe(true)
    const actionRows = await actions.evaluateAll((items) => items.map((item) => item.offsetTop))
    expect(new Set(actionRows).size).toBe(actionRows.length)

    const dropdownBounds = await dropdown.boundingBox()
    expect(dropdownBounds.y).toBeGreaterThanOrEqual(0)
    expect(dropdownBounds.y + dropdownBounds.height).toBeLessThanOrEqual(360)
    expect(await dropdown.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await expect(actions.last()).toBeVisible()

    await page.setViewportSize({ width: 1000, height: 300 })
    await expect.poll(async () => {
      const bounds = await dropdown.boundingBox()
      return bounds.y >= 0 && bounds.y + bounds.height <= 300
    }).toBe(true)
  })

  test('a tall options dropdown stays below the horizontal tab bar', async ({ page }) => {
    await goTo(page, 'history')
    await page.setViewportSize({ width: 1200, height: 400 })

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()

    const dropdown = video.locator('.optionsButton .iconDropdown')
    await expect(dropdown).toBeVisible()

    // Clamping to the viewport edge let a menu that is too tall for the space
    // below it cover the tabs and the top navigation instead of scrolling.
    const [dropdownBounds, chromeBottom] = await Promise.all([
      dropdown.boundingBox(),
      page.evaluate(() => {
        return Math.max(
          document.querySelector('.topNav').getBoundingClientRect().bottom,
          document.querySelector('.tabBar:not(.vertical)').getBoundingClientRect().bottom
        )
      })
    ])

    expect(chromeBottom).toBeGreaterThan(0)
    expect(dropdownBounds.y).toBeGreaterThanOrEqual(chromeBottom)
    expect(dropdownBounds.y + dropdownBounds.height).toBeLessThanOrEqual(400)
    expect(await dropdown.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

    // Repositioning alone cannot keep up with a fast scroll, so the chrome also
    // has to paint above the dropdown.
    const stackingOrder = await dropdown.evaluate((element) => ({
      dropdown: Number(getComputedStyle(element).zIndex),
      tabBar: Number(getComputedStyle(document.querySelector('.tabBar:not(.vertical)')).zIndex),
      topNav: Number(getComputedStyle(document.querySelector('.topNav')).zIndex)
    }))
    expect(stackingOrder.tabBar).toBeGreaterThan(stackingOrder.dropdown)
    expect(stackingOrder.topNav).toBeGreaterThan(stackingOrder.dropdown)
  })

  test('an open options dropdown crosses vertical tabs without lifting its feed card', async ({ page }) => {
    await goTo(page, 'history')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseVerticalTabBar', true)
    })

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()

    await expect(video.locator('.optionsButton .iconDropdown')).toBeVisible()
    const stackingOrder = await video.evaluate((listVideo) => ({
      topNav: Number(getComputedStyle(document.querySelector('.topNav')).zIndex),
      tabBar: Number(getComputedStyle(document.querySelector('.tabBar.vertical')).zIndex),
      dropdown: Number(getComputedStyle(listVideo.querySelector('.iconDropdown')).zIndex),
      listVideo: getComputedStyle(listVideo).zIndex
    }))
    expect(stackingOrder.topNav).toBeGreaterThan(stackingOrder.dropdown)
    expect(stackingOrder.dropdown).toBeGreaterThan(stackingOrder.tabBar)
    expect(stackingOrder.listVideo).toBe('auto')

    await video.locator('.optionsButton').click()
    await video.locator('.addToPlaylistIcon .iconButton').click()
    const thumbnailDropdown = video.locator('.addToPlaylistIcon .iconDropdown')
    await expect(thumbnailDropdown).toBeVisible()
    // A mid-flight opacity fade on the icon would make it a stacking context and
    // trap the dropdown below the tab bar, so let the hover transition settle first
    await expect(video.locator('.addToPlaylistIcon')).toHaveCSS('opacity', '1')
    const dropdownCoversVerticalTabs = await thumbnailDropdown.evaluate((dropdown) => {
      // Stretch the (fixed, so reflow-free) tab bar over the dropdown instead of
      // moving the dropdown: its inline transform belongs to FtIconButton's
      // viewport keeping, which would overwrite ours on its next frame
      const tabBar = document.querySelector('.tabBar.vertical')
      const dropdownRect = dropdown.getBoundingClientRect()
      const previousInlineSize = tabBar.style.inlineSize
      tabBar.style.inlineSize = `${dropdownRect.left + dropdownRect.width / 2}px`

      try {
        const tabBarRect = tabBar.getBoundingClientRect()
        const overlapLeft = Math.max(tabBarRect.left, dropdownRect.left)
        const overlapRight = Math.min(tabBarRect.right, dropdownRect.right)
        if (overlapLeft >= overlapRight) {
          return false
        }

        const elementAtOverlap = document.elementFromPoint(
          overlapLeft + (overlapRight - overlapLeft) / 2,
          Math.max(tabBarRect.top, dropdownRect.top) + 10
        )
        return dropdown.contains(elementAtOverlap)
      } finally {
        tabBar.style.inlineSize = previousInlineSize
      }
    })
    expect(dropdownCoversVerticalTabs).toBe(true)
  })

  test('shows a filled playlist icon when the video is already in a playlist', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await expect(video.locator('.addToPlaylistIcon [data-prefix="fac"][data-icon="playlist-check"]')).toBeVisible()
  })

  test('add to playlist dropdown shows membership and toggles it', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const dropdown = video.locator('.addToPlaylistIcon .iconDropdown')
    const favoritesRow = dropdown.locator('.playlistRow', { hasText: 'Favorites' })
    const savedVideosRow = dropdown.locator('.playlistRow', { hasText: 'Saved videos' })

    // The video is seeded into "Saved videos" but not "Favorites"
    await expect(savedVideosRow.locator('[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
    await expect(favoritesRow.locator('[data-prefix="far"][data-icon="bookmark"]')).toBeVisible()
    await expect(favoritesRow.locator('.playlistThumbnail')).toBeVisible()

    // Clicking a row adds the video, keeps the dropdown open and names the playlist in the toast
    await favoritesRow.click()
    await expect(favoritesRow.locator('[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
    await expect(page.locator('.toast .message', { hasText: 'Video has been saved to Favorites' })).toBeVisible()

    // The toast shows the video's thumbnail, not just the message
    await expect(page.locator('.toast.hasImage .image')).toHaveAttribute('src', /eeeeeeeeeee/)
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.map((entry) => entry.videoId)
    }).toEqual(['eeeeeeeeeee'])

    // Playlist entries must not carry the attributes the store strips
    const saved = (await readPlaylist(app, 'favorites')).videos[0]
    expect(saved).not.toHaveProperty('description')
    expect(saved).not.toHaveProperty('viewCount')

    // Clicking it again removes the video
    await favoritesRow.click()
    await expect(favoritesRow.locator('[data-prefix="far"][data-icon="bookmark"]')).toBeVisible()
    await expect(page.locator('.toast .message', { hasText: 'Video has been removed from Favorites' })).toBeVisible()
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.length
    }).toBe(0)
  })

  test('rapidly clicking a playlist row does not add duplicate entries', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const favoritesRow = video.locator('.addToPlaylistIcon .iconDropdown .playlistRow', { hasText: 'Favorites' })

    // Two activations before the first write can commit must still only add one entry
    await favoritesRow.dblclick()

    await expect(favoritesRow.locator('[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.length
    }).toBe(1)
  })

  test('the dropdown and quick bookmark cannot both add the same video', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const favoritesRow = video.locator('.addToPlaylistIcon .iconDropdown .playlistRow', { hasText: 'Favorites' })
    await expect(favoritesRow).toBeVisible()

    // "Favorites" is also the quick bookmark target, so activating both controls
    // in the same tick races two adds against the same playlist
    await page.evaluate(() => {
      const listVideo = document.querySelector('.ft-list-video')
      const row = [...listVideo.querySelectorAll('.addToPlaylistIcon .iconDropdown .playlistRow')]
        .find((element) => element.textContent.includes('Favorites'))

      row.click()
      listVideo.querySelector('.quickBookmarkVideoIcon .iconButton').click()
    })

    await expect(video.locator('.quickBookmarkVideoIcon.bookmarked')).toBeVisible()
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.length
    }).toBe(1)
  })

  test('two windows adding the same video only store it once', async ({ app, page }) => {
    const [secondWindow] = await Promise.all([
      app.electronApp.waitForEvent('window'),
      page.locator('.topNav .navNewWindowButton').click()
    ])
    await waitForAppReady(secondWindow)

    // Issue the add both windows' playlist controls make, rather than clicking
    // them: a click is a toggle, so whichever window has already been told about
    // the other's write would remove the video instead of racing to add it.
    const addFromWindow = (window, playlistItemId) => window.evaluate(
      ([action, playlistItemId]) => window.ftElectron.dbPlaylists(action, {
        _id: 'favorites',
        lastUpdatedAt: Date.now(),
        videoData: {
          videoId: 'eeeeeeeeeee',
          playlistItemId,
          title: 'Bookmarkable video',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          lengthSeconds: 60,
          published: Date.now(),
          timeAdded: Date.now(),
          type: 'video'
        }
      }),
      [DBActions.PLAYLISTS.UPSERT_VIDEO, playlistItemId]
    )

    const written = await Promise.all([
      addFromWindow(page, 'from-first-window'),
      addFromWindow(secondWindow, 'from-second-window')
    ])

    // Exactly one of them wrote, and the other was told the video was already there
    expect(written.filter((result) => result === PlaylistVideoAddResult.ADDED)).toHaveLength(1)
    expect(written.filter((result) => result === PlaylistVideoAddResult.ALREADY_PRESENT)).toHaveLength(1)

    const favorites = await readPlaylist(app, 'favorites')
    expect(favorites.videos.map((entry) => entry.videoId)).toEqual(['eeeeeeeeeee'])
  })

  test('adding to a playlist that no longer exists is not reported as saved', async ({ page }) => {
    await goTo(page, 'history')

    // A write that changes nothing is ambiguous, so a deleted playlist has to be
    // told apart from the video already being there
    const result = await page.evaluate((action) => window.ftElectron.dbPlaylists(action, {
      _id: 'playlist-deleted-in-another-window',
      lastUpdatedAt: Date.now(),
      videoData: {
        videoId: 'eeeeeeeeeee',
        playlistItemId: 'orphaned',
        title: 'Bookmarkable video',
        author: 'Test Channel',
        authorId: 'UC-test-channel-id',
        lengthSeconds: 60,
        published: Date.now(),
        timeAdded: Date.now(),
        type: 'video'
      }
    }), DBActions.PLAYLISTS.UPSERT_VIDEO)

    expect(result).toBe(PlaylistVideoAddResult.PLAYLIST_MISSING)
  })

  test('creating a playlist from the dropdown puts the video in it', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()
    await video.locator('.addToPlaylistIcon .createRow').click()

    await page.locator('.playlistNameInput input').fill('Cool clips')
    await page.getByRole('button', { name: 'Create', exact: true }).click()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      const created = records.filter((record) => record.playlistName === 'Cool clips').at(-1)
      return created?.videos?.map((entry) => entry.videoId)
    }).toEqual(['eeeeeeeeeee'])
  })

  test('quick bookmark saves the video to the target playlist', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await expect(video.locator('.quickBookmarkVideoIcon [data-icon="clock"]')).toBeVisible()
    await video.locator('.quickBookmarkVideoIcon').click()

    // Once saved, the button keeps the configured icon and indicates state with color.
    await expect(video.locator('.quickBookmarkVideoIcon.bookmarked')).toBeVisible()
    await expect(video.locator('.quickBookmarkVideoIcon [data-icon="clock"]')).toBeVisible()
    await expect(video.locator('.quickBookmarkVideoIcon .overlayIcon')).toHaveCount(0)
    await expect(video.locator('.quickBookmarkVideoIcon .iconButton')).toHaveCSS('color', 'rgb(110, 170, 115)')
    await expect(page.locator('.toast .message', { hasText: 'Video has been saved to Favorites' })).toBeVisible()

    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.map((entry) => entry.videoId)
    }).toEqual(['eeeeeeeeeee'])
  })

  test('the options dropdown toggles watched status separately from removing history', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Mark As Watched' }).click()

    // The watched action changes independently and keeps the history entry.
    await video.hover()
    await video.locator('.optionsButton').click()
    await expect(page.getByRole('option', { name: 'Unmark As Watched' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Remove From History' })).toBeVisible()
    await page.getByRole('option', { name: 'Unmark As Watched' }).click()

    await expect(page.getByText('Bookmarkable video')).toBeVisible()
    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'eeeeeeeeeee').at(-1)?.isWatched
    }).toBe(false)

    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Remove From History' }).click()

    await expect(page.getByText('Bookmarkable video')).toBeHidden()
    await expect(page.getByText('Your history list is currently empty.')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'eeeeeeeeeee').at(-1)?.$$deleted
    }).toBe(true)
  })
})

test.describe('toast icons', () => {
  test.use({
    seed: {
      ...SEED,
      settings: { ...SEED.settings, thumbnailPreference: 'hidden' }
    }
  })

  test('falls back to an icon when the video has no thumbnail', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const favoritesRow = video.locator('.addToPlaylistIcon .iconDropdown .playlistRow', { hasText: 'Favorites' })
    await favoritesRow.click()

    await expect(page.locator('.toast .message', { hasText: 'Video has been saved to Favorites' })).toBeVisible()
    await expect(page.locator('.toast .image')).toBeHidden()
    await expect(page.locator('.toast .icon[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
  })

  test('shows a fitting icon on toasts that have no thumbnail at all', async ({ page }) => {
    await goTo(page, 'history')

    await page.getByRole('button', { name: 'Mark All As Watched' }).click()
    await page.getByRole('button', { name: 'Mark All As Watched', exact: true }).last().click()

    await expect(page.locator('.toast .message', { hasText: 'All videos in your history have been marked as watched' })).toBeVisible()
    await expect(page.locator('.toast .icon[data-prefix="fas"][data-icon="eye"]')).toBeVisible()
  })
})
