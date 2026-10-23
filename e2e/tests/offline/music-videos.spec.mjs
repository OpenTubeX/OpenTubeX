import { test, expect, goTo } from '../../helpers/app.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const timestamp = new Date().toISOString()
const videoSelector = '.tabContent[aria-hidden="false"] .ftVideoPlayer video'
const video = (videoId, title, isMusic) => ({
  type: 'video',
  videoId,
  title,
  author: 'Music creator',
  authorId: CHANNEL_ID,
  published: Date.now() - 3_600_000,
  viewCount: 1000,
  lengthSeconds: 225,
  isMusic
})

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      defaultPlayback: 2,
      autoplayVideos: false,
      playNextVideo: false,
      hideRecommendedVideos: false
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{ id: CHANNEL_ID, name: 'Music creator', thumbnail: '' }]
    }],
    subscriptionCache: [{
      _id: CHANNEL_ID,
      videos: [video('music000001', 'Music video', true), video('talk0000001', 'Talk video', false)],
      videosTimestamp: timestamp,
      shorts: [],
      shortsTimestamp: timestamp,
      liveStreams: [],
      liveStreamsTimestamp: timestamp,
      communityPosts: [],
      communityPostsTimestamp: timestamp
    }]
  }
})

async function expectPlaybackRate(page, rate) {
  const player = page.locator(videoSelector)
  await expect.poll(() => player.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
  await expect.poll(() => player.evaluate(element => element.playbackRate)).toBe(rate)
  return player
}

test('marks music videos with a labelled note in the duration badge', async ({ page }, testInfo) => {
  await goTo(page, 'subscriptions')

  const music = page.locator('.ft-list-video').filter({ hasText: 'Music video' })
  const talk = page.locator('.ft-list-video').filter({ hasText: 'Talk video' })
  await expect(music.locator('.videoDuration').getByRole('img', { name: 'Music video', exact: true })).toBeVisible()
  await expect(music.locator('.videoDuration')).toHaveText('3:45')
  await expect(talk.locator('.videoDuration')).toHaveText('3:45')
  await expect(talk.getByRole('img', { name: 'Music video', exact: true })).toHaveCount(0)
  await music.screenshot({ path: testInfo.outputPath('music-video-card.png') })
})

test('plays music videos opened from a list at normal speed', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await goTo(page, 'subscriptions')
  await page.locator('a.title').filter({ hasText: 'Talk video' }).click()
  await expect(page).toHaveURL(/#\/watch\/talk0000001(\?(?!.*musicVideo).*)?$/)
  await expectPlaybackRate(page, 2)

  await page.getByRole('button', { name: 'Expand side navigation', exact: true }).click()
  await goTo(page, 'subscriptions')
  await page.locator('a.title').filter({ hasText: 'Music video' }).click()
  await expect(page).toHaveURL(/#\/watch\/music000001\?.*musicVideo=true/)
  await expectPlaybackRate(page, 1)
  expect(await (await watchViewHandle(page)).evaluate(view => view.isMusicVideo)).toBe(true)
})

for (const source of ['queue', 'end screen']) {
  test(`plays music videos reached from the ${source} at normal speed`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await goTo(page, 'subscriptions')
    await page.locator('a.title').filter({ hasText: 'Talk video' }).click()
    const player = await expectPlaybackRate(page, 2)
    const watch = await watchViewHandle(page)
    const next = { videoId: 'music000002', title: 'Queued music video', type: 'video', isMusic: true }
    if (source === 'queue') {
      await watch.evaluate((view, video) => view.$store.commit('addVideoToWatchQueue', { video }), next)
    } else {
      await watch.evaluate((view, video) => { view.recommendedVideos = [video] }, next)
    }
    await player.evaluate(element => { element.currentTime = element.duration - 0.1; return element.play() })
    if (source === 'end screen') await page.locator('.endedRecommendation').click()

    await expect(page).toHaveURL(/#\/watch\/music000002\?musicVideo=true$/)
    await expectPlaybackRate(page, 1)
  })
}
