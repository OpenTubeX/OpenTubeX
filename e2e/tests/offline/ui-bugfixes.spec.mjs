import { test, expect, goTo } from '../../helpers/app.mjs'

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

test.describe('history reorder animation', () => {
  test.use({
    seed: {
      history: [
        historyEntry('aaaaaaaaaaa', 'Alpha video', Date.now() - 1000),
        historyEntry('bbbbbbbbbbb', 'Bravo video', Date.now() - 2000),
        historyEntry('ccccccccccc', 'Charlie video', Date.now() - 3000)
      ]
    }
  })

  // A reorder must move the existing DOM nodes, which is what lets the
  // TransitionGroup run its FLIP move animation. Index-derived keys made Vue
  // destroy and recreate the elements instead, which is the choppy "jump".
  test('reuses the same DOM nodes when entries are reordered', async ({ page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Alpha video')).toBeVisible()

    // Tag every rendered item so we can tell reuse from recreation.
    const tagged = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.autoGrid > *'))
      items.forEach((element, index) => {
        element.dataset.ftReorderProbe = String(index)
      })
      return items.length
    })
    expect(tagged).toBe(3)

    // Reorder the list, the same path a re-watched entry moving to the top takes.
    await page.locator('.sortSelect select').selectOption('earliest_played_first')

    const items = page.locator('.autoGrid > *')
    await expect(items.first()).toContainText('Charlie video')

    // Every element still carries its probe, i.e. nothing was recreated.
    const probes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.autoGrid > *'))
        .map((element) => element.dataset.ftReorderProbe ?? null)
    )
    expect(probes).toHaveLength(3)
    expect(probes).not.toContain(null)
  })
})
