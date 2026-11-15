import { test, expect, goTo, goToSettingsSection, sel } from '../../helpers/app.mjs'
import { mockPlayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'
import { openPlayerOptions } from '../../helpers/player.mjs'

const musicModeSeed = {
  settings: {
    videoPlaybackEngine: 'built-in',
    ytDlpPlaybackEngineDefaultMigration: true,
    autoplayVideos: false,
    defaultPlayback: 2,
    quickSettings: ['musicMode', 'defaultPlayback', 'baseTheme'],
    playNextVideo: false,
    hideRecommendedVideos: false,
    autoUpdateChannelPlaybackSpeeds: false,
    useCustomShortsPlayer: true,
    baseTheme: 'system',
    systemDarkTheme: 'dark',
    systemLightTheme: 'light',
    mainColor: 'Red',
    secColor: 'Blue',
  },
  history: [watchHistoryEntry, { ...watchHistoryEntry, _id: 'musicvideo1', videoId: 'musicvideo1', timeWatched: watchHistoryEntry.timeWatched - 1000 }],
}

test.use({ seed: { ...musicModeSeed, settings: { ...musicModeSeed.settings, showMusicModeToggle: true } } })

const videoSelector = '.tabContent[aria-hidden="false"] .ftVideoPlayer video'

async function setMusicMode(page, enabled) {
  await page.evaluate(value => {
    const store = window.$store
    store.commit('setTabMusicMode', { tabId: store.getters.getActiveTabId, value })
  }, enabled)
}

async function expectPlayback(page, position, rate) {
  const video = page.locator(videoSelector)
  await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
  // Playing videos keep advancing, so on a slow machine a sampled currentTime
  // can already be past the expected position. Use where the played range
  // containing the current position began instead.
  await expect.poll(() => video.evaluate(element => {
    if (element.paused) return element.currentTime
    for (let index = element.played.length - 1; index >= 0; index--) {
      if (element.played.start(index) <= element.currentTime) return element.played.start(index)
    }
    return element.currentTime
  })).toBeCloseTo(position, 0)
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(rate)
  return video
}

test('player toggles music mode without rewinding or changing saved defaults', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.locator('a.title').filter({ hasText: watchHistoryEntry.title }).first().click()
  const video = await expectPlayback(page, 10, 2)
  const watch = await watchViewHandle(page)
  await watch.evaluate(view => view.$store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify({ [view.channelId]: 2.5 })))
  await page.locator('.ftVideoPlayer').hover()
  await openPlayerOptions(page)
  const button = page.locator('.music-mode-button')
  await expect(button).toHaveAccessibleName('Music Mode')
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expectPlayback(page, 10, 1)
  await expect(page.locator('.musicModeIndicator')).toBeVisible()
  await expect(page.locator('.profileTrigger')).toHaveAccessibleName('Quick settings — Music Mode')
  await page.locator('.shaka-playbackrate-button').click()
  await expect(button).toBeHidden()
  await page.locator('.shaka-playback-rates .shaka-back-to-overflow-button').click()
  await expect(button).toBeVisible()
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expectPlayback(page, 10, 2.5)
  await expect(page.locator('.musicModeIndicator')).toHaveCount(0)
  expect(await watch.evaluate(view => view.$store.getters.getDefaultPlayback)).toBe(2)
  expect(await watch.evaluate(view => JSON.parse(view.$store.getters.getChannelPlaybackSpeeds)[view.channelId])).toBe(2.5)
  await video.evaluate(element => { element.currentTime = 5 })
  await watch.evaluate(view => view.handleWatchProgressAutoSaveWhenProgressEnabled())
  await expect.poll(() => watch.evaluate(view => view.historyEntry.watchProgress)).toBeCloseTo(5, 0)
})

