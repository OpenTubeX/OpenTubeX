import { test, expect } from '../../helpers/innertube.mjs'
import { findWatchComponent, openVideoOrSkip, waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// "Me at the zoo" - the oldest video on YouTube, short and stable.
const VIDEO = {
  id: 'jNQXAC9IVRw',
  title: 'Me at the zoo',
  url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
}

/**
 * Leaves every request to a stream's assigned node unanswered, like an ISP-hosted
 * cache that stopped responding, and records the nodes that served the rest.
 * The assigned node is the first server in the stream's `mn` parameter.
 * @param {import('@playwright/test').Page} page
 */
async function blockAssignedMediaNodes(page) {
  const nodes = { blockedRequests: 0, served: new Set() }
  await page.route(/^https:\/\/[^/]+\.googlevideo\.com\/videoplayback/, async (route, request) => {
    const url = new URL(request.url())
    // HLS segment URLs carry their parameters as path segments
    const segments = url.pathname.split('/')
    const servers = url.searchParams.get('mn') ?? (segments[segments.indexOf('mn') + 1] ?? '').replaceAll('%2C', ',')
    if (url.hostname.endsWith(`---${servers.split(',')[0]}.googlevideo.com`)) {
      nodes.blockedRequests++
      return
    }
    nodes.served.add(url.hostname)
    await route.fallback()
  })
  return nodes
}

for (const engine of ['built-in', 'yt-dlp']) {
  test.describe(`with the ${engine} engine`, () => {
    test.use({ seed: { settings: { videoPlaybackEngine: engine, playbackEngineFallback: false } } })

    test('plays from the backup server when the assigned media node does not respond', async ({ page, innertube }) => {
      test.skip(innertube.replay, 'needs the media servers of the real API')
      test.setTimeout(120_000)
      const nodes = await blockAssignedMediaNodes(page)

      await openVideoOrSkip(test, page, VIDEO)
      await waitForPlaybackOrSkip(test, page)

      const watchComponent = await page.evaluateHandle(findWatchComponent)
      const activeEngine = await watchComponent.evaluate(component => component.proxy.activePlaybackEngine)
      await watchComponent.dispose()
      test.skip(activeEngine !== engine, `${engine} is unavailable, ${activeEngine} served the streams`)

      expect(nodes.blockedRequests).toBeGreaterThan(0)
      expect(nodes.served.size).toBeGreaterThan(0)
    })
  })
}
