import { test, expect, goTo, goToSettingsSection, sel } from '../../helpers/app.mjs'
import { mockPlayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'

const musicModeSeed = {
  settings: {
    videoPlaybackEngine: 'built-in',
    ytDlpPlaybackEngineDefaultMigration: true,
    autoplayVideos: false,
    defaultPlayback: 2,
    quickSettings: ['musicMode', 'defaultPlayback', 'baseTheme'],
    playNextVideo: false,
    hideRecommendedVideos: false,
    rememberPlaybackSpeedPerChannel: true,
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setTabMusicMode', { tabId: store.getters.getActiveTabId, value })
  }, enabled)
}

async function expectPlayback(page, position, rate) {
  const video = page.locator(videoSelector)
  await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(position, 0)
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
  await page.locator('.shaka-overflow-menu-button').click()
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

for (const source of ['queue click', 'queue end', 'recommendation', 'manual']) {
  test(`music mode starts unclassified videos from ${source} at zero and 1x`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await setMusicMode(page, true)
    await goTo(page, 'history')
    await page.locator('a.title').filter({ hasText: watchHistoryEntry.title }).first().click()
    const video = await expectPlayback(page, 0, 1)
    const watch = await watchViewHandle(page)
    expect(await watch.evaluate(view => view.videoGenreIsMusic)).toBe(false)
    if (source.startsWith('queue')) {
      await watch.evaluate(view => view.$store.commit('addVideoToWatchQueue', {
        video: { videoId: 'musicvideo1', title: 'Music mode test video' },
      }))
      if (source === 'queue click') await page.locator('.queueVideo').click()
      else await video.evaluate(element => { element.currentTime = element.duration - 0.1; return element.play() })
    } else if (source === 'recommendation') {
      await watch.evaluate(view => {
        view.recommendedVideos = [{ videoId: 'musicvideo1', title: 'Music mode test video', type: 'video' }]
      })
      await video.evaluate(element => { element.currentTime = element.duration - 0.1; return element.play() })
      await page.locator('.endedRecommendation').click()
    } else {
      await page.getByRole('button', { name: 'Expand side navigation', exact: true }).click()
      await goTo(page, 'history')
      await page.locator('a.title[href="#/watch/musicvideo1"]').click()
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
  const musicTabId = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveTabId)
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getTabMusicMode(store.getters.getActiveTabId)
  })).toBe(false)
})

async function openShort(page, id) {
  await page.locator(sel.searchInput).fill(`https://www.youtube.com/shorts/${id}`)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#/watch/${id}\\?short=true$`))
  await expect(page.locator('.ftVideoPlayer')).toHaveClass(/shortsPlayer/)
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
  await firstVideo.evaluate(element => { element.currentTime = 5 })
  await expectPlayback(page, 5, 1.5)
  await firstVideo.evaluate(element => element.pause())
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

test('excludes music mode from saved Quick Settings and the customizer', async ({ page, attachScreenshot }) => {
  await page.locator('.profileTrigger').click()
  const menu = page.locator('.quickSettingsMenu')
  await expect(menu.locator('.quickSettingControl')).toHaveCount(2)
  await expect(menu.getByRole('checkbox', { name: /^Music Mode/ })).toHaveCount(0)
  await expect(menu.locator('[data-setting-id="defaultPlayback"]')).toBeVisible()
  await attachScreenshot('quick-settings-menu-without-music-mode')
  await page.locator('.profileTrigger').click()
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Customize quick settings' }).click()
  await expect(page.getByRole('button', { name: 'Remove Music Mode', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add setting' }).click()
  const search = page.getByLabel('Search settings')
  await search.fill('Music Mode')
  await expect(page.locator('.settingPicker .optionWrapper')).toHaveCount(0)
  await attachScreenshot('quick-settings-without-music-mode')
  await search.fill('Autoplay')
  await expect(page.locator('.settingPicker .optionWrapper')).not.toHaveCount(0)
})

test('music mode headphones have a translucent circular background in both icon packs and themes', async ({ page }, testInfo) => {
  await setMusicMode(page, true)
  for (const iconPack of ['material', 'remix']) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', value), iconPack)
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
      const indicator = page.locator('.musicModeIndicator')
      await expect(indicator).toBeVisible()
      await expect(indicator).toHaveCSS('background-color', /\/ 0\.4\)$/)
      await expect(indicator).toHaveCSS('border-radius', '50%')
      await expect(indicator).toHaveCSS('opacity', '1')
      const bounds = await page.locator('.profileTrigger').boundingBox()
      await testInfo.attach(`music-mode-${iconPack}-${colorScheme}`, {
        body: await page.screenshot({ clip: { x: bounds.x - 12, y: bounds.y - 8, width: bounds.width + 24, height: bounds.height + 20 } }),
        contentType: 'image/png',
      })
    }
  }
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
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
      await testInfo.attach(`music-mode-explanation-${colorScheme}`, {
        body: await explanation.screenshot(),
        contentType: 'image/png',
      })
    }
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
    await page.locator('.shaka-overflow-menu-button').click()
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
    await page.locator('.shaka-overflow-menu-button').click()
    await expect(page.locator('.music-mode-button')).toBeVisible()
    await expect(page.locator('.music-mode-button')).toHaveAttribute('aria-pressed', 'true')
    const restarted = await app.relaunch()
    await restarted.page.locator('.profileTrigger').click()
    await expect(restarted.page.locator('[data-setting-id="musicMode"]')).toHaveCount(0)
    expect(await restarted.page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getShowMusicModeToggle)).toBe(true)
    await expect(restarted.page.locator('.musicModeIndicator')).toHaveCount(0)
  })
})
