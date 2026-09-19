import { test, expect } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      rememberPlaybackSpeedPerChannel: true,
      rememberVideoQualityPerChannel: true,
      rememberSubtitlesStatePerChannel: true,
      rememberVolumePerChannel: true,
      autoUpdateChannelPlaybackSpeeds: false,
      autoUpdateChannelVideoQualities: false,
      autoUpdateChannelSubtitlesStates: false,
      autoUpdateChannelVolumes: false,
      useQuickPlaybackSpeedBar: false,
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue',
      currentLocale: 'en-US'
    }
  }
})

async function savedValues(page) {
  return page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return ['ChannelPlaybackSpeeds', 'ChannelVideoQualities', 'ChannelSubtitlesStates', 'ChannelVolumes']
      .map(key => JSON.parse(store.getters[`get${key}`]))
  })
}

test('removes each saved channel override from the watch popover without changing playback', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const view = await watchViewHandle(page)
  await view.evaluate(async view => {
    const overrides = [
      ['ChannelPlaybackSpeeds', 1],
      ['ChannelVideoQualities', '360'],
      ['ChannelSubtitlesStates', false],
      ['ChannelVolumes', 0]
    ]
    for (const [key, value] of overrides) {
      await view.$store.dispatch(`update${key}`, JSON.stringify({ [view.channelId]: value, other: value }))
    }
  })
  const video = page.locator(`${activeTab} .ftVideoPlayer video`)
  await video.evaluate(video => video.pause())
  const before = await video.evaluate(video => ({ speed: video.playbackRate, volume: video.volume }))
  await page.locator(`${activeTab} .watchVideoInfo`).getByRole('button', { name: 'Save channel setting…', exact: true }).click()
  const rows = page.locator('.channelSettingRow')
  await expect(rows).toHaveCount(4)
  await expect.poll(() => rows.first().locator('.channelSettingSave > span').last().evaluate(label => (
    label.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(label).fontSize)
  ))).toBeLessThan(2)
  for (let index = 0; index < 4; index++) {
    if (index > 0) {
      await page.locator(`${activeTab} .watchVideoInfo`).getByRole('button', { name: 'Save channel setting…', exact: true }).click()
    }
    await rows.nth(index).getByRole('button', { name: 'Forget this setting' }).click()
    await expect(rows.nth(index).getByRole('button', { name: 'Forget this setting' })).toHaveCount(0)
    await expect.poll(async () => Object.keys((await savedValues(page))[index])).toEqual(['other'])
  }
  expect(await video.evaluate(video => ({ speed: video.playbackRate, volume: video.volume }))).toEqual(before)
  await view.evaluate(async view => {
    for (const setting of ['VideoQuality', 'SubtitlesState', 'Volume']) {
      await view.$store.dispatch(`updateRemember${setting}PerChannel`, false)
    }
  })
  await page.locator(`${activeTab} .watchVideoInfo`).getByRole('button', { name: 'Save channel setting…', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await rows.first().locator('.channelSettingSave').press('Enter')
  await expect.poll(async () => Object.keys((await savedValues(page))[0]).length).toBe(2)
  if (!await rows.first().isVisible()) {
    await page.locator(`${activeTab} .watchVideoInfo`).getByRole('button', { name: 'Save channel setting…', exact: true }).click()
  }
  await expect(rows.first().getByRole('button', { name: 'Forget this setting' })).toBeVisible()
  await rows.first().getByRole('button', { name: 'Forget this setting' }).press('Enter')
  await expect.poll(async () => Object.keys((await savedValues(page))[0])).toEqual(['other'])
})

test('quick speed action saves, replaces and removes the channel speed through its button', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const view = await watchViewHandle(page)
  await view.evaluate(async view => {
    await view.$store.dispatch('updateUseQuickPlaybackSpeedBar', true)
    await view.$store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify({ other: 1.25 }))
  })
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const video = player.locator('video')
  await video.evaluate(video => video.pause())
  await player.hover()
  const action = player.locator('.ft-quick-playback-rate-save')
  await expect(action).toHaveText('Set Default')
  await action.click()
  await expect(action).toHaveText('Delete')
  await expect.poll(async () => Object.keys((await savedValues(page))[0]).length).toBe(2)
  await video.evaluate(video => { video.playbackRate = 1.5 })
  await expect(action).toHaveText('Set Default')
  await action.click()
  await expect(action).toHaveText('Delete')
  await action.click()
  await expect(action).toHaveText('Set Default')
  await expect.poll(async () => (await savedValues(page))[0]).toEqual({ other: 1.25 })
  expect(await video.evaluate(video => video.playbackRate)).toBe(1.5)
})
