import { sel, setPlayerFullscreen, test, expect } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { measureFullscreenDockToggle } from '../../helpers/fullscreen-docks.mjs'
import { WATCH_PAGE_SEED, setWindowWidth } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

test('Android fullscreen host keeps watch cards behind the player', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  await page.evaluate(() => {
    document.body.classList.add('capacitorTabs')
    const host = document.querySelector('.videoLayout')
    host.addEventListener('click', event => {
      event.stopImmediatePropagation()
      host.requestFullscreen()
    }, { once: true, capture: true })
  })
  await page.locator('.videoLayout').click({ position: { x: 8, y: 8 } })
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('videoLayout'))).toBe(true)

  await expect.poll(() => page.evaluate(() => {
    const card = document.querySelector('.infoArea .watchVideoInfo')
    const bounds = card.getBoundingClientRect()
    const element = document.elementFromPoint(bounds.left + 100, bounds.top + 100)
    return Boolean(element?.closest('.ftVideoPlayer'))
  })).toBe(true)
})

const FULLSCREEN_PLAYLIST_ID = 'fullscreen-preview'

const FULLSCREEN_PLAYLIST = {
  _id: FULLSCREEN_PLAYLIST_ID,
  playlistName: 'Fullscreen preview',
  protected: false,
  description: '',
  videos: [{
    videoId: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    author: 'jawed',
    authorId: 'UC4QobU6STFB0P71PMvOGN5A',
    lengthSeconds: 19,
    playlistItemId: 'playlist-item-0',
    type: 'video'
  }, ...Array.from({ length: 29 }, (_, index) => ({
    videoId: `playlist${String(index + 1).padStart(3, '0')}`,
    title: `Playlist video ${index + 1}`,
    author: 'Playlist channel',
    authorId: 'UC-playlist-channel',
    lengthSeconds: 60,
    playlistItemId: `playlist-item-${index + 1}`,
    type: 'video'
  }))],
  createdAt: Date.now() - 86_400_000,
  lastUpdatedAt: Date.now() - 86_400_000
}