for (const source of ['queue end', 'recommendation']) {
  test(`music mode starts unclassified videos from ${source} at zero and 1x`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await setMusicMode(page, true)
    await goTo(page, 'history')
    await page.locator('a.title').filter({ hasText: watchHistoryEntry.title }).first().click()
    const video = await expectPlayback(page, 0, 1)
    const watch = await watchViewHandle(page)
    expect(await watch.evaluate(view => view.isMusicVideo)).toBe(false)
    if (source === 'queue end') {
      await watch.evaluate(view => view.$store.commit('addVideoToWatchQueue', {
        video: { videoId: 'musicvideo1', title: 'Music mode test video' },
      }))
      await video.evaluate(element => { element.currentTime = element.duration - 0.1; return element.play() })
    } else {
      await watch.evaluate(view => {
        view.recommendedVideos = [{ videoId: 'musicvideo1', title: 'Music mode test video', type: 'video' }]
      })
      await video.evaluate(element => { element.currentTime = element.duration - 0.1; return element.play() })
      await page.locator('.endedRecommendation').click()
    }
    await expect(page).toHaveURL(/#\/watch\/musicvideo1$/)
    await expectPlayback(page, 0, 1)
    const nextWatch = await watchViewHandle(page)
    await page.locator(videoSelector).evaluate(element => { element.currentTime = 5 })
    await nextWatch.evaluate(view => view.handleWatchProgressAutoSaveWhenProgressEnabled())
    await expect.poll(() => nextWatch.evaluate(view => view.historyEntry.watchProgress)).toBeCloseTo(5, 0)
  })
}

test('music mode stays with its tab and resets after restarting the app', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await setMusicMode(page, true)
  await goTo(page, 'history')
  await page.locator('a.title').filter({ hasText: watchHistoryEntry.title }).first().click()
  await expectPlayback(page, 0, 1)
  const musicTabId = await page.evaluate(() => window.$store.getters.getActiveTabId)
  await page.evaluate(() => window.ftElectron.tabs.create({ route: '/watch/musicvideo1' }))
  await expect(page).toHaveURL(/#\/watch\/musicvideo1$/)
  await expectPlayback(page, 10, 2)
  await expect(page.locator('.musicModeIndicator')).toHaveCount(0)
  await page.evaluate(tabId => window.ftElectron.tabs.activate(tabId), musicTabId)
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw$/)
  await expect(page.locator('.musicModeIndicator')).toBeVisible()
  const restarted = await app.relaunch()
  await expect(restarted.page.locator('.musicModeIndicator')).toHaveCount(0)
  expect(await restarted.page.evaluate(() => {
    const store = window.$store
    return store.getters.getTabMusicMode(store.getters.getActiveTabId)
  })).toBe(false)
})

async function openShort(page, id) {
  await page.locator(sel.searchInput).fill(`https://www.youtube.com/shorts/${id}`)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#/watch/${id}\\?short=true$`))
  await expect(page.locator('.ftVideoPlayer')).toHaveClass(/shortsPlayer/)
  // The URL changes before the watch view starts loading the Short, so the
  // previous Short's player can briefly match every playback check below.
  // Wait for this Short's metadata load, which also resets the channel.
  const watch = await watchViewHandle(page)
  await expect.poll(() => watch.evaluate((view, videoId) => (
    view.videoId === videoId && !view.isLoading && view.$refs.player?.hasLoaded === true
  ), id)).toBe(true)
  return expectPlayback(page, 0, 1)
}

test('music mode restarts a retained Short at zero and normal speed', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await setMusicMode(page, true)
  const firstVideo = await openShort(page, 'jNQXAC9IVRw')
  const retainedVideo = await firstVideo.elementHandle()
  const watch = await watchViewHandle(page)
  await page.locator('body').press('p')
  await page.locator('body').press('p')
  // Pause before seeking: a seek into an already played range would report
  // that range's start.
  await firstVideo.evaluate(element => {
    element.pause()
    element.currentTime = 5
  })
  await expectPlayback(page, 5, 1.5)
  await openShort(page, 'musicvideo1')
  await openShort(page, 'jNQXAC9IVRw')
  expect(await retainedVideo.evaluate(element => element === document.querySelector('.ftVideoPlayer video'))).toBe(true)
  expect(await watch.evaluate(view => view.currentPlaybackRate)).toBe(1)
})

