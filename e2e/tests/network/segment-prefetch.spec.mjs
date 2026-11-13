import { test, expect } from '../../helpers/innertube.mjs'
import { activeTab, findWatchComponent, openVideoOrSkip, waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// "Me at the zoo" - the oldest video on YouTube, short and stable.
const VIDEO = {
  id: 'jNQXAC9IVRw',
  title: 'Me at the zoo',
  url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
}

const CONFIGURED_LIMIT = 4

/**
 * Reads the limit shaka-player is actually running with, together with the
 * playback engine that ended up serving the streams.
 *
 * @param {import('@playwright/test').Page} page
 */
async function readPrefetchState(page) {
  const watchComponent = await page.evaluateHandle(findWatchComponent)

  return await page.locator(`${activeTab} .ftVideoPlayer`).evaluate((element, watchComponent) => {
    const overlay = element.ui ?? element.querySelector('video')?.ui
    const shakaPlayer = overlay?.getControls().getPlayer()
    if (!watchComponent || !shakaPlayer) {
      throw new Error('Unable to access the mounted player')
    }

    return {
      engine: watchComponent.proxy.activePlaybackEngine,
      segmentPrefetchLimit: shakaPlayer.getConfiguration().streaming.segmentPrefetchLimit
    }
  }, watchComponent)
}

test.describe('concurrent segment downloads', () => {
  test.describe('with yt-dlp', () => {
    test.use({
      seed: {
        settings: {
          segmentPrefetchLimit: CONFIGURED_LIMIT,
          videoPlaybackEngine: 'yt-dlp'
        }
      }
    })

    test('applies the configured limit to shaka-player', async ({ page, innertube }) => {
      test.skip(innertube.replay, 'needs the adaptive formats of the real API')
      await openVideoOrSkip(test, page, VIDEO)
      await waitForPlaybackOrSkip(test, page)

      const { engine, segmentPrefetchLimit } = await readPrefetchState(page)
      test.skip(engine !== 'yt-dlp', 'yt-dlp is unavailable, the built-in engine served the streams')

      expect(segmentPrefetchLimit).toBe(CONFIGURED_LIMIT)
    })
  })

  test.describe('with the built-in engine', () => {
    test.use({
      seed: {
        settings: {
          segmentPrefetchLimit: CONFIGURED_LIMIT,
          videoPlaybackEngine: 'built-in',
          // the built-in engine is migrated away from on startup otherwise
          ytDlpPlaybackEngineDefaultMigration: true
        }
      }
    })

    test('keeps SABR sequential', async ({ page, innertube }) => {
      test.skip(innertube.replay, 'needs the adaptive formats of the real API')
      await openVideoOrSkip(test, page, VIDEO)
      await waitForPlaybackOrSkip(test, page)

      const { engine, segmentPrefetchLimit } = await readPrefetchState(page)
      expect(engine).toBe('built-in')

      // SABR requests depend on the state the server returned for the previous
      // one, so they can't be parallelised and the setting has to be ignored
      expect(segmentPrefetchLimit).toBe(1)
    })
  })
})
