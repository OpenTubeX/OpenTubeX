import { test, expect, goTo, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'
import { mockPlayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'

test.use({
  seed: {
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
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue',
    },
    history: [watchHistoryEntry, { ...watchHistoryEntry, _id: 'musicvideo1', videoId: 'musicvideo1', timeWatched: watchHistoryEntry.timeWatched - 1000 }],
  },
})

const videoSelector = '.tabContent[aria-hidden="false"] .ftVideoPlayer video'

async function setMusicMode(page, enabled) {
  await page.locator('.profileTrigger').click()
  const checkbox = page.locator('.quickSettingsMenu').getByRole('checkbox', { name: /^Music Mode/ })
  if (await checkbox.isChecked() !== enabled) await checkbox.locator('..').locator('label').click()
  await expect(checkbox).toBeChecked({ checked: enabled })
  await checkbox.press('Escape')
  await expect(page.locator('.quickSettingsMenu')).toBeHidden()
}

async function expectPlayback(page, position, rate) {
  const video = page.locator(videoSelector)
  await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(position, 0)
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(rate)
  return video
}

test('player and Quick Settings toggle music mode without rewinding or changing saved defaults', async ({ app, page }) => {
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
  await page.locator('.profileTrigger').click()
  const checkbox = page.locator('.quickSettingsMenu').getByRole('checkbox', { name: /^Music Mode/ })
  await expect(checkbox).toBeChecked()
  await checkbox.focus()
  await checkbox.press('Space')
  await expect(checkbox).not.toBeChecked()
  await page.locator('.profileTrigger').click()
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
  await restarted.page.locator('.profileTrigger').click()
  await expect(restarted.page.locator('.quickSettingsMenu').getByRole('checkbox', { name: /^Music Mode/ })).not.toBeChecked()
})

test('music mode remains accessible in narrow Quick Settings', async ({ app, page }) => {
  for (const { width, height, scale } of [{ width: 375, height: 850, scale: 100 }, { width: 850, height: 480, scale: 125 }]) {
    await setWindowSize(app, page, { width, height })
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), scale)
    await page.locator('.profileTrigger').click()
    const section = page.locator('[data-setting-id="musicMode"]')
    await expect(section).toBeVisible()
    expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const help = section.locator('.selectTooltip button')
    await help.focus()
    const explanation = page.getByRole('tooltip').filter({ hasText: 'Play videos at 1×' })
    await expect(explanation).toBeVisible()
    expect(await explanation.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= window.innerWidth
    })).toBe(true)
    const checkbox = section.getByRole('checkbox', { name: /^Music Mode/ })
    await checkbox.focus()
    await expect(explanation).toBeHidden()
    await checkbox.press('Space')
    await expect(checkbox).toBeChecked()
    await checkbox.press('Space')
    await expect(checkbox).not.toBeChecked()
    await checkbox.press('Escape')
    await expect(page.locator('.quickSettingsMenu')).toBeHidden()
  }
})

test('adds and removes music mode through the Quick Settings customizer', async ({ page }) => {
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Customize quick settings' }).click()
  await page.getByRole('button', { name: 'Remove Music Mode', exact: true }).click()
  await page.getByRole('button', { name: 'Add setting' }).click()
  const search = page.getByLabel('Search settings')
  await search.fill('Music Mode')
  await page.locator('.settingPicker .optionWrapper').getByText('Music Mode', { exact: true }).click()
  await search.press('Escape')
  await page.locator('.settingsCloseButton').click()
  await setMusicMode(page, true)
  await expect(page.locator('.musicModeIndicator')).toBeVisible()
})
