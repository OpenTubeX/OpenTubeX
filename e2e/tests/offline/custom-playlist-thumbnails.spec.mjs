import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const playlistId = 'custom-thumbnail-playlist'
const imageFile = path.resolve('e2e/fixtures/images/opentubex-playlist.jpg')
const replacementFile = path.resolve('e2e/fixtures/media/avatar.png')
const picker = page => page.locator('.playlistThumbnailPicker')
const preview = page => picker(page).locator('img:not(.retryImagePlaceholder)')
const headerImage = page => page.locator('.playlistThumbnail img:not(.retryImagePlaceholder)')
const cardImage = page => page.locator('.ft-list-video', {
  has: page.getByRole('link', { name: 'Weekend walks', exact: true })
}).locator('img.thumbnailImage:not(.retryImagePlaceholder)')

async function routeThumbnails(page) {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.route('https://invidious.test/vi/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
}

async function openPlaylist(page) {
  await routeThumbnails(page)
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name: 'Weekend walks', exact: true }).click()
  await expect(page.locator('.playlistTitle')).toHaveText('Weekend walks')
}

async function setImage(page, file = imageFile) {
  await picker(page).locator('input[type="file"]').setInputFiles(file)
  await expect(preview(page)).toHaveAttribute('src', /^data:image\/webp;base64,/)
  await expect(picker(page)).toHaveAttribute('aria-busy', 'false')
  await expectImagesLoaded(preview(page))
  return await preview(page).getAttribute('src')
}

async function dispatch(page, action, payload) {
  await page.evaluate(({ action, payload }) => document.querySelector('#app').__vue_app__
    .config.globalProperties.$store.dispatch(action, payload), { action, payload })
}

test.use({
  seed: {
    settings: {
      playlistViewType: 'list',
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue',
    },
    playlists: [{
      _id: playlistId,
      playlistName: 'Weekend walks',
      description: 'Videos for a quiet weekend',
      protected: false,
      createdAt: 1700000000000,
      lastUpdatedAt: 1700000000000,
      videos: [{ videoId: 'ccccccccccc', playlistItemId: 'thumbnail-video', title: 'Mountain walk', author: 'Test channel', lengthSeconds: 120, type: 'video' }],
    }],
  },
})

test('selects, replaces and restores a thumbnail across restarts', async ({ app, page }) => {
  // This round trip includes two full Electron restarts, including startup checks.
  test.setTimeout(120_000)
  await openPlaylist(page)
  await page.getByTitle('Edit Playlist Info').click()
  const original = await setImage(page, {
    name: 'large.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1440"><rect width="2560" height="1440" fill="#246"/></svg>'),
  })
  expect(await preview(page).evaluate(image => [image.naturalWidth, image.naturalHeight]))
    .toEqual([1280, 720])
  await page.getByTitle('Save Changes').click()
  await expect(headerImage(page)).toHaveAttribute('src', original)

  // Full playlist exports retain the portable image, not a local path.
  await page.evaluate(() => {
    window.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async data => { window.__exportedPlaylist = data },
        close: async () => {},
      }),
    })
  })
  await page.getByTitle('Export This Playlist', { exact: true }).click()
  await page.getByRole('button', { name: 'Export OpenTubeX (.db)', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__exportedPlaylist || '{}').customThumbnail)).toBe(original)

  ;({ page } = await app.relaunch())
  await routeThumbnails(page)
  await goTo(page, 'userplaylists')
  await expect(cardImage(page)).toHaveAttribute('src', original)
  await page.getByRole('link', { name: 'Weekend walks', exact: true }).click()
  await expect(headerImage(page)).toHaveAttribute('src', original)
  await dispatch(page, 'updateBackendPreference', 'invidious')
  await dispatch(page, 'updateDefaultInvidiousInstance', 'https://invidious.test')
  await dispatch(page, 'updateThumbnailPreference', 'start')
  await expect(headerImage(page)).toHaveAttribute('src', original)
  await page.getByTitle('Edit Playlist Info').click()
  const replacement = await setImage(page, replacementFile)
  expect(replacement).not.toBe(original)
  await page.getByTitle('Save Changes').click()
  await expect(headerImage(page)).toHaveAttribute('src', replacement)
  await page.getByTitle('Edit Playlist Info').click()
  await picker(page).getByRole('button', { name: 'Restore default thumbnail' }).click()
  await expect(preview(page)).toHaveAttribute('src', /\/vi\/ccccccccccc\/mq1.jpg/)
  await page.getByTitle('Save Changes').click()
  await expect(headerImage(page)).toHaveAttribute('src', /\/vi\/ccccccccccc\/mq1.jpg/)

  ;({ page } = await app.relaunch())
  await routeThumbnails(page)
  await goTo(page, 'userplaylists')
  await expect(cardImage(page)).toHaveAttribute('src', /\/vi\/ccccccccccc\/maxresdefault.jpg/)
  const records = (await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')).trim().split('\n').map(JSON.parse)
  expect(records.filter(record => record._id === playlistId).at(-1).customThumbnail).toBe('')
})