test('inactive Shorts cannot overwrite the active channel speed when music mode changes', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await setMusicMode(page, true)
  await openShort(page, 'jNQXAC9IVRw')
  const watch = await watchViewHandle(page)
  await watch.evaluate(async view => {
    await view.$store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify({ first: 2.5, second: 3 }))
    view.channelId = 'first'
    await view.$nextTick()
  })
  await openShort(page, 'musicvideo1')
  await watch.evaluate(async view => {
    view.channelId = 'second'
    await view.$nextTick()
  })
  const video = await openShort(page, 'jNQXAC9IVRw')
  const position = await video.evaluate(element => {
    element.pause()
    return element.currentTime
  })
  await watch.evaluate(async view => {
    view.channelId = 'first'
    await view.$nextTick()
  })
  await setMusicMode(page, false)
  await expectPlayback(page, position, 2.5)
  await expect.poll(() => watch.evaluate(view => view.currentPlaybackRate)).toBe(2.5)
})

test.describe('music mode visibility setting', () => {
  test.use({ seed: musicModeSeed })

  test('hides the player toggle by default and saves the visibility preference', async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    await page.locator('.profileTrigger').click()
    await expect(page.locator('[data-setting-id="musicMode"]')).toHaveCount(0)
    await page.locator('.profileTrigger').click()
    const playback = await goToSettingsSection(page, 'playback')
    const visibility = playback.getByRole('checkbox', { name: /^Show Music Mode Toggle/ })
    await expect(visibility).not.toBeChecked()
    const help = visibility.locator('..').locator('.selectTooltip button')
    await help.focus()
    const explanation = page.getByRole('tooltip').filter({ hasText: 'Play videos at 1×' })
    await expect(explanation).toBeVisible()
    await expect(explanation).toContainText('Your saved playback defaults stay unchanged.')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveClass(/dark/)
    await testInfo.attach('music-mode-explanation-dark', {
      body: await explanation.screenshot(),
      contentType: 'image/png',
    })
    await visibility.focus()
    await expect(explanation).toBeHidden()
    await testInfo.attach('music-mode-visibility-setting', {
      body: await visibility.locator('..').screenshot(),
      contentType: 'image/png',
    })
    await visibility.locator('..').locator('label').click()
    await expect(visibility).toBeChecked()
    await page.locator('.settingsCloseButton').click()
    await setMusicMode(page, true)
    await goTo(page, 'history')
    await page.locator('a.title').filter({ hasText: watchHistoryEntry.title }).first().click()
    await expectPlayback(page, 0, 1)
    await page.locator('.ftVideoPlayer').hover()
    await openPlayerOptions(page)
    await expect(page.locator('.music-mode-button')).toBeVisible()
    const watch = await watchViewHandle(page)
    await watch.evaluate(view => view.$store.dispatch('updateShowMusicModeToggle', false))
    await expect(page.locator('.music-mode-button')).toHaveCount(0)
    await page.locator('.profileTrigger').click()
    await expect(page.locator('[data-setting-id="musicMode"]')).toHaveCount(0)
    expect(await watch.evaluate(view => view.$store.getters.getQuickSettings.includes('musicMode'))).toBe(false)
    await expect(page.locator('.musicModeIndicator')).toBeVisible()
    await expectPlayback(page, 0, 1)
    await watch.evaluate(view => view.$store.dispatch('updateShowMusicModeToggle', true))
    await expect(page.locator('[data-setting-id="musicMode"]')).toHaveCount(0)
    await page.locator('.profileTrigger').click()
    await page.locator('.ftVideoPlayer').hover()
    await openPlayerOptions(page)
    await expect(page.locator('.music-mode-button')).toBeVisible()
    await expect(page.locator('.music-mode-button')).toHaveAttribute('aria-pressed', 'true')
    const restarted = await app.relaunch()
    await restarted.page.locator('.profileTrigger').click()
    await expect(restarted.page.locator('[data-setting-id="musicMode"]')).toHaveCount(0)
    expect(await restarted.page.evaluate(() => window.$store.getters.getShowMusicModeToggle)).toBe(true)
    await expect(restarted.page.locator('.musicModeIndicator')).toHaveCount(0)
  })
})
