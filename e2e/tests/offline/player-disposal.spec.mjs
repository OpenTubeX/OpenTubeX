import { test, expect } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

test('Watch cleanup waits for an overlapping player teardown', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await page.evaluateHandle(findWatchComponent)
  try {
    const result = await watch.evaluate(async component => {
      const player = component.proxy.$refs.player
      const host = document.querySelector('.ftVideoPlayer')
      const video = host.querySelector('video')
      const ui = host.ui
      const originalDestroy = ui.destroy.bind(ui)
      let releaseDestroy
      let signalDestroyed
      const released = new Promise(resolve => { releaseDestroy = resolve })
      const destroyed = new Promise(resolve => { signalDestroyed = resolve })
      // Hold the return after Shaka releases its proxy's sender, while the
      // component still has a player reference. This is the unmount/save race.
      ui.destroy = async () => {
        await originalDestroy()
        signalDestroyed()
        await released
      }
      const first = player.destroyPlayer()
      await destroyed
      try {
        const second = component.proxy.destroyPlayer(player)
        const pending = Promise.all([first, second])
        releaseDestroy()
        await pending
        return { hostReleased: host.ui === null, videoReleased: video.ui === null }
      } finally {
        releaseDestroy()
        await first
      }
    })
    expect(result).toEqual({ hostReleased: true, videoReleased: true })
  } finally {
    await watch.dispose()
  }
})
