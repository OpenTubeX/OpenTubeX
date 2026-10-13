import { test, expect, goTo } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  launchArgs: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      fetchSubscriptionsAutomatically: false,
      useSponsorBlock: false,
      playNextVideo: false,
      keepPlayingOnNavigation: false,
      hideSideBarOnWatchPages: false,
      holdToDoublePlaybackSpeed: true,
    }
  }
})

async function sample(page, session, label) {
  // Let notification expiry and transition cleanup finish before collecting.
  await page.waitForTimeout(5500)
  for (let i = 0; i < 3; i++) {
    await session.send('HeapProfiler.collectGarbage')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  }
  const dom = await session.send('Memory.getDOMCounters')
  const heap = await session.send('Runtime.getHeapUsage')
  const metrics = () => session.send('Performance.getMetrics').then(result => Object.fromEntries(result.metrics.map(m => [m.name, m.value])))
  const before = await metrics()
  await page.waitForTimeout(1000)
  const after = await metrics()
  const result = { label, ...dom, heapMiB: heap.usedSize / 1024 ** 2, backingMiB: heap.backingStorageSize / 1024 ** 2, idleTaskMs: 1000 * (after.TaskDuration - before.TaskDuration) }
  console.log('Session audit:', result)
  return result
}

test('repeated playback interactions retain bounded resources', async ({ app, page }) => {
  test.setTimeout(240_000)
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  const video = await openMockedVideo(page)
  await video.evaluate(element => { element.loop = true })
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  await expect(page.locator('.commentsTitle')).toBeVisible()
  const reply = page.locator('.commentReplyRootToggle .commentReplyContinuationButton').first()
  await reply.click()
  await expect(page.locator('.commentReplyBranch').first()).toBeVisible()
  await video.focus()
  const baseline = await sample(page, session, 'playback baseline')
  for (let batch = 0; batch < 3; batch++) {
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.locator('.ftVideoPlayer').hover()
      await page.keyboard.down('Space')
      try {
        await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(2)
      } finally {
        await page.keyboard.up('Space')
      }
      await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1)
      await page.evaluate(() => window.scrollTo(0, 1200))
      await reply.evaluate(button => button.click())
      await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')) })
      await page.waitForTimeout(100)
    }
    const current = await sample(page, session, `playback ${(batch + 1) * 20}`)
    expect.soft(current.heapMiB - baseline.heapMiB).toBeLessThan(8)
    expect.soft(current.nodes - baseline.nodes).toBeLessThan(1000)
    expect.soft(current.jsEventListeners - baseline.jsEventListeners).toBeLessThan(100)
  }
  await session.detach()
})

test('repeated navigation and tab creation retain bounded resources', async ({ app, page }) => {
  test.setTimeout(240_000)
  await mockPlayableWatchPage(app, page)
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  const cycle = async index => {
    await openMockedVideo(page, `audit${String(index).padStart(6, '0')}`)
    for (const route of ['history', 'userplaylists', 'settings', 'subscriptions']) {
      await goTo(page, route)
      if (route === 'settings') await page.locator('.settingsWindow').press('Escape')
    }
    await page.evaluate(async () => {
      const tab = await window.ftElectron.tabs.create({ route: '/history', makeActive: true })
      await new Promise(resolve => setTimeout(resolve, 150))
      await window.ftElectron.tabs.close(tab.id)
    })
  }
  for (let i = 0; i < 3; i++) await cycle(i)
  const baseline = await sample(page, session, 'navigation baseline')
  for (let batch = 0; batch < 3; batch++) {
    for (let i = 0; i < 8; i++) await cycle(3 + batch * 8 + i)
    const current = await sample(page, session, `navigation ${(batch + 1) * 8}`)
    expect.soft(current.heapMiB - baseline.heapMiB).toBeLessThan(8)
    expect.soft(current.nodes - baseline.nodes).toBeLessThan(1000)
    expect.soft(current.jsEventListeners - baseline.jsEventListeners).toBeLessThan(100)
  }
  await session.detach()
})
