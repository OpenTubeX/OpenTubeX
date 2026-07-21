import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, sel, goTo } from '../../helpers/app.mjs'

function historyEntry(videoId, title, timeWatched, isWatched = false) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    published: Date.now() - 86_400_000,
    description: 'Test description',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 10,
    isWatched,
    timeWatched,
    isLive: false,
    type: 'video'
  }
}

test.use({
  seed: {
    history: [
      historyEntry('aaaaaaaaaaa', 'First test video', Date.now() - 1000, true),
      historyEntry('bbbbbbbbbbb', 'Second test video', Date.now() - 2000)
    ]
  }
})

test.describe('watch history', () => {
  test('shows seeded entries, newest first', async ({ page }) => {
    await goTo(page, 'history')

    await expect(page.getByText('First test video')).toBeVisible()
    await expect(page.getByText('Second test video')).toBeVisible()

    const titles = page.locator('.ft-list-video .title, [class*="videoTitle"]')
    await expect(titles.first()).toContainText('First test video')
  })

  test('history search filters entries', async ({ page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('First test video')).toBeVisible()

    const filterInput = page.locator('.ft-input-component input').last()
    await filterInput.fill('Second')

    await expect(page.getByText('Second test video')).toBeVisible()
    await expect(page.getByText('First test video')).toBeHidden()
  })

  test('always shows watched indicators', async ({ page }) => {
    await goTo(page, 'history')

    const watchedIndicator = page.locator('.videoWatched')
    await expect(page.getByRole('checkbox', { name: 'Show Watched Indicators' })).toHaveCount(0)
    await expect(watchedIndicator).toHaveText('Watched')
  })

  test('keeps an existing entry in place when toggling watched status', async ({ page }) => {
    await goTo(page, 'history')

    const videos = page.locator('.ft-list-video')
    const secondVideo = videos.filter({ hasText: 'Second test video' })

    await secondVideo.hover()
    await secondVideo.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Mark As Watched' }).click()

    await expect(videos.nth(0)).toContainText('First test video')
    await expect(videos.nth(1)).toContainText('Second test video')

    await secondVideo.hover()
    await secondVideo.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Unmark As Watched' }).click()

    await expect(videos.nth(0)).toContainText('First test video')
    await expect(videos.nth(1)).toContainText('Second test video')
  })

  test('marks every history entry as watched', async ({ app, page }) => {
    await goTo(page, 'history')

    const markAllButton = page.getByRole('button', { name: 'Mark All As Watched' })
    await expect(markAllButton).not.toBeDisabled()
    await markAllButton.click()

    const prompt = page.getByRole('dialog', {
      name: 'Are you sure you want to mark all videos in your history as watched?'
    })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'Mark All As Watched' }).click()

    await expect(markAllButton).toBeDisabled()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      const latestRecords = Object.values(Object.fromEntries(
        records.filter(record => record.videoId).map(record => [record.videoId, record])
      ))
      return latestRecords.every(record => record.isWatched === true)
    }).toBe(true)
  })
})

test.describe('history cleanup', () => {
  test.use({
    seed: {
      history: [
        historyEntry('rrrrrrrrrrr', 'Recent video', Date.now() - 1000),
        historyEntry('ooooooooooo', 'Old video', Date.now() - 100 * 86_400_000)
      ]
    }
  })

  test('deletes only entries older than the selected cutoff', async ({ app, page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Recent video')).toBeVisible()
    await expect(page.getByText('Old video')).toBeVisible()

    await page.getByRole('button', { name: 'Delete Old History' }).click()
    await page.locator('.cleanupPromptContent select').selectOption('30')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('Old video')).toBeHidden()
    await expect(page.getByText('Recent video')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'ooooooooooo').at(-1)?.$$deleted
    }).toBe(true)
  })
})

test.describe('legacy watch history', () => {
  const timeWatched = Date.now() - 1000

  test.use({
    seed: {
      history: [
        {
          _id: 'legacyvideo',
          videoId: 'legacyvideo',
          title: 'Legacy imported video',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          published: timeWatched,
          description: '',
          viewCount: 1234,
          lengthSeconds: 100,
          watchProgress: 0.95,
          timeWatched,
          isLive: false,
          type: 'video'
        }
      ]
    }
  })

  test('migrates fractional progress and watched status on load', async ({ app, page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Legacy imported video')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.find((record) => record._id === 'legacyvideo')
    }).toMatchObject({ watchProgress: 95, isWatched: true, isLive: false })
  })
})