test.describe('watch page', () => {
  test('resets the Shorts auxiliary viewport when switching panels', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await openMockedVideo(page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.isShort = true
      watchView.videoDescription = Array(200).fill('Long Shorts metadata').join('\n')
      watchView.videoDescriptionHtml = ''
      watchView.shortsMetadataOpen = true
      watchView.isLoading = false
      await watchView.$nextTick()
    })

    const target = page.locator('.shortsAuxPanelTarget')
    await expect(page.locator('.shortsAuxPanel')).toHaveClass(/shortsAuxPanelOpen/)
    await expect.poll(() => target.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await watchComponent.evaluate(async (component) => {
      component.proxy.toggleTranscript()
      await component.proxy.$nextTick()
    })
    await expect(page.locator('.shortsAuxPanelTarget .watchVideoTranscript')).toBeVisible()
    await page.waitForTimeout(250)
    expect(await target.evaluate(element => element.scrollTop)).toBe(0)

    const transcript = page.locator('.shortsAuxPanelTarget .watchVideoTranscript')
    await transcript.evaluate(element => { element.style.blockSize = '200%' })
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await watchComponent.evaluate(async (component) => {
      component.proxy.closeTranscript()
      await component.proxy.$nextTick()
    })
    await expect(transcript).toHaveCount(0)
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBe(0)

    await watchComponent.evaluate(async (component) => {
      component.proxy.handleSponsorBlockInfoChange({
        open: true,
        loading: false,
        pendingUuid: null,
        segments: [],
        submissionEnabled: false
      })
      await component.proxy.$nextTick()
    })
    const sponsorBlock = page.locator('.shortsAuxPanelTarget .watchVideoSponsorBlock')
    await expect(sponsorBlock).toBeVisible()
    await sponsorBlock.evaluate(element => { element.style.blockSize = '200%' })
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await watchComponent.evaluate(async (component) => {
      component.proxy.handleSponsorBlockInfoChange({
        open: false,
        loading: false,
        pendingUuid: null,
        segments: [],
        submissionEnabled: false
      })
      await component.proxy.$nextTick()
    })
    await expect(sponsorBlock).toHaveCount(0)
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBe(0)

    await watchComponent.dispose()
  })

  test('shares the Shorts information dock with fullscreen and keeps its settings menu visible', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?short=true/)
    await waitForPlayback(page)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const moreOptions = player.getByRole('button', { name: 'More Options' })
    const overflowMenu = player.locator('.shaka-overflow-menu')
    const auxPanel = page.locator('.shortsAuxPanel')

    // Shorts hide their top controls while playing without pointer activity,
    // so reveal them like a user would instead of racing their fade-out.
    await player.hover()
    await moreOptions.click()
    await expect(overflowMenu.locator(':scope > button').first())
      .toHaveAccessibleName('Video information')
    await overflowMenu.getByRole('button', { name: 'Video information' }).click()
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await auxPanel.getByRole('button', { name: /Save channel setting/i }).click()
    const settingsMenu = page.locator('.app > .dropdownLayer > .iconDropdown.portal')
    await expect(settingsMenu).toBeVisible()
    await expect(settingsMenu).not.toHaveCSS('max-inline-size', 'none')
    expect(await settingsMenu.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      )
      return element.contains(hit)
    })).toBe(true)
    await page.keyboard.press('Escape')

    await setPlayerFullscreen(page, true)
    const fullscreenMetadata = player.locator('.fullscreenMetadataOverlay.open')
    await expect(fullscreenMetadata).toBeVisible()
    await expect(player).not.toHaveClass(/presentationModeChanging/)

    await expect(player.locator('.shaka-controls-container')).toHaveCSS('transition-property', 'none')

    expect(await player.evaluate(element => {
      return getComputedStyle(
        element.querySelector('.shaka-seek-bar-container')
      ).transitionProperty
    })).toBe('none')

    const initialSeekLeft = await player.locator('.shaka-seek-bar-container').evaluate(element => {
      return element.getBoundingClientRect().left
    })
    const closingMotion = await measureFullscreenDockToggle(watchComponent, false)
    expect(closingMotion.animationKeyframes).toHaveLength(2)
    expect(closingMotion.animationKeyframes[0].scale).not.toBe(closingMotion.animationKeyframes[1].scale)
    expect(closingMotion.widths.length).toBeLessThanOrEqual(2)
    expect(closingMotion.controlWidths.length).toBeLessThanOrEqual(2)
    await expect(fullscreenMetadata).toHaveCount(0)
    const fullscreenWidth = (await player.boundingBox()).width
    await expect.poll(async () => {
      return player.locator('.shaka-controls-container').evaluate(element => {
        return element.getBoundingClientRect().width
      })
    }).toBeCloseTo(fullscreenWidth, 0)
    const closedSeekLeft = await player.locator('.shaka-seek-bar-container').evaluate(element => {
      return element.getBoundingClientRect().left
    })
    expect(closedSeekLeft).toBeGreaterThan(initialSeekLeft)

    const reopeningMotion = await measureFullscreenDockToggle(watchComponent, true)
    await expect(fullscreenMetadata).toBeVisible()
    expect(reopeningMotion.animationKeyframes).toHaveLength(2)
    expect(reopeningMotion.animationKeyframes[0].scale).not.toBe(reopeningMotion.animationKeyframes[1].scale)
    expect(reopeningMotion.widths.length).toBeLessThanOrEqual(2)
    expect(reopeningMotion.controlWidths.length).toBeLessThanOrEqual(2)
    const reopenedControlsWidth = await player.locator('.shaka-controls-container').evaluate(element => {
      return element.getBoundingClientRect().width
    })
    expect(reopenedControlsWidth).toBeLessThan(fullscreenWidth)
    const reopenedSeekLeft = await player.locator('.shaka-seek-bar-container').evaluate(element => {
      return element.getBoundingClientRect().left
    })
    expect(reopenedSeekLeft).toBeLessThan(closedSeekLeft)

    await player.locator('.shortsFullscreenVideoSpace').hover({ force: true })
    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    await expect.poll(async () => {
      const [buttonBounds, menuBounds] = await Promise.all([
        moreOptions.boundingBox(),
        overflowMenu.boundingBox()
      ])
      return Math.max(
        Math.abs(buttonBounds.x + buttonBounds.width - menuBounds.x - menuBounds.width),
        Math.abs(buttonBounds.y + buttonBounds.height + 8 - menuBounds.y)
      )
    }).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(overflowMenu).toBeHidden()

    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(true)
    })
    const fullscreenTranscript = player.locator('.fullscreenTranscriptOverlay.open')
    await expect(fullscreenTranscript).toBeVisible()
    await fullscreenMetadata.locator('.fullscreenMetadataHeader').dblclick({
      position: { x: 30, y: 26 }
    })
    await expect.poll(async () => (await fullscreenMetadata.boundingBox()).height)
      .toBeLessThan(100)
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(false)
    })
    await expect(fullscreenTranscript).toHaveCount(0)
    await fullscreenMetadata.getByRole('button', { name: 'Close video information' }).click()
    await player.locator('.shortsFullscreenTitleButton').click()
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(true)
    })
    await expect.poll(async () => (await fullscreenMetadata.boundingBox()).height)
      .toBeGreaterThan(150)

    await setPlayerFullscreen(page, false)
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await auxPanel.getByRole('button', { name: 'Close video information' }).click()
    await expect(auxPanel).not.toHaveClass(/shortsAuxPanelOpen/)

    await setPlayerFullscreen(page, true)
    await player.locator('.shortsFullscreenVideoSpace').hover({ force: true })
    await moreOptions.click()
    await overflowMenu.getByRole('button', { name: 'Video information' }).click()
    await expect(player.locator('.fullscreenMetadataOverlay.open')).toBeVisible()

    // Cover reopening the menu after playback controls have auto-hidden.
    await page.mouse.move(0, 0)
    await expect(player.locator('.shortsTopControls')).toBeHidden()
    await player.locator('.shortsFullscreenVideoSpace').hover({ force: true })
    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    await setPlayerFullscreen(page, false)
    await expect(overflowMenu).toBeHidden()
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    await expect.poll(async () => {
      const [buttonBounds, menuBounds] = await Promise.all([
        moreOptions.boundingBox(),
        overflowMenu.boundingBox()
      ])
      return Math.max(
        Math.abs(buttonBounds.x + buttonBounds.width - menuBounds.x - menuBounds.width),
        Math.abs(buttonBounds.y + buttonBounds.height + 8 - menuBounds.y)
      )
    }).toBeLessThanOrEqual(1)

    await watchComponent.dispose()
  })

  test('fullscreen metadata uses one full-dock scrollbar', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.playerFullscreenTitleOverlay').click({ force: true })

    const metadata = page.locator('.fullscreenMetadataOverlay.open')
    const target = metadata.locator('.fullscreenMetadataTarget')
    await expect(metadata).toBeVisible()
    await expect(target).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(metadata.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect(metadata.locator('.descriptionScroll'))
      .not.toHaveAttribute('data-overlayscrollbars-viewport')

    await metadata.locator('.description').evaluate((element) => {
      element.textContent = Array.from(
        { length: 100 },
        (_, index) => `Long description line ${index + 1}`
      ).join('\n')
    })
    await expect.poll(() => target.evaluate(
      element => element.scrollHeight > element.clientHeight
    )).toBe(true)

    const scrollbar = target.locator(':scope > .os-scrollbar-vertical')
    const scrollbarBounds = await scrollbar.boundingBox()
    const targetBounds = await target.boundingBox()
    expect(Math.abs(scrollbarBounds.y - targetBounds.y)).toBeLessThanOrEqual(1)
    expect(
      Math.abs(
        targetBounds.y + targetBounds.height -
        scrollbarBounds.y - scrollbarBounds.height
      )
    ).toBeLessThanOrEqual(1)

    await target.evaluate(element => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 3
    })
    await expect.poll(() => target.evaluate(
      element => element.scrollTop
    )).toBeGreaterThan(0)
    const handle = scrollbar.locator('.os-scrollbar-handle')
    await handle.hover()
  })

  test('fullscreen metadata opens description links externally without toggling playback', async ({ app, page }) => {
    await app.electronApp.evaluate(({ shell }) => {
      globalThis.fullscreenExternalUrls = []
      shell.openExternal = async url => {
        globalThis.fullscreenExternalUrls.push(url)
      }
    })
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.evaluate(() => window.$store.dispatch('updateExternalLinkHandling', ''))
    const video = await waitForPlayback(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.playerFullscreenTitleOverlay').click({ force: true })

    const metadata = page.locator('.fullscreenMetadataOverlay.open')
    await expect(metadata).toBeVisible()
    await metadata.locator('.description').evaluate((element) => {
      element.insertAdjacentHTML('beforeend', '<a href="https://example.com/fullscreen-link">Fullscreen link</a>')
    })
    const paused = await video.evaluate(element => element.paused)

    // The dock stops clicks before they reach the document link handler
    await metadata.getByRole('link', { name: 'Fullscreen link', exact: true }).click()

    await expect.poll(() => app.electronApp.evaluate(() => globalThis.fullscreenExternalUrls))
      .toEqual(['https://example.com/fullscreen-link'])
    await expect(metadata).toBeVisible()
    expect(await video.evaluate(element => element.paused)).toBe(paused)
  })
})

