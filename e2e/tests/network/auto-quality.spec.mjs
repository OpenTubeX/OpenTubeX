import { test, expect } from '../../helpers/innertube.mjs'
import { activeTab, openVideoOrSkip, waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// "Me at the zoo" - the oldest video on YouTube, short and stable.
const VIDEO = {
  id: 'jNQXAC9IVRw',
  title: 'Me at the zoo',
  url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
}

/**
 * @param {import('@playwright/test').Page} page
 */
function readAbrState(page) {
  return page.locator(`${activeTab} .ftVideoPlayer`).evaluate((element) => {
    const overlay = element.ui ?? element.querySelector('video')?.ui
    const player = overlay?.getControls().getPlayer()
    if (!player) {
      throw new Error('Unable to access the mounted player')
    }

    const autoButton = element.querySelector('.shaka-enable-abr-button')

    return {
      abrEnabled: player.getConfiguration().abr.enabled,
      autoButtonVisible: autoButton != null && getComputedStyle(autoButton).display !== 'none'
    }
  })
}

test.describe('auto quality', () => {
  test.describe('with yt-dlp', () => {
    test.use({
      seed: {
        settings: {
          defaultQuality: 'auto',
          videoPlaybackEngine: 'yt-dlp'
        }
      }
    })

    test('is offered and used', async ({ page, innertube }) => {
      test.skip(innertube.replay, 'needs the adaptive formats of the real API')
      await openVideoOrSkip(test, page, VIDEO)
      await waitForPlaybackOrSkip(test, page)

      const { abrEnabled, autoButtonVisible } = await readAbrState(page)
      expect(abrEnabled).toBe(true)
      expect(autoButtonVisible).toBe(true)
    })
  })

  test.describe('with the built-in engine', () => {
    test.use({
      seed: {
        settings: {
          defaultQuality: 'auto',
          videoPlaybackEngine: 'built-in',
          // the built-in engine is migrated away from on startup otherwise
          ytDlpPlaybackEngineDefaultMigration: true
        }
      }
    })

    test('stays hidden, as it is broken with SABR', async ({ page, innertube }) => {
      test.skip(innertube.replay, 'needs the adaptive formats of the real API')
      await openVideoOrSkip(test, page, VIDEO)
      await waitForPlaybackOrSkip(test, page)

      const { abrEnabled, autoButtonVisible } = await readAbrState(page)
      expect(abrEnabled).toBe(false)
      expect(autoButtonVisible).toBe(false)
    })
  })
})