test('cancelling edits and invalid images keep the saved thumbnail', async ({ page }) => {
  await openPlaylist(page)
  await page.getByTitle('Edit Playlist Info').click()
  const original = await setImage(page)
  await page.getByTitle('Save Changes').click()
  await page.getByTitle('Edit Playlist Info').click()
  await picker(page).locator('input[type="file"]').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })
  await expect(page.getByText('The selected image could not be loaded')).toBeVisible()
  await expect(preview(page)).toHaveAttribute('src', original)
  await picker(page).getByRole('button', { name: 'Restore default thumbnail' }).click()
  await page.getByTitle('Cancel', { exact: true }).click()
  await expect(headerImage(page)).toHaveAttribute('src', original)
  await page.getByTitle('Edit Playlist Info').click()
  await setImage(page, replacementFile)
  await page.getByTitle('Cancel', { exact: true }).click()
  await expect(headerImage(page)).toHaveAttribute('src', original)
})

test('disables saving while an image loads and discards a cancelled selection', async ({ page }) => {
  await openPlaylist(page)
  await page.getByTitle('Edit Playlist Info').click()
  await page.evaluate(() => {
    const decode = Image.prototype.decode
    Image.prototype.decode = function () {
      Image.prototype.decode = decode
      return new Promise(resolve => { window.__finishThumbnailDecode = () => decode.call(this).then(resolve) })
    }
  })
  await picker(page).locator('input[type="file"]').setInputFiles(imageFile)
  await expect(picker(page)).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByTitle('Save Changes')).toHaveAttribute('aria-disabled', 'true')
  await page.getByTitle('Cancel', { exact: true }).click()
  await page.getByTitle('Edit Playlist Info').click()
  await page.evaluate(() => window.__finishThumbnailDecode())
  await expect(preview(page)).toHaveAttribute('src', /\/vi\/ccccccccccc\//)
  await expect(page.getByTitle('Save Changes')).toHaveAttribute('aria-disabled', 'false')
})

test('a failed save keeps the selected image available for retry', async ({ page }) => {
  await openPlaylist(page)
  await page.getByTitle('Edit Playlist Info').click()
  const custom = await setImage(page)
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const dispatch = store.dispatch
    store.dispatch = (action, payload) => {
      if (action === 'updatePlaylist') {
        store.dispatch = dispatch
        return Promise.resolve(false)
      }
      return dispatch(action, payload)
    }
  })
  await page.getByTitle('Save Changes').click()
  await expect(page.getByText('There was an issue with updating this playlist.')).toBeVisible()
  await expect(preview(page)).toHaveAttribute('src', custom)
  // A hovered toast pauses its timeout; move away before retrying the covered button.
  await page.mouse.move(0, 0)
  await expect(page.getByText('There was an issue with updating this playlist.')).not.toBeVisible()
  await page.getByTitle('Save Changes').click()
  await expect(headerImage(page)).toHaveAttribute('src', custom)
})

test('playlist imports restore thumbnails for existing and new playlists', async ({ page }) => {
  await openPlaylist(page)
  await page.getByTitle('Edit Playlist Info').click()
  const custom = await setImage(page)
  await page.getByTitle('Save Changes').click()
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const playlist = store.getters.getPlaylist('custom-thumbnail-playlist')
    window.__thumbnailImport = JSON.stringify(playlist) + '\n' + JSON.stringify({ ...playlist, _id: 'imported-thumbnail', playlistName: 'Imported thumbnail' })
    window.showOpenFilePicker = async () => [{
      getFile: async () => new File([window.__thumbnailImport], 'playlists.db', { type: 'application/x-freetube-db' }),
    }]
  })
  await dispatch(page, 'updatePlaylist', { _id: playlistId, customThumbnail: '' })
  const dataSection = await goToSettingsSection(page, 'data')
  await dataSection.getByRole('button', { name: /^Import playlists$/i }).click()
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return ['custom-thumbnail-playlist', 'imported-thumbnail'].map(id => store.getters.getPlaylist(id)?.customThumbnail)
  })).toEqual([custom, custom])
  await goTo(page, 'userplaylists')
  await expect(cardImage(page)).toHaveAttribute('src', custom)
})

