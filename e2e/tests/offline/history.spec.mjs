import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, sel, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const DAY = 86_400_000

function historyEntry(videoId, title, timeWatched, isWatched = false, extra = {}) {
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
    type: 'video',
    ...extra
  }
}

test.use({
  seed: {
    history: [
      historyEntry('aaaaaaaaaaa', 'First test video', now - 1000, true),
      historyEntry('bbbbbbbbbbb', 'Second test video', now - 2000),
      historyEntry('ccccccccccc', 'Active live stream', now - 3000, false, { isLive: true }),
      historyEntry('eeeeeeeeeee', 'Upcoming premiere', now - 4000, false, {
        isUpcoming: true,
        premiereTimestamp: Math.floor((now + 30 * DAY) / 1000)
      }),
      historyEntry('fffffffffff', 'Started premiere with stale flag', now - 5000, false, {
        isUpcoming: true,
        premiereTimestamp: Math.floor((now - DAY) / 1000)
      })
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

  test('the sort options row keeps a gap above the video grid', async ({ page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('First test video')).toBeVisible()

    const optionsRow = page.locator('.optionsRow')
    const firstVideo = page.locator('.ft-list-video, [class*="ft-list-video"]').first()
    await expect.poll(async () => {
      const [optionsBox, videoBox] = await Promise.all([
        optionsRow.boundingBox(),
        firstVideo.boundingBox()
      ])
      return videoBox.y - (optionsBox.y + optionsBox.height)
    }).toBeGreaterThanOrEqual(10)
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

  test('does not offer watched actions for an active live history entry', async ({ page }) => {
    await goTo(page, 'history')

    const activeLiveStream = page.locator('.ft-list-video').filter({ hasText: 'Active live stream' })
    await activeLiveStream.hover()
    await activeLiveStream.locator('.optionsButton').click()

    await expect(page.getByRole('option', { name: 'Mark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Unmark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Remove From History' })).toBeVisible()
  })

  test('does not offer watched actions for an upcoming premiere history entry', async ({ page }) => {
    await goTo(page, 'history')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere' })
    await upcomingPremiere.hover()
    await upcomingPremiere.locator('.optionsButton').click()

    await expect(page.getByRole('option', { name: 'Mark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Unmark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Remove From History' })).toBeVisible()
  })

  test('enables watched actions when a mounted premiere reaches its scheduled time', async ({ page }) => {
    await goTo(page, 'trending')
    await page.clock.install({ time: now })
    await goTo(page, 'history')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere' })
    await upcomingPremiere.hover()
    await upcomingPremiere.locator('.optionsButton').click()
    await expect(page.getByRole('option', { name: 'Mark As Watched' })).toHaveCount(0)

    // Split the jump so timers beyond Chromium's maximum timeout are rescheduled.
    await page.clock.fastForward(24 * DAY)
    await page.clock.fastForward(6 * DAY + 1000)

    await expect(page.getByRole('option', { name: 'Mark As Watched' })).toBeVisible()
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
      return latestRecords.every(record => {
        return record.isLive === true || record.isUpcoming === true || record.isWatched === true
      }) &&
        latestRecords.find(record => record.videoId === 'ccccccccccc')?.isWatched === false &&
        latestRecords.find(record => record.videoId === 'eeeeeeeeeee')?.isWatched === false &&
        latestRecords.find(record => record.videoId === 'fffffffffff')?.isWatched === true
    }).toBe(true)
  })
})

test.describe('watch history with an immediate watched threshold', () => {
  test.use({
    seed: {
      settings: { watchedPercentageThreshold: 0 },
      history: [
        historyEntry('ddddddddddd', 'Immediately watched video', Date.now(), true)
      ]
    }
  })

  test('removes a history entry when it is marked as unwatched', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').filter({ hasText: 'Immediately watched video' })
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Unmark As Watched' }).click()

    await expect(video).toHaveCount(0)
    await expect(page.getByText('Your history list is currently empty.')).toBeVisible()
    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      return records.filter(record => record._id === 'ddddddddddd').at(-1)?.$$deleted
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

  test('selects a history cutoff from the modal dropdown', async ({ page }) => {
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Delete Old History' }).click()

    const dialog = page.getByRole('dialog')
    const combobox = dialog.getByRole('combobox', { name: /Delete entries older than/i })
    await combobox.click()

    const dropdown = page.getByRole('listbox', { name: /Delete entries older than/i })
    await expect(dropdown).toBeVisible()
    await expect(dropdown.locator('xpath=..')).toHaveClass(/prompt/)
    await dropdown.getByRole('option', { name: '1 month' }).click()

    await expect(combobox).toContainText('1 month')
    await expect(dialog).toBeVisible()
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