test.describe('fullscreen captions', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        defaultCaptionSettings: JSON.stringify({ fontScale: 1.5 })
      }
    }
  })

  test('scales the caption containers with the player in fullscreen', async ({ app }) => {
    const { page } = app
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)

    const player = page.locator('.ftVideoPlayer')
    await player.evaluate(element => {
      for (const className of ['shaka-text-container', 'shaka-speech-to-text-container']) {
        if (element.querySelector(`.${className}`)) continue

        const captions = document.createElement('div')
        captions.className = className
        element.append(captions)
      }
    })

    const captionContainers = player.locator(
      '.shaka-text-container, .shaka-speech-to-text-container'
    )
    await expect(captionContainers).toHaveCount(2)
    const getFontSizes = () => captionContainers.evaluateAll(elements => {
      return elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize))
    })
    const getPlayerHeight = () => video.evaluate(element => element.clientHeight)
    // Shaka scales the cues by the configured size, the containers have the size it scales: 20px at a player height of 540px
    const expectShareOfPlayer = async () => {
      const [fontSizes, playerHeight] = await Promise.all([getFontSizes(), getPlayerHeight()])
      return fontSizes.map(fontSize => Math.abs(fontSize / playerHeight - 20 / 540) < 0.0005)
    }
    await expect.poll(expectShareOfPlayer).toEqual([true, true])
    const windowedFontSizes = await getFontSizes()

    // The player is only a couple of hundred pixels tall here, so the captions shrink down to their legible minimum.
    await setWindowWidth(app, 400)
    await expect.poll(getFontSizes).toEqual([10, 10])

    // Fullscreen grows the captions with the player.
    await setPlayerFullscreen(page, true)
    await expect.poll(expectShareOfPlayer).toEqual([true, true])
    for (const [index, fontSize] of (await getFontSizes()).entries()) {
      expect(fontSize).toBeGreaterThan(windowedFontSizes[index])
    }
  })
})