test('empty playlists show custom thumbnails and honor hidden and blurred preferences', async ({ page }) => {
  await dispatch(page, 'removeAllVideos', playlistId)
  await openPlaylist(page)
  await page.getByTitle('Edit Playlist Info').click()
  const custom = await setImage(page)
  await page.getByTitle('Save Changes').click()
  await expect(headerImage(page)).toHaveAttribute('src', custom)
  await dispatch(page, 'updateBlurThumbnails', true)
  await expect(headerImage(page)).toHaveClass(/blur/)
  await dispatch(page, 'updateThumbnailPreference', 'hidden')
  await expect(headerImage(page)).toHaveAttribute('src', /thumbnail_placeholder/)
  await goTo(page, 'userplaylists')
  await expect(cardImage(page)).toHaveAttribute('src', /thumbnail_placeholder/)
  await dispatch(page, 'updateThumbnailPreference', 'start')
  await expect(cardImage(page)).toHaveAttribute('src', custom)
  await expect(cardImage(page)).toHaveClass(/blur/)
  await dispatch(page, 'updateBlurThumbnails', false)
  await dispatch(page, 'updateThumbnailPreference', 'start')
  await expect(cardImage(page)).toHaveAttribute('src', custom)
  await dispatch(page, 'showAddToPlaylistPromptForManyVideos', {
    videos: [{ videoId: 'ddddddddddd', title: 'Another walk', lengthSeconds: 120, type: 'video' }],
  })
  const selectorImage = page.locator('.ft-playlist-selector', { hasText: 'Weekend walks' }).locator('img:not(.retryImagePlaceholder)')
  await expect(selectorImage).toHaveAttribute('src', custom)
  await dispatch(page, 'updateThumbnailPreference', 'hidden')
  await expect(selectorImage).toHaveAttribute('src', /thumbnail_placeholder/)
  await dispatch(page, 'updateThumbnailPreference', 'start')
  await dispatch(page, 'updateBlurThumbnails', true)
  await expect(selectorImage).toHaveAttribute('src', custom)
  await expect(selectorImage).toHaveCSS('filter', 'blur(20px)')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await dispatch(page, 'updateBlurThumbnails', false)
  await dispatch(page, 'updateThumbnailPreference', 'start')
  await page.getByRole('link', { name: 'Weekend walks', exact: true }).click()
  await page.getByTitle('Edit Playlist Info').click()
  await picker(page).getByRole('button', { name: 'Restore default thumbnail' }).click()
  await page.getByTitle('Save Changes').click()
  await expect(headerImage(page)).toHaveAttribute('src', /thumbnail_placeholder/)
})

for (const uiScale of [100, 125]) {
  test(`thumbnail controls fit list and grid layouts at ${uiScale}% scale`, async ({ app, page }, testInfo) => {
    await dispatch(page, 'updateUiScale', uiScale)
    await openPlaylist(page)
    await page.getByTitle('Edit Playlist Info').click()
    await setImage(page)
    for (const view of ['list', 'grid']) {
      await dispatch(page, 'updatePlaylistViewType', view)
      for (const width of [1440, 700, 375]) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setMinimumSize(0, 0)
          window.setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
        }, { width, uiScale })
        await expect.poll(() => page.evaluate(width => Math.abs(innerWidth - width), width)).toBeLessThanOrEqual(1)
        await expect(preview(page)).toBeVisible()
        await picker(page).getByRole('button', { name: 'Restore default thumbnail' }).scrollIntoViewIfNeeded()
        const overflow = await picker(page).evaluate(element => {
          const bounds = element.getBoundingClientRect()
          return { left: bounds.left, right: bounds.right, width: innerWidth, overflow: element.scrollWidth - element.clientWidth }
        })
        expect(overflow.left).toBeGreaterThanOrEqual(0)
        expect(overflow.right).toBeLessThanOrEqual(overflow.width)
        expect(overflow.overflow).toBeLessThanOrEqual(1)
        await page.getByTitle('Save Changes').scrollIntoViewIfNeeded()
        await expect(page.getByTitle('Save Changes')).toBeInViewport()
      }
    }
    if (uiScale === 100) {
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
        await expectImagesLoaded(preview(page))
        await picker(page).screenshot({ path: testInfo.outputPath(`playlist-thumbnail-${colorScheme}.png`) })
      }
    }
    await page.getByTitle('Save Changes').click()
    await expect(picker(page)).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => {
      const root = document.documentElement
      return root.scrollHeight - root.clientHeight
    })).toBeLessThanOrEqual(1)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await expect(page.locator('body > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
  })
}
