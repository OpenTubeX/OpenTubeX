import { test, expect, sel, goTo } from '../../helpers/app.mjs'

function historyEntry(videoId, title, timeWatched) {
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
    isWatched: false,
    timeWatched,
    isLive: false,
    type: 'video'
  }
}

test.use({
  seed: {
    history: [
      historyEntry('aaaaaaaaaaa', 'First test video', Date.now() - 1000),
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
})