test.describe('fullscreen playlist dock', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        enableSubtitlesByDefault: true,
        uiRoundness: 200,
      },
      playlists: [FULLSCREEN_PLAYLIST],
      history: [{
        ...FULLSCREEN_PLAYLIST.videos[0],
        _id: 'jNQXAC9IVRw',
        watchProgress: 19,
        isWatched: true,
        timeWatched: Date.now(),
        isLive: false,
      }]
    }
  })

  async function openFullscreenPlaylistVideo(page) {
    await page.locator(sel.sideNavLink('userplaylists')).first().evaluate(element => element.click())
    await expect(page).toHaveURL(/#\/userplaylists/)
    await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.playlistName }).first().click()
    await expect(page).toHaveURL(new RegExp(`#\\/playlist\\/${FULLSCREEN_PLAYLIST_ID}`))
    await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.videos[0].title }).first().click()
    await expect(page).toHaveURL(
      new RegExp(`#\\/watch\\/jNQXAC9IVRw\\?.*playlistId=${FULLSCREEN_PLAYLIST_ID}`)
    )
  }

  test('keeps positioned captions centered across playlist videos', async ({ app, page }) => {
    test.setTimeout(120_000)
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'position:63% align:start' })
    // The seeded watch progress, plus any playback before opening the
    // playlist, resumes the first entry near the end of the 30 second demo
    // media. It could then end and advance the playlist while the test acts
    // on its player, so start it from the beginning instead.
    await page.evaluate(() => window.$store.dispatch('removeFromHistory', 'jNQXAC9IVRw'))
    await openFullscreenPlaylistVideo(page)
    await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer')
    const caption = player.locator('.shaka-text-container [translate="no"]')
    const expectCaptionCentered = async () => {
      await expect(caption).toBeVisible()
      await expect.poll(async () => {
        const [playerBounds, captionBounds] = await Promise.all([
          player.boundingBox(),
          caption.boundingBox(),
        ])
        if (!playerBounds || !captionBounds) return Number.POSITIVE_INFINITY

        return Math.abs(
          (playerBounds.x + playerBounds.width / 2) -
          (captionBounds.x + captionBounds.width / 2)
        )
      }).toBeLessThanOrEqual(1)
    }

    // The source cue must not override the configured anchor in the inline player either.
    await expectCaptionCentered()
    await setPlayerFullscreen(page, true)
    await expectCaptionCentered()

    for (let index = 1; index <= 9; index++) {
      const previousPlayer = await player.elementHandle()
      await player.locator('.shaka-controls-button-panel > .skip-next-button').click({ force: true })
      await expect(page).toHaveURL(new RegExp(
        `#\\/watch\\/playlist${String(index).padStart(3, '0')}\\?.*playlistId=${FULLSCREEN_PLAYLIST_ID}`
      ))
      // The previous video's player and caption stay mounted until the new
      // video replaces them. Checking or skipping before that would act on the
      // old player, so wait for the replacement.
      await expect.poll(() => previousPlayer.evaluate(element => element.isConnected)).toBe(false)
      await previousPlayer.dispose()
      await expectCaptionCentered()
    }
  })

  test('clamps the watch playlist after removing most entries', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page)
    await waitForPlayback(page)

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenPlaylistToggle').click()
    await expect(page.locator('.fullscreenPlaylistTarget .watchVideoPlaylist')).toBeVisible()

    const playlist = page.locator('.fullscreenPlaylistTarget .watchVideoPlaylist')
    const scroller = playlist.locator('.playlistItemsWrapper')
    const items = scroller.locator('.playlistItem')
    await expect(items).toHaveCount(FULLSCREEN_PLAYLIST.videos.length)
    // The dock may still be laying out its items, so keep scrolling until it can.
    await expect.poll(() => scroller.evaluate(element => {
      element.scrollTop = element.scrollHeight
      return element.scrollTop
    })).toBeGreaterThan(0)

    await page.evaluate(async ({ playlistId, playlistItemIds, videoIds }) => {
      const store = window.$store
      await store.dispatch('removeVideos', { _id: playlistId, playlistItemIds, videoIds })
    }, {
      playlistId: FULLSCREEN_PLAYLIST_ID,
      playlistItemIds: FULLSCREEN_PLAYLIST.videos.slice(4).map(video => video.playlistItemId),
      videoIds: FULLSCREEN_PLAYLIST.videos.slice(4).map(video => video.videoId)
    })
    await expect(items).toHaveCount(4)
    await page.waitForTimeout(250)
    expect(await scroller.evaluate(element => element.scrollTop)).toBe(0)
  })

  test('keeps compact watched labels and playlist menus clear of other controls', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page)

    const playlist = page.locator('.watchVideoPlaylist.resizablePlaylist')
    const item = playlist.locator('.playlistItem').first()
    const thumbnail = item.locator('.videoThumbnail')
    const watched = thumbnail.locator('.videoWatched')
    const actions = thumbnail.locator('.playlistIcons')
    await expect(playlist).toBeVisible()
    await thumbnail.hover()
    await expect(watched).toBeVisible()
    await expect(actions).toBeVisible()
    const duration = thumbnail.locator('.videoDuration')
    await expect(watched).toHaveCSS('font-size', '12px')
    await expect(watched).toHaveCSS('border-radius', '16px')
    await expect(duration).toHaveCSS('font-size', '12px')
    await expect(duration).toHaveCSS('border-radius', '16px')

    const [watchedBox, actionsBox] = await Promise.all([
      watched.boundingBox(),
      actions.boundingBox(),
    ])
    expect(
      watchedBox.x + watchedBox.width <= actionsBox.x ||
    actionsBox.x + actionsBox.width <= watchedBox.x ||
    watchedBox.y + watchedBox.height <= actionsBox.y ||
    actionsBox.y + actionsBox.height <= watchedBox.y
    ).toBe(true)

    const sponsorBlockLabel = thumbnail.locator('.sponsorBlockVideoLabel')
    await thumbnail.evaluate(element => {
      const watched = element.querySelector('.videoWatched')
      watched.style.display = 'none'
      watched.closest('.ft-list-item').classList.remove('watched')

      const label = element.querySelector('.videoDuration').cloneNode(false)
      label.className = 'sponsorBlockVideoLabel'
      const text = document.createElement('span')
      text.textContent = 'Self-Promotion'
      for (const attribute of label.getAttributeNames()) {
        if (attribute.startsWith('data-v-')) {
          text.setAttribute(attribute, '')
        }
      }
      label.append(text)
      element.append(label)
    })
    await expect(sponsorBlockLabel).toBeVisible()
    const [sponsorBlockBox, durationBox, currentActionsBox] = await Promise.all([
      sponsorBlockLabel.boundingBox(),
      duration.boundingBox(),
      actions.boundingBox(),
    ])
    expect(sponsorBlockBox.y).toBeGreaterThan(
      currentActionsBox.y + currentActionsBox.height
    )
    expect(sponsorBlockBox.x + sponsorBlockBox.width).toBeLessThanOrEqual(durationBox.x)

    // User playlist rows trade this button for one-tap removal, so use the queue's.
    await expect(item.locator('.addToPlaylistIcon')).toHaveCount(0)
    await page.evaluate(() => window.$store.commit('addVideoToWatchQueue', {
      video: { videoId: 'queued00001', title: 'Queued video', author: 'Queue channel', lengthSeconds: 60 }
    }))
    const queueItem = page.locator('.watchQueue .queueItem').first()
    await queueItem.locator('.videoThumbnail').hover()
    const addToPlaylist = queueItem.locator('.addToPlaylistIcon .iconButton')
    await addToPlaylist.click()
    const dropdown = page.locator('.app > .dropdownLayer > .iconDropdown.portal')
    await expect(dropdown).toBeVisible()
    const [buttonBox, dropdownBox] = await Promise.all([
      addToPlaylist.boundingBox(),
      dropdown.boundingBox(),
    ])
    expect(
      dropdownBox.y + dropdownBox.height <= buttonBox.y ||
      dropdownBox.y >= buttonBox.y + buttonBox.height
    ).toBe(true)
    expect(dropdownBox.x).toBeGreaterThanOrEqual(8)
    expect(dropdownBox.x + dropdownBox.width).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth - 8)
    )
    expect(await dropdown.evaluate(element => element.parentElement?.parentElement?.classList.contains('app'))).toBe(true)
    await expect(dropdown).toHaveCSS(
      'font-family',
      await page.locator('.app').evaluate(element => getComputedStyle(element).fontFamily)
    )
    expect(await dropdown.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      ))
    })).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dropdown).toHaveCount(0)

    await item.locator('.title').click({ button: 'right' })
    const contextMenu = page.locator('.contextMenu')
    await expect(contextMenu).toBeVisible()
    await expect(contextMenu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })).toBeVisible()
    const menuBounds = await contextMenu.boundingBox()
    expect(menuBounds.x).toBeGreaterThanOrEqual(8)
    expect(menuBounds.y).toBeGreaterThanOrEqual(8)
    // offsetWidth rounds while rendered bounds can retain fractional CSS pixels.
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth - 7))
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight - 7))
  })
})
