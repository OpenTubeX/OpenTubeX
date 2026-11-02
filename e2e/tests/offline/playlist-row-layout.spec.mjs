import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

const longTitle = 'Spider-Man Brand New Day Breakdown! Every Easter Egg and Detail You Missed in the Entire Timeline'
const fixtureTitles = [longTitle, 'Short title', 'A'.repeat(160)]

async function setThumbnailSize(page, size) {
  await page.locator('.profileTrigger').click()
  const slider = page.locator('.playlistThumbnailSizeSlider .input')
  await expect(slider).toBeVisible()
  await slider.press('Home')
  const step = Number(await slider.getAttribute('step'))
  for (let value = Number(await slider.getAttribute('min')); value < size; value += step) {
    await slider.press('ArrowRight')
  }
  await expect(slider).toHaveValue(String(size))
  await page.locator('.profileTrigger').click()
  await expect(slider).toBeHidden()
}

for (const [uiScale, userPlaylistSortOrder] of [[100, 'date_added_descending'], [125, 'date_added_descending'], [100, 'custom'], [125, 'custom']]) {
  test.describe(`playlist rows at ${uiScale}% UI scale with ${userPlaylistSortOrder} sorting`, () => {
    test.use({
      seed: {
        settings: { uiScale, userPlaylistSortOrder, playlistViewType: 'list', quickSettings: ['playlistThumbnailSize'], quickBookmarkTargetPlaylistId: 'bookmarks', extraThumbnailAction: 'copyYoutube', externalPlayer: 'mpv', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
        history: [{
          _id: 'layout00001',
          videoId: 'layout00001',
          title: fixtureTitles[1],
          author: 'Test channel',
          authorId: 'UC-test-channel-id',
          isWatched: true,
          watchProgress: 120,
          timeWatched: Date.now()
        }],
        playlists: [{
          _id: 'row-layout',
          playlistName: 'Playlist row layout',
          protected: false,
          videos: fixtureTitles.map((title, index) => ({
            videoId: `layout0000${index}`,
            title,
            author: 'A channel with a very long name that should not crowd the video title',
            authorId: 'UC-test-channel-id',
            lengthSeconds: 120,
            isUpcoming: index === 1,
            premiereTimestamp: index === 1 ? Math.floor(Date.now() / 1000) + 3600 : 0,
            viewCount: 12000,
            published: Date.now() - 86_400_000,
            playlistItemId: `layout-item-${index}`,
            type: 'video'
          })),
          lastUpdatedAt: Date.now()
        }, {
          _id: 'bookmarks',
          playlistName: 'Bookmarks',
          protected: false,
          videos: [],
          lastUpdatedAt: Date.now()
        }]
      }
    })

    test('keeps long titles and metadata balanced beside thumbnails', async ({ app, page, attachScreenshot }) => {
      await goTo(page, 'userplaylists')
      await page.getByRole('link', { name: 'Playlist row layout', exact: true }).click()
      const rows = page.locator('.playlistItem .ft-list-video')
      await expect(rows).toHaveCount(3)

      for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 900 }]) {
        await setWindowSize(app, page, size)
        for (const [index, row] of (await rows.all()).entries()) {
          const title = row.locator('.title')
          // Clamp only the visible text; retain the full accessible link name.
          await expect(title).toHaveAccessibleName(fixtureTitles[index])
          // Wait for every part of the row to reflow after a responsive layout change.
          await expect(async () => {
            const geometry = await row.evaluate(element => {
              const title = element.querySelector('.title')
              const thumbnail = element.querySelector('.videoThumbnail')
              const info = element.querySelector('.infoLine')
              const numberedRow = element.closest('.playlistItem').getBoundingClientRect()
              const grabBar = element.closest('.playlistItem').querySelector('.grabBar')
              const grabBarRect = grabBar?.getClientRects().length > 0 ? grabBar.getBoundingClientRect() : null
              const thumbnailRect = thumbnail.getBoundingClientRect()
              const thumbnailCenter = thumbnailRect.top + thumbnailRect.height / 2
              const badge = thumbnail.querySelector('.playlistIndexBadge').getBoundingClientRect()
              const watched = thumbnail.querySelector('.videoWatched')?.getBoundingClientRect()
              const contentCenter = (title.getBoundingClientRect().top + info.getBoundingClientRect().bottom) / 2
              const style = getComputedStyle(title)
              return {
                fontSize: parseFloat(style.fontSize),
                titleHeight: title.getBoundingClientRect().height,
                lineHeight: parseFloat(style.lineHeight),
                contentCenterDifference: Math.abs(contentCenter - thumbnailCenter),
                metadataFontSize: parseFloat(getComputedStyle(info).fontSize),
                overflow: Math.max(element.getBoundingClientRect().right, title.getBoundingClientRect().right, info.getBoundingClientRect().right) - document.documentElement.clientWidth,
                thumbnailRatio: thumbnail.getBoundingClientRect().width / thumbnail.getBoundingClientRect().height,
                indexAreaShown: element.closest('.playlistItem').querySelector('.videoIndexArea').getClientRects().length > 0,
                grabBarCenterDifference: grabBarRect ? Math.abs(grabBarRect.top + grabBarRect.height / 2 - thumbnailCenter) : null,
                badgeOffset: Math.max(Math.abs(badge.left - thumbnailRect.left - 4), Math.abs(badge.top - thumbnailRect.top - 4)),
                badgeClearsWatched: !watched || badge.right <= watched.left,
                rowCenterDifference: Math.abs(thumbnailCenter - numberedRow.top - numberedRow.height / 2)
              }
            })
            expect(geometry.fontSize).toBeLessThanOrEqual(16)
            expect(geometry.titleHeight).toBeLessThanOrEqual(geometry.lineHeight * 2 + 1)
            expect(geometry.contentCenterDifference).toBeLessThanOrEqual(1)
            expect(geometry.metadataFontSize).toBeLessThan(geometry.fontSize)
            expect(geometry.overflow).toBeLessThanOrEqual(1)
            expect(geometry.thumbnailRatio).toBeCloseTo(16 / 9, 1)
            // Without a reorder handle, the thumbnail takes the empty handle column.
            expect(geometry.indexAreaShown).toBe(userPlaylistSortOrder === 'custom')
            if (userPlaylistSortOrder === 'custom') expect(geometry.grabBarCenterDifference).toBeLessThanOrEqual(1)
            expect(geometry.badgeOffset).toBeLessThanOrEqual(1)
            expect(geometry.badgeClearsWatched).toBe(true)
            expect(geometry.rowCenterDifference).toBeLessThanOrEqual(1)
          }).toPass({ timeout: 15_000 })
        }
        await attachScreenshot(`playlist rows ${size.width}px`)
      }

      const thumbnail = rows.first().locator('.videoThumbnail')
      let previousWidth = 0
      for (const size of [60, 70, 80, 90, 100, 110, 120, 130]) {
        await setThumbnailSize(page, size)
        await expect.poll(async () => (await thumbnail.boundingBox()).width).toBeGreaterThan(previousWidth)
        previousWidth = (await thumbnail.boundingBox()).width
      }
    })

    if (userPlaylistSortOrder === 'custom') {
      test('keeps all thumbnail actions inside small thumbnails', async ({ app, page }) => {
        await goTo(page, 'userplaylists')
        await page.getByRole('link', { name: 'Playlist row layout', exact: true }).click()
        await setThumbnailSize(page, 60)
        const thumbnail = page.locator('.playlistItem .videoThumbnail').nth(1)
        await expect(thumbnail.locator('.videoWatched')).toBeVisible()
        // Reuse the scoped badge fixture pattern from the watch-playlist tests.
        await thumbnail.evaluate(element => {
          // Upcoming videos have no SponsorBlock segments, so show a regular duration.
          const duration = element.querySelector('.videoDuration')
          duration.classList.remove('upcoming')
          duration.textContent = '12:34'
          const label = duration.cloneNode(false)
          label.className = 'sponsorBlockVideoLabel'
          const text = document.createElement('span')
          text.textContent = 'Self-Promotion'
          label.append(element.querySelector('.ft-icon').cloneNode(true), text)
          element.append(label)
        })
        // A long localized Watched label must not cover the index badge.
        await thumbnail.locator('.videoWatched').evaluate(label => { label.textContent = 'Παρακολουθήθηκε' })
        const badges = thumbnail.locator('.playlistIndexBadge, .videoDuration, .videoWatched, .sponsorBlockVideoLabel')
        const sponsorBlockIconFits = () => thumbnail.locator('.sponsorBlockVideoLabel').evaluate(label => {
          const icon = label.querySelector('.ft-icon').getBoundingClientRect()
          const bounds = label.getBoundingClientRect()
          return icon.left >= bounds.left - 0.5 && icon.right <= bounds.right + 0.5
        })
        const visibleOverlays = () => thumbnail.evaluate(element => {
          const rects = [...element.querySelectorAll('.playlistIndexBadge, .videoDuration, .videoWatched, .sponsorBlockVideoLabel, .externalPlayerIcon')]
            .filter(overlay => overlay.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
            .map(overlay => overlay.getBoundingClientRect())
          return {
            count: rects.length,
            apart: rects.every((a, i) => rects.slice(i + 1).every(b =>
              a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5))
          }
        })
        await expect(badges).toHaveCount(4)
        const actions = thumbnail.locator('.playlistIcons')
        const buttons = actions.locator('button')
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
          for (const { width, height, mobile } of [
            { width: 1440, height: 950, mobile: false },
            { width: 1000, height: 850, mobile: false },
            { width: 812, height: 375, mobile: true },
            { width: 375, height: 812, mobile: true }
          ]) {
            await setWindowSize(app, page, { width, height })
            // Each label fits inside the 16:9 image instead of making the thumbnail taller.
            await expect.poll(() => thumbnail.evaluate(element => {
              const imageHeight = element.getBoundingClientRect().width * 9 / 16
              return Math.max(...[...element.querySelectorAll('.playlistIndexBadge, .videoDuration, .videoWatched, .sponsorBlockVideoLabel')]
                .map(badge => {
                  const style = getComputedStyle(badge)
                  return badge.getBoundingClientRect().height + Number.parseFloat(style.marginBlockStart) + Number.parseFloat(style.marginBlockEnd)
                })) - imageHeight
            })).toBeLessThanOrEqual(1)
            // The labels share the small thumbnail without covering each other. The external
            // player button only shows on hover here. The phone-sized thumbnail is narrower than the labels.
            if (width > 375) {
              await expect.poll(visibleOverlays).toEqual({ count: 4, apart: true })
            }
            if (mobile) {
              await expect(actions).toHaveClass(/mobileThumbnailActions/)
              await expect(actions).toBeHidden()
              continue
            }
            await page.locator('.sortSelect').hover()
            // Narrow thumbnails keep only the SponsorBlock icon.
            await expect(thumbnail.locator('.sponsorBlockVideoLabel .ft-icon')).toBeVisible()
            // The external player button only shows on hover, so the label keeps the corner.
            await expect.poll(() => thumbnail.evaluate(element => element.querySelector('.sponsorBlockVideoLabel').getBoundingClientRect().left -
              element.getBoundingClientRect().left)).toBeCloseTo(4, 0)
            // The label clips what does not fit beside its neighbors, but the icon always fits.
            await expect.poll(sponsorBlockIconFits).toBe(true)
            const sponsorBlockText = thumbnail.locator('.sponsorBlockVideoLabel > span:last-child')
            await expect.poll(() => sponsorBlockText.evaluate(text => text.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
            await expect(thumbnail.locator('.sponsorBlockVideoLabel')).toMatchAriaSnapshot('- text: Self-Promotion')
            for (const badge of await badges.all()) await expect(badge).toBeVisible()
            await expect(actions).toHaveCSS('opacity', '0')
            await thumbnail.hover()
            await expect(buttons).toHaveCount(7)
            for (const badge of await badges.all()) await expect(badge).toBeHidden()
            await expect(async () => {
              await thumbnail.hover()
              await expect(actions).toHaveCSS('opacity', '1')
              for (const badge of await badges.all()) await expect(badge).toBeHidden()
              const bounds = await thumbnail.boundingBox()
              for (const button of await buttons.all()) {
                await expect(button).toBeVisible()
                const action = await button.boundingBox()
                // Electron zoom can produce fractional CSS-pixel bounds.
                expect(action.width).toBeGreaterThanOrEqual(24 - 0.01)
                expect(action.height).toBeGreaterThanOrEqual(24 - 0.01)
                expect(action.x).toBeGreaterThanOrEqual(bounds.x - 1)
                expect(action.y).toBeGreaterThanOrEqual(bounds.y - 1)
                expect(action.x + action.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
                expect(action.y + action.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1)
                const externalPlayer = await thumbnail.locator('.externalPlayerIcon').boundingBox()
                const separateFromExternalPlayer = action.x + action.width <= externalPlayer.x + 1 ||
                  externalPlayer.x + externalPlayer.width <= action.x + 1 ||
                  action.y + action.height <= externalPlayer.y + 1 ||
                  externalPlayer.y + externalPlayer.height <= action.y + 1
                expect(separateFromExternalPlayer).toBe(true)
              }
            }).toPass({ timeout: 15_000 })
            await page.locator('.playlistItem .ft-list-video').nth(1).locator('.title').focus()
            await page.locator('.sortSelect').hover()
            await expect(actions).toHaveCSS('opacity', '1')
            for (const badge of await badges.all()) await expect(badge).toBeHidden()
            await page.locator('.profileTrigger').focus()
            for (const badge of await badges.all()) await expect(badge).toBeVisible()
          }
        }
        await setWindowSize(app, page, { width: 1440, height: 950 })
        await expect(actions).not.toHaveClass(/mobileThumbnailActions/)
        // Without hover, the external player button stays visible beside the labels.
        await page.locator('.profileTrigger').focus()
        const cdp = await page.context().newCDPSession(page)
        try {
          await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
          // The SponsorBlock icon also fits beside an hours-long duration.
          for (const duration of ['12:34', '1:23:45']) {
            await thumbnail.locator('.videoDuration').evaluate((element, text) => { element.textContent = text }, duration)
            await expect.poll(visibleOverlays).toEqual({ count: 5, apart: true })
            await expect.poll(sponsorBlockIconFits).toBe(true)
          }
          // Narrower thumbnails clip the label beside an hours-long duration instead of covering it.
          await thumbnail.locator('.videoDuration').evaluate(element => { element.textContent = '12:34' })
          await setWindowSize(app, page, { width: 812, height: 375 })
          await expect.poll(visibleOverlays).toEqual({ count: 5, apart: true })
          await expect.poll(sponsorBlockIconFits).toBe(true)
        } finally {
          await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
          await cdp.detach()
        }

        await setWindowSize(app, page, { width: 1440, height: 950 })
        // Non-user playlists can render this same toolbar with no enabled actions.
        await actions.evaluate(element => element.replaceChildren())
        // The external player button is then the only action, and it still replaces the labels.
        await thumbnail.hover()
        await expect(thumbnail.locator('.externalPlayerIcon')).toHaveCSS('opacity', '1')
        for (const badge of await badges.all()) await expect(badge).toBeHidden()
        // Without any thumbnail action, the labels stay.
        await thumbnail.locator('.externalPlayerIcon').evaluate(button => button.remove())
        await thumbnail.hover()
        for (const badge of await badges.all()) await expect(badge).toBeVisible()
        await page.locator('.playlistItem .ft-list-video').nth(1).locator('.title').focus()
        for (const badge of await badges.all()) await expect(badge).toBeVisible()
      })
    }
  })
}
