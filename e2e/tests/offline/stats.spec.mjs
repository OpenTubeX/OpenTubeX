import { test, expect, goTo } from '../../helpers/app.mjs'

/**
 * @param {Date} date
 */
function toDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

const today = toDateKey(new Date())
const yesterday = toDateKey(new Date(Date.now() - 86_400_000))

// Marks the history migration as already completed so the seeded totals
// stay exact and no historical-estimate prompt appears.
const migrationDone = {
  _id: 'history-watch-time-v1',
  completedAt: Date.now(),
  hadEstimates: false,
  adjustment: null
}

test.describe('watch stats', () => {
  test.use({
    seed: {
      watchStats: [
        { _id: today, date: today, seconds: 3600 },
        { _id: yesterday, date: yesterday, seconds: 1800 },
        migrationDone
      ]
    }
  })

  test('summary cards show the seeded totals', async ({ page }) => {
    await goTo(page, 'stats')

    const summaryCard = (label) => page.locator('.summaryCard').filter({ hasText: label })

    await expect(summaryCard('Today')).toContainText('1 hr')
    await expect(summaryCard('Total watch time')).toContainText('1 hr 30 min')

    // Both charts render with data.
    await expect(page.locator('.lineChart')).toBeVisible()
    await expect(page.locator('.barChart')).toBeVisible()
  })

  test('resetting statistics clears all recorded time', async ({ page }) => {
    await goTo(page, 'stats')
    await expect(page.locator('.summaryCard').filter({ hasText: 'Total watch time' })).toContainText('1 hr 30 min')

    await page.locator('.resetStatsButton').click()
    await page.getByRole('button', { name: 'Reset', exact: true }).click()

    await expect(page.locator('.summaryCard').filter({ hasText: 'Total watch time' })).toContainText('0 min')
  })
})

test.describe('historical watch time migration', () => {
  test.use({
    seed: {
      history: [
        {
          _id: 'watchedvid01',
          videoId: 'watchedvid01',
          title: 'Previously watched video',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          published: Date.now() - 2 * 86_400_000,
          description: '',
          viewCount: 1234,
          lengthSeconds: 600,
          watchProgress: 600,
          isWatched: true,
          timeWatched: Date.now() - 86_400_000,
          isLive: false,
          type: 'video'
        }
      ]
    }
  })

  test('estimates watch time from history and offers a playback speed adjustment', async ({ page }) => {
    await goTo(page, 'stats')

    // First visit after the migration: the adjustment prompt opens on its own.
    const prompt = page.locator('.historicalAdjustment')
    await expect(prompt).toBeVisible()

    await prompt.getByRole('button', { name: 'Apply playback speed' }).click()
    await expect(prompt).toBeHidden()

    // The estimate is marked as such and contributes to the totals:
    // 600 seconds of saved playback progress become 10 minutes.
    await expect(page.locator('.estimateNote')).toBeVisible()
    await expect(page.locator('.summaryCard').filter({ hasText: 'Total watch time' })).toContainText('10 min')
    await expect(page.locator('.adjustEstimateButton')).toBeVisible()
  })
})
