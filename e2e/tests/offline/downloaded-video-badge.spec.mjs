import path from 'node:path'

import { test, expect, goTo, repoRoot } from '../../helpers/app.mjs'

const mediaPath = path.join(repoRoot, 'e2e/fixtures/media/demo.webm')
const historyEntry = (videoId, title, timeWatched) => ({
  _id: videoId,
  videoId,
  title,
  author: 'Test Channel',
  authorId: 'UC0000000000000000000000',
  published: 1700000000000,
  timeWatched,
  description: '',
  viewCount: 1234,
  lengthSeconds: 60,
  watchProgress: 0,
  isWatched: false,
  isLive: false,
  type: 'video'
})

test.use({
  seed: {
    settings: { landingPage: 'history', enableDownloads: true },
    history: [historyEntry('offline0001', 'Downloaded video', 1700000002000), historyEntry('online00001', 'Online video', 1700000001000)],
    downloads: [{
      id: 1,
      videoId: 'offline0001',
      title: 'Downloaded video',
      status: 'completed',
      mode: 'video',
      percent: 100,
      destination: mediaPath,
      destinations: [mediaPath],
      files: [{ videoId: 'offline0001', path: mediaPath, extension: 'webm' }],
    }],
  },
})

test('marks downloaded videos and plays their local file when opened', async ({ page }) => {
  await goTo(page, 'history')
  const downloaded = page.locator('.ft-list-video').filter({ hasText: 'Downloaded video' })
  const online = page.locator('.ft-list-video').filter({ hasText: 'Online video' })
  await expect(downloaded.locator('.videoDuration').getByRole('img', { name: 'Downloaded', exact: true })).toBeVisible()
  await expect(downloaded.locator('.videoDuration')).toHaveText('1:00')
  await expect(online.locator('.videoDuration')).toHaveText('1:00')
  await expect(online.getByRole('img', { name: 'Downloaded', exact: true })).toHaveCount(0)

  await downloaded.locator('.thumbnailLink').click()
  await expect(page).toHaveURL(/#\/watch\/offline0001\?downloadId=1$/)
  const video = page.locator('video').first()
  await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
  await expect.poll(() => video.evaluate(element => element.currentSrc)).toMatch(/^downloadmedia:\/\/file\/1\/offline0001/)
})
